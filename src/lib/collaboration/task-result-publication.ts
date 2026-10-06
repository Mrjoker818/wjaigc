import 'server-only';

import { getPool } from '@/lib/db-client';
import type { ProjectCompletedTaskInput } from '@/lib/asset-core/task-projector';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { publishPreparedDocumentTaskOutput } from './document-media-import';
import { assertTaskPublication, prepareTaskPublication, taskPublicationSnapshot } from './task-publication-output';
export { canvasTaskOutputCommandKey } from './task-publication-output';

/** Selection only. Publication still revalidates the actual intent and authority. */
export async function hasPersistedCanvasPublicationIntent(actorId: string, taskId: string): Promise<boolean> {
  const result = await getPool().query(`SELECT 1 FROM wujie_canvas_task_publications p
    JOIN cloud_tasks t ON t.id=p.task_id AND t.user_id=p.actor_id AND t.project_id=p.project_id
    WHERE p.task_id=$1 AND p.actor_id=$2 AND p.publication_intent IS NOT NULL AND t.status='completed'`, [taskId, actorId]);
  return result.rowCount === 1;
}

export async function projectCanvasTaskResult(input: ProjectCompletedTaskInput): Promise<WorkspaceAssetReference[] | null> {
  const capability = await prepareTaskPublication(input.actorUserId, input.taskId, input.targetProjectId, input.workspace);
  if (!capability) return null;
  const snapshot = taskPublicationSnapshot(capability);
  const references: WorkspaceAssetReference[] = [];
  for (const request of snapshot.requests) {
    references.push((await publishPreparedDocumentTaskOutput(capability, request.outputIndex)).assetReference);
  }
  // Structured Skill parent results have no direct media; never mark empty success.
  if (!references.length) return references;
  const client = await getPool().connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    // UPDATE first: concurrent completed/pending recorders cannot SHARE-upgrade deadlock.
    await client.query('SELECT 1 FROM cloud_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE', [input.taskId, input.actorUserId]);
    await assertTaskPublication(client, capability);
    await client.query(`UPDATE cloud_tasks SET result=jsonb_set(result,'{assetProjection}',$3::jsonb,true)
      WHERE id=$1 AND user_id=$2 AND status='completed'
        AND COALESCE(result->'assetProjection'->>'status','') <> 'completed'`,
    [input.taskId, input.actorUserId, JSON.stringify({ status: 'completed', references,
      versionIds: references.map(ref => ref.assetVersionId), completedAt: new Date().toISOString() })]);
    await client.query('COMMIT');
    return references;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}
