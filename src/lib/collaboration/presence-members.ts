import 'server-only';

import type { PoolClient } from 'pg';

import { resolveAssetGraphMode } from '@/lib/asset-core/mode';
import { getPool } from '@/lib/db-client';

export class PresenceMemberError extends Error {
  readonly code = 'PRESENCE_FORBIDDEN';

  constructor() {
    super('无权进入或管理此项目的在线状态');
    this.name = 'PresenceMemberError';
  }
}

function usesLegacyPresenceSnapshot(): boolean {
  return process.env.WUJIE_PRESENCE_ENABLED === 'true'
    && resolveAssetGraphMode(process.env.WUJIE_ASSET_GRAPH_MODE) !== 'asset-v3';
}

function legacyProjectArraySql(alias: 'owner_projects' | 'data'): string {
  const value = `${alias}.data_value`;
  const storedString = `(${value} #>> '{}')`;
  // Historical rows may contain a JSON-encoded array as a jsonb string.
  // Validate before casting, and fail closed for malformed or non-array values.
  return `CASE
    WHEN jsonb_typeof(${value}) = 'array' THEN ${value}
    WHEN jsonb_typeof(${value}) = 'string' THEN
      CASE WHEN pg_input_is_valid(${storedString}, 'jsonb') THEN
        CASE WHEN jsonb_typeof(${storedString}::jsonb) = 'array'
          THEN ${storedString}::jsonb ELSE '[]'::jsonb END
      ELSE '[]'::jsonb END
    ELSE '[]'::jsonb END`;
}

export function legacyPresenceProjectPredicate(alias: 'p' | 'project'): string {
  if (!usesLegacyPresenceSnapshot()) return '';
  // The legacy project list owns visibility in legacy mode; a migrated graph row
  // may remain active after that list deletes the project.
  return `AND EXISTS (
    SELECT 1 FROM wujie_user_data owner_projects
    CROSS JOIN LATERAL jsonb_array_elements(
      ${legacyProjectArraySql('owner_projects')}
    ) snapshot_project(value)
     WHERE owner_projects.user_id = ${alias}.owner_id
       AND owner_projects.data_key = 'projects'
       AND jsonb_typeof(snapshot_project.value) = 'object'
       AND snapshot_project.value->>'id' = ${alias}.id
       AND (
         NULLIF(snapshot_project.value->>'userId', '') IS NULL
         OR snapshot_project.value->>'userId' = ${alias}.owner_id
       )
  )`;
}

async function ensureLegacyPresenceProject(ownerId: string, projectId: string): Promise<void> {
  if (!usesLegacyPresenceSnapshot()) return;
  const existing = await getPool().query('SELECT 1 FROM wujie_projects WHERE id = $1', [projectId]);
  if (existing.rowCount) return;
  // Existing legacy projects may predate the presence-enabled sync projection.
  // Derive only the caller's exact project from the authoritative user snapshot.
  await getPool().query(
    `INSERT INTO wujie_projects (id, owner_id, name, status, metadata)
     SELECT $2, $1, COALESCE(project.value->>'name', ''), 'active', '{"presenceProjection":true}'::jsonb
       FROM wujie_user_data data
       CROSS JOIN LATERAL jsonb_array_elements(
         ${legacyProjectArraySql('data')}
       ) project(value)
      WHERE data.user_id = $1 AND data.data_key = 'projects'
        AND jsonb_typeof(project.value) = 'object'
        AND project.value->>'id' = $2
        AND (NULLIF(project.value->>'userId', '') IS NULL OR project.value->>'userId' = $1)
     ON CONFLICT (id) DO NOTHING`,
    [ownerId, projectId],
  );
}

async function assertPresenceOwner(ownerId: string, projectId: string): Promise<void> {
  await ensureLegacyPresenceProject(ownerId, projectId);
  const result = await getPool().query(
    `SELECT 1
       FROM wujie_projects p
       JOIN wujie_users owner_user ON owner_user.id = p.owner_id
      WHERE p.id = $1 AND p.owner_id = $2
        AND p.status = 'active' AND owner_user.status = 'active'
        ${legacyPresenceProjectPredicate('p')}`,
    [projectId, ownerId],
  );
  if (result.rowCount !== 1) throw new PresenceMemberError();
}

export async function assertPresenceMember(
  actorUserId: string,
  projectId: string,
): Promise<void> {
  await ensureLegacyPresenceProject(actorUserId, projectId);
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
        )
        ${legacyPresenceProjectPredicate('p')}`,
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
        ${legacyPresenceProjectPredicate('p')}
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
        ${legacyPresenceProjectPredicate('p')}
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
