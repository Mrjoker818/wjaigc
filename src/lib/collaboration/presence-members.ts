import 'server-only';

import type { PoolClient } from 'pg';

import { getPool } from '@/lib/db-client';

export class PresenceMemberError extends Error {
  readonly code = 'PRESENCE_FORBIDDEN';

  constructor() {
    super('无权进入或管理此项目的在线状态');
    this.name = 'PresenceMemberError';
  }
}

async function assertPresenceOwner(ownerId: string, projectId: string): Promise<void> {
  const result = await getPool().query(
    `SELECT 1
       FROM wujie_projects p
       JOIN wujie_users owner_user ON owner_user.id = p.owner_id
      WHERE p.id = $1 AND p.owner_id = $2
        AND p.status = 'active' AND owner_user.status = 'active'`,
    [projectId, ownerId],
  );
  if (result.rowCount !== 1) throw new PresenceMemberError();
}

export async function assertPresenceMember(
  actorUserId: string,
  projectId: string,
): Promise<void> {
  const result = await getPool().query(
    `SELECT 1
       FROM wujie_projects p
       JOIN wujie_users actor ON actor.id = $1 AND actor.status = 'active'
       JOIN wujie_users owner_user ON owner_user.id = p.owner_id
      WHERE p.id = $2 AND p.status = 'active'
        AND owner_user.status = 'active'
        AND (
          p.owner_id = $1
          OR EXISTS (
            SELECT 1 FROM wujie_project_presence_members m
             WHERE m.project_id = p.id AND m.owner_id = p.owner_id
               AND m.member_user_id = $1 AND m.status = 'active'
          )
        )`,
    [actorUserId, projectId],
  );
  if (result.rowCount !== 1) throw new PresenceMemberError();
}

export async function assertPresenceMemberForLease(
  client: PoolClient,
  actorUserId: string,
  projectId: string,
): Promise<void> {
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
  if (!ownerId) throw new PresenceMemberError();
  if (ownerId === actorUserId) return;
  const member = await client.query(
    `SELECT 1 FROM wujie_project_presence_members
      WHERE project_id = $1 AND owner_id = $2
        AND member_user_id = $3 AND status = 'active'
      FOR SHARE`,
    [projectId, ownerId, actorUserId],
  );
  if (member.rowCount !== 1) throw new PresenceMemberError();
}

export async function grantPresenceMember(
  ownerId: string,
  projectId: string,
  memberUserId: string,
): Promise<void> {
  const result = await getPool().query(
    `INSERT INTO wujie_project_presence_members
       (project_id, owner_id, member_user_id, status)
     SELECT p.id, p.owner_id, member_user.id, 'active'
       FROM wujie_projects p
       JOIN wujie_users owner_user ON owner_user.id = p.owner_id
       JOIN wujie_users member_user ON member_user.id = $3
      WHERE p.id = $2 AND p.owner_id = $1
        AND p.status = 'active'
        AND owner_user.status = 'active'
        AND member_user.status = 'active'
        AND member_user.id <> p.owner_id
     ON CONFLICT (project_id, owner_id, member_user_id)
     DO UPDATE SET
       status = 'active',
       updated_at = CASE
         WHEN wujie_project_presence_members.status = 'revoked' THEN now()
         ELSE wujie_project_presence_members.updated_at
       END,
       revoked_at = NULL
     RETURNING 1`,
    [ownerId, projectId, memberUserId],
  );
  if (result.rowCount !== 1) throw new PresenceMemberError();
}

export async function revokePresenceMember(
  ownerId: string,
  projectId: string,
  memberUserId: string,
): Promise<void> {
  await assertPresenceOwner(ownerId, projectId);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE wujie_project_presence_members
          SET status = 'revoked', updated_at = now(), revoked_at = now()
        WHERE project_id = $1 AND owner_id = $2
          AND member_user_id = $3 AND status = 'active'`,
      [projectId, ownerId, memberUserId],
    );
    const leasesAvailable = await client.query<{ relation: string | null }>(
      "SELECT to_regclass('wujie_presence_leases')::text AS relation",
    );
    if (leasesAvailable.rows[0]?.relation) {
      const removed = await client.query(
        `DELETE FROM wujie_presence_leases
          WHERE project_id = $1 AND user_id = $2`,
        [projectId, memberUserId],
      );
      if (removed.rowCount) {
        await client.query(
          `INSERT INTO wujie_presence_project_sequences (project_id, sequence)
           VALUES ($1, 1)
           ON CONFLICT (project_id) DO UPDATE
             SET sequence = wujie_presence_project_sequences.sequence + 1`,
          [projectId],
        );
        await client.query("SELECT pg_notify('wujie_presence_changed', $1)", [projectId]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface PresenceMemberSummary {
  userId: string;
  name: string;
}

export async function listPresenceMembers(
  ownerId: string,
  projectId: string,
): Promise<PresenceMemberSummary[]> {
  await assertPresenceOwner(ownerId, projectId);
  const result = await getPool().query<{ user_id: string; name: string }>(
    `SELECT member_user.id AS user_id, member_user.name
       FROM wujie_project_presence_members m
       JOIN wujie_users member_user ON member_user.id = m.member_user_id
      WHERE m.project_id = $1 AND m.owner_id = $2
        AND m.status = 'active' AND member_user.status = 'active'
      ORDER BY member_user.name, member_user.id`,
    [projectId, ownerId],
  );
  return result.rows.map(row => ({ userId: row.user_id, name: row.name }));
}
