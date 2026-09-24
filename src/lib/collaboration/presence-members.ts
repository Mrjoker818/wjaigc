import 'server-only';

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
  await getPool().query(
    `UPDATE wujie_project_presence_members
        SET status = 'revoked', updated_at = now(), revoked_at = now()
      WHERE project_id = $1 AND owner_id = $2
        AND member_user_id = $3 AND status = 'active'`,
    [projectId, ownerId, memberUserId],
  );
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
