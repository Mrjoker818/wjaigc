import type { Pool, PoolClient, QueryResultRow } from 'pg';

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
  type InspectManagedLegacyMedia,
  type VerifiedLegacyMedia,
} from './legacy-migration';
import { lockAssetGraphWriteGate } from './storage';
import type { AssetKind, MediaAvailability } from './types';
import { parseWorkspaceSourceTrace } from './source-trace';
import { parseDeletedCanvasPlacements, type DeletedCanvasPlacement } from './deleted-canvas-placements';

export type AssetGraphMappings = Record<string, Record<string, LegacyImageMapping>>;

export {
  adoptManagedCanvasMapping,
  adoptTaskProjectedCanvasMapping,
  planCanvasShadowReconciliation,
  selectCanvasImagesForAssetGraph,
};

export interface CanvasProjectSyncTransaction {
  claimRevision?(expectedRevision: number): Promise<number>;
  readProjects?(): Promise<Project[]>;
  verifyProjectMappings?(
    project: Project,
    mappings: Record<string, LegacyImageMapping>,
    verifiedMediaByImageId?: Readonly<Record<string, VerifiedLegacyMedia>>,
  ): Promise<boolean>;
  writeProjects(projects: Project[]): Promise<void>;
  syncPresenceProjects?(projects: Project[]): Promise<void>;
  syncProject(
    project: Project,
    verifiedMediaByImageId?: Readonly<Record<string, VerifiedLegacyMedia>>,
  ): Promise<MigrationResult>;
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
  inspectManagedMedia?: InspectManagedLegacyMedia;
}

const PROJECT_REVISION_DATA_KEY = '__asset_graph_projects_revision';

export async function readCanvasShadowSnapshot(actorUserId: string, database: Pick<Pool, 'query'> = getPool()): Promise<{
  value: unknown;
  revision: number;
  deletedCanvasPlacements: DeletedCanvasPlacement[];
}> {
  // One statement gives projects, revision and deletion identities the same MVCC snapshot.
  const result = await database.query<{
    value: unknown;
    revision: unknown;
    deleted_placements: unknown;
  }>(`SELECT
    (SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = 'projects') AS value,
    (SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = $2) AS revision,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'projectId', p.project_id, 'entityId', p.entity_id,
      'assetId', p.asset_id, 'assetVersionId', p.asset_version_id, 'placementId', p.id
    )) FROM wujie_workspace_placements p
    JOIN wujie_assets a ON a.id = p.asset_id AND a.owner_id = p.owner_id AND a.project_id = p.project_id
    JOIN wujie_asset_versions v ON v.id = p.asset_version_id AND v.asset_id = p.asset_id
      AND v.owner_id = p.owner_id AND v.project_id = p.project_id
    WHERE p.owner_id = $1 AND p.status = 'trashed' AND p.deleted_at IS NOT NULL
      AND p.workspace_kind = 'canvas' AND p.entity_type IN ('canvas-image', 'canvas-video')
      AND p.workspace_id IN (p.project_id, 'canvas:' || p.project_id)), '[]'::jsonb) AS deleted_placements`,
  [actorUserId, PROJECT_REVISION_DATA_KEY]);
  const row = result.rows[0];
  if (!row) throw new Error('Canvas project snapshot is unavailable');
  const deletedCanvasPlacements = parseDeletedCanvasPlacements(row.deleted_placements);
  if (!deletedCanvasPlacements) throw new Error('Canvas deletion snapshot is invalid');
  return { value: row.value, revision: parseProjectRevision(row.revision), deletedCanvasPlacements };
}

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

interface PreparedCanvasProjectMedia {
  projects: Project[];
  verifiedMediaByProject: Record<string, Record<string, VerifiedLegacyMedia>>;
}

function inferCanvasAssetKind(image: CanvasImage): AssetKind {
  return image.mediaType === 'video' || Boolean(image.videoUrl) ? 'video' : 'image';
}

function selectCanvasPrimaryMediaUrl(image: CanvasImage): string {
  return inferCanvasAssetKind(image) === 'video' && image.videoUrl
    ? image.videoUrl
    : image.url;
}

async function persistCanvasProjectMedia(input: CanvasProjectSyncInput): Promise<PreparedCanvasProjectMedia> {
  const projects: Project[] = [];
  const verifiedMediaByProject: Record<string, Record<string, VerifiedLegacyMedia>> = {};
  for (const project of input.projects) {
    const canvasImages: CanvasImage[] = [];
    const verifiedMediaByImageId: Record<string, VerifiedLegacyMedia> = {};
    for (const image of project.canvasImages) {
      const dataUrls = [image.url, image.sourceUrl, image.thumbnailUrl]
        .filter((url): url is string => typeof url === 'string' && url.startsWith('data:'));
      let persistedImage = image;
      if (dataUrls.length > 0 && !input.persistMedia) {
        throw new LegacyMigrationError('LEGACY_MEDIA_PERSIST_FAILED');
      }
      try {
        const persistedByDataUrl = new Map<string, Awaited<ReturnType<NonNullable<CanvasProjectSyncInput['persistMedia']>>>>();
        const mapping = mappingForLegacyImage({ actorUserId: input.actorUserId, projectId: project.id }, image.id);
        for (const dataUrl of new Set(dataUrls)) {
          if (persistedByDataUrl.has(dataUrl)) continue;
          const persisted = await input.persistMedia!({
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
        persistedImage = {
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
        };
        if (
          persistedPrimary
          && typeof persistedPrimary.mimeType === 'string'
          && Number.isSafeInteger(persistedPrimary.byteSize)
          && (persistedPrimary.byteSize ?? 0) > 0
        ) {
          verifiedMediaByImageId[image.id] = {
            url: persistedPrimary.url,
            mimeType: persistedPrimary.mimeType,
            byteSize: persistedPrimary.byteSize!,
            ...(persistedPrimary.width === undefined ? {} : { width: persistedPrimary.width }),
            ...(persistedPrimary.height === undefined ? {} : { height: persistedPrimary.height }),
          };
        }
      } catch (error) {
        throw new LegacyMigrationError('LEGACY_MEDIA_PERSIST_FAILED', { cause: error });
      }

      const primaryUrl = selectCanvasPrimaryMediaUrl(persistedImage);
      const shouldInspect = input.inspectManagedMedia
        && !verifiedMediaByImageId[persistedImage.id]
        && inferCanvasAssetKind(persistedImage) === 'image'
        && (primaryUrl.startsWith('/api/serve-upload/') || primaryUrl.startsWith('/uploads/'));
      if (shouldInspect) {
        try {
          const verified = await input.inspectManagedMedia!({ url: primaryUrl, kind: 'image' });
          if (verified?.url === primaryUrl) {
            verifiedMediaByImageId[persistedImage.id] = verified;
            persistedImage = {
              ...persistedImage,
              ...(verified.width ? { originalWidth: verified.width } : {}),
              ...(verified.height ? { originalHeight: verified.height } : {}),
            };
          }
        } catch {
          // Preserve the existing fail-closed asset state; sharing will reject incomplete metadata.
        }
      }
      canvasImages.push(persistedImage);
    }
    if (Object.keys(verifiedMediaByImageId).length > 0) {
      verifiedMediaByProject[project.id] = verifiedMediaByImageId;
    }
    projects.push({ ...project, canvasImages });
  }
  return { projects, verifiedMediaByProject };
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

function canonicalizeGraphSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeGraphSnapshot);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeGraphSnapshot(entry)]),
    );
  }
  return value;
}

function completeProjectMappings(project: Project): Record<string, LegacyImageMapping> | null {
  const mappings: Record<string, LegacyImageMapping> = {};
  for (const image of selectCanvasImagesForAssetGraph(project.canvasImages)) {
    if (!image.assetId || !image.assetVersionId || !image.placementId) return null;
    mappings[image.id] = {
      assetId: image.assetId,
      versionId: image.assetVersionId,
      placementId: image.placementId,
    };
  }
  return mappings;
}

function hasUnchangedProjectGraph(previous: Project, next: Project): boolean {
  if (previous.name !== next.name) return false;
  if ((previous.schemaVersion ?? 1) !== (next.schemaVersion ?? 1)) return false;
  const previousImages = selectCanvasImagesForAssetGraph(previous.canvasImages);
  const nextImages = selectCanvasImagesForAssetGraph(next.canvasImages);
  return JSON.stringify(canonicalizeGraphSnapshot(previousImages))
    === JSON.stringify(canonicalizeGraphSnapshot(nextImages));
}

async function readProjects(client: PoolClient, actorUserId: string): Promise<Project[]> {
  const result = await client.query<ProjectRevisionRow>(
    `SELECT data_value
       FROM wujie_user_data
      WHERE user_id = $1 AND data_key = 'projects'
      FOR UPDATE`,
    [actorUserId],
  );
  let value = result.rows[0]?.data_value;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value as Project[] : [];
}

interface ProjectMappingRow extends QueryResultRow {
  entity_id: string;
  asset_id: string;
  asset_version_id: string;
  placement_id: string;
  file_url: string;
  mime_type: string | null;
  byte_size: string | null;
  width: number | null;
  height: number | null;
}

interface ProjectCheckpointRow extends QueryResultRow {
  status: string;
  checkpoint: unknown;
}

function checkpointSourceSchemaVersion(checkpoint: unknown): number | null {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return null;
  const value = (checkpoint as Record<string, unknown>).sourceSchemaVersion;
  return value === 1 || value === 2 || value === 3 ? value : null;
}

async function verifyProjectMappings(
  client: PoolClient,
  actorUserId: string,
  project: Project,
  mappings: Record<string, LegacyImageMapping>,
  verifiedMediaByImageId: Readonly<Record<string, VerifiedLegacyMedia>> = {},
): Promise<boolean> {
  const checkpoint = await client.query<ProjectCheckpointRow>(
    `SELECT status, checkpoint
       FROM wujie_asset_migration_checkpoints
      WHERE owner_id = $1 AND project_id = $2 AND legacy_project_id = $2
      FOR UPDATE`,
    [actorUserId, project.id],
  );
  const checkpointRow = checkpoint.rows[0];
  if (
    checkpointRow?.status !== 'completed'
    || checkpointSourceSchemaVersion(checkpointRow.checkpoint) !== (project.schemaVersion ?? 1)
  ) {
    return false;
  }
  const result = await client.query<ProjectMappingRow>(
    `SELECT placement.entity_id, placement.asset_id, placement.asset_version_id,
            placement.id AS placement_id, version.file_url, version.mime_type,
            version.byte_size, version.width, version.height
       FROM wujie_workspace_placements placement
       JOIN wujie_assets asset
         ON asset.id = placement.asset_id
        AND asset.owner_id = placement.owner_id
        AND asset.project_id = placement.project_id
        AND asset.status = 'active'
       JOIN wujie_asset_versions version
         ON version.id = placement.asset_version_id
        AND version.asset_id = placement.asset_id
        AND version.owner_id = placement.owner_id
        AND version.project_id = placement.project_id
      WHERE placement.owner_id = $1 AND placement.project_id = $2
        AND placement.workspace_kind = 'canvas'
        AND placement.workspace_id IN ($2, 'canvas:' || $2)
        AND placement.entity_type IN ('canvas-image', 'canvas-video')
        AND placement.status = 'active'
      ORDER BY asset.id, version.id, placement.id
      FOR UPDATE OF asset, version, placement`,
    [actorUserId, project.id],
  );
  if (result.rows.length !== Object.keys(mappings).length) return false;
  const rowsByEntity = new Map(result.rows.map((row) => [row.entity_id, row]));
  return Object.entries(mappings).every(([entityId, mapping]) => {
    const row = rowsByEntity.get(entityId);
    const verified = verifiedMediaByImageId[entityId];
    const identityMatches = row?.asset_id === mapping.assetId
      && row.asset_version_id === mapping.versionId
      && row.placement_id === mapping.placementId;
    if (!identityMatches || !verified) return identityMatches;
    return row.file_url === verified.url
      && row.mime_type === verified.mimeType
      && Number(row.byte_size) === verified.byteSize
      && (verified.width === undefined || row.width === verified.width)
      && (verified.height === undefined || row.height === verified.height);
  });
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

async function syncLegacyPresenceProjects(
  client: PoolClient,
  actorUserId: string,
  projects: Project[],
): Promise<void> {
  if (process.env.WUJIE_PRESENCE_ENABLED !== 'true') return;
  for (const project of projects) {
    if (!project.id || project.userId !== actorUserId) {
      throw new Error('Invalid presence project owner');
    }
    const result = await client.query(
      `INSERT INTO wujie_projects (id, owner_id, name, status, metadata)
       VALUES ($1, $2, $3, 'active', '{"presenceProjection":true}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, status = 'active', updated_at = now()
       WHERE wujie_projects.owner_id = EXCLUDED.owner_id
         AND wujie_projects.metadata->>'presenceProjection' = 'true'`,
      [project.id, actorUserId, project.name],
    );
    if (result.rowCount !== 1) {
      const existing = await client.query<{ owner_id: string }>(
        'SELECT owner_id FROM wujie_projects WHERE id = $1',
        [project.id],
      );
      if (existing.rows[0]?.owner_id !== actorUserId) {
        throw new Error('Presence project ID belongs to another owner');
      }
    }
  }
  await client.query(
    `UPDATE wujie_projects SET status = 'trashed', updated_at = now()
      WHERE owner_id = $1 AND status = 'active'
        AND metadata->>'presenceProjection' = 'true'
        AND NOT (id = ANY($2::text[]))`,
    [actorUserId, projects.map(project => project.id)],
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
       AND (
         NOT (asset.project_id = ANY($2::text[]))
         OR EXISTS (
           SELECT 1 FROM wujie_workspace_placements canvas_placement
           WHERE canvas_placement.asset_id = asset.id
             AND canvas_placement.owner_id = asset.owner_id
             AND canvas_placement.workspace_kind = 'canvas'
             AND canvas_placement.entity_type IN ('canvas-image', 'canvas-video')
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM wujie_workspace_placements placement
         WHERE placement.asset_id = asset.id
           AND placement.owner_id = asset.owner_id
           AND placement.status = 'active'
       )`,
    [actorUserId, activeProjectIds],
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

export async function readCanvasProjectRevision(
  actorUserId: string,
  database: Pick<Pool, 'query'> = getPool(),
): Promise<number> {
  const result = await database.query<ProjectRevisionRow>(
    `SELECT data_value
       FROM wujie_user_data
      WHERE user_id = $1 AND data_key = $2`,
    [actorUserId, PROJECT_REVISION_DATA_KEY],
  );
  return parseProjectRevision(result.rows[0]?.data_value);
}

/** Serializes a share snapshot with the same per-owner revision CAS used by project sync. */
export async function lockCanvasProjectRevision(
  client: Pick<PoolClient, 'query'>,
  actorUserId: string,
): Promise<void> {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [actorUserId, PROJECT_REVISION_DATA_KEY],
  );
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
        readProjects: () => readProjects(client, this.actorUserId),
        verifyProjectMappings: (project, mappings, verifiedMediaByImageId) => verifyProjectMappings(
          client,
          this.actorUserId,
          project,
          mappings,
          verifiedMediaByImageId,
        ),
        writeProjects: (projects) => writeProjects(client, this.actorUserId, projects),
        syncPresenceProjects: (projects) => syncLegacyPresenceProjects(client, this.actorUserId, projects),
        syncProject: (project, verifiedMediaByImageId) => migrateLegacyProjectOnWriteInTransaction(client, {
          actorUserId: this.actorUserId,
          projectId: project.id,
          verifiedMediaByImageId,
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
  const prepared = await persistCanvasProjectMedia(input);
  const persistedProjects = prepared.projects;
  return storage.transaction(async (transaction) => {
    let revision: number | undefined;
    if (input.expectedRevision !== undefined) {
      if (!transaction.claimRevision) {
        throw new Error('Canvas project sync storage does not support revision checks');
      }
      revision = await transaction.claimRevision(input.expectedRevision);
    }
    const previousProjects = transaction.readProjects
      ? await transaction.readProjects()
      : [];
    const previousById = new Map(previousProjects.map((project) => [project.id, project]));
    await transaction.writeProjects(persistedProjects);
    const mappings: AssetGraphMappings = {};
    for (const project of persistedProjects) {
      const previous = previousById.get(project.id);
      const reusableMappings = completeProjectMappings(project);
      const graphIsUnchanged = previous
        && reusableMappings
        && hasUnchangedProjectGraph(previous, project);
      const mappingsAreCurrent = graphIsUnchanged
        && transaction.verifyProjectMappings
        ? await transaction.verifyProjectMappings(
          project,
          reusableMappings,
          prepared.verifiedMediaByProject[project.id],
        )
        : false;
      if (mappingsAreCurrent && reusableMappings) {
        mappings[project.id] = reusableMappings;
        continue;
      }
      const result = await transaction.syncProject(
        project,
        prepared.verifiedMediaByProject[project.id],
      );
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
  const persistedProjects = (await persistCanvasProjectMedia({
    ...input,
    inspectManagedMedia: undefined,
  })).projects;
  return storage.transaction(async (transaction) => {
    if (input.expectedRevision === undefined) {
      throw new Error('Canvas project revision is required');
    }
    if (!transaction.claimRevision) {
      throw new Error('Canvas project sync storage does not support revision checks');
    }
    const revision = await transaction.claimRevision(input.expectedRevision);
    await transaction.writeProjects(persistedProjects);
    await transaction.syncPresenceProjects?.(persistedProjects);
    return { projects: persistedProjects, mappings: {}, revision };
  });
}

export interface AssetV3CanvasPlacement {
  entityId: string;
  assetId: string;
  assetVersionId: string;
  placementId: string;
  kind: AssetKind;
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
  asset_kind: AssetKind;
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
      const sourceTrace = parseWorkspaceSourceTrace(
        placement.metadata.sourceTrace ?? metadataImage.sourceTrace ?? legacyImage?.sourceTrace,
      );
      delete base.sourceTrace;
      const transform = asRecord(placement.transform);
      const width = numberOr(transform.width, base.width ?? 256);
      const height = numberOr(transform.height, base.height ?? 256);
      const isVideo = placement.kind === 'video';
      const videoPosterUrl = isVideo
        ? placement.thumbnailUrl
          ?? base.videoThumbnailUrl
          ?? base.thumbnailUrl
          ?? (base.url && base.url !== base.videoUrl ? base.url : undefined)
        : undefined;
      return {
        ...base,
        id: placement.entityId,
        url: isVideo ? videoPosterUrl ?? '' : placement.fileUrl,
        thumbnailUrl: isVideo ? videoPosterUrl : placement.thumbnailUrl ?? base.thumbnailUrl,
        mediaType: isVideo ? 'video' : 'image',
        videoUrl: isVideo ? placement.fileUrl : undefined,
        videoThumbnailUrl: isVideo ? videoPosterUrl : undefined,
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
        ...(sourceTrace ? { sourceTrace } : {}),
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
            asset.kind AS asset_kind, version.file_url, version.availability, version.recovery_source_url,
            ${thumbnailSelection}, placement.transform, placement.metadata
     FROM wujie_workspace_placements placement
     JOIN wujie_assets asset
       ON asset.id = placement.asset_id
      AND asset.owner_id = placement.owner_id
      AND asset.project_id = placement.project_id
      AND asset.status = 'active'
     JOIN wujie_asset_versions version
       ON version.id = placement.asset_version_id
      AND version.owner_id = placement.owner_id
      AND version.project_id = placement.project_id
     ${thumbnailJoin}
     WHERE placement.owner_id = $1
       AND placement.project_id = ANY($2::text[])
       AND placement.workspace_kind = 'canvas'
       AND placement.entity_type IN ('canvas-image', 'canvas-video')
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
      kind: row.asset_kind,
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
