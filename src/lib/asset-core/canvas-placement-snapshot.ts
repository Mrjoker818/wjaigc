import type { AssetCoreSqlTransaction } from './storage';
import type { WorkspacePlacement } from './types';

export async function trashCanvasPlacementSnapshotInTransaction(
  client: AssetCoreSqlTransaction,
  ownerId: string,
  projectId: string,
  placement: WorkspacePlacement,
): Promise<number> {
  const snapshot = await client.query<{ data_value: unknown }>(
    `SELECT data_value FROM wujie_user_data
     WHERE user_id = $1 AND data_key = 'projects'
     FOR UPDATE`,
    [ownerId],
  );
  const projects = Array.isArray(snapshot.rows[0]?.data_value)
    ? snapshot.rows[0].data_value as Array<Record<string, unknown>>
    : null;
  if (!projects) throw new Error('Canvas project snapshot is unavailable');
  const project = projects.find(candidate => candidate.id === projectId);
  if (!project) throw new Error('Canvas project snapshot is unavailable');
  const canvasImages = Array.isArray(project.canvasImages)
    ? project.canvasImages as Array<Record<string, unknown>>
    : [];
  project.canvasImages = canvasImages.filter(candidate => candidate.id !== placement.entityId);
  project.updatedAt = Date.now();
  await client.query(
    `UPDATE wujie_user_data
     SET data_value = $2::jsonb, updated_at = $3
     WHERE user_id = $1 AND data_key = 'projects'`,
    [ownerId, JSON.stringify(projects), Date.now()],
  );
  const revision = await client.query<{ revision: string }>(
    `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
     VALUES ($1, '__asset_graph_projects_revision', '1'::jsonb, $2)
     ON CONFLICT (user_id, data_key) DO UPDATE SET
       data_value = to_jsonb(COALESCE(
         CASE
           WHEN jsonb_typeof(wujie_user_data.data_value) = 'number'
             THEN (wujie_user_data.data_value #>> '{}')::bigint
           WHEN jsonb_typeof(wujie_user_data.data_value) = 'string'
                AND (wujie_user_data.data_value #>> '{}') ~ '^\\d+$'
             THEN (wujie_user_data.data_value #>> '{}')::bigint
           ELSE 0
         END,
         0
       ) + 1),
       updated_at = EXCLUDED.updated_at
     RETURNING data_value #>> '{}' AS revision`,
    [ownerId, Date.now()],
  );
  const nextRevision = Number(revision.rows[0]?.revision ?? 0);
  await client.query(
    `UPDATE wujie_workspace_placements
     SET metadata = metadata || jsonb_build_object('canvasTrashProjectRevision', $4::bigint),
         updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND status = 'trashed'`,
    [placement.id, ownerId, projectId, nextRevision],
  );
  placement.metadata = {
    ...(placement.metadata ?? {}),
    canvasTrashProjectRevision: nextRevision,
  };
  return nextRevision;
}
