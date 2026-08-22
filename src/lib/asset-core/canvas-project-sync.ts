import type { PoolClient, QueryResultRow } from 'pg';

import { getPool } from '@/lib/db-client';
import type { CanvasImage, Project } from '@/lib/user-types';

import {
  LegacyMigrationError,
  adoptManagedCanvasMapping,
  adoptTaskProjectedCanvasMapping,
  mappingForLegacyImage,
  migrateLegacyProjectOnWriteInTransaction,
  planCanvasShadowReconciliation,
  selectCanvasImagesForAssetGraph,
  type LegacyImageMapping,
  type LegacyMigrationInput,
  type MigrationResult,
} from './legacy-migration';
import { lockAssetGraphWriteGate } from './storage';
import type { MediaAvailability } from './types';

export type AssetGraphMappings = Record<string, Record<string, LegacyImageMapping>>;

export {
  adoptManagedCanvasMapping,
  adoptTaskProjectedCanvasMapping,
  planCanvasShadowReconciliation,
  selectCanvasImagesForAssetGraph,
};

export interface CanvasProjectSyncTransaction {
  claimRevision?(expectedRevision: number): Promise<number>;
  writeProjects(projects: Project[]): Promise<void>;
  syncProject(project: Project): Promise<MigrationResult>;
  reconcileDeletedProjects?(activeProjectIds: string[]): Promise<void>;
}

export interface CanvasProjectSyncStorage {
  transaction<T>(callback: (transaction: CanvasProjectSyncTransaction) => Promise<T>): Promise<T>;
}

export interface CanvasProjectSyncResult {
  projects: Project[];
  mappings: AssetGraphMappings;
  revision?: number;
}

export interface CanvasProjectSyncInput {
  actorUserId: string;
  projects: Project[];
  expectedRevision?: number;
  persistMedia?: LegacyMigrationInput['persistMedia'];
}

const PROJECT_REVISION_DATA_KEY = '__asset_graph_projects_revision';

interface ProjectRevisionRow extends QueryResultRow {
  data_value: unknown;
}

function parseProjectRevision(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return 0;
}

export class CanvasProjectSyncConflictError extends Error {
  readonly code = 'CANVAS_PROJECT_SYNC_CONFLICT';

  constructor(readonly currentRevision: number) {
    super('Canvas project snapshot is stale');
    this.name = 'CanvasProjectSyncConflictError';
  }
}

async function persistCanvasProjectMedia(input: CanvasProjectSyncInput): Promise<Project[]> {
  const projects: Project[] = [];
  for (const project of input.projects) {
    const canvasImages: CanvasImage[] = [];
    for (const image of project.canvasImages) {
      const dataUrls = [image.url, image.sourceUrl, image.thumbnailUrl]
        .filter((url): url is string => typeof url === 'string' && url.startsWith('data:'));
      if (dataUrls.length === 0) {
        canvasImages.push(image);
        continue;
      }
      if (!input.persistMedia) throw new LegacyMigrationError('LEGACY_MEDIA_PERSIST_FAILED');
      try {
        const persistedByDataUrl = new Map<string, Awaited<ReturnType<NonNullable<CanvasProjectSyncInput['persistMedia']>>>>();
        const mapping = mappingForLegacyImage({ actorUserId: input.actorUserId, projectId: project.id }, image.id);
        for (const dataUrl of new Set(dataUrls)) {
          if (persistedByDataUrl.has(dataUrl)) continue;
          const persisted = await input.persistMedia({
            actorUserId: input.actorUserId,
            projectId: project.id,
            legacyImageId: image.id,
            mapping,
            dataUrl,
          });
          if (!persisted.url || persisted.url.startsWith('data:') || persisted.url.startsWith('blob:')) {
            throw new Error('Persistence returned a temporary URL');
          }
          persistedByDataUrl.set(dataUrl, persisted);
        }
        const persistedPrimary = persistedByDataUrl.get(image.url);
        canvasImages.push({
          ...image,
          url: persistedPrimary?.url ?? image.url,
          ...(image.sourceUrl?.startsWith('data:')
            ? { sourceUrl: persistedByDataUrl.get(image.sourceUrl)?.url }
            : {}),
          ...(image.thumbnailUrl?.startsWith('data:')
            ? { thumbnailUrl: persistedByDataUrl.get(image.thumbnailUrl)?.url }
            : {}),
          originalWidth: persistedPrimary?.width ?? image.originalWidth,
          originalHeight: persistedPrimary?.height ?? image.originalHeight,
          mediaAvailability: persistedPrimary ? 'ready' : image.mediaAvailability,
          mediaErrorCode: persistedPrimary ? undefined : image.mediaErrorCode,
        });
      } catch (error) {
        throw new LegacyMigrationError('LEGACY_MEDIA_PERSIST_FAILED', { cause: error });
      }
    }
    projects.push({ ...project, canvasImages });
  }
  return projects;
}

function applyMappings(projects: Project[], mappings: AssetGraphMappings): Project[] {
  return projects.map((project) => ({
    ...project,
    canvasImages: project.canvasImages.map((image) => {
      const mapping = mappings[project.id]?.[image.id];
      return mapping ? {
        ...image,
        assetId: mapping.assetId,
        assetVersionId: mapping.versionId,
        placementId: mapping.placementId,
      } : image;
    }),
  }));
}

async function writeProjects(client: PoolClient, actorUserId: string, projects: Project[]): Promise<void> {
  await client.query(
    `INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
     VALUES ($1, 'projects', $2, $3)
     ON CONFLICT (user_id, data_key) DO UPDATE SET
       data_value = EXCLUDED.data_value,
       updated_at = EXCLUDED.updated_at`,
    [actorUserId, JSON.stringify(projects), Date.now()],
  );
}

export async function reconcileDeletedCanvasProjectsInTransaction(
  client: PoolClient,
  actorUserId: string,
  activeProjectIds: string[],
): Promise<void> {
  await client.query(
    `SELECT id FROM wujie_assets
     WHERE owner_id = $1 AND NOT (project_id = ANY($2::text[]))
     ORDER BY id
     FOR UPDATE`,
    [actorUserId, activeProjectIds],
  );
  await client.query(
    `UPDATE wujie_workspace_placements
     SET status = 'trashed', deleted_at = COALESCE(deleted_at, now()), updated_at = now()
     WHERE owner_id = $1 AND status = 'active'
       AND NOT (project_id = ANY($2::text[]))`,
    [actorUserId, activeProjectIds],
  );
  await client.query(
    `UPDATE wujie_assets asset
     SET status = 'trashed', updated_at = now()
     WHERE asset.owner_id = $1 AND asset.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM wujie_workspace_placements placement
         WHERE placement.asset_id = asset.id
           AND placement.owner_id = asset.owner_id
           AND placement.status = 'active'
       )`,
    [actorUserId],
  );
  await client.query(
    `UPDATE wujie_projects
     SET status = 'trashed', updated_at = now()
     WHERE owner_id = $1 AND status = 'active'
       AND NOT (id = ANY($2::text[]))`,
    [actorUserId, activeProjectIds],
  );
}

async function claimProjectRevision(
  client: PoolClient,
  actorUserId: string,
  expectedRevision: number,
): Promise<number> {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [actorUserId, PROJECT_REVISION_DATA_KEY],
  );
  const result = await client.query<ProjectRevisionRow>(
    `SELECT data_value
       FROM wujie_user_data
      WHERE user_id = $1 AND data_key = $2`,
    [actorUserId, PROJECT_REVISION_DATA_KEY],
  );
  const currentRevision = parseProjectRevision(result.rows[0]?.data_value);
  if (currentRevision !== expectedRevision) {
    throw new CanvasProjectSyncConflictError(currentRevision);
  }
  const nextRevision = currentRevision + 1;
  await client.query(
    `INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, data_key) DO UPDATE SET
       data_value = EXCLUDED.data_value,
       updated_at = EXCLUDED.updated_at`,
    [actorUserId, PROJECT_REVISION_DATA_KEY, JSON.stringify(nextRevision), Date.now()],
  );
  return nextRevision;
}

export async function readCanvasProjectRevision(actorUserId: string): Promise<number> {
  const result = await getPool().query<ProjectRevisionRow>(
    `SELECT data_value
       FROM wujie_user_data
      WHERE user_id = $1 AND data_key = $2`,
    [actorUserId, PROJECT_REVISION_DATA_KEY],
  );
  return parseProjectRevision(result.rows[0]?.data_value);
}

class PostgresCanvasProjectSyncStorage implements CanvasProjectSyncStorage {
  constructor(private readonly actorUserId: string) {}

  async transaction<T>(callback: (transaction: CanvasProjectSyncTransaction) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await lockAssetGraphWriteGate(client, 'shared');
      const result = await callback({
        claimRevision: (expectedRevision) => claimProjectRevision(client, this.actorUserId, expectedRevision),
        writeProjects: (projects) => writeProjects(client, this.actorUserId, projects),
        syncProject: (project) => migrateLegacyProjectOnWriteInTransaction(client, {
          actorUserId: this.actorUserId,
          projectId: project.id,
        }),
        reconcileDeletedProjects: (activeProjectIds) => reconcileDeletedCanvasProjectsInTransaction(
          client,
          this.actorUserId,
          activeProjectIds,
        ),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function executeCanvasProjectSync(
  input: CanvasProjectSyncInput,
  storage: CanvasProjectSyncStorage = new PostgresCanvasProjectSyncStorage(input.actorUserId),
): Promise<CanvasProjectSyncResult> {
  const persistedProjects = await persistCanvasProjectMedia(input);
  return storage.transaction(async (transaction) => {
    let revision: number | undefined;
    if (input.expectedRevision !== undefined) {
      if (!transaction.claimRevision) {
        throw new Error('Canvas project sync storage does not support revision checks');
      }
      revision = await transaction.claimRevision(input.expectedRevision);
    }
    await transaction.writeProjects(persistedProjects);
    const mappings: AssetGraphMappings = {};
    for (const project of persistedProjects) {
      const result = await transaction.syncProject(project);
      mappings[project.id] = result.mappings;
    }
    await transaction.reconcileDeletedProjects?.(persistedProjects.map((project) => project.id));
    const projects = applyMappings(persistedProjects, mappings);
    await transaction.writeProjects(projects);
    return { projects, mappings, ...(revision === undefined ? {} : { revision }) };
  });
}

export async function executeLegacyCanvasProjectSync(
  input: CanvasProjectSyncInput,
  storage: CanvasProjectSyncStorage = new PostgresCanvasProjectSyncStorage(input.actorUserId),
): Promise<CanvasProjectSyncResult> {
  const persistedProjects = await persistCanvasProjectMedia(input);
  return storage.transaction(async (transaction) => {
    if (input.expectedRevision === undefined) {
      throw new Error('Canvas project revision is required');
    }
    if (!transaction.claimRevision) {
      throw new Error('Canvas project sync storage does not support revision checks');
    }
    const revision = await transaction.claimRevision(input.expectedRevision);
    await transaction.writeProjects(persistedProjects);
    return { projects: persistedProjects, mappings: {}, revision };
  });
}

export interface AssetV3CanvasPlacement {
  entityId: string;
  assetId: string;
  assetVersionId: string;
  placementId: string;
  fileUrl: string;
  thumbnailUrl?: string;
  availability: MediaAvailability;
  recoverySourceUrl?: string;
  transform: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface AssetV3PlacementRow extends QueryResultRow {
  project_id: string;
  entity_id: string;
  asset_id: string;
  asset_version_id: string;
  placement_id: string;
  file_url: string;
  thumbnail_url: string | null;
  availability: MediaAvailability;
  recovery_source_url: string | null;
  transform: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function hydrateAssetV3Projects(
  projects: Project[],
  placementsByProject: Record<string, AssetV3CanvasPlacement[]>,
): Project[] {
  return projects.map((project) => {
    const graphPlacements = placementsByProject[project.id] ?? [];
    if (graphPlacements.length === 0 && project.schemaVersion !== 3) return project;
    const legacyById = new Map(project.canvasImages.map((image) => [image.id, image]));
    const canvasImages = graphPlacements.map((placement) => {
      const metadataImage = asRecord(placement.metadata.legacyImage);
      const legacyImage = legacyById.get(placement.entityId);
      const base = { ...(legacyImage ?? {}), ...metadataImage } as Partial<CanvasImage>;
      const transform = asRecord(placement.transform);
      const width = numberOr(transform.width, base.width ?? 256);
      const height = numberOr(transform.height, base.height ?? 256);
      return {
        ...base,
        id: placement.entityId,
        url: placement.fileUrl,
        thumbnailUrl: placement.thumbnailUrl ?? base.thumbnailUrl,
        sourceUrl: placement.recoverySourceUrl ?? base.sourceUrl,
        x: numberOr(transform.x, base.x ?? 0),
        y: numberOr(transform.y, base.y ?? 0),
        width,
        height,
        originalWidth: numberOr(transform.originalWidth, base.originalWidth ?? width),
        originalHeight: numberOr(transform.originalHeight, base.originalHeight ?? height),
        rotation: numberOr(transform.rotation, base.rotation ?? 0),
        zIndex: numberOr(transform.zIndex, base.zIndex ?? 0),
        createdAt: base.createdAt ?? Date.now(),
        mediaAvailability: placement.availability,
        assetId: placement.assetId,
        assetVersionId: placement.assetVersionId,
        placementId: placement.placementId,
      } satisfies CanvasImage;
    });
    return { ...project, schemaVersion: 3, canvasImages };
  });
}

function assetV3PlacementQuery(includeThumbnailVariants: boolean): string {
  const thumbnailSelection = includeThumbnailVariants
    ? 'thumbnail_variant.file_url AS thumbnail_url'
    : 'NULL::text AS thumbnail_url';
  const thumbnailJoin = includeThumbnailVariants
    ? `LEFT JOIN LATERAL (
       SELECT variant.file_url
       FROM wujie_asset_thumbnail_variants variant
       WHERE variant.asset_version_id = version.id
         AND variant.status = 'ready'
         AND variant.size IN (512, 256)
         AND variant.file_url <> ''
       ORDER BY variant.size DESC
       LIMIT 1
     ) thumbnail_variant ON TRUE`
    : '';
  return `SELECT placement.project_id, placement.entity_id, placement.asset_id,
            placement.asset_version_id, placement.id AS placement_id,
            version.file_url, version.availability, version.recovery_source_url,
            ${thumbnailSelection}, placement.transform, placement.metadata
     FROM wujie_workspace_placements placement
     JOIN wujie_asset_versions version
       ON version.id = placement.asset_version_id
      AND version.owner_id = placement.owner_id
      AND version.project_id = placement.project_id
     ${thumbnailJoin}
     WHERE placement.owner_id = $1
       AND placement.project_id = ANY($2::text[])
       AND placement.workspace_kind = 'canvas'
       AND placement.entity_type = 'canvas-image'
       AND placement.status = 'active'
     ORDER BY placement.created_at, placement.id`;
}

function isMissingThumbnailVariantTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === '42P01'
    && typeof candidate.message === 'string'
    && candidate.message.includes('wujie_asset_thumbnail_variants');
}

export async function readAssetV3Projects(actorUserId: string, projects: Project[]): Promise<Project[]> {
  if (projects.length === 0) return [];
  const values = [actorUserId, projects.map((project) => project.id)];
  const pool = getPool();
  let result: { rows: AssetV3PlacementRow[] };
  try {
    result = await pool.query<AssetV3PlacementRow>(assetV3PlacementQuery(true), values);
  } catch (error) {
    if (!isMissingThumbnailVariantTable(error)) throw error;
    result = await pool.query<AssetV3PlacementRow>(assetV3PlacementQuery(false), values);
  }
  const placementsByProject: Record<string, AssetV3CanvasPlacement[]> = {};
  for (const row of result.rows) {
    (placementsByProject[row.project_id] ??= []).push({
      entityId: row.entity_id,
      assetId: row.asset_id,
      assetVersionId: row.asset_version_id,
      placementId: row.placement_id,
      fileUrl: row.file_url,
      ...(row.thumbnail_url ? { thumbnailUrl: row.thumbnail_url } : {}),
      availability: row.availability,
      ...(row.recovery_source_url ? { recoverySourceUrl: row.recovery_source_url } : {}),
      transform: asRecord(row.transform),
      metadata: asRecord(row.metadata),
    });
  }
  return hydrateAssetV3Projects(projects, placementsByProject);
}
