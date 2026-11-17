/** Drama project persistence. Every query is scoped to the owner; saves use `version` as an optimistic lock. */
import 'server-only';
import { randomUUID } from 'crypto';
import { execSql } from '@/lib/db-client';
import type { DramaProjectRecord, DramaProjectV1 } from './types';

export class DramaVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super('DRAMA_VERSION_CONFLICT');
    this.name = 'DramaVersionConflictError';
  }
}

type Row = Record<string, unknown>;

function toRecord(row: Row): DramaProjectRecord {
  return {
    id: String(row.id),
    projectId: row.project_id == null ? null : String(row.project_id),
    title: String(row.title ?? ''),
    doc: (typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc) as DramaProjectV1,
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export interface DramaProjectSummary {
  id: string;
  projectId: string | null;
  title: string;
  version: number;
  updatedAt: number;
}

export async function listDramaProjects(userId: string, projectId?: string): Promise<DramaProjectSummary[]> {
  const result = projectId
    ? await execSql(
      `SELECT id, project_id, title, version, updated_at FROM wujie_drama_projects
        WHERE user_id = $1 AND project_id = $2 ORDER BY updated_at DESC LIMIT 100`, [userId, projectId])
    : await execSql(
      `SELECT id, project_id, title, version, updated_at FROM wujie_drama_projects
        WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`, [userId]);
  return result.rows.map(row => ({
    id: String(row.id),
    projectId: row.project_id == null ? null : String(row.project_id),
    title: String(row.title ?? ''),
    version: Number(row.version),
    updatedAt: Number(row.updated_at),
  }));
}

export async function createDramaProject(userId: string, projectId: string | null, doc: DramaProjectV1): Promise<DramaProjectRecord> {
  const now = Date.now();
  const result = await execSql(
    `INSERT INTO wujie_drama_projects (id, user_id, project_id, title, doc, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 1, $6, $6)
     RETURNING id, project_id, title, doc, version, created_at, updated_at`,
    [`drama_${randomUUID()}`, userId, projectId, doc.title, JSON.stringify(doc), now],
  );
  return toRecord(result.rows[0]);
}

export async function getDramaProject(userId: string, id: string): Promise<DramaProjectRecord | null> {
  const result = await execSql(
    `SELECT id, project_id, title, doc, version, created_at, updated_at FROM wujie_drama_projects
      WHERE id = $1 AND user_id = $2`, [id, userId]);
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

/** Saves only when `expectedVersion` still matches; returns null when the project does not exist for this user. */
export async function saveDramaProject(
  userId: string, id: string, expectedVersion: number, doc: DramaProjectV1,
): Promise<DramaProjectRecord | null> {
  const result = await execSql(
    `UPDATE wujie_drama_projects SET doc = $4::jsonb, title = $5, version = version + 1, updated_at = $6
      WHERE id = $1 AND user_id = $2 AND version = $3
      RETURNING id, project_id, title, doc, version, created_at, updated_at`,
    [id, userId, expectedVersion, JSON.stringify(doc), doc.title, Date.now()],
  );
  if (result.rows[0]) return toRecord(result.rows[0]);
  const current = await execSql('SELECT version FROM wujie_drama_projects WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!current.rows[0]) return null;
  throw new DramaVersionConflictError(Number(current.rows[0].version));
}

export async function deleteDramaProject(userId: string, id: string): Promise<boolean> {
  const result = await execSql('DELETE FROM wujie_drama_projects WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rowCount > 0;
}
