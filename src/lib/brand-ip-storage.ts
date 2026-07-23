import 'server-only';

import { nanoid } from 'nanoid';

import { execSql } from '@/lib/db-client';
import {
  getBrandIpStage,
  type BrandIpBrief,
  type BrandIpControlledVariable,
  type BrandIpDirection,
  type BrandIpImmutableCore,
  type BrandIpProject,
} from '@/lib/brand-ip';

interface BrandIpProjectRow {
  id: string;
  user_id: string;
  name: string;
  brief: BrandIpBrief | string | null;
  directions: BrandIpDirection[] | string | null;
  confirmed_direction_id: string | null;
  immutable_core: BrandIpImmutableCore[] | string | null;
  controlled_variables: BrandIpControlledVariable[] | string | null;
  current_stage: BrandIpProject['currentStage'];
  created_at: string;
  updated_at: string;
}

export interface CreateBrandIpProjectInput {
  name?: string;
  brief?: BrandIpBrief;
}

export interface UpdateBrandIpProjectInput {
  name?: string;
  brief?: BrandIpBrief;
  directions?: BrandIpDirection[];
  confirmedDirectionId?: string | null;
  immutableCore?: BrandIpImmutableCore[];
  controlledVariables?: BrandIpControlledVariable[];
}

let tablesEnsured = false;

function parseJson<T>(value: T | string | null, fallback: T): T {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToProject(row: BrandIpProjectRow): BrandIpProject {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    brief: parseJson<BrandIpBrief>(row.brief, {}),
    directions: parseJson<BrandIpDirection[]>(row.directions, []),
    confirmedDirectionId: row.confirmed_direction_id,
    immutableCore: parseJson<BrandIpImmutableCore[]>(row.immutable_core, []),
    controlledVariables: parseJson<BrandIpControlledVariable[]>(row.controlled_variables, []),
    currentStage: row.current_stage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureBrandIpTables(): Promise<void> {
  if (tablesEnsured) return;

  await execSql(`
    CREATE TABLE IF NOT EXISTS brand_ip_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      brief JSONB NOT NULL DEFAULT '{}'::jsonb,
      directions JSONB NOT NULL DEFAULT '[]'::jsonb,
      confirmed_direction_id TEXT,
      immutable_core JSONB NOT NULL DEFAULT '[]'::jsonb,
      controlled_variables JSONB NOT NULL DEFAULT '[]'::jsonb,
      current_stage TEXT NOT NULL DEFAULT 'brand-goal',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await execSql('CREATE INDEX IF NOT EXISTS idx_brand_ip_projects_user_updated ON brand_ip_projects(user_id, updated_at DESC)');
  tablesEnsured = true;
}

export async function getBrandIpProject(projectId: string, userId: string): Promise<BrandIpProject | null> {
  await ensureBrandIpTables();
  const result = await execSql(
    'SELECT * FROM brand_ip_projects WHERE id = $1 AND user_id = $2 LIMIT 1',
    [projectId, userId],
  );
  const row = result.rows[0] as unknown as BrandIpProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export async function listBrandIpProjects(userId: string): Promise<BrandIpProject[]> {
  await ensureBrandIpTables();
  const result = await execSql(
    'SELECT * FROM brand_ip_projects WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  );
  return (result.rows as unknown as BrandIpProjectRow[]).map(rowToProject);
}

export async function updateBrandIpProject(
  projectId: string,
  userId: string,
  input: UpdateBrandIpProjectInput,
): Promise<BrandIpProject | null> {
  const existing = await getBrandIpProject(projectId, userId);
  if (!existing) return null;

  const nextProject = {
    name: input.name?.trim() || existing.name,
    brief: input.brief ?? existing.brief,
    directions: input.directions ?? existing.directions,
    confirmedDirectionId: input.confirmedDirectionId === undefined
      ? existing.confirmedDirectionId
      : input.confirmedDirectionId,
    immutableCore: input.immutableCore ?? existing.immutableCore,
    controlledVariables: input.controlledVariables ?? existing.controlledVariables,
  };
  const currentStage = getBrandIpStage(nextProject);
  const updatedAt = new Date().toISOString();

  const result = await execSql(`
    UPDATE brand_ip_projects
    SET name = $1, brief = $2, directions = $3, confirmed_direction_id = $4,
        immutable_core = $5, controlled_variables = $6, current_stage = $7, updated_at = $8
    WHERE id = $9 AND user_id = $10
    RETURNING *
  `, [
    nextProject.name,
    JSON.stringify(nextProject.brief),
    JSON.stringify(nextProject.directions),
    nextProject.confirmedDirectionId,
    JSON.stringify(nextProject.immutableCore),
    JSON.stringify(nextProject.controlledVariables),
    currentStage,
    updatedAt,
    projectId,
    userId,
  ]);
  const row = result.rows[0] as unknown as BrandIpProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export async function createBrandIpProject(userId: string, input: CreateBrandIpProjectInput): Promise<BrandIpProject> {
  await ensureBrandIpTables();
  const now = new Date().toISOString();
  const id = `brand-ip-${nanoid(12)}`;
  const brief = input.brief ?? {};
  const initialProject = {
    brief,
    directions: [],
    confirmedDirectionId: null,
    immutableCore: [],
    controlledVariables: [],
  };
  const currentStage = getBrandIpStage(initialProject);

  const result = await execSql(`
    INSERT INTO brand_ip_projects (
      id, user_id, name, brief, directions, confirmed_direction_id,
      immutable_core, controlled_variables, current_stage, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [
    id,
    userId,
    input.name?.trim() || '未命名品牌 IP',
    JSON.stringify(brief),
    JSON.stringify([]),
    null,
    JSON.stringify([]),
    JSON.stringify([]),
    currentStage,
    now,
    now,
  ]);

  return rowToProject(result.rows[0] as unknown as BrandIpProjectRow);
}
