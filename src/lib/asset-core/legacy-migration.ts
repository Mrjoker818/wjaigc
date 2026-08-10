import { createHash } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';

import { getPool } from '@/lib/db-client';
import type { CanvasImage, Project } from '@/lib/user-types';

import { readProjectSnapshot, type ProjectSchemaVersion } from './project-readers';
import type { AssetFile, AssetKind } from './types';

export type LegacyMigrationErrorCode =
  | 'LEGACY_PROJECT_NOT_FOUND'
  | 'LEGACY_PROJECT_QUARANTINED'
  | 'LEGACY_MEDIA_PERSIST_FAILED'
  | 'LEGACY_MIGRATION_FAILED';

export class LegacyMigrationError extends Error {
  constructor(readonly code: LegacyMigrationErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = 'LegacyMigrationError';
  }
}

export interface LegacyMediaPersistenceInput {
  actorUserId: string;
  projectId: string;
  legacyImageId: string;
  mapping: LegacyImageMapping;
  dataUrl: string;
}

export interface LegacyMediaPersistenceResult {
  url: string;
  storageKey?: string;
  checksum?: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
}

export interface LegacyMigrationInput {
  actorUserId: string;
  projectId: string;
  persistMedia?: (
    input: LegacyMediaPersistenceInput,
  ) => Promise<LegacyMediaPersistenceResult>;
}

export interface LegacyImageMapping {
  assetId: string;
  versionId: string;
  placementId: string;
}

export interface MigrationResult {
  project: Project;
  sourceSchemaVersion: ProjectSchemaVersion;
  migrated: boolean;
  reused: boolean;
  mappings: Record<string, LegacyImageMapping>;
}

interface LegacyProjectRow extends QueryResultRow {
  legacy_project: Record<string, unknown>;
}

interface ProjectRow extends QueryResultRow {
  schema_version: number;
  metadata: Record<string, unknown>;
}

interface CheckpointRow extends QueryResultRow {
  status: 'pending' | 'running' | 'completed' | 'failed';
  checkpoint: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function migrationError(code: LegacyMigrationErrorCode, cause?: unknown): LegacyMigrationError {
  return new LegacyMigrationError(code, cause === undefined ? undefined : { cause });
}

function cloneAuditPayload(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function deterministicUuid(parts: string[]): string {
  const bytes = Buffer.from(
    createHash('sha256').update(JSON.stringify(parts)).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function mappingForLegacyImage(
  input: Pick<LegacyMigrationInput, 'actorUserId' | 'projectId'>,
  legacyImageId: string,
): LegacyImageMapping {
  const namespace = ['wujie-legacy-migration-v1', input.actorUserId, input.projectId, legacyImageId];
  return {
    assetId: deterministicUuid([...namespace, 'asset']),
    versionId: deterministicUuid([...namespace, 'version']),
    placementId: deterministicUuid([...namespace, 'placement']),
  };
}

function inferAssetKind(image: CanvasImage): AssetKind {
  const primaryUrl = image.url.toLowerCase();
  if (image.mediaType === 'video' || image.videoUrl) return 'video';
  if (primaryUrl.endsWith('.glb') || primaryUrl.endsWith('.gltf')) return 'model-3d';
  if (primaryUrl.endsWith('.psd')) return 'psd';
  if (primaryUrl.endsWith('.svg')) return 'svg';
  return 'image';
}

function imageTransform(image: CanvasImage): Record<string, unknown> {
  return {
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
    originalWidth: image.originalWidth,
    originalHeight: image.originalHeight,
    rotation: image.rotation,
    zIndex: image.zIndex,
  };
}

function checkpointMappings(checkpoint: Record<string, unknown>): Record<string, LegacyImageMapping> {
  const candidate = asRecord(checkpoint.legacyImageMappings);
  const mappings: Record<string, LegacyImageMapping> = {};
  for (const [legacyImageId, value] of Object.entries(candidate)) {
    const mapping = asRecord(value);
    if (
      typeof mapping.assetId === 'string'
      && typeof mapping.versionId === 'string'
      && typeof mapping.placementId === 'string'
    ) {
      mappings[legacyImageId] = {
        assetId: mapping.assetId,
        versionId: mapping.versionId,
        placementId: mapping.placementId,
      };
    }
  }
  return mappings;
}

async function loadAuthorizedLegacyProject(
  client: PoolClient,
  actorUserId: string,
  projectId: string,
): Promise<Record<string, unknown>> {
  const result = await client.query<LegacyProjectRow>(
    `SELECT legacy.value AS legacy_project
     FROM wujie_user_data user_data
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(user_data.data_value) = 'array' THEN user_data.data_value
         ELSE '[]'::jsonb
       END
     ) legacy(value)
     WHERE user_data.user_id = $1
       AND user_data.data_key = 'projects'
       AND legacy.value->>'id' = $2
       AND (
         NOT legacy.value ? 'userId'
         OR legacy.value->>'userId' = $1
       )
     FOR UPDATE OF user_data`,
    [actorUserId, projectId],
  );
  const project = result.rows[0]?.legacy_project;
  if (!project) throw migrationError('LEGACY_PROJECT_NOT_FOUND');
  return project;
}

function migratedProject(
  project: Project,
  sourceSchemaVersion: ProjectSchemaVersion,
  auditPayload: Record<string, unknown>,
): Project {
  return {
    ...project,
    schemaVersion: 3,
    legacyAudit: {
      sourceSchemaVersion,
      payload: cloneAuditPayload(auditPayload),
    },
  };
}

async function fileForImage(
  input: LegacyMigrationInput,
  image: CanvasImage,
  mapping: LegacyImageMapping,
): Promise<AssetFile> {
  const availability = image.mediaAvailability ?? 'ready';
  if (!image.url.startsWith('data:')) {
    return {
      url: image.url,
      availability,
      ...(image.sourceUrl ? { recoverySourceUrl: image.sourceUrl } : {}),
      ...(image.originalWidth >= 0 ? { width: image.originalWidth } : {}),
      ...(image.originalHeight >= 0 ? { height: image.originalHeight } : {}),
    };
  }
  if (!input.persistMedia) throw migrationError('LEGACY_MEDIA_PERSIST_FAILED');

  let persisted: LegacyMediaPersistenceResult;
  try {
    persisted = await input.persistMedia({
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      legacyImageId: image.id,
      mapping,
      dataUrl: image.url,
    });
  } catch (error) {
    throw migrationError('LEGACY_MEDIA_PERSIST_FAILED', error);
  }
  if (!persisted.url || persisted.url.startsWith('data:') || persisted.url.startsWith('blob:')) {
    throw migrationError('LEGACY_MEDIA_PERSIST_FAILED');
  }
  return {
    ...persisted,
    availability: 'ready',
    ...(image.sourceUrl ? { recoverySourceUrl: image.sourceUrl } : {}),
    width: persisted.width ?? image.originalWidth,
    height: persisted.height ?? image.originalHeight,
  };
}

function readCompletedProject(
  rawProject: Record<string, unknown>,
  sourceSchemaVersion: ProjectSchemaVersion,
): Project {
  const read = readProjectSnapshot(rawProject);
  if (!read.project) throw migrationError('LEGACY_PROJECT_QUARANTINED');
  return migratedProject(read.project, sourceSchemaVersion, rawProject);
}

async function existingCompletedMigration(
  client: PoolClient,
  actorUserId: string,
  projectId: string,
  rawProject: Record<string, unknown>,
  sourceSchemaVersion: ProjectSchemaVersion,
): Promise<MigrationResult | null> {
  const checkpoint = await client.query<CheckpointRow>(
    `SELECT status, checkpoint
     FROM wujie_asset_migration_checkpoints
     WHERE owner_id = $1 AND project_id = $2 AND legacy_project_id = $2
     FOR UPDATE`,
    [actorUserId, projectId],
  );
  const row = checkpoint.rows[0];
  if (!row || row.status !== 'completed') return null;

  const project = await client.query<ProjectRow>(
    `SELECT schema_version, metadata
     FROM wujie_projects
     WHERE owner_id = $1 AND id = $2 AND status = 'active'
     FOR UPDATE`,
    [actorUserId, projectId],
  );
  if (project.rows[0]?.schema_version !== 3) {
    throw migrationError('LEGACY_MIGRATION_FAILED');
  }
  return {
    project: readCompletedProject(rawProject, sourceSchemaVersion),
    sourceSchemaVersion,
    migrated: false,
    reused: true,
    mappings: checkpointMappings(row.checkpoint),
  };
}

async function insertGraphForImage(
  client: PoolClient,
  input: LegacyMigrationInput,
  image: CanvasImage,
): Promise<LegacyImageMapping> {
  const mapping = mappingForLegacyImage(input, image.id);
  const file = await fileForImage(input, image, mapping);
  const { assetId, versionId, placementId } = mapping;
  const createdAt = new Date(image.createdAt || Date.now()).toISOString();
  const metadata = JSON.stringify({ legacyImageId: image.id, legacyImage: image });

  await client.query(
    `INSERT INTO wujie_assets(
       id, owner_id, project_id, kind, status, current_version_id, metadata, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', NULL, $5::jsonb, $6, $6)`,
    [assetId, input.actorUserId, input.projectId, inferAssetKind(image), metadata, createdAt],
  );
  await client.query(
    `INSERT INTO wujie_asset_versions(
       id, asset_id, owner_id, project_id, file_url, storage_key, checksum, mime_type,
       byte_size, width, height, availability, recovery_source_url, idempotency_key,
       metadata, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16
     )`,
    [
      versionId,
      assetId,
      input.actorUserId,
      input.projectId,
      file.url,
      file.storageKey ?? null,
      file.checksum ?? null,
      file.mimeType ?? null,
      file.byteSize ?? null,
      file.width ?? null,
      file.height ?? null,
      file.availability,
      file.recoverySourceUrl ?? null,
      `legacy:${input.projectId}:${image.id}`,
      metadata,
      createdAt,
    ],
  );
  await client.query(
    `UPDATE wujie_assets SET current_version_id = $4, updated_at = $5
     WHERE id = $1 AND owner_id = $2 AND project_id = $3`,
    [assetId, input.actorUserId, input.projectId, versionId, createdAt],
  );
  await client.query(
    `INSERT INTO wujie_workspace_placements(
       id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
       entity_type, entity_id, status, deleted_at, transform, metadata, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'canvas', $3, 'canvas-image', $6, 'active', NULL,
       $7::jsonb, $8::jsonb, $9, $9
     )`,
    [
      placementId,
      input.actorUserId,
      input.projectId,
      assetId,
      versionId,
      image.id,
      JSON.stringify(imageTransform(image)),
      metadata,
      createdAt,
    ],
  );
  return mapping;
}

export async function migrateLegacyProjectOnWrite(
  input: LegacyMigrationInput,
): Promise<MigrationResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rawProject = await loadAuthorizedLegacyProject(
      client,
      input.actorUserId,
      input.projectId,
    );
    const read = readProjectSnapshot(rawProject);
    if (!read.project || read.sourceSchemaVersion === null) {
      throw migrationError('LEGACY_PROJECT_QUARANTINED');
    }
    const sourceSchemaVersion = read.sourceSchemaVersion;
    const completed = await existingCompletedMigration(
      client,
      input.actorUserId,
      input.projectId,
      rawProject,
      sourceSchemaVersion,
    );
    if (completed) {
      await client.query('COMMIT');
      return completed;
    }

    const existingProject = await client.query<ProjectRow>(
      `SELECT schema_version, metadata
       FROM wujie_projects
       WHERE owner_id = $1 AND id = $2 AND status = 'active'
       FOR UPDATE`,
      [input.actorUserId, input.projectId],
    );
    if (existingProject.rows[0]) throw migrationError('LEGACY_MIGRATION_FAILED');

    await client.query(
      `INSERT INTO wujie_projects(
         id, owner_id, name, status, schema_version, metadata, created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', $4, $5::jsonb, $6, $7)`,
      [
        input.projectId,
        input.actorUserId,
        read.project.name ?? '',
        sourceSchemaVersion,
        JSON.stringify({ legacySourceSchemaVersion: sourceSchemaVersion }),
        new Date(read.project.createdAt || Date.now()).toISOString(),
        new Date(read.project.updatedAt || Date.now()).toISOString(),
      ],
    );
    const checkpointId = deterministicUuid([
      'wujie-legacy-migration-v1',
      input.actorUserId,
      input.projectId,
      'checkpoint',
    ]);
    await client.query(
      `INSERT INTO wujie_asset_migration_checkpoints(
         id, owner_id, project_id, legacy_project_id, status, checkpoint
       ) VALUES ($1, $2, $3, $3, 'running', '{}'::jsonb)`,
      [checkpointId, input.actorUserId, input.projectId],
    );

    const mappings: Record<string, LegacyImageMapping> = {};
    for (const image of read.project.canvasImages) {
      mappings[image.id] = await insertGraphForImage(client, input, image);
    }
    await client.query(
      `UPDATE wujie_asset_migration_checkpoints
       SET status = 'completed', checkpoint = $4::jsonb, error_code = NULL, updated_at = now()
       WHERE owner_id = $1 AND project_id = $2 AND legacy_project_id = $3`,
      [
        input.actorUserId,
        input.projectId,
        input.projectId,
        JSON.stringify({ sourceSchemaVersion, legacyImageMappings: mappings }),
      ],
    );
    const auditPayload = cloneAuditPayload(rawProject);
    await client.query(
      `UPDATE wujie_projects
       SET schema_version = 3,
           metadata = metadata || $3::jsonb,
           updated_at = now()
       WHERE owner_id = $1 AND id = $2 AND status = 'active'`,
      [
        input.actorUserId,
        input.projectId,
        JSON.stringify({
          legacyAuditPayload: auditPayload,
          legacySourceSchemaVersion: sourceSchemaVersion,
        }),
      ],
    );
    await client.query('COMMIT');
    return {
      project: migratedProject(read.project, sourceSchemaVersion, auditPayload),
      sourceSchemaVersion,
      migrated: true,
      reused: false,
      mappings,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof LegacyMigrationError) throw error;
    throw migrationError('LEGACY_MIGRATION_FAILED', error);
  } finally {
    client.release();
  }
}
