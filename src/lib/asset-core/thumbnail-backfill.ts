import { createHash, randomUUID } from 'node:crypto';

import type { QueryResultRow } from 'pg';

import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';
import {
  deleteImageFile,
  isServerDataRootDurable,
  saveImageFile,
} from '@/lib/server-data-root';
import { readImageFromS3Bounded, uploadImageToS3 } from '@/lib/s3-storage';

import { withAssetCoreTransaction } from './storage';

export type ThumbnailVariantSize = 256 | 512;

export interface ThumbnailBackfillSummary {
  dryRun: boolean;
  discovered: number;
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface ThumbnailBackfillStatus {
  pending: number;
  processing: number;
  ready: number;
  failed: number;
}

export interface ThumbnailVariantTarget {
  assetVersionId: string;
  assetId: string;
  ownerId: string;
  projectId: string;
  size: ThumbnailVariantSize;
  fileUrl: string;
  storageKey: string | null;
  recoverySourceUrl: string | null;
  leaseOwner: string;
}

export interface ThumbnailVariantResult {
  fileUrl: string;
  storageKey: string | null;
  checksum: string;
  mimeType: 'image/webp';
  byteSize: number;
  width: number;
  height: number;
}

export interface ThumbnailBackfillDependencies {
  discover(input: { dryRun: boolean; limit: number }): Promise<number>;
  claim(input: {
    leaseOwner: string;
    leaseExpiresAt: Date;
    limit: number;
  }): Promise<ThumbnailVariantTarget[]>;
  execute(target: ThumbnailVariantTarget): Promise<ThumbnailVariantResult>;
  complete(target: ThumbnailVariantTarget, result: ThumbnailVariantResult): Promise<boolean>;
  fail(target: ThumbnailVariantTarget, error: string): Promise<boolean>;
  status(): Promise<ThumbnailBackfillStatus>;
  createLeaseOwner(): string;
  now(): Date;
}

export interface ThumbnailBackfillOptions {
  limit?: number;
  leaseMs?: number;
}

interface ClaimedThumbnailRow extends QueryResultRow {
  asset_version_id: string;
  asset_id: string;
  owner_id: string;
  project_id: string;
  size: ThumbnailVariantSize;
  file_url: string;
  storage_key: string | null;
  recovery_source_url: string | null;
  lease_owner: string;
}

interface CountRow extends QueryResultRow {
  count: string;
}

interface StatusRow extends QueryResultRow {
  status: 'pending' | 'processing' | 'ready' | 'failed';
  count: string;
}

const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 80_000_000;

const DISCOVER_THUMBNAIL_VARIANTS_SQL = `
  WITH candidate_variants AS (
    SELECT version.id AS asset_version_id, size.value::smallint AS size,
           version.asset_id, version.owner_id, version.project_id
    FROM wujie_asset_versions version
    JOIN wujie_assets asset
      ON asset.id = version.asset_id
     AND asset.owner_id = version.owner_id
     AND asset.project_id = version.project_id
    CROSS JOIN (VALUES (256), (512)) AS size(value)
    WHERE asset.kind = 'image'
      AND asset.status = 'active'
      AND version.availability = 'ready'
      AND version.width IS NOT NULL
      AND version.height IS NOT NULL
      AND greatest(version.width, version.height) > size.value
      AND NOT EXISTS (
        SELECT 1 FROM wujie_asset_thumbnail_variants existing
        WHERE existing.asset_version_id = version.id
          AND existing.size = size.value
      )
    ORDER BY version.created_at, version.id, size.value
    LIMIT $1
  )
`;

const INSERT_THUMBNAIL_VARIANTS_SQL = `
  ${DISCOVER_THUMBNAIL_VARIANTS_SQL}
  INSERT INTO wujie_asset_thumbnail_variants(
    asset_version_id, size, asset_id, owner_id, project_id, status
  )
  SELECT asset_version_id, size, asset_id, owner_id, project_id, 'pending'
  FROM candidate_variants
  ON CONFLICT (asset_version_id, size) DO NOTHING
  RETURNING asset_version_id
`;

export const CLAIM_THUMBNAIL_VARIANTS_SQL = `
  WITH candidates AS (
    SELECT variant.asset_version_id, variant.size
    FROM wujie_asset_thumbnail_variants variant
    WHERE variant.status IN ('pending', 'failed')
       OR (variant.status = 'processing' AND variant.lease_expires_at <= now())
    ORDER BY variant.updated_at, variant.asset_version_id, variant.size
    LIMIT $3
    FOR UPDATE SKIP LOCKED
  )
  UPDATE wujie_asset_thumbnail_variants variant
  SET status = 'processing', lease_owner = $1, lease_expires_at = $2,
      attempt_count = attempt_count + 1, updated_at = now()
  FROM candidates
  WHERE variant.asset_version_id = candidates.asset_version_id
    AND variant.size = candidates.size
  RETURNING variant.asset_version_id, variant.asset_id, variant.owner_id,
            variant.project_id, variant.size, variant.lease_owner
`;

function toTarget(row: ClaimedThumbnailRow): ThumbnailVariantTarget {
  return {
    assetVersionId: row.asset_version_id,
    assetId: row.asset_id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    size: Number(row.size) as ThumbnailVariantSize,
    fileUrl: row.file_url,
    storageKey: row.storage_key,
    recoverySourceUrl: row.recovery_source_url,
    leaseOwner: row.lease_owner,
  };
}

async function loadThumbnailSource(target: ThumbnailVariantTarget): Promise<Buffer> {
  if (target.storageKey) {
    const fromStorage = await readImageFromS3Bounded(
      target.storageKey.replace(/^\/+/, ''),
      MAX_SOURCE_BYTES,
      30_000,
    );
    if (fromStorage) return fromStorage;
  }
  try {
    return (await loadSafeImageInput(target.fileUrl, {
      maxBytes: MAX_SOURCE_BYTES,
      maxPixels: MAX_SOURCE_PIXELS,
    })).buffer;
  } catch (error) {
    if (!target.recoverySourceUrl) throw error;
    return (await loadSafeImageInput(target.recoverySourceUrl, {
      maxBytes: MAX_SOURCE_BYTES,
      maxPixels: MAX_SOURCE_PIXELS,
    })).buffer;
  }
}

async function executeThumbnailVariant(
  target: ThumbnailVariantTarget,
): Promise<ThumbnailVariantResult> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(target.assetVersionId)) {
    throw new Error('Asset version identifier is invalid');
  }
  const source = await loadThumbnailSource(target);
  const sourceMetadata = await safeSharp(source, { maxPixels: MAX_SOURCE_PIXELS }).metadata();
  const longestEdge = Math.max(sourceMetadata.width ?? 0, sourceMetadata.height ?? 0);
  if (longestEdge <= target.size) throw new Error('Source image is not larger than the thumbnail');

  const output = await safeSharp(source, { maxPixels: MAX_SOURCE_PIXELS })
    .resize({
      width: target.size,
      height: target.size,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  const outputMetadata = await safeSharp(output).metadata();
  if (!outputMetadata.width || !outputMetadata.height) {
    throw new Error('Generated thumbnail dimensions are unavailable');
  }

  const filename = `${target.size}.webp`;
  const subdirectory = `thumbnails/${target.assetVersionId}`;
  const fileUrl = saveImageFile(output, filename, subdirectory);
  const storageKey = await uploadImageToS3(
    output,
    `${subdirectory}/${filename}`,
    'image/webp',
  ).catch(() => null);
  if (!storageKey && !isServerDataRootDurable()) {
    deleteImageFile(filename, subdirectory);
    throw new Error('Thumbnail output could not be persisted durably');
  }
  return {
    fileUrl,
    storageKey: storageKey?.replace(/^\/+/, '') ?? null,
    checksum: `sha256:${createHash('sha256').update(output).digest('hex')}`,
    mimeType: 'image/webp',
    byteSize: output.byteLength,
    width: outputMetadata.width,
    height: outputMetadata.height,
  };
}

export function createPostgresThumbnailBackfillDependencies(): ThumbnailBackfillDependencies {
  return {
    async discover({ dryRun, limit }) {
      return withAssetCoreTransaction(async (transaction) => {
        if (dryRun) {
          const result = await transaction.query<CountRow>(
            `${DISCOVER_THUMBNAIL_VARIANTS_SQL} SELECT count(*)::text AS count FROM candidate_variants`,
            [limit],
          );
          return Number(result.rows[0]?.count ?? 0);
        }
        const result = await transaction.query(INSERT_THUMBNAIL_VARIANTS_SQL, [limit]);
        return result.rowCount ?? 0;
      });
    },
    async claim({ leaseOwner, leaseExpiresAt, limit }) {
      return withAssetCoreTransaction(async (transaction) => {
        const claimed = await transaction.query<ClaimedThumbnailRow>(
          `WITH claimed AS (${CLAIM_THUMBNAIL_VARIANTS_SQL})
           SELECT claimed.*, version.file_url, version.storage_key, version.recovery_source_url
           FROM claimed
           JOIN wujie_asset_versions version ON version.id = claimed.asset_version_id`,
          [leaseOwner, leaseExpiresAt.toISOString(), limit],
        );
        return claimed.rows.map(toTarget);
      });
    },
    execute: executeThumbnailVariant,
    async complete(target, result) {
      return withAssetCoreTransaction(async (transaction) => {
        const completed = await transaction.query(
          `UPDATE wujie_asset_thumbnail_variants
           SET status = 'ready', file_url = $4, storage_key = $5,
               checksum = $6, mime_type = $7, byte_size = $8,
               width = $9, height = $10, lease_owner = NULL,
               lease_expires_at = NULL, last_error = NULL, updated_at = now()
           WHERE asset_version_id = $1 AND size = $2
             AND lease_owner = $3 AND status = 'processing'
           RETURNING asset_version_id`,
          [
            target.assetVersionId,
            target.size,
            target.leaseOwner,
            result.fileUrl,
            result.storageKey,
            result.checksum,
            result.mimeType,
            result.byteSize,
            result.width,
            result.height,
          ],
        );
        return (completed.rowCount ?? 0) === 1;
      });
    },
    async fail(target, error) {
      return withAssetCoreTransaction(async (transaction) => {
        const failed = await transaction.query(
          `UPDATE wujie_asset_thumbnail_variants
           SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
               last_error = $4, updated_at = now()
           WHERE asset_version_id = $1 AND size = $2
             AND lease_owner = $3 AND status = 'processing'
           RETURNING asset_version_id`,
          [target.assetVersionId, target.size, target.leaseOwner, error.slice(0, 2000)],
        );
        return (failed.rowCount ?? 0) === 1;
      });
    },
    async status() {
      return withAssetCoreTransaction(async (transaction) => {
        const result = await transaction.query<StatusRow>(
          `SELECT status, count(*)::text AS count
           FROM wujie_asset_thumbnail_variants GROUP BY status`,
        );
        const status: ThumbnailBackfillStatus = { pending: 0, processing: 0, ready: 0, failed: 0 };
        for (const row of result.rows) status[row.status] = Number(row.count);
        return status;
      });
    },
    createLeaseOwner: randomUUID,
    now: () => new Date(),
  };
}

function requireDependencies(
  dependencies?: ThumbnailBackfillDependencies,
): ThumbnailBackfillDependencies {
  return dependencies ?? createPostgresThumbnailBackfillDependencies();
}

function normalizeLimit(value?: number): number {
  if (!Number.isInteger(value) || !value) return 20;
  return Math.min(100, Math.max(1, value));
}

function normalizeLeaseMs(value?: number): number {
  if (!Number.isFinite(value)) return 120_000;
  return Math.min(10 * 60_000, Math.max(30_000, Math.trunc(value!)));
}

function emptySummary(dryRun: boolean, discovered: number): ThumbnailBackfillSummary {
  return { dryRun, discovered, claimed: 0, completed: 0, failed: 0, skipped: 0 };
}

export async function previewAssetThumbnailBackfill(
  options: ThumbnailBackfillOptions = {},
  dependencies?: ThumbnailBackfillDependencies,
): Promise<ThumbnailBackfillSummary> {
  const deps = requireDependencies(dependencies);
  const limit = normalizeLimit(options.limit);
  const discovered = await deps.discover({ dryRun: true, limit });
  return emptySummary(true, discovered);
}

export async function runAssetThumbnailBackfill(
  options: ThumbnailBackfillOptions = {},
  dependencies?: ThumbnailBackfillDependencies,
): Promise<ThumbnailBackfillSummary> {
  const deps = requireDependencies(dependencies);
  const limit = normalizeLimit(options.limit);
  const discovered = await deps.discover({ dryRun: false, limit });
  const leaseOwner = deps.createLeaseOwner();
  const leaseExpiresAt = new Date(deps.now().getTime() + normalizeLeaseMs(options.leaseMs));
  const targets = await deps.claim({ leaseOwner, leaseExpiresAt, limit });
  const summary = { ...emptySummary(false, discovered), claimed: targets.length };

  for (const target of targets) {
    try {
      const result = await deps.execute(target);
      if (await deps.complete(target, result)) summary.completed += 1;
      else summary.skipped += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Thumbnail generation failed';
      if (await deps.fail(target, message)) summary.failed += 1;
      else summary.skipped += 1;
    }
  }
  return summary;
}

export async function getAssetThumbnailBackfillStatus(
  dependencies?: ThumbnailBackfillDependencies,
): Promise<ThumbnailBackfillStatus> {
  return requireDependencies(dependencies).status();
}
