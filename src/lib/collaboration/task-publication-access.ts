import 'server-only';

import type { PoolClient } from 'pg';
import { DocumentAccessError } from './document-access';
import { CanvasTaskPublicationError } from './task-publication';
import { CanvasPublicationIntentError, parseCanvasTaskPublicationIntent,
  type CanvasTaskPublicationIntent } from './task-publication-intent';

export type TaskPublicationAccess = Readonly<{
  taskId: string;
  actorId: string;
  ownerId: string;
  projectId: string;
  workspaceId: string;
  grantGeneration: string;
}> | null;

/** Read only, inside the caller's short transaction. Lock task before publication
 * and before project authorization; absence is distinct from an unavailable read. */
export async function readTaskPublicationAccess(
  client: PoolClient, actorId: string, taskId: string,
): Promise<TaskPublicationAccess> {
  try {
    const task = (await client.query<{ user_id: string; project_id: string }>(
      'SELECT user_id,project_id FROM cloud_tasks WHERE id=$1 FOR SHARE', [taskId],
    )).rows[0];
    const publication = (await client.query<NonNullable<TaskPublicationAccess>>(`SELECT
      task_id AS "taskId",actor_id AS "actorId",owner_id AS "ownerId",project_id AS "projectId",
      workspace_id AS "workspaceId",grant_generation::text AS "grantGeneration"
      FROM wujie_canvas_task_publications WHERE task_id=$1 FOR SHARE`, [taskId])).rows[0];
    if (!publication) return null;
    if (!task || task.user_id !== actorId || publication.actorId !== actorId
      || task.project_id !== publication.projectId || publication.taskId !== taskId
      || publication.workspaceId !== publication.projectId
      || !/^(0|[1-9][0-9]*)$/u.test(publication.grantGeneration)
      || (publication.ownerId === actorId ? publication.grantGeneration !== '0' : publication.grantGeneration === '0')) {
      throw new DocumentAccessError();
    }
    return Object.freeze(publication);
  } catch (error) {
    if (error instanceof DocumentAccessError) throw error;
    throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_UNAVAILABLE');
  }
}

/** Historical data, not current publishing authority. Never recompute from today's canvas. */
export async function readTaskPublicationIntent(
  client: PoolClient, actorId: string, taskId: string,
): Promise<CanvasTaskPublicationIntent | null> {
  try {
    if (!await readTaskPublicationAccess(client, actorId, taskId)) return null;
    const row = (await client.query<{ publication_intent: unknown }>(
      'SELECT publication_intent FROM wujie_canvas_task_publications WHERE task_id=$1 FOR SHARE', [taskId],
    )).rows[0];
    if (row?.publication_intent === null) return null;
    return parseCanvasTaskPublicationIntent(row?.publication_intent);
  } catch (error) {
    if (error instanceof DocumentAccessError || error instanceof CanvasTaskPublicationError) throw error;
    if (error instanceof CanvasPublicationIntentError) throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_CONFLICT');
    throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_UNAVAILABLE');
  }
}
