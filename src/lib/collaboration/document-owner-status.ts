import 'server-only';

import { getPool } from '@/lib/db-client';
import { PROJECT_REVISION_DATA_KEY } from '@/lib/asset-core/canvas-project-sync';
import { DocumentAccessError } from '@/lib/collaboration/document-access';

export interface DocumentOwnerStatus {
  projectId: string;
  featureEnabled: boolean;
  enabled: boolean;
  currentRevision: number;
}

function authorityConflict(): Error & { code: string } {
  return Object.assign(new Error('项目协作权威记录不一致'), { code: 'DOCUMENT_AUTHORITY_CONFLICT' });
}

export async function readDocumentOwnerStatus(ownerId: string, projectId: string): Promise<DocumentOwnerStatus> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const owner = await client.query("SELECT 1 FROM wujie_users WHERE id=$1 AND status='active'", [ownerId]);
    if (owner.rowCount !== 1) throw new DocumentAccessError();
    const snapshot = await client.query<{ data_value: unknown }>(
      "SELECT data_value FROM wujie_user_data WHERE user_id=$1 AND data_key='projects'", [ownerId],
    );
    let projects: unknown = snapshot.rows[0]?.data_value;
    if (typeof projects === 'string') {
      try { projects = JSON.parse(projects) as unknown; } catch { throw authorityConflict(); }
    }
    if (projects === undefined) throw new DocumentAccessError();
    if (!Array.isArray(projects)) throw authorityConflict();
    const matches = projects.filter((project: unknown) => typeof project === 'object' && project !== null
      && 'id' in project && project.id === projectId);
    if (matches.length === 0) throw new DocumentAccessError();
    if (matches.length !== 1) throw authorityConflict();
    const project: unknown = matches[0];
    if (typeof project !== 'object' || project === null || !('userId' in project)
      || project.userId !== ownerId) throw new DocumentAccessError();
    const graph = await client.query<{ owner_id: string; status: string }>(
      'SELECT owner_id,status FROM wujie_projects WHERE id=$1', [projectId],
    );
    if (graph.rows.length && (graph.rows[0].owner_id !== ownerId || graph.rows[0].status !== 'active')) {
      throw new DocumentAccessError();
    }
    const setting = await client.query<{ enabled: boolean }>(
      'SELECT enabled FROM wujie_project_document_settings WHERE project_id=$1 AND owner_id=$2', [projectId, ownerId],
    );
    const document = await client.query(
      'SELECT 1 FROM wujie_project_canvas_documents WHERE project_id=$1 AND owner_id=$2', [projectId, ownerId],
    );
    const enabled = setting.rows[0]?.enabled === true;
    if (enabled !== (document.rowCount === 1) || (enabled && graph.rowCount !== 1)) throw authorityConflict();
    const revision = await client.query<{ data_value: unknown }>(
      'SELECT data_value FROM wujie_user_data WHERE user_id=$1 AND data_key=$2', [ownerId, PROJECT_REVISION_DATA_KEY],
    );
    const value = revision.rows[0]?.data_value;
    const currentRevision = revision.rows.length === 0 ? 0
      : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof currentRevision !== 'number' || !Number.isSafeInteger(currentRevision) || currentRevision < 0) {
      throw authorityConflict();
    }
    await client.query('COMMIT');
    return { projectId, featureEnabled: process.env.WUJIE_YJS_ENABLED === 'true', enabled, currentRevision };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
