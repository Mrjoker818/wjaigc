import 'server-only';

import type { PoolClient } from 'pg';

import { getPool } from '@/lib/db-client';

export class DocumentAccessError extends Error {
  readonly code = 'DOCUMENT_FORBIDDEN';

  constructor() {
    super('无权编辑此项目文档');
    this.name = 'DocumentAccessError';
  }
}

export async function assertDocumentEditor(
  actorUserId: string,
  projectId: string,
  client?: PoolClient,
): Promise<{ ownerId: string }> {
  if (!client) {
    // A standalone permission read must use one MVCC snapshot. Mutating callers
    // pass their transaction client so these checks and their write share locks.
    const access = await getPool().query<{ owner_id: string }>(
      `SELECT p.owner_id
         FROM wujie_projects p
         JOIN wujie_users actor ON actor.id = $1 AND actor.status = 'active'
         JOIN wujie_users owner_user ON owner_user.id = p.owner_id
        WHERE p.id = $2 AND p.status = 'active' AND owner_user.status = 'active'
          AND (p.owner_id = $1 OR EXISTS (
            SELECT 1 FROM wujie_project_document_editors editor
             WHERE editor.project_id = p.id AND editor.owner_id = p.owner_id
               AND editor.member_user_id = $1 AND editor.status = 'active'
          ))`,
      [actorUserId, projectId],
    );
    const ownerId = access.rows[0]?.owner_id;
    if (!ownerId) throw new DocumentAccessError();
    return { ownerId };
  }

  const project = await client.query<{ owner_id: string }>(
    `SELECT p.owner_id
       FROM wujie_projects p
       JOIN wujie_users actor ON actor.id = $1 AND actor.status = 'active'
       JOIN wujie_users owner_user ON owner_user.id = p.owner_id
      WHERE p.id = $2 AND p.status = 'active' AND owner_user.status = 'active'
      FOR SHARE OF p, actor, owner_user`,
    [actorUserId, projectId],
  );
  const ownerId = project.rows[0]?.owner_id;
  if (!ownerId) throw new DocumentAccessError();
  if (ownerId === actorUserId) return { ownerId };

  const editor = await client.query(
    `SELECT 1 FROM wujie_project_document_editors
      WHERE project_id = $1 AND owner_id = $2
        AND member_user_id = $3 AND status = 'active'
      FOR SHARE`,
    [projectId, ownerId, actorUserId],
  );
  if (editor.rowCount !== 1) throw new DocumentAccessError();
  return { ownerId };
}

export async function grantDocumentEditor(
  ownerId: string,
  projectId: string,
  memberUserId: string,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await assertDocumentOwner(client, ownerId, projectId);
    const member = await client.query(
      `SELECT 1 FROM wujie_users
        WHERE id = $1 AND status = 'active' AND id <> $2
        FOR SHARE`,
      [memberUserId, ownerId],
    );
    if (member.rowCount !== 1) throw new DocumentAccessError();
    await client.query(
      `INSERT INTO wujie_project_document_editors
         (project_id, owner_id, member_user_id, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (project_id, owner_id, member_user_id)
       DO UPDATE SET
         status = 'active',
         grant_generation = CASE
           WHEN wujie_project_document_editors.status = 'revoked'
           THEN wujie_project_document_editors.grant_generation + 1
           ELSE wujie_project_document_editors.grant_generation
         END,
         updated_at = CASE
           WHEN wujie_project_document_editors.status = 'revoked' THEN now()
           ELSE wujie_project_document_editors.updated_at
         END,
         revoked_at = NULL`,
      [projectId, ownerId, memberUserId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeDocumentEditor(
  ownerId: string,
  projectId: string,
  memberUserId: string,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await assertDocumentOwner(client, ownerId, projectId);
    const revoked = await client.query(
      `UPDATE wujie_project_document_editors
          SET status = 'revoked',
              grant_generation = grant_generation + 1,
              updated_at = now(), revoked_at = now()
        WHERE project_id = $1 AND owner_id = $2
          AND member_user_id = $3 AND status = 'active'`,
      [projectId, ownerId, memberUserId],
    );
    if (revoked.rowCount) {
      await client.query("SELECT pg_notify('wujie_document_access_changed', $1)", [projectId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface DocumentEditorSummary {
  userId: string;
  name: string;
}

export async function listDocumentEditors(
  ownerId: string,
  projectId: string,
): Promise<DocumentEditorSummary[]> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await assertDocumentOwner(client, ownerId, projectId);
    const editors = await client.query<{ user_id: string; name: string }>(
      `SELECT member_user.id AS user_id, member_user.name
         FROM wujie_project_document_editors editor
         JOIN wujie_users member_user ON member_user.id = editor.member_user_id
        WHERE editor.project_id = $1 AND editor.owner_id = $2
          AND editor.status = 'active' AND member_user.status = 'active'
        ORDER BY member_user.name, member_user.id`,
      [projectId, ownerId],
    );
    await client.query('COMMIT');
    return editors.rows.map(row => ({ userId: row.user_id, name: row.name }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertDocumentOwner(client: PoolClient, ownerId: string, projectId: string): Promise<void> {
  const project = await client.query(
    `SELECT 1 FROM wujie_projects p
       JOIN wujie_users owner_user ON owner_user.id = p.owner_id
      WHERE p.id = $1 AND p.owner_id = $2
        AND p.status = 'active' AND owner_user.status = 'active'
      FOR SHARE OF p, owner_user`,
    [projectId, ownerId],
  );
  if (project.rowCount !== 1) throw new DocumentAccessError();
}
