import 'server-only';
import type { PoolClient } from 'pg';
import { getPool, isDatabaseConfigured } from '@/lib/db-client';

export type GenerationProjectAccess =
  | { kind: 'unscoped'; actorUserId: string }
  | { kind: 'personal'; actorUserId: string; ownerId: string; projectId: string }
  | { kind: 'document'; actorUserId: string; ownerId: string; projectId: string; grantGeneration: string };

export class GenerationProjectAccessError extends Error {
  readonly status: 400 | 403 | 503;

  constructor(readonly code: 'GENERATION_PROJECT_INVALID' | 'GENERATION_PROJECT_FORBIDDEN' | 'GENERATION_PROJECT_UNAVAILABLE') {
    const errors = {
      GENERATION_PROJECT_INVALID: { status: 400, message: '项目参数无效' },
      GENERATION_PROJECT_FORBIDDEN: { status: 403, message: '无权在此项目中生成图片' },
      GENERATION_PROJECT_UNAVAILABLE: { status: 503, message: '项目权限服务暂不可用，请稍后重试' },
    } as const;
    super(errors[code].message);
    this.name = 'GenerationProjectAccessError';
    this.status = errors[code].status;
  }
}

/** A point-in-time admission only, never a permit for a later document write. */
export async function authorizeGenerationProject(input: {
  actorUserId: string; projectId: unknown;
}): Promise<GenerationProjectAccess> {
  const { actorUserId, projectId } = input;
  if (projectId === undefined || projectId === null || projectId === '') {
    return { kind: 'unscoped', actorUserId };
  }
  if (typeof projectId !== 'string' || projectId.length > 256
    || projectId.trim() !== projectId || /\p{Cc}/u.test(projectId)) {
    throw new GenerationProjectAccessError('GENERATION_PROJECT_INVALID');
  }

  let client: PoolClient | undefined;
  let discardClient = false;
  try {
    if (!isDatabaseConfigured()) throw new GenerationProjectAccessError('GENERATION_PROJECT_UNAVAILABLE');
    client = await getPool().connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const access = await readGenerationProjectAccess(client, actorUserId, projectId);
    await client.query('COMMIT');
    return access;
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); }
      catch { discardClient = true; }
    }
    if (error instanceof GenerationProjectAccessError && !discardClient) throw error;
    // Database details, SQL and connection credentials never become a public cause/message.
    throw new GenerationProjectAccessError('GENERATION_PROJECT_UNAVAILABLE');
  } finally {
    client?.release(discardClient);
  }
}

export async function readGenerationProjectAccess(
  client: Pick<PoolClient, 'query'>, actorUserId: string, projectId: string,
): Promise<GenerationProjectAccess> {
  const forbidden = (): never => { throw new GenerationProjectAccessError('GENERATION_PROJECT_FORBIDDEN'); };
  const actor = await client.query<{ status: string }>('SELECT status FROM wujie_users WHERE id = $1', [actorUserId]);
  if (actor.rows[0]?.status !== 'active') return forbidden();

  // Do not filter by owner/status: an existing foreign or trashed row is authoritative.
  const result = await client.query<{
    owner_id: string; status: string; owner_status: string | null; enabled: boolean | null; has_document: boolean;
  }>(`SELECT p.owner_id, p.status, owner_user.status AS owner_status, settings.enabled,
      EXISTS (SELECT 1 FROM wujie_project_canvas_documents doc
        WHERE doc.project_id = p.id AND doc.owner_id = p.owner_id) AS has_document
    FROM wujie_projects p
    LEFT JOIN wujie_users owner_user ON owner_user.id = p.owner_id
    LEFT JOIN wujie_project_document_settings settings ON settings.project_id = p.id AND settings.owner_id = p.owner_id
    WHERE p.id = $1`, [projectId]);
  const project = result.rows[0];
  if (!project) {
    const legacy = await client.query<{ data_value: unknown }>(
      "SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = 'projects'", [actorUserId],
    );
    let value = legacy.rows[0]?.data_value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value) as unknown; }
      catch { return forbidden(); }
    }
    const matches: Record<string, unknown>[] = Array.isArray(value)
      ? value.filter((entry: unknown): entry is Record<string, unknown> => (
          typeof entry === 'object' && entry !== null && 'id' in entry && entry.id === projectId
        ))
      : [];
    if (matches.length !== 1 || matches[0].userId !== actorUserId
      || (matches[0].status !== undefined && matches[0].status !== 'active')) return forbidden();
    return { kind: 'personal', actorUserId, ownerId: actorUserId, projectId };
  }
  if (project.status !== 'active' || project.owner_status !== 'active') return forbidden();
  const ownerId = project.owner_id;
  if (project.has_document || project.enabled === true) {
    if (!project.has_document || project.enabled !== true || process.env.WUJIE_YJS_ENABLED !== 'true') return forbidden();
    if (actorUserId === ownerId) return { kind: 'document', actorUserId, ownerId, projectId, grantGeneration: '0' };
    const editor = await client.query<{ grant_generation: string }>(
      `SELECT grant_generation::text FROM wujie_project_document_editors
        WHERE project_id = $1 AND owner_id = $2 AND member_user_id = $3 AND status = 'active'`,
      [projectId, ownerId, actorUserId],
    );
    if (!editor.rows[0]) return forbidden();
    return { kind: 'document', actorUserId, ownerId, projectId, grantGeneration: editor.rows[0].grant_generation };
  }
  if (actorUserId !== ownerId) return forbidden();
  return { kind: 'personal', actorUserId, ownerId, projectId };
}
