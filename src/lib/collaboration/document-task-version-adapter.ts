import 'server-only';

import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { outputUrls, type ProjectionTask } from '@/lib/asset-core/task-projector';
import { DocumentMediaError, type MediaAdoptionRequest, type MediaVersionImportRequest } from './document-media-request';

interface TaskRow { id: string; user_id: string; project_id: string; type: string; status: string; result: Record<string, unknown> }
interface VersionRow {
  id: string; asset_id: string; owner_id: string; project_id: string; task_id: string | null;
  file_url: string; recovery_source_url: string | null; storage_key: string | null; checksum: string | null;
  mime_type: string; byte_size: string | null; metadata: Record<string, unknown>; availability: string;
  kind: 'image' | 'video'; version_record: Record<string, unknown>; asset_record: Record<string, unknown>;
  project_record: Record<string, unknown>;
}
function forbidden(): never { throw new DocumentMediaError('DOCUMENT_MEDIA_SOURCE_FORBIDDEN'); }
async function readPrivateVersion(actorId: string, sourceVersionId: string, client?: PoolClient): Promise<VersionRow> {
  const db = client ?? getPool();
  const row = (await db.query<VersionRow>(`SELECT version.*,asset.kind,
    to_jsonb(version) AS version_record,to_jsonb(asset) AS asset_record,to_jsonb(project) AS project_record
    FROM wujie_asset_versions version
    JOIN wujie_assets asset ON asset.id=version.asset_id AND asset.owner_id=version.owner_id AND asset.project_id=version.project_id
    JOIN wujie_projects project ON project.id=version.project_id AND project.owner_id=version.owner_id
    WHERE version.id=$1 AND version.owner_id=$2 AND version.availability='ready'
      AND asset.status='active' AND project.status='active' AND asset.kind IN ('image','video')
      ${client ? 'FOR SHARE OF version,asset,project' : ''}`, [sourceVersionId, actorId])).rows[0];
  if (!row || row.id !== sourceVersionId || row.owner_id !== actorId
    || row.asset_record.id !== row.asset_id || row.asset_record.owner_id !== actorId
    || row.asset_record.project_id !== row.project_id || row.project_record.id !== row.project_id
    || row.project_record.owner_id !== actorId || row.availability !== 'ready'
    || row.asset_record.status !== 'active' || row.project_record.status !== 'active'
    || (row.kind !== 'image' && row.kind !== 'video')) forbidden();
  return row;
}
async function readTaskVersion(actorId: string, row: VersionRow, client?: PoolClient): Promise<{ task: TaskRow; source: VersionRow; outputIndex: number }> {
  const db = client ?? getPool();
  const task = (await db.query<TaskRow>(`SELECT id,user_id,project_id,type,status,result FROM cloud_tasks
    WHERE id=$1 AND user_id=$2 ${client ? 'FOR SHARE' : ''}`, [row.task_id, actorId])).rows[0];
  const publication = await db.query('SELECT 1 FROM wujie_canvas_task_publications WHERE task_id=$1', [row.task_id]);
  const index = row.metadata?.outputIndex;
  if (!task || task.id !== row.task_id || task.user_id !== actorId || task.project_id !== row.project_id
    || task.status !== 'completed' || !task.result || typeof task.result !== 'object' || Array.isArray(task.result)
    || !task.type || publication.rows.length !== 0 || row.metadata?.source !== 'task-projection'
    || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) forbidden();
  const type = task.type.toLowerCase();
  const kind = type.includes('video') ? 'video' : 'image';
  if ((!type.includes('video') && (type.includes('3d') || type.includes('model'))) || row.kind !== kind) forbidden();
  const url = outputUrls({ ...task, userId: task.user_id, status: 'completed' } as ProjectionTask)[index];
  if (!url || (row.file_url !== url && row.recovery_source_url !== url)) forbidden();
  return { task, source: row, outputIndex: index };
}
declare const privateVersionBrand: unique symbol;
export interface PreparedPrivateTaskVersion { readonly [privateVersionBrand]: true }
interface PrivateSnapshot { actorId: string; input: MediaAdoptionRequest; task: TaskRow; source: VersionRow; outputIndex: number }
const privateVersions = new WeakMap<PreparedPrivateTaskVersion, PrivateSnapshot>();
/** No browser-supplied task/output identity and no URL-based task lookup. */
export async function resolvePrivateTaskVersion(actorId: string, input: MediaVersionImportRequest):
Promise<{ input: MediaAdoptionRequest; source: PreparedPrivateTaskVersion } | undefined> {
  const row = await readPrivateVersion(actorId, input.sourceVersionId);
  if (row.task_id === null) return undefined;
  const snapshot = await readTaskVersion(actorId, row);
  const derived = { ...input, taskId: snapshot.task.id, outputIndex: snapshot.outputIndex };
  const source = Object.freeze({}) as PreparedPrivateTaskVersion;
  privateVersions.set(source, structuredClone({ actorId, input: derived, ...snapshot }));
  return { input: derived, source };
}
/** Re-read at preparation and final transaction; even equal-URL slots cannot drift. */
export async function readBoundPrivateTaskVersion(actorId: string,
  input: Pick<MediaAdoptionRequest, 'projectId' | 'taskId' | 'outputIndex' | 'sourceVersionId'>,
  capability: PreparedPrivateTaskVersion, client?: PoolClient): Promise<{ task: TaskRow; source: VersionRow; outputIndex: number }> {
  const previous = privateVersions.get(capability);
  if (!previous || previous.actorId !== actorId || previous.input.projectId !== input.projectId
    || previous.input.taskId !== input.taskId || previous.input.outputIndex !== input.outputIndex
    || previous.input.sourceVersionId !== input.sourceVersionId) throw new DocumentMediaError('DOCUMENT_MEDIA_CONFLICT');
  try {
    const row = await readPrivateVersion(actorId, input.sourceVersionId!, client);
    const current = await readTaskVersion(actorId, row, client);
    if (!isDeepStrictEqual(previous.task, current.task) || !isDeepStrictEqual(previous.source, current.source)
      || previous.outputIndex !== current.outputIndex) throw new DocumentMediaError('DOCUMENT_MEDIA_CONFLICT');
    return current;
  } catch (error) {
    if (error instanceof DocumentMediaError) throw new DocumentMediaError('DOCUMENT_MEDIA_CONFLICT');
    throw error;
  }
}
