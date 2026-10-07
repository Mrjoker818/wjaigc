import 'server-only';

import { getPool } from '@/lib/db-client';
import type { ProjectCompletedTaskInput } from '@/lib/asset-core/task-projector';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { publishPreparedDocumentTaskBatch } from './document-media-import';
import { prepareTaskPublication } from './task-publication-output';
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
  // Structured Skill parents still return [] without a completed marker.
  return publishPreparedDocumentTaskBatch(capability);
}
