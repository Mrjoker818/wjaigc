import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { getPool } from '@/lib/db-client';

import type {
  Asset,
  AssetFile,
  AssetKind,
  AssetVersion,
  WorkspaceKind,
  WorkspacePlacement,
} from './types';

type SqlClient = Pick<PoolClient, 'query'>;

export interface StoredVersion {
  version: AssetVersion;
  requestDigest: string;
}

export interface StoredTransfer {
  placement: WorkspacePlacement;
  requestDigest: string;
}

export interface AssetStorageTransaction {
  findProject(ownerId: string, projectId: string): Promise<boolean>;
  findAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null>;
  lockAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null>;
  insertAsset(asset: Asset): Promise<void>;
  findVersion(ownerId: string, versionId: string): Promise<AssetVersion | null>;
  findVersionByIdempotency(
    ownerId: string,
    projectId: string,
    idempotencyKey: string,
  ): Promise<StoredVersion | null>;
  insertVersion(version: AssetVersion, requestDigest: string): Promise<void>;
  insertParents(version: AssetVersion, parentVersionIds: string[]): Promise<void>;
  updateAssetCurrentVersion(
    ownerId: string,
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<Asset>;
  findPlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null>;
  findActivePlacement(
    ownerId: string,
    projectId: string,
    workspace: WorkspaceKind,
    workspaceId: string,
    entityType: string,
    entityId: string,
  ): Promise<WorkspacePlacement | null>;
  insertPlacement(placement: WorkspacePlacement): Promise<boolean>;
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
  insertTransferPlacement(placement: WorkspacePlacement, requestDigest: string): Promise<boolean>;
  trashPlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null>;
  countActivePlacements(ownerId: string, projectId: string, assetId: string): Promise<number>;
  trashAsset(ownerId: string, projectId: string, assetId: string): Promise<boolean>;
  activateAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null>;
  restorePlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null>;
}

export interface AssetStorage {
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
  transform: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  request_digest?: string | null;
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
    '{}'::text[]
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

  async findVersion(ownerId: string, versionId: string): Promise<AssetVersion | null> {
    const result = await this.client.query<VersionRow>(
      `${versionSelect}
       WHERE v.id = $1 AND v.owner_id = $2
       GROUP BY v.id`,
      [versionId, ownerId],
    );
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
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

  async insertVersion(version: AssetVersion, requestDigest: string): Promise<void> {
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
        version.idempotencyKey ?? null, JSON.stringify({ requestDigest }), version.createdAt,
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
       WHERE owner_id = $1 AND asset_version_id = $2 AND project_id = $3
         AND workspace_kind = $4 AND workspace_id = $5 AND entity_type = $6 AND entity_id = $7
         AND idempotency_key = $8`,
      [ownerId, sourceVersionId, targetProjectId, workspace, workspaceId, entityType, entityId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? { placement: mapPlacement(row), requestDigest: row.request_digest ?? '' } : null;
  }

  async insertTransferPlacement(placement: WorkspacePlacement, requestDigest: string): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO wujie_workspace_placements(
        id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
        entity_type, entity_id, status, deleted_at, transform, metadata, idempotency_key,
        request_digest, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17
      ) ON CONFLICT DO NOTHING`,
      [
        placement.id, placement.ownerId, placement.projectId, placement.assetId, placement.assetVersionId,
        placement.workspace, placement.workspaceId, placement.entityType, placement.entityId,
        placement.status, placement.deletedAt, JSON.stringify(placement.transform ?? {}),
        JSON.stringify(placement.metadata ?? {}), placement.metadata?.idempotencyKey ?? null,
        requestDigest, placement.createdAt, placement.updatedAt,
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

  async restorePlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement | null> {
    const result = await this.client.query<PlacementRow>(
      `UPDATE wujie_workspace_placements
       SET status = 'active', deleted_at = NULL, updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND status = 'trashed' RETURNING *`,
      [placementId, ownerId, projectId],
    );
    return result.rows[0] ? mapPlacement(result.rows[0]) : null;
  }
}

export class PostgresAssetStorage implements AssetStorage {
  constructor(private readonly pool: Pool = getPool()) {}

  async transaction<T>(callback: (transaction: AssetStorageTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(new PostgresAssetStorageTransaction(client));
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

export function createPostgresAssetStorage(pool?: Pool): AssetStorage {
  return new PostgresAssetStorage(pool);
}
