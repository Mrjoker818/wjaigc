import { createHash } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';

import { getPool } from '@/lib/db-client';
import type { CanvasImage, Project } from '@/lib/user-types';

import { readProjectSnapshot, type ProjectSchemaVersion } from './project-readers';
import { lockAssetGraphWriteGate } from './storage';
import type { AssetFile, AssetKind } from './types';

export type LegacyMigrationErrorCode =
  | 'LEGACY_PROJECT_NOT_FOUND'
  | 'LEGACY_PROJECT_QUARANTINED'
  | 'LEGACY_MEDIA_PERSIST_FAILED'
  | 'LEGACY_MIGRATION_INTEGRITY_CONFLICT'
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
  status: 'active' | 'trashed';
}

interface CheckpointRow extends QueryResultRow {
  status: 'pending' | 'running' | 'completed' | 'failed';
  checkpoint: Record<string, unknown>;
}

interface VersionFileRow extends QueryResultRow {
  file_url: string;
  storage_key: string | null;
  checksum: string | null;
  mime_type: string | null;
  byte_size: string | null;
  width: number | null;
  height: number | null;
  availability: AssetFile['availability'];
  recovery_source_url: string | null;
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

export function mappingForLegacyImage(
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

function assetFileIdentity(file: AssetFile): Record<string, unknown> {
  return {
    url: file.url,
    availability: file.availability,
    recoverySourceUrl: file.recoverySourceUrl ?? null,
    storageKey: file.storageKey ?? null,
    checksum: file.checksum ?? null,
    mimeType: file.mimeType ?? null,
    byteSize: file.byteSize ?? null,
    width: file.width ?? null,
    height: file.height ?? null,
  };
}

function assetFileMatchesSnapshot(currentFile: AssetFile, nextFile: AssetFile): boolean {
  const currentIdentity = assetFileIdentity(currentFile);
  const nextIdentity = assetFileIdentity(nextFile);
  return Object.entries(nextFile).every(([key]) => (
    currentIdentity[key] === nextIdentity[key]
  ));
}

export function planCanvasAssetVersionUpdate(input: {
  actorUserId: string;
  projectId: string;
  imageId: string;
  mapping: LegacyImageMapping;
  currentFile: AssetFile;
  nextFile: AssetFile;
}): {
  action: 'reuse' | 'append';
  mapping: LegacyImageMapping;
  parentVersionIds: string[];
} {
  if (assetFileMatchesSnapshot(input.currentFile, input.nextFile)) {
    return { action: 'reuse', mapping: input.mapping, parentVersionIds: [] };
  }
  const versionId = deterministicUuid([
    'wujie-legacy-migration-v1',
    input.actorUserId,
    input.projectId,
    input.imageId,
    'version',
    input.mapping.versionId,
    JSON.stringify(assetFileIdentity(input.nextFile)),
  ]);
  return {
    action: 'append',
    mapping: { ...input.mapping, versionId },
    parentVersionIds: [input.mapping.versionId],
  };
}

export interface CanvasShadowReconciliationPlan {
  additions: Array<{ image: CanvasImage; mapping: LegacyImageMapping }>;
  updates: Array<{ image: CanvasImage; mapping: LegacyImageMapping }>;
  removals: Array<{ imageId: string; mapping: LegacyImageMapping }>;
  activeMappings: Record<string, LegacyImageMapping>;
  checkpointMappings: Record<string, LegacyImageMapping>;
}

export function selectCanvasImagesForAssetGraph(images: CanvasImage[]): CanvasImage[] {
  return images.filter((image) => !image.isProcessingPlaceholder);
}

function isProjectCanvasWorkspace(workspaceId: string, projectId: string): boolean {
  return workspaceId === projectId || workspaceId === `canvas:${projectId}`;
}

export async function adoptManagedCanvasMapping(
  client: Pick<PoolClient, 'query'>,
  input: Pick<LegacyMigrationInput, 'actorUserId' | 'projectId'>,
  image: CanvasImage,
): Promise<LegacyImageMapping | null> {
  const supplied = [image.assetId, image.assetVersionId, image.placementId];
  if (supplied.every(value => !value)) return null;
  if (supplied.some(value => typeof value !== 'string' || value.length === 0)) {
    throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
  }
  const mapping = {
    assetId: image.assetId as string,
    versionId: image.assetVersionId as string,
    placementId: image.placementId as string,
  };
  const asset = await client.query<{ id: string }>(
    `SELECT asset.id
     FROM wujie_assets asset
     WHERE asset.id = $1 AND asset.owner_id = $2 AND asset.project_id = $3
     FOR UPDATE`,
    [mapping.assetId, input.actorUserId, input.projectId],
  );
  if (!asset.rows[0]) throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
  const version = await client.query<{ asset_id: string; asset_version_id: string }>(
    `SELECT asset_id, id AS asset_version_id
     FROM wujie_asset_versions
     WHERE id = $1 AND asset_id = $2 AND owner_id = $3 AND project_id = $4
     FOR UPDATE`,
    [mapping.versionId, mapping.assetId, input.actorUserId, input.projectId],
  );
  if (!version.rows[0]) throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
  const placement = await client.query<{
    asset_id: string;
    asset_version_id: string;
    placement_id: string;
  }>(
    `SELECT asset_id, asset_version_id, id AS placement_id
     FROM wujie_workspace_placements
      WHERE id = $1 AND owner_id = $2 AND project_id = $3
        AND asset_id = $4 AND asset_version_id = $5
        AND workspace_kind = 'canvas' AND workspace_id IN ($3, 'canvas:' || $3)
        AND entity_type = 'canvas-image'
       AND entity_id = $6 AND status = 'active'
     FOR UPDATE`,
    [
      mapping.placementId,
      input.actorUserId,
      input.projectId,
      mapping.assetId,
      mapping.versionId,
      image.id,
    ],
  );
  if (!placement.rows[0]) throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
  const metadata = JSON.stringify({
    source: 'managed-canvas-reference',
    legacyImageId: image.id,
    legacyImage: image,
  });
  const updated = await client.query(
    `UPDATE wujie_workspace_placements
     SET transform = $4::jsonb, metadata = $5::jsonb, updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND project_id = $3
       AND asset_id = $6 AND asset_version_id = $7
       AND workspace_kind = 'canvas' AND workspace_id IN ($3, 'canvas:' || $3)
       AND entity_type = 'canvas-image' AND entity_id = $8 AND status = 'active'`,
    [
      mapping.placementId,
      input.actorUserId,
      input.projectId,
      JSON.stringify(imageTransform(image)),
      metadata,
      mapping.assetId,
      mapping.versionId,
      image.id,
    ],
  );
  if ((updated.rowCount ?? 0) !== 1) throw migrationError('LEGACY_MIGRATION_FAILED');
  return mapping;
}

export async function adoptTaskProjectedCanvasMapping(
  client: Pick<PoolClient, 'query'>,
  input: Pick<LegacyMigrationInput, 'actorUserId' | 'projectId'>,
  image: CanvasImage,
): Promise<LegacyImageMapping | null> {
  if (!image.generationTaskId) return null;
  const entityPrefix = `${image.generationTaskId}:`;
  if (!image.id.startsWith(entityPrefix)) return null;
  const rawOutputIndex = image.id.slice(entityPrefix.length);
  if (!/^\d+$/.test(rawOutputIndex)) return null;
  const outputIndex = Number(rawOutputIndex);
  if (!Number.isInteger(outputIndex) || outputIndex < 0) return null;
  const projectedAsset = await client.query<{
    asset_id: string;
    asset_version_id: string;
  }>(
    `SELECT version.asset_id, version.id AS asset_version_id
     FROM wujie_asset_versions version
     JOIN wujie_assets asset
       ON asset.id = version.asset_id
      AND asset.owner_id = version.owner_id
      AND asset.project_id = version.project_id
     WHERE version.owner_id = $1 AND version.project_id = $2 AND version.task_id = $3
       AND version.metadata->>'outputIndex' = $4::text
     FOR UPDATE OF asset`,
    [input.actorUserId, input.projectId, image.generationTaskId, outputIndex],
  );
  const projectedAssetRow = projectedAsset.rows[0];
  if (!projectedAssetRow) return null;
  const projectedVersion = await client.query<{
    asset_id: string;
    asset_version_id: string;
  }>(
    `SELECT asset_id, id AS asset_version_id
     FROM wujie_asset_versions
     WHERE id = $1 AND asset_id = $2 AND owner_id = $3 AND project_id = $4
       AND task_id = $5 AND metadata->>'outputIndex' = $6::text
     FOR UPDATE`,
    [
      projectedAssetRow.asset_version_id,
      projectedAssetRow.asset_id,
      input.actorUserId,
      input.projectId,
      image.generationTaskId,
      outputIndex,
    ],
  );
  const versionRow = projectedVersion.rows[0];
  if (!versionRow) throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
  const projectedPlacement = await client.query<{
    asset_id: string;
    asset_version_id: string;
    placement_id: string;
  }>(
    `SELECT placement.asset_id, placement.asset_version_id, placement.id AS placement_id
     FROM wujie_workspace_placements placement
      WHERE placement.owner_id = $1 AND placement.project_id = $2
         AND placement.workspace_kind = 'canvas'
         AND placement.workspace_id IN ($2, 'canvas:' || $2)
        AND placement.entity_type = 'canvas-image'
        AND placement.entity_id = $3
        AND placement.status = 'active'
        AND placement.asset_id = $4
        AND placement.asset_version_id = $5
     FOR UPDATE OF placement`,
    [input.actorUserId, input.projectId, image.id, versionRow.asset_id, versionRow.asset_version_id],
  );
  const row = projectedPlacement.rows[0];
  if (!row) return null;
  const metadata = JSON.stringify({
    source: 'task-projection',
    taskId: image.generationTaskId,
    legacyImageId: image.id,
    legacyImage: image,
  });
  const updated = await client.query(
    `UPDATE wujie_workspace_placements
     SET transform = $4::jsonb, metadata = $5::jsonb, updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND project_id = $3
       AND asset_id = $6 AND asset_version_id = $7
       AND workspace_kind = 'canvas' AND workspace_id IN ($3, 'canvas:' || $3)
       AND entity_type = 'canvas-image' AND entity_id = $8 AND status = 'active'`,
    [
      row.placement_id,
      input.actorUserId,
      input.projectId,
      JSON.stringify(imageTransform(image)),
      metadata,
      row.asset_id,
      row.asset_version_id,
      image.id,
    ],
  );
  if ((updated.rowCount ?? 0) !== 1) throw migrationError('LEGACY_MIGRATION_FAILED');
  return {
    assetId: row.asset_id,
    versionId: row.asset_version_id,
    placementId: row.placement_id,
  };
}

export function planCanvasShadowReconciliation(input: {
  actorUserId: string;
  projectId: string;
  previousMappings: Record<string, LegacyImageMapping>;
  images: CanvasImage[];
}): CanvasShadowReconciliationPlan {
  const additions: CanvasShadowReconciliationPlan['additions'] = [];
  const updates: CanvasShadowReconciliationPlan['updates'] = [];
  const activeMappings: Record<string, LegacyImageMapping> = {};
  const checkpointMappings = { ...input.previousMappings };
  const graphImages = selectCanvasImagesForAssetGraph(input.images);
  const currentIds = new Set(graphImages.map((image) => image.id));

  for (const image of graphImages) {
    const existing = input.previousMappings[image.id];
    const mapping = existing ?? mappingForLegacyImage(input, image.id);
    activeMappings[image.id] = mapping;
    checkpointMappings[image.id] = mapping;
    (existing ? updates : additions).push({ image, mapping });
  }

  return {
    additions,
    updates,
    removals: Object.entries(input.previousMappings)
      .filter(([imageId]) => !currentIds.has(imageId))
      .map(([imageId, mapping]) => ({ imageId, mapping })),
    activeMappings,
    checkpointMappings,
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

export function selectLegacyCanvasMediaUrl(image: CanvasImage): string {
  return inferAssetKind(image) === 'video' && image.videoUrl
    ? image.videoUrl
    : image.url;
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

function hasCompleteManagedCanvasMapping(image: CanvasImage): boolean {
  return [image.assetId, image.assetVersionId, image.placementId]
    .every(value => typeof value === 'string' && value.length > 0);
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
  const mediaUrl = selectLegacyCanvasMediaUrl(image);
  if (!mediaUrl.startsWith('data:')) {
    return {
      url: mediaUrl,
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
      dataUrl: mediaUrl,
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
  input: LegacyMigrationInput,
  rawProject: Record<string, unknown>,
  sourceSchemaVersion: ProjectSchemaVersion,
): Promise<MigrationResult | null> {
  const checkpoint = await client.query<CheckpointRow>(
    `SELECT status, checkpoint
     FROM wujie_asset_migration_checkpoints
     WHERE owner_id = $1 AND project_id = $2 AND legacy_project_id = $2
     FOR UPDATE`,
    [input.actorUserId, input.projectId],
  );
  const row = checkpoint.rows[0];
  if (!row || row.status !== 'completed') return null;

  const project = await client.query<ProjectRow>(
    `SELECT schema_version, metadata, status
     FROM wujie_projects
     WHERE owner_id = $1 AND id = $2
     FOR UPDATE`,
    [input.actorUserId, input.projectId],
  );
  if (project.rows[0]?.schema_version !== 3) {
    throw migrationError('LEGACY_MIGRATION_FAILED');
  }
  const read = readProjectSnapshot(rawProject);
  if (!read.project) throw migrationError('LEGACY_PROJECT_QUARANTINED');
  const plan = planCanvasShadowReconciliation({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    previousMappings: checkpointMappings(row.checkpoint),
    images: read.project.canvasImages,
  });
  await lockProjectAssetsForReconciliation(client, input);

  const adoptAndReconcile = async (image: CanvasImage): Promise<LegacyImageMapping | null> => {
    const adopted = await adoptManagedCanvasMapping(client, input, image)
      ?? await adoptTaskProjectedCanvasMapping(client, input, image);
    if (!adopted) return null;
    const reconciled = await updateGraphForImage(client, input, image, adopted);
    if (!reconciled) throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
    return reconciled;
  };

  const reconcileManagedUpdate = async (
    image: CanvasImage,
    checkpointMapping: LegacyImageMapping,
  ): Promise<LegacyImageMapping> => {
    if (
      image.assetId !== checkpointMapping.assetId
      || image.placementId !== checkpointMapping.placementId
    ) {
      const adopted = await adoptAndReconcile(image);
      if (!adopted) throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
      return adopted;
    }
    const placement = await client.query<{ asset_version_id: string }>(
      `SELECT asset_version_id
       FROM wujie_workspace_placements
       WHERE id = $1 AND owner_id = $2 AND project_id = $3
         AND asset_id = $4
         AND workspace_kind = 'canvas' AND workspace_id IN ($3, 'canvas:' || $3)
         AND entity_type = 'canvas-image' AND entity_id = $5 AND status = 'active'`,
      [
        checkpointMapping.placementId,
        input.actorUserId,
        input.projectId,
        checkpointMapping.assetId,
        image.id,
      ],
    );
    const placementVersionId = placement.rows[0]?.asset_version_id;
    if (!placementVersionId) throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
    if (placementVersionId === checkpointMapping.versionId) {
      const reconciled = await updateGraphForImage(client, input, image, checkpointMapping);
      if (!reconciled) throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
      return reconciled;
    }
    if (placementVersionId === image.assetVersionId) {
      const adopted = await adoptAndReconcile(image);
      if (!adopted) throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
      return adopted;
    }
    throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
  };

  for (const { image, mapping } of plan.updates) {
    const adopted = hasCompleteManagedCanvasMapping(image)
      ? await reconcileManagedUpdate(image, mapping)
      : null;
    const updated = adopted ?? await updateGraphForImage(client, input, image, mapping);
    const activeMapping = updated ?? await insertGraphForImage(client, input, image, mapping);
    plan.activeMappings[image.id] = activeMapping;
    plan.checkpointMappings[image.id] = activeMapping;
  }
  for (const { image, mapping } of plan.additions) {
    const activeMapping = await adoptAndReconcile(image)
      ?? await insertGraphForImage(client, input, image, mapping);
    plan.activeMappings[image.id] = activeMapping;
    plan.checkpointMappings[image.id] = activeMapping;
  }
  for (const { imageId, mapping } of plan.removals) {
    await trashGraphForImage(client, input, imageId, mapping);
  }
  await trashStaleCanvasPlacements(client, input, plan.activeMappings);
  await client.query(
    `UPDATE wujie_asset_migration_checkpoints
     SET checkpoint = $4::jsonb, error_code = NULL, updated_at = now()
     WHERE owner_id = $1 AND project_id = $2 AND legacy_project_id = $3`,
    [
      input.actorUserId,
      input.projectId,
      input.projectId,
      JSON.stringify({ sourceSchemaVersion, legacyImageMappings: plan.checkpointMappings }),
    ],
  );
  await client.query(
    `UPDATE wujie_projects SET name = $3, status = 'active', updated_at = now()
     WHERE owner_id = $1 AND id = $2`,
    [input.actorUserId, input.projectId, read.project.name ?? ''],
  );
  return {
    project: readCompletedProject(rawProject, sourceSchemaVersion),
    sourceSchemaVersion,
    migrated: false,
    reused: true,
    mappings: plan.activeMappings,
  };
}

async function lockProjectAssetsForReconciliation(
  client: PoolClient,
  input: LegacyMigrationInput,
): Promise<void> {
  await client.query(
    `SELECT asset.id AS locked_asset_id
     FROM wujie_assets asset
     WHERE asset.owner_id = $1 AND asset.project_id = $2
     ORDER BY asset.id
     FOR UPDATE`,
    [input.actorUserId, input.projectId],
  );
}

async function insertGraphForImage(
  client: PoolClient,
  input: LegacyMigrationInput,
  image: CanvasImage,
  existingMapping?: LegacyImageMapping,
): Promise<LegacyImageMapping> {
  const mapping = existingMapping ?? mappingForLegacyImage(input, image.id);
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

async function updateGraphForImage(
  client: PoolClient,
  input: LegacyMigrationInput,
  image: CanvasImage,
  mapping: LegacyImageMapping,
): Promise<LegacyImageMapping | null> {
  const file = await fileForImage(input, image, mapping);
  const metadata = JSON.stringify({ legacyImageId: image.id, legacyImage: image });
  const assetLock = await client.query<{
    id: string;
    owner_id: string;
    project_id: string;
    current_version_id: string | null;
  }>(
    `SELECT id, owner_id, project_id, current_version_id
     FROM wujie_assets
     WHERE id = $1
     FOR UPDATE`,
    [mapping.assetId],
  );
  const assetRow = assetLock.rows[0];
  if (!assetRow) return null;
  if (assetRow.owner_id !== input.actorUserId || assetRow.project_id !== input.projectId) {
    throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
  }
  const currentVersion = await client.query<VersionFileRow>(
    `SELECT file_url, storage_key, checksum, mime_type, byte_size, width, height,
            availability, recovery_source_url
     FROM wujie_asset_versions
     WHERE id = $1 AND asset_id = $2 AND owner_id = $3 AND project_id = $4
     FOR UPDATE`,
    [mapping.versionId, mapping.assetId, input.actorUserId, input.projectId],
  );
  const row = currentVersion.rows[0];
  if (!row) throw migrationError('LEGACY_MIGRATION_FAILED');
  const lockedPlacement = await client.query<{
    asset_id: string;
    asset_version_id: string;
    owner_id: string;
    project_id: string;
    workspace_kind: string;
    workspace_id: string;
    entity_type: string;
    entity_id: string;
  }>(
    `SELECT asset_id, asset_version_id, owner_id, project_id, workspace_kind, workspace_id,
            entity_type, entity_id
     FROM wujie_workspace_placements
     WHERE id = $1
     FOR UPDATE`,
    [mapping.placementId],
  );
  const placementRow = lockedPlacement.rows[0];
  if (placementRow && (
    placementRow.asset_id !== mapping.assetId
    || placementRow.asset_version_id !== mapping.versionId
    || placementRow.owner_id !== input.actorUserId
    || placementRow.project_id !== input.projectId
    || placementRow.workspace_kind !== 'canvas'
    || !isProjectCanvasWorkspace(placementRow.workspace_id, input.projectId)
    || placementRow.entity_type !== 'canvas-image'
    || placementRow.entity_id !== image.id
  )) {
    throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
  }
  const asset = await client.query(
    `UPDATE wujie_assets
     SET kind = $4, status = 'active', metadata = $5::jsonb, updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND project_id = $3`,
    [mapping.assetId, input.actorUserId, input.projectId, inferAssetKind(image), metadata],
  );
  if ((asset.rowCount ?? 0) === 0) return null;
  const currentFile: AssetFile = {
    url: row.file_url,
    availability: row.availability,
    ...(row.storage_key ? { storageKey: row.storage_key } : {}),
    ...(row.checksum ? { checksum: row.checksum } : {}),
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
    ...(row.byte_size === null ? {} : { byteSize: Number(row.byte_size) }),
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    ...(row.recovery_source_url ? { recoverySourceUrl: row.recovery_source_url } : {}),
  };
  const versionPlan = planCanvasAssetVersionUpdate({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    imageId: image.id,
    mapping,
    currentFile,
    nextFile: file,
  });
  if (versionPlan.action === 'append') {
    const createdAt = new Date().toISOString();
    await client.query(
      `INSERT INTO wujie_asset_versions(
         id, asset_id, owner_id, project_id, file_url, storage_key, checksum, mime_type,
         byte_size, width, height, availability, recovery_source_url, idempotency_key,
         metadata, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16
       )`,
      [
        versionPlan.mapping.versionId,
        mapping.assetId,
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
        `legacy:${input.projectId}:${image.id}:${versionPlan.mapping.versionId}`,
        metadata,
        createdAt,
      ],
    );
    await client.query(
      `INSERT INTO wujie_asset_version_parents(
         asset_id, owner_id, project_id, version_id, parent_version_id, parent_order
       ) VALUES ($1, $2, $3, $4, $5, 0)`,
      [mapping.assetId, input.actorUserId, input.projectId, versionPlan.mapping.versionId, mapping.versionId],
    );
    if (assetRow.current_version_id === null || assetRow.current_version_id === mapping.versionId) {
      const promoted = await client.query(
        `UPDATE wujie_assets SET current_version_id = $4, updated_at = now()
         WHERE id = $1 AND owner_id = $2 AND project_id = $3
           AND current_version_id IS NOT DISTINCT FROM $5`,
        [
          mapping.assetId,
          input.actorUserId,
          input.projectId,
          versionPlan.mapping.versionId,
          assetRow.current_version_id,
        ],
      );
      if ((promoted.rowCount ?? 0) !== 1) {
        throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
      }
    }
  }
  const placement = placementRow
    ? await client.query(
    `UPDATE wujie_workspace_placements
     SET asset_version_id = $4, status = 'active', deleted_at = NULL,
         transform = $5::jsonb, metadata = $6::jsonb, updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND project_id = $3`,
    [
      mapping.placementId,
      input.actorUserId,
      input.projectId,
      versionPlan.mapping.versionId,
      JSON.stringify(imageTransform(image)),
      metadata,
    ])
    : await client.query(
    `INSERT INTO wujie_workspace_placements(
       id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
       entity_type, entity_id, status, deleted_at, transform, metadata, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'canvas', $3, 'canvas-image', $6, 'active', NULL,
       $7::jsonb, $8::jsonb, now(), now()
     )`,
    [
      mapping.placementId,
      input.actorUserId,
      input.projectId,
      mapping.assetId,
      versionPlan.mapping.versionId,
      image.id,
      JSON.stringify(imageTransform(image)),
      metadata,
    ]);
  if ((placement.rowCount ?? 0) !== 1) throw migrationError('LEGACY_MIGRATION_FAILED');
  return versionPlan.mapping;
}

async function trashGraphForImage(
  client: PoolClient,
  input: LegacyMigrationInput,
  imageId: string,
  mapping: LegacyImageMapping,
): Promise<void> {
  const assetLock = await client.query<{ id: string }>(
    `SELECT id FROM wujie_assets
     WHERE id = $1 AND owner_id = $2 AND project_id = $3
     FOR UPDATE`,
    [mapping.assetId, input.actorUserId, input.projectId],
  );
  if (!assetLock.rows[0]) return;
  const placementLock = await client.query<{
    asset_id: string;
    workspace_kind: string;
    workspace_id: string;
    entity_type: string;
    entity_id: string;
  }>(
    `SELECT asset_id, workspace_kind, workspace_id, entity_type, entity_id
     FROM wujie_workspace_placements
     WHERE id = $1 AND owner_id = $2 AND project_id = $3
     FOR UPDATE`,
    [mapping.placementId, input.actorUserId, input.projectId],
  );
  const placementRow = placementLock.rows[0];
  if (placementRow && (
    placementRow.asset_id !== mapping.assetId
    || placementRow.workspace_kind !== 'canvas'
    || !isProjectCanvasWorkspace(placementRow.workspace_id, input.projectId)
    || placementRow.entity_type !== 'canvas-image'
    || placementRow.entity_id !== imageId
  )) {
    throw migrationError('LEGACY_MIGRATION_INTEGRITY_CONFLICT');
  }
  await client.query(
    `UPDATE wujie_workspace_placements
     SET status = 'trashed', deleted_at = COALESCE(deleted_at, now()), updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND project_id = $3
       AND asset_id = $4 AND workspace_kind = 'canvas'
       AND workspace_id IN ($3, 'canvas:' || $3)
       AND entity_type = 'canvas-image' AND entity_id = $5 AND status = 'active'`,
    [mapping.placementId, input.actorUserId, input.projectId, mapping.assetId, imageId],
  );
  await client.query(
    `UPDATE wujie_assets asset
     SET status = 'trashed', updated_at = now()
     WHERE asset.id = $1 AND asset.owner_id = $2 AND asset.project_id = $3
       AND NOT EXISTS (
         SELECT 1 FROM wujie_workspace_placements placement
         WHERE placement.asset_id = asset.id AND placement.owner_id = asset.owner_id
           AND placement.project_id = asset.project_id AND placement.status = 'active'
       )`,
    [mapping.assetId, input.actorUserId, input.projectId],
  );
}

async function trashStaleCanvasPlacements(
  client: PoolClient,
  input: LegacyMigrationInput,
  activeMappings: Record<string, LegacyImageMapping>,
): Promise<void> {
  await client.query(
    `SELECT asset.id
     FROM wujie_assets asset
     WHERE asset.owner_id = $1 AND asset.project_id = $2
       AND asset.id IN (
         SELECT placement.asset_id
         FROM wujie_workspace_placements placement
         WHERE placement.owner_id = $1 AND placement.project_id = $2
           AND placement.workspace_kind = 'canvas'
           AND placement.workspace_id IN ($2, 'canvas:' || $2)
           AND placement.entity_type = 'canvas-image' AND placement.status = 'active'
       )
     ORDER BY asset.id
     FOR UPDATE`,
    [input.actorUserId, input.projectId],
  );
  const placementLock = await client.query<{ id: string; asset_id: string }>(
    `SELECT id, asset_id
     FROM wujie_workspace_placements
     WHERE owner_id = $1 AND project_id = $2
       AND workspace_kind = 'canvas' AND workspace_id IN ($2, 'canvas:' || $2)
       AND entity_type = 'canvas-image' AND status = 'active'
     ORDER BY id
     FOR UPDATE`,
    [input.actorUserId, input.projectId],
  );
  const activePlacementIds = new Set(
    Object.values(activeMappings).map(mapping => mapping.placementId),
  );
  const staleRows = placementLock.rows.filter(row => !activePlacementIds.has(row.id));
  if (staleRows.length === 0) return;

  const stalePlacementIds = staleRows.map(row => row.id);
  const staleAssetIds = [...new Set(staleRows.map(row => row.asset_id))];
  await client.query(
    `UPDATE wujie_workspace_placements
     SET status = 'trashed', deleted_at = COALESCE(deleted_at, now()), updated_at = now()
     WHERE owner_id = $1 AND project_id = $2 AND id = ANY($3::text[])
       AND workspace_kind = 'canvas' AND workspace_id IN ($2, 'canvas:' || $2)
       AND entity_type = 'canvas-image' AND status = 'active'`,
    [input.actorUserId, input.projectId, stalePlacementIds],
  );
  await client.query(
    `UPDATE wujie_assets asset
     SET status = 'trashed', updated_at = now()
     WHERE asset.owner_id = $1 AND asset.project_id = $2 AND asset.id = ANY($3::text[])
       AND NOT EXISTS (
         SELECT 1 FROM wujie_workspace_placements placement
         WHERE placement.asset_id = asset.id AND placement.owner_id = asset.owner_id
           AND placement.project_id = asset.project_id AND placement.status = 'active'
       )`,
    [input.actorUserId, input.projectId, staleAssetIds],
  );
}

export async function migrateLegacyProjectOnWriteInTransaction(
  client: PoolClient,
  input: LegacyMigrationInput,
): Promise<MigrationResult> {
  try {
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
      input,
      rawProject,
      sourceSchemaVersion,
    );
    if (completed) return completed;

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
    for (const image of selectCanvasImagesForAssetGraph(read.project.canvasImages)) {
      mappings[image.id] = await adoptManagedCanvasMapping(client, input, image)
        ?? await adoptTaskProjectedCanvasMapping(client, input, image)
        ?? await insertGraphForImage(client, input, image);
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
    return {
      project: migratedProject(read.project, sourceSchemaVersion, auditPayload),
      sourceSchemaVersion,
      migrated: true,
      reused: false,
      mappings,
    };
  } catch (error) {
    if (error instanceof LegacyMigrationError) throw error;
    throw migrationError('LEGACY_MIGRATION_FAILED', error);
  }
}

export async function migrateLegacyProjectOnWrite(
  input: LegacyMigrationInput,
): Promise<MigrationResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockAssetGraphWriteGate(client, 'shared');
    const result = await migrateLegacyProjectOnWriteInTransaction(client, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
