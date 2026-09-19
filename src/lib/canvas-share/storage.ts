import type { Pool, QueryResultRow } from 'pg';

import {
  type AssetCoreSqlTransaction,
  createAssetStorageTransaction,
  withAssetCoreTransaction,
} from '@/lib/asset-core/storage';
import type { Asset, AssetVersion } from '@/lib/asset-core/types';
import { getPool } from '@/lib/db-client';

import { CanvasShareError } from './errors';
import type {
  CanvasShareItemRecord,
  CanvasSharePolicyPatch,
  CanvasShareRecord,
  CanvasShareSafeDisplayMetadata,
  CanvasShareStatus,
  CanvasShareTransform,
  CanvasShareViewport,
} from './types';

export interface StoredCanvasShareSnapshot {
  record: CanvasShareRecord;
  items: CanvasShareItemRecord[];
}

interface CanvasShareRow extends QueryResultRow {
  id: string;
  owner_id: string;
  project_id: string;
  project_revision: number;
  token_hash: string;
  title: string;
  status: CanvasShareStatus;
  expires_at: Date | string | null;
  allow_download: boolean;
  viewport: CanvasShareViewport;
  snapshot_digest: string;
  view_count: string | number;
  last_viewed_at: Date | string | null;
  created_at: Date | string;
  revoked_at: Date | string | null;
}

interface CanvasShareOwnerRow extends CanvasShareRow {
  item_count: string | number;
}

interface CanvasSharePublicRow extends CanvasShareRow {
  item_count: string | number;
}

export interface CanvasShareOwnerRecord extends CanvasShareRecord {
  itemCount: number;
}

interface CanvasShareItemRow extends QueryResultRow {
  id: string;
  share_id: string;
  placement_id: string;
  asset_id: string;
  asset_version_id: string;
  entity_type: 'canvas-image' | 'canvas-video';
  asset_kind: 'image' | 'video';
  transform: CanvasShareTransform;
  display_metadata: CanvasShareSafeDisplayMetadata;
  mime_type: string;
  width: number | null;
  height: number | null;
  byte_size: string | number | null;
  checksum: string | null;
  availability: 'ready';
  sort_order: number;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function mapShare(row: CanvasShareRow): CanvasShareRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    projectRevision: row.project_revision,
    tokenHash: row.token_hash,
    title: row.title,
    status: row.status,
    expiresAt: nullableIso(row.expires_at),
    allowDownload: row.allow_download,
    viewport: row.viewport,
    snapshotDigest: row.snapshot_digest,
    viewCount: Number(row.view_count),
    lastViewedAt: nullableIso(row.last_viewed_at),
    createdAt: toIso(row.created_at),
    revokedAt: nullableIso(row.revoked_at),
  };
}

function mapItem(row: CanvasShareItemRow): CanvasShareItemRecord {
  return {
    id: row.id,
    shareId: row.share_id,
    placementId: row.placement_id,
    assetId: row.asset_id,
    assetVersionId: row.asset_version_id,
    entityType: row.entity_type,
    assetKind: row.asset_kind,
    transform: row.transform,
    displayMetadata: row.display_metadata,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    checksum: row.checksum,
    availability: row.availability,
    sortOrder: row.sort_order,
    createdAt: toIso(row.created_at),
  };
}

async function insertCanvasShareWithClient(
  client: AssetCoreSqlTransaction,
  record: CanvasShareRecord,
  items: readonly CanvasShareItemRecord[],
): Promise<StoredCanvasShareSnapshot> {
  await client.query(
    `INSERT INTO wujie_canvas_shares (
       id, owner_id, project_id, project_revision, token_hash, title, status,
       expires_at, allow_download, viewport, snapshot_digest, view_count,
       last_viewed_at, created_at, revoked_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15
     )`,
    [
      record.id,
      record.ownerId,
      record.projectId,
      record.projectRevision,
      record.tokenHash,
      record.title,
      record.status,
      record.expiresAt,
      record.allowDownload,
      JSON.stringify(record.viewport),
      record.snapshotDigest,
      record.viewCount,
      record.lastViewedAt,
      record.createdAt,
      record.revokedAt,
    ],
  );
  for (const item of items) {
    await client.query(
      `INSERT INTO wujie_canvas_share_items (
         id, share_id, placement_id, asset_id, asset_version_id, entity_type,
         asset_kind, transform, display_metadata, mime_type, width, height,
         byte_size, checksum, availability, sort_order, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12,
         $13, $14, $15, $16, $17
       )`,
      [
        item.id,
        record.id,
        item.placementId,
        item.assetId,
        item.assetVersionId,
        item.entityType,
        item.assetKind,
        JSON.stringify(item.transform),
        JSON.stringify(item.displayMetadata),
        item.mimeType,
        item.width,
        item.height,
        item.byteSize,
        item.checksum,
        item.availability,
        item.sortOrder,
        item.createdAt,
      ],
    );
  }
  return { record, items: [...items] };
}

export async function insertCanvasShare(
  record: CanvasShareRecord,
  items: readonly CanvasShareItemRecord[],
  client?: AssetCoreSqlTransaction,
  pool: Pool = getPool(),
): Promise<StoredCanvasShareSnapshot> {
  if (client) return insertCanvasShareWithClient(client, record, items);
  return withAssetCoreTransaction(
    transaction => insertCanvasShareWithClient(transaction, record, items),
    pool,
    'shared',
  );
}

async function readItems(
  client: Pick<Pool, 'query'>,
  shareId: string,
): Promise<CanvasShareItemRecord[]> {
  const result = await client.query<CanvasShareItemRow>(
    `SELECT * FROM wujie_canvas_share_items
     WHERE share_id = $1
     ORDER BY sort_order, id`,
    [shareId],
  );
  return result.rows.map(mapItem);
}

export async function listCanvasShares(
  ownerId: string,
  projectId: string,
  database: Pick<Pool, 'query'> = getPool(),
): Promise<CanvasShareOwnerRecord[]> {
  const result = await database.query<CanvasShareOwnerRow>(
    `SELECT share_record.*, count(item.id)::bigint AS item_count
     FROM wujie_canvas_shares share_record
     LEFT JOIN wujie_canvas_share_items item ON item.share_id = share_record.id
     WHERE share_record.owner_id = $1 AND share_record.project_id = $2
     GROUP BY share_record.id
     ORDER BY share_record.created_at DESC, share_record.id DESC`,
    [ownerId, projectId],
  );
  return result.rows.map(row => ({ ...mapShare(row), itemCount: Number(row.item_count) }));
}

export async function findCanvasShareForOwner(
  ownerId: string,
  shareId: string,
  database: Pick<Pool, 'query'> = getPool(),
): Promise<StoredCanvasShareSnapshot | null> {
  const result = await database.query<CanvasShareRow>(
    'SELECT * FROM wujie_canvas_shares WHERE id = $1 AND owner_id = $2',
    [shareId, ownerId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { record: mapShare(row), items: await readItems(database, row.id) };
}

export async function findCanvasShareByTokenHash(
  tokenHash: string,
  database: Pick<Pool, 'query'> = getPool(),
): Promise<StoredCanvasShareSnapshot | null> {
  const result = await database.query<CanvasShareRow>(
    'SELECT * FROM wujie_canvas_shares WHERE token_hash = $1',
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { record: mapShare(row), items: await readItems(database, row.id) };
}

export async function updateCanvasSharePolicy(
  ownerId: string,
  shareId: string,
  patch: CanvasSharePolicyPatch,
  database: Pick<Pool, 'query'> = getPool(),
): Promise<CanvasShareRecord | null> {
  const result = await database.query<CanvasShareRow>(
    `UPDATE wujie_canvas_shares
     SET expires_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE expires_at END,
         allow_download = CASE WHEN $5::boolean THEN $6::boolean ELSE allow_download END
     WHERE id = $1 AND owner_id = $2 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > now())
     RETURNING *`,
    [
      shareId,
      ownerId,
      patch.expiresAt !== undefined,
      patch.expiresAt ?? null,
      patch.allowDownload !== undefined,
      patch.allowDownload ?? false,
    ],
  );
  return result.rows[0] ? mapShare(result.rows[0]) : null;
}

export interface CanvasShareExpectedPolicy {
  expiresAt: string | null;
  allowDownload: boolean;
}

export async function updateCanvasSharePolicyIfCurrent(
  ownerId: string,
  shareId: string,
  patch: CanvasSharePolicyPatch,
  expected: CanvasShareExpectedPolicy,
  database: Pick<Pool, 'query'> = getPool(),
): Promise<CanvasShareRecord | null> {
  const result = await database.query<CanvasShareRow>(
    `UPDATE wujie_canvas_shares
     SET expires_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE expires_at END,
         allow_download = CASE WHEN $5::boolean THEN $6::boolean ELSE allow_download END
     WHERE id = $1 AND owner_id = $2 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > now())
       AND expires_at IS NOT DISTINCT FROM $7::timestamptz
       AND allow_download = $8::boolean
     RETURNING *`,
    [
      shareId,
      ownerId,
      patch.expiresAt !== undefined,
      patch.expiresAt ?? null,
      patch.allowDownload !== undefined,
      patch.allowDownload ?? false,
      expected.expiresAt,
      expected.allowDownload,
    ],
  );
  return result.rows[0] ? mapShare(result.rows[0]) : null;
}

export async function revokeCanvasShare(
  ownerId: string,
  shareId: string,
  revokedAt: string,
  database: Pick<Pool, 'query'> = getPool(),
): Promise<CanvasShareRecord | null> {
  const result = await database.query<CanvasShareRow>(
    `UPDATE wujie_canvas_shares
     SET status = 'revoked', revoked_at = $3
     WHERE id = $1 AND owner_id = $2 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > $3)
     RETURNING *`,
    [shareId, ownerId, revokedAt],
  );
  return result.rows[0] ? mapShare(result.rows[0]) : null;
}

export async function incrementCanvasShareView(
  shareId: string,
  viewedAt: string,
  database: Pick<Pool, 'query'> = getPool(),
): Promise<CanvasShareRecord | null> {
  const result = await database.query<CanvasShareRow>(
    `UPDATE wujie_canvas_shares
     SET view_count = view_count + 1, last_viewed_at = $2
     WHERE id = $1 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > $2)
     RETURNING *`,
    [shareId, viewedAt],
  );
  return result.rows[0] ? mapShare(result.rows[0]) : null;
}

export interface CanvasSharePublicSnapshotContext {
  snapshot: StoredCanvasShareSnapshot;
  expectedItemCount: number;
  incrementView(): Promise<CanvasShareRecord | null>;
  findAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null>;
  findVersion(ownerId: string, projectId: string, versionId: string): Promise<AssetVersion | null>;
}

export type CanvasSharePublicSnapshotOperation<T> = (
  context: CanvasSharePublicSnapshotContext,
) => Promise<T>;

async function withLockedActiveCanvasShareSnapshot<T>(
  tokenHash: string,
  accessedAt: string,
  operation: CanvasSharePublicSnapshotOperation<T>,
  lockMode: 'update' | 'share',
  pool: Pool,
): Promise<T> {
  const lockClause = lockMode === 'update' ? 'FOR UPDATE' : 'FOR SHARE';
  return withAssetCoreTransaction(async client => {
    const result = await client.query<CanvasSharePublicRow>(
      `SELECT share_record.*,
              (SELECT count(*)::bigint
                 FROM wujie_canvas_share_items item
                WHERE item.share_id = share_record.id) AS item_count
         FROM wujie_canvas_shares share_record
        WHERE share_record.token_hash = $1
          AND share_record.status = 'active'
          AND (share_record.expires_at IS NULL OR share_record.expires_at > $2::timestamptz)
        ${lockClause}`,
      [tokenHash, accessedAt],
    );
    const row = result.rows[0];
    if (!row) throw new CanvasShareError('CANVAS_SHARE_NOT_FOUND');
    const snapshot: StoredCanvasShareSnapshot = {
      record: mapShare(row),
      items: await readItems(client, row.id),
    };
    const assetStorage = createAssetStorageTransaction(client);
    return operation({
      snapshot,
      expectedItemCount: Number(row.item_count),
      incrementView: () => incrementCanvasShareView(row.id, accessedAt, client),
      findAsset: (ownerId, projectId, assetId) => (
        assetStorage.findAsset(ownerId, projectId, assetId)
      ),
      findVersion: (ownerId, projectId, versionId) => (
        assetStorage.findVersion(ownerId, projectId, versionId)
      ),
    });
  }, pool);
}

export async function withActiveCanvasShareSnapshot<T>(
  tokenHash: string,
  accessedAt: string,
  operation: CanvasSharePublicSnapshotOperation<T>,
  pool: Pool = getPool(),
): Promise<T> {
  return withLockedActiveCanvasShareSnapshot(
    tokenHash,
    accessedAt,
    operation,
    'update',
    pool,
  );
}

export async function withActiveCanvasShareMediaSnapshot<T>(
  tokenHash: string,
  accessedAt: string,
  operation: CanvasSharePublicSnapshotOperation<T>,
  pool: Pool = getPool(),
): Promise<T> {
  return withLockedActiveCanvasShareSnapshot(
    tokenHash,
    accessedAt,
    operation,
    'share',
    pool,
  );
}
