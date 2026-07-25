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

// ─── 品牌 IP 资产持久化 ──────────────────────────────────────────────

export type BrandIpAssetType = 'character-standard' | 'monochrome' | 'small-format' | 'emoji-pack';

export interface BrandIpAsset {
  id: string;
  projectId: string;
  userId: string;
  taskId: string | null;
  imageUrl: string;
  prompt: string | null;
  model: string | null;
  providerId: string | null;
  directionId: string | null;
  version: number;
  status: 'active' | 'archived' | 'failed';
  assetType: BrandIpAssetType;
  favorite: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface BrandIpAssetRow {
  id: string;
  project_id: string;
  user_id: string;
  task_id: string | null;
  image_url: string;
  prompt: string | null;
  model: string | null;
  provider_id: string | null;
  direction_id: string | null;
  version: number;
  status: string;
  metadata: string | null;
  created_at: string;
}

function rowToAsset(row: BrandIpAssetRow): BrandIpAsset {
  const metadata = row.metadata ? (() => { try { return JSON.parse(row.metadata as string) as Record<string, unknown>; } catch { return null; } })() : null;
  const assetType = metadata?.assetType;
  const validAssetTypes: BrandIpAssetType[] = ['character-standard', 'monochrome', 'small-format', 'emoji-pack'];

  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    taskId: row.task_id,
    imageUrl: row.image_url,
    prompt: row.prompt,
    model: row.model,
    providerId: row.provider_id,
    directionId: row.direction_id,
    version: row.version,
    status: row.status as BrandIpAsset['status'],
    assetType: typeof assetType === 'string' && validAssetTypes.includes(assetType as BrandIpAssetType)
      ? assetType as BrandIpAssetType
      : 'character-standard',
    favorite: metadata?.favorite === true,
    metadata,
    createdAt: row.created_at,
  };
}

let assetTablesEnsured = false;

async function ensureBrandIpAssetTables(): Promise<void> {
  if (assetTablesEnsured) return;
  await execSql(`
    CREATE TABLE IF NOT EXISTS brand_ip_assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      task_id TEXT,
      image_url TEXT NOT NULL,
      prompt TEXT,
      model TEXT,
      provider_id TEXT,
      direction_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB,
      created_at TEXT NOT NULL
    )
  `);
  await execSql('CREATE INDEX IF NOT EXISTS idx_brand_ip_assets_project ON brand_ip_assets(project_id, user_id, created_at DESC)');
  assetTablesEnsured = true;
}

export interface SaveBrandIpAssetInput {
  projectId: string;
  userId: string;
  taskId?: string | null;
  imageUrl: string;
  prompt?: string | null;
  model?: string | null;
  providerId?: string | null;
  directionId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function saveBrandIpAsset(input: SaveBrandIpAssetInput): Promise<BrandIpAsset> {
  await ensureBrandIpAssetTables();
  const id = `asset-${nanoid(12)}`;
  const now = new Date().toISOString();

  // Determine next version number
  const versionResult = await execSql(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM brand_ip_assets WHERE project_id = $1 AND user_id = $2 AND direction_id = $3',
    [input.projectId, input.userId, input.directionId || ''],
  );
  const version = (versionResult.rows[0] as unknown as { next_version: number })?.next_version ?? 1;

  const result = await execSql(`
    INSERT INTO brand_ip_assets (
      id, project_id, user_id, task_id, image_url, prompt, model, provider_id,
      direction_id, version, status, metadata, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12)
    RETURNING *
  `, [
    id,
    input.projectId,
    input.userId,
    input.taskId ?? null,
    input.imageUrl,
    input.prompt ?? null,
    input.model ?? null,
    input.providerId ?? null,
    input.directionId ?? null,
    version,
    input.metadata ? JSON.stringify(input.metadata) : null,
    now,
  ]);

  return rowToAsset(result.rows[0] as unknown as BrandIpAssetRow);
}

export async function listBrandIpAssets(
  projectId: string,
  userId: string,
  status: 'active' | 'archived' | 'all' = 'active',
): Promise<BrandIpAsset[]> {
  await ensureBrandIpAssetTables();
  const result = status === 'all'
    ? await execSql(
      'SELECT * FROM brand_ip_assets WHERE project_id = $1 AND user_id = $2 ORDER BY created_at DESC',
      [projectId, userId],
    )
    : await execSql(
      'SELECT * FROM brand_ip_assets WHERE project_id = $1 AND user_id = $2 AND status = $3 ORDER BY created_at DESC',
      [projectId, userId, status],
    );
  return (result.rows as unknown as BrandIpAssetRow[]).map(rowToAsset);
}

async function updateBrandIpAsset(
  projectId: string,
  userId: string,
  assetId: string,
  changes: { status?: 'active' | 'archived'; favorite?: boolean },
): Promise<BrandIpAsset | null> {
  await ensureBrandIpAssetTables();
  const existingResult = await execSql(
    'SELECT * FROM brand_ip_assets WHERE id = $1 AND project_id = $2 AND user_id = $3 LIMIT 1',
    [assetId, projectId, userId],
  );
  const existing = existingResult.rows[0] as unknown as BrandIpAssetRow | undefined;
  if (!existing) return null;

  const currentMetadata = rowToAsset(existing).metadata ?? {};
  const metadata = changes.favorite === undefined
    ? currentMetadata
    : { ...currentMetadata, favorite: changes.favorite };
  const nextStatus = changes.status ?? existing.status;
  const result = await execSql(
    'UPDATE brand_ip_assets SET status = $1, metadata = $2 WHERE id = $3 AND project_id = $4 AND user_id = $5 RETURNING *',
    [nextStatus, JSON.stringify(metadata), assetId, projectId, userId],
  );
  const row = result.rows[0] as unknown as BrandIpAssetRow | undefined;
  return row ? rowToAsset(row) : null;
}

export async function setBrandIpAssetFavorite(
  projectId: string,
  userId: string,
  assetId: string,
  favorite: boolean,
): Promise<BrandIpAsset | null> {
  return updateBrandIpAsset(projectId, userId, assetId, { favorite });
}

export async function setBrandIpAssetStatus(
  projectId: string,
  userId: string,
  assetId: string,
  status: 'active' | 'archived',
): Promise<BrandIpAsset | null> {
  return updateBrandIpAsset(projectId, userId, assetId, { status });
}
