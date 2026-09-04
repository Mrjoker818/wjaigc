import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { getPool } from '@/lib/db-client';

import { trashCanvasPlacementSnapshotInTransaction } from './canvas-placement-snapshot';
import type {
  Asset,
  AssetFile,
  AssetKind,
  AssetVersion,
  WorkspaceKind,
  WorkspacePlacement,
} from './types';

export type AssetCoreSqlTransaction = Pick<PoolClient, 'query'>;
type SqlClient = AssetCoreSqlTransaction;

const ASSET_GRAPH_WRITE_GATE_KEY = 'wujie:asset-graph-write-gate:v1';
const ASSET_GRAPH_WRITE_GATE_TIMEOUT_MS = 5_000;

export type AssetGraphWriteGateMode = 'shared' | 'exclusive';

export class AssetGraphWriteGateTimeoutError extends Error {
  constructor() {
    super('ASSET_GRAPH_WRITE_GATE_TIMEOUT');
    this.name = 'AssetGraphWriteGateTimeoutError';
  }
}

function isPostgresLockTimeout(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '55P03';
}

export async function lockAssetGraphWriteGate(
  client: AssetCoreSqlTransaction,
  mode: AssetGraphWriteGateMode,
): Promise<void> {
  if (mode === 'shared') {
    await client.query(
      'SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))',
      [ASSET_GRAPH_WRITE_GATE_KEY],
    );
    return;
  }

  await client.query(`SET LOCAL lock_timeout = '${ASSET_GRAPH_WRITE_GATE_TIMEOUT_MS}ms'`);
  try {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [ASSET_GRAPH_WRITE_GATE_KEY],
    );
    await client.query("SET LOCAL lock_timeout = '0'");
  } catch (error) {
    if (isPostgresLockTimeout(error)) throw new AssetGraphWriteGateTimeoutError();
    throw error;
  }
}

export interface StoredVersion {
  version: AssetVersion;
  requestDigest: string;
}

export interface StoredTransfer {
  placement: WorkspacePlacement;
  requestDigest: string;
  sourceVersionId: string;
}

export interface AssetStorageTransaction {
  findProject(ownerId: string, projectId: string): Promise<boolean>;
  findAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null>;
  lockAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null>;
  insertAsset(asset: Asset): Promise<void>;
  resolveVersionProject(ownerId: string, versionId: string): Promise<string | null>;
  findVersion(ownerId: string, projectId: string, versionId: string): Promise<AssetVersion | null>;
  lockVersionIdempotency(ownerId: string, projectId: string, idempotencyKey: string): Promise<void>;
  findVersionByIdempotency(
    ownerId: string,
    projectId: string,
    idempotencyKey: string,
  ): Promise<StoredVersion | null>;
  insertVersion(
    version: AssetVersion,
    requestDigest: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  insertParents(version: AssetVersion, parentVersionIds: string[]): Promise<void>;
  updateAssetCurrentVersion(
    ownerId: string,
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<Asset>;
  findPlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null>;
  lockPlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null>;
  findActivePlacement(
    ownerId: string,
    projectId: string,
    workspace: WorkspaceKind,
    workspaceId: string,
    entityType: string,
    entityId: string,
  ): Promise<WorkspacePlacement | null>;
  findActivePlacementForVersion(
    ownerId: string,
    projectId: string,
    workspace: WorkspaceKind,
    workspaceId: string,
    assetVersionId: string,
  ): Promise<WorkspacePlacement | null>;
  insertPlacement(placement: WorkspacePlacement): Promise<boolean>;
  lockTransferIdempotency(ownerId: string, idempotencyKey: string): Promise<void>;
  findTransfersByIdempotency(ownerId: string, idempotencyKey: string): Promise<StoredTransfer[]>;
  findTransfer(
    ownerId: string,
    sourceVersionId: string,
    targetProjectId: string,
    workspace: WorkspaceKind,
    workspaceId: string,
    entityType: string,
    entityId: string,
    idempotencyKey: string,
  ): Promise<StoredTransfer | null>;
  insertTransferPlacement(
    placement: WorkspacePlacement,
    sourceVersionId: string,
    idempotencyKey: string,
    requestDigest: string,
  ): Promise<boolean>;
  trashPlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null>;
  countActivePlacements(ownerId: string, projectId: string, assetId: string): Promise<number>;
  trashAsset(ownerId: string, projectId: string, assetId: string): Promise<boolean>;
  activateAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null>;
  lockCanvasProjectSnapshot(ownerId: string): Promise<void>;
  readPlacementTrashProjectRevision(placement: WorkspacePlacement): Promise<number | undefined>;
  trashCanvasPlacementSnapshot(
    ownerId: string,
    projectId: string,
    placement: WorkspacePlacement,
  ): Promise<number>;
  restorePlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null>;
  restoreCanvasPlacementSnapshot(
    ownerId: string,
    projectId: string,
    placement: WorkspacePlacement,
  ): Promise<number>;
}

export interface AssetStorage {
  read<T>(callback: (transaction: AssetStorageTransaction) => Promise<T>): Promise<T>;
  transaction<T>(callback: (transaction: AssetStorageTransaction) => Promise<T>): Promise<T>;
}

interface AssetRow extends QueryResultRow {
  id: string;
  owner_id: string;
  project_id: string;
  kind: AssetKind;
  status: 'active' | 'trashed';
  current_version_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow extends QueryResultRow {
  id: string;
  asset_id: string;
  owner_id: string;
  project_id: string;
  file_url: string;
  storage_key: string | null;
  checksum: string | null;
  mime_type: string | null;
  byte_size: string | null;
  width: number | null;
  height: number | null;
  availability: AssetFile['availability'];
  recovery_source_url: string | null;
  task_id: string | null;
  idempotency_key: string | null;
  metadata: Record<string, unknown>;
  parent_version_ids: string[] | null;
  created_at: Date;
}

interface PlacementRow extends QueryResultRow {
  id: string;
  owner_id: string;
  project_id: string;
  asset_id: string;
  asset_version_id: string;
  workspace_kind: WorkspaceKind;
  workspace_id: string;
  entity_type: WorkspacePlacement['entityType'];
  entity_id: string;
  status: 'active' | 'trashed';
  deleted_at: Date | null;
  lifecycle_revision?: string;
  transform: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  request_digest?: string | null;
  source_version_id?: string | null;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    kind: row.kind,
    status: row.status,
    currentVersionId: row.current_version_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapVersion(row: VersionRow): AssetVersion {
  return {
    id: row.id,
    assetId: row.asset_id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    file: {
      url: row.file_url,
      availability: row.availability,
      ...(row.storage_key ? { storageKey: row.storage_key } : {}),
      ...(row.checksum ? { checksum: row.checksum } : {}),
      ...(row.mime_type ? { mimeType: row.mime_type } : {}),
      ...(row.byte_size === null ? {} : { byteSize: Number(row.byte_size) }),
      ...(row.width === null ? {} : { width: row.width }),
      ...(row.height === null ? {} : { height: row.height }),
      ...(row.recovery_source_url ? { recoverySourceUrl: row.recovery_source_url } : {}),
    },
    parentVersionIds: row.parent_version_ids ?? [],
    ...(row.task_id ? { taskId: row.task_id } : {}),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    ...(Object.keys(asRecord(row.metadata)).length > 0 ? { metadata: asRecord(row.metadata) } : {}),
    createdAt: toIso(row.created_at),
  };
}

function mapPlacement(row: PlacementRow): WorkspacePlacement {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    assetId: row.asset_id,
    assetVersionId: row.asset_version_id,
    workspace: row.workspace_kind,
    workspaceId: row.workspace_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    status: row.status,
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
    ...(row.lifecycle_revision ? { lifecycleRevision: row.lifecycle_revision } : {}),
    ...(Object.keys(asRecord(row.transform)).length > 0 ? { transform: asRecord(row.transform) } : {}),
    ...(Object.keys(asRecord(row.metadata)).length > 0 ? { metadata: asRecord(row.metadata) } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  } as WorkspacePlacement;
}

const versionSelect = `
  SELECT v.*, COALESCE(
    array_agg(p.parent_version_id ORDER BY p.parent_order)
      FILTER (WHERE p.parent_version_id IS NOT NULL),
    ARRAY(
      SELECT jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(v.metadata->'sourceVersionIds') = 'array'
          THEN v.metadata->'sourceVersionIds'
          ELSE '[]'::jsonb
        END
      )
    )
  ) AS parent_version_ids
  FROM wujie_asset_versions v
  LEFT JOIN wujie_asset_version_parents p ON p.version_id = v.id
`;

class PostgresAssetStorageTransaction implements AssetStorageTransaction {
  constructor(private readonly client: SqlClient) {}

  async findProject(ownerId: string, projectId: string): Promise<boolean> {
    const result = await this.client.query(
      'SELECT 1 FROM wujie_projects WHERE id = $1 AND owner_id = $2 AND status = $3',
      [projectId, ownerId, 'active'],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async findAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null> {
    const result = await this.client.query<AssetRow>(
      `SELECT * FROM wujie_assets
       WHERE id = $1 AND owner_id = $2 AND project_id = $3`,
      [assetId, ownerId, projectId],
    );
    return result.rows[0] ? mapAsset(result.rows[0]) : null;
  }

  async lockAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null> {
    const result = await this.client.query<AssetRow>(
      `SELECT * FROM wujie_assets
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 FOR UPDATE`,
      [assetId, ownerId, projectId],
    );
    return result.rows[0] ? mapAsset(result.rows[0]) : null;
  }

  async insertAsset(asset: Asset): Promise<void> {
    await this.client.query(
      `INSERT INTO wujie_assets(
        id, owner_id, project_id, kind, status, current_version_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [asset.id, asset.ownerId, asset.projectId, asset.kind, asset.status, asset.currentVersionId, asset.createdAt],
    );
  }

  async resolveVersionProject(ownerId: string, versionId: string): Promise<string | null> {
    const result = await this.client.query<{ project_id: string }>(
      `SELECT version.project_id
       FROM wujie_asset_versions version
       JOIN wujie_projects project
         ON project.id = version.project_id AND project.owner_id = version.owner_id
       WHERE version.id = $1 AND version.owner_id = $2 AND project.status = 'active'`,
      [versionId, ownerId],
    );
    return result.rows[0]?.project_id ?? null;
  }

  async findVersion(ownerId: string, projectId: string, versionId: string): Promise<AssetVersion | null> {
    const result = await this.client.query<VersionRow>(
      `${versionSelect}
       WHERE v.id = $1 AND v.owner_id = $2 AND v.project_id = $3
       GROUP BY v.id`,
      [versionId, ownerId, projectId],
    );
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
  }

  async lockVersionIdempotency(
    ownerId: string,
    projectId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`asset-version:${ownerId}:${projectId}:${idempotencyKey}`],
    );
  }

  async findVersionByIdempotency(
    ownerId: string,
    projectId: string,
    idempotencyKey: string,
  ): Promise<StoredVersion | null> {
    const result = await this.client.query<VersionRow>(
      `${versionSelect}
       WHERE v.owner_id = $1 AND v.project_id = $2 AND v.idempotency_key = $3
       GROUP BY v.id`,
      [ownerId, projectId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? {
      version: mapVersion(row),
      requestDigest: typeof row.metadata?.requestDigest === 'string' ? row.metadata.requestDigest : '',
    } : null;
  }

  async insertVersion(
    version: AssetVersion,
    requestDigest: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO wujie_asset_versions(
        id, asset_id, owner_id, project_id, file_url, storage_key, checksum, mime_type,
        byte_size, width, height, availability, recovery_source_url, task_id,
        idempotency_key, metadata, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17
      )`,
      [
        version.id, version.assetId, version.ownerId, version.projectId, version.file.url,
        version.file.storageKey ?? null, version.file.checksum ?? null, version.file.mimeType ?? null,
        version.file.byteSize ?? null, version.file.width ?? null, version.file.height ?? null,
        version.file.availability, version.file.recoverySourceUrl ?? null, version.taskId ?? null,
        version.idempotencyKey ?? null, JSON.stringify({ ...metadata, requestDigest }), version.createdAt,
      ],
    );
  }

  async insertParents(version: AssetVersion, parentVersionIds: string[]): Promise<void> {
    for (const [parentOrder, parentVersionId] of parentVersionIds.entries()) {
      await this.client.query(
        `INSERT INTO wujie_asset_version_parents(
          asset_id, owner_id, project_id, version_id, parent_version_id, parent_order
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [version.assetId, version.ownerId, version.projectId, version.id, parentVersionId, parentOrder],
      );
    }
  }

  async updateAssetCurrentVersion(
    ownerId: string,
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<Asset> {
    const result = await this.client.query<AssetRow>(
      `UPDATE wujie_assets SET current_version_id = $4, status = 'active', updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 RETURNING *`,
      [assetId, ownerId, projectId, versionId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Asset update unexpectedly affected no rows');
    return mapAsset(row);
  }

  async findPlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null> {
    const result = await this.client.query<PlacementRow>(
      `SELECT * FROM wujie_workspace_placements
       WHERE id = $1 AND owner_id = $2 AND project_id = $3`,
      [placementId, ownerId, projectId],
    );
    return result.rows[0] ? mapPlacement(result.rows[0]) : null;
  }

  async lockPlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null> {
    const result = await this.client.query<PlacementRow>(
      `SELECT *, xmin::text AS lifecycle_revision FROM wujie_workspace_placements
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 FOR UPDATE`,
      [placementId, ownerId, projectId],
    );
    return result.rows[0] ? mapPlacement(result.rows[0]) : null;
  }

  async findActivePlacement(
    ownerId: string,
    projectId: string,
    workspace: WorkspaceKind,
    workspaceId: string,
    entityType: string,
    entityId: string,
  ): Promise<WorkspacePlacement | null> {
    const result = await this.client.query<PlacementRow>(
      `SELECT * FROM wujie_workspace_placements
       WHERE owner_id = $1 AND project_id = $2 AND workspace_kind = $3 AND workspace_id = $4
         AND entity_type = $5 AND entity_id = $6 AND status = 'active'`,
      [ownerId, projectId, workspace, workspaceId, entityType, entityId],
    );
    return result.rows[0] ? mapPlacement(result.rows[0]) : null;
  }

  async findActivePlacementForVersion(
    ownerId: string,
    projectId: string,
    workspace: WorkspaceKind,
    workspaceId: string,
    assetVersionId: string,
  ): Promise<WorkspacePlacement | null> {
    const result = await this.client.query<PlacementRow>(
      `SELECT * FROM wujie_workspace_placements
       WHERE owner_id = $1 AND project_id = $2 AND workspace_kind = $3 AND workspace_id = $4
         AND asset_version_id = $5 AND status = 'active'
       ORDER BY created_at, id LIMIT 1`,
      [ownerId, projectId, workspace, workspaceId, assetVersionId],
    );
    return result.rows[0] ? mapPlacement(result.rows[0]) : null;
  }

  async insertPlacement(placement: WorkspacePlacement): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO wujie_workspace_placements(
        id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
        entity_type, entity_id, status, deleted_at, transform, metadata, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15
      ) ON CONFLICT DO NOTHING`,
      [
        placement.id, placement.ownerId, placement.projectId, placement.assetId, placement.assetVersionId,
        placement.workspace, placement.workspaceId, placement.entityType, placement.entityId,
        placement.status, placement.deletedAt, JSON.stringify(placement.transform ?? {}),
        JSON.stringify(placement.metadata ?? {}), placement.createdAt, placement.updatedAt,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async lockTransferIdempotency(ownerId: string, idempotencyKey: string): Promise<void> {
    await this.client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`asset-transfer:${ownerId}:${idempotencyKey}`],
    );
  }

  async findTransfersByIdempotency(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<StoredTransfer[]> {
    const result = await this.client.query<PlacementRow>(
      `SELECT *, xmin::text AS lifecycle_revision FROM wujie_workspace_placements
       WHERE owner_id = $1 AND idempotency_key = $2
       ORDER BY created_at, id`,
      [ownerId, idempotencyKey],
    );
    return result.rows.map(row => ({
      placement: mapPlacement(row),
      requestDigest: row.request_digest ?? '',
      sourceVersionId: row.source_version_id ?? '',
    }));
  }

  async findTransfer(
    ownerId: string,
    sourceVersionId: string,
    targetProjectId: string,
    workspace: WorkspaceKind,
    workspaceId: string,
    entityType: string,
    entityId: string,
    idempotencyKey: string,
  ): Promise<StoredTransfer | null> {
    const result = await this.client.query<PlacementRow>(
      `SELECT * FROM wujie_workspace_placements
       WHERE owner_id = $1 AND source_version_id = $2 AND project_id = $3
         AND workspace_kind = $4 AND workspace_id = $5 AND entity_type = $6 AND entity_id = $7
         AND idempotency_key = $8`,
      [ownerId, sourceVersionId, targetProjectId, workspace, workspaceId, entityType, entityId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? {
      placement: mapPlacement(row),
      requestDigest: row.request_digest ?? '',
      sourceVersionId: row.source_version_id ?? '',
    } : null;
  }

  async insertTransferPlacement(
    placement: WorkspacePlacement,
    sourceVersionId: string,
    idempotencyKey: string,
    requestDigest: string,
  ): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO wujie_workspace_placements(
        id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
        entity_type, entity_id, status, deleted_at, transform, metadata, idempotency_key,
        request_digest, source_version_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18
      ) ON CONFLICT DO NOTHING`,
      [
        placement.id, placement.ownerId, placement.projectId, placement.assetId, placement.assetVersionId,
        placement.workspace, placement.workspaceId, placement.entityType, placement.entityId,
        placement.status, placement.deletedAt, JSON.stringify(placement.transform ?? {}),
        JSON.stringify(placement.metadata ?? {}), idempotencyKey,
        requestDigest, sourceVersionId, placement.createdAt, placement.updatedAt,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async trashPlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null> {
    const result = await this.client.query<PlacementRow>(
      `UPDATE wujie_workspace_placements
       SET status = 'trashed', deleted_at = now(), updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND status = 'active' RETURNING *`,
      [placementId, ownerId, projectId],
    );
    return result.rows[0] ? mapPlacement(result.rows[0]) : null;
  }

  async countActivePlacements(ownerId: string, projectId: string, assetId: string): Promise<number> {
    const result = await this.client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM wujie_workspace_placements
       WHERE asset_id = $1 AND owner_id = $2 AND project_id = $3 AND status = 'active'`,
      [assetId, ownerId, projectId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async trashAsset(ownerId: string, projectId: string, assetId: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE wujie_assets SET status = 'trashed', updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND status = 'active'`,
      [assetId, ownerId, projectId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async activateAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null> {
    const result = await this.client.query<AssetRow>(
      `UPDATE wujie_assets SET status = 'active', updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 RETURNING *`,
      [assetId, ownerId, projectId],
    );
    return result.rows[0] ? mapAsset(result.rows[0]) : null;
  }

  async lockCanvasProjectSnapshot(ownerId: string): Promise<void> {
    await this.client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [ownerId, '__asset_graph_projects_revision'],
    );
  }

  async readPlacementTrashProjectRevision(placement: WorkspacePlacement): Promise<number | undefined> {
    const value = placement.metadata?.canvasTrashProjectRevision;
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
  }

  async trashCanvasPlacementSnapshot(
    ownerId: string,
    projectId: string,
    placement: WorkspacePlacement,
  ): Promise<number> {
    return trashCanvasPlacementSnapshotInTransaction(this.client, ownerId, projectId, placement);
  }

  async restorePlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null> {
    const result = await this.client.query<PlacementRow>(
      `UPDATE wujie_workspace_placements
       SET status = 'active', deleted_at = NULL, updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND status = 'trashed' RETURNING *`,
      [placementId, ownerId, projectId],
    );
    return result.rows[0] ? mapPlacement(result.rows[0]) : null;
  }

  async restoreCanvasPlacementSnapshot(
    ownerId: string,
    projectId: string,
    placement: WorkspacePlacement,
  ): Promise<number> {
    const snapshot = await this.client.query<{ data_value: unknown }>(
      `SELECT data_value FROM wujie_user_data
       WHERE user_id = $1 AND data_key = 'projects'
       FOR UPDATE`,
      [ownerId],
    );
    const projects = Array.isArray(snapshot.rows[0]?.data_value)
      ? snapshot.rows[0].data_value as Array<Record<string, unknown>>
      : null;
    if (!projects) throw new Error('Canvas project snapshot is unavailable');
    const project = projects.find(candidate => candidate.id === projectId);
    if (!project) throw new Error('Canvas project snapshot is unavailable');
    const version = await this.findVersion(ownerId, projectId, placement.assetVersionId);
    if (!version) throw new Error('Canvas asset version is unavailable');
    const metadataImage = placement.metadata?.legacyImage;
    const base = metadataImage && typeof metadataImage === 'object' && !Array.isArray(metadataImage)
      ? metadataImage as Record<string, unknown>
      : {};
    const transform = placement.transform ?? {};
    const restoredDimensions: Record<string, number> = {};
    for (const [key, fallback] of [
      ['originalWidth', version.file.width],
      ['originalHeight', version.file.height],
    ] as const) {
      const existing = transform[key] ?? base[key];
      if (!(typeof existing === 'number' && Number.isFinite(existing) && existing > 1)
        && typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) {
        restoredDimensions[key] = fallback;
      }
    }
    const image = {
      ...base,
      ...transform,
      ...restoredDimensions,
      id: placement.entityId,
      url: version.file.url,
      sourceUrl: version.file.recoverySourceUrl ?? base.sourceUrl,
      mediaAvailability: version.file.availability,
      assetId: placement.assetId,
      assetVersionId: placement.assetVersionId,
      placementId: placement.id,
    };
    const canvasImages = Array.isArray(project.canvasImages)
      ? project.canvasImages as Array<Record<string, unknown>>
      : [];
    const existingIndex = canvasImages.findIndex(candidate => candidate.id === placement.entityId);
    project.canvasImages = existingIndex >= 0
      ? canvasImages.map((candidate, index) => index === existingIndex ? image : candidate)
      : [...canvasImages, image];
    project.updatedAt = Date.now();
    await this.client.query(
      `UPDATE wujie_user_data
       SET data_value = $2::jsonb, updated_at = $3
       WHERE user_id = $1 AND data_key = 'projects'`,
      [ownerId, JSON.stringify(projects), Date.now()],
    );
    const revision = await this.client.query<{ revision: string }>(
      `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
       VALUES ($1, '__asset_graph_projects_revision', '1'::jsonb, $2)
       ON CONFLICT (user_id, data_key) DO UPDATE SET
         data_value = to_jsonb(COALESCE(
           CASE
             WHEN jsonb_typeof(wujie_user_data.data_value) = 'number'
               THEN (wujie_user_data.data_value #>> '{}')::bigint
             WHEN jsonb_typeof(wujie_user_data.data_value) = 'string'
                  AND (wujie_user_data.data_value #>> '{}') ~ '^\\d+$'
               THEN (wujie_user_data.data_value #>> '{}')::bigint
             ELSE 0
           END,
           0
         ) + 1),
         updated_at = EXCLUDED.updated_at
       RETURNING data_value #>> '{}' AS revision`,
      [ownerId, Date.now()],
    );
    return Number(revision.rows[0]?.revision ?? 0);
  }
}

export class PostgresAssetStorage implements AssetStorage {
  constructor(private readonly pool: Pool = getPool()) {}

  async read<T>(callback: (transaction: AssetStorageTransaction) => Promise<T>): Promise<T> {
    return this.runTransaction(callback, false);
  }

  async transaction<T>(callback: (transaction: AssetStorageTransaction) => Promise<T>): Promise<T> {
    return this.runTransaction(callback, true);
  }

  private async runTransaction<T>(
    callback: (transaction: AssetStorageTransaction) => Promise<T>,
    write: boolean,
  ): Promise<T> {
    const client = await this.pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      if (write) await lockAssetGraphWriteGate(client, 'shared');
      const result = await callback(new PostgresAssetStorageTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        const releaseError = rollbackError instanceof Error
          ? rollbackError
          : new Error(String(rollbackError));
        client.release(releaseError);
        released = true;
      }
      throw error;
    } finally {
      if (!released) client.release();
    }
  }
}

export function createPostgresAssetStorage(pool?: Pool): AssetStorage {
  return new PostgresAssetStorage(pool);
}

/** Runs lifecycle-only SQL through the same BEGIN/COMMIT discipline as asset storage. */
export async function withAssetCoreTransaction<T>(
  callback: (transaction: AssetCoreSqlTransaction) => Promise<T>,
  pool: Pool = getPool(),
  writeGate: 'shared' | 'none' = 'none',
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (writeGate === 'shared') await lockAssetGraphWriteGate(client, 'shared');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
