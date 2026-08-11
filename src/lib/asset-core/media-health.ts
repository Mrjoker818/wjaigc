import { createHash, randomUUID } from 'node:crypto';

import {
  type AssetCoreSqlTransaction,
  withAssetCoreTransaction,
} from './storage';

export const DEFAULT_TRASH_RETENTION_DAYS = 30;

export interface OrphanCandidateInput {
  managed: boolean;
  activePlacements: number;
  legacyReferences: number;
  migrationConfirmed: boolean;
  byteSize?: number;
}

export interface PurgeEligibilityInput {
  assetStatus: 'active' | 'trashed';
  trashedAt: string | null;
  activePlacements: number;
  versionCount: number;
  legacyReferences: number;
  migrationConfirmed: boolean;
  candidateId: string;
  expectedCandidateId: string;
  confirmationDigest: string;
  expectedConfirmationDigest: string;
}

export interface MediaHealthCandidate {
  assetId: string;
  candidateId?: string;
  confirmationDigest?: string;
  estimatedBytes: number;
}

export interface MediaHealthProtection {
  assetId: string;
  reasons: string[];
  estimatedBytes: number;
}

export class MediaHealthError extends Error {
  constructor(readonly code: 'ASSET_NOT_FOUND' | 'ASSET_PURGE_REJECTED' | 'ASSET_RECOVERY_NOT_ALLOWED') {
    super(code);
    this.name = 'MediaHealthError';
  }
}

export function evaluateOrphanCandidate(input: OrphanCandidateInput): {
  candidate: boolean;
  protectionReasons: string[];
  estimatedBytes: number;
} {
  const protectionReasons: string[] = [];
  if (!input.managed) protectionReasons.push('UNMANAGED_MEDIA');
  if (input.activePlacements > 0) protectionReasons.push('ACTIVE_PLACEMENT');
  if (input.legacyReferences > 0) protectionReasons.push('LEGACY_REFERENCE');
  if (!input.migrationConfirmed) protectionReasons.push('MIGRATION_UNCONFIRMED');
  return {
    candidate: protectionReasons.length === 0,
    protectionReasons,
    estimatedBytes: input.byteSize ?? 0,
  };
}

export function evaluatePurgeEligibility(
  input: PurgeEligibilityInput,
  now: Date = new Date(),
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.assetStatus !== 'trashed') reasons.push('ASSET_NOT_TRASHED');
  if (!input.trashedAt) reasons.push('MISSING_TRASH_TIMESTAMP');
  if (input.trashedAt) {
    const notBefore = new Date(input.trashedAt).getTime()
      + DEFAULT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(notBefore) || now.getTime() < notBefore) reasons.push('RETENTION_NOT_ELAPSED');
  }
  if (input.activePlacements > 0) reasons.push('ACTIVE_PLACEMENT');
  if (input.versionCount === 0) reasons.push('UNKNOWN_OWNERSHIP');
  if (input.legacyReferences > 0) reasons.push('LEGACY_REFERENCE');
  if (!input.migrationConfirmed) reasons.push('MIGRATION_UNCONFIRMED');
  if (input.candidateId !== input.expectedCandidateId) reasons.push('CANDIDATE_ID_MISMATCH');
  if (input.confirmationDigest !== input.expectedConfirmationDigest) reasons.push('CONFIRMATION_DIGEST_MISMATCH');
  return { eligible: reasons.length === 0, reasons };
}

function digestCandidate(row: HealthRow): string {
  return createHash('sha256').update(JSON.stringify({
    activePlacements: row.active_placements,
    assetId: row.asset_id,
    byteSize: row.estimated_bytes,
    legacyReferences: row.legacy_references,
    managedVersions: row.managed_versions,
    migrationConfirmed: row.migration_confirmed,
    sharedMedia: row.shared_media,
    status: row.status,
    trashedAt: row.trashed_at?.toISOString() ?? null,
    unknownLegacyOwnership: row.unknown_legacy_ownership,
    updatedAt: row.updated_at.toISOString(),
    versionCount: row.version_count,
  })).digest('hex');
}

function legacyReferenceExpression(): string {
  return `EXISTS (
    SELECT 1 FROM wujie_user_data legacy_data
    JOIN wujie_asset_versions legacy_version
      ON legacy_version.asset_id = a.id
     AND legacy_version.owner_id = a.owner_id
     AND legacy_version.project_id = a.project_id
    WHERE legacy_data.user_id = a.owner_id
      AND legacy_data.data_key IN ('projects', 'workflows', 'workflow', 'chat', 'chat-history', 'simple-chat')
      AND legacy_data.data_value::text LIKE '%' || legacy_version.file_url || '%'
  )`;
}

interface HealthRow {
  asset_id: string;
  status: 'active' | 'trashed';
  updated_at: Date;
  trashed_at: Date | null;
  active_placements: string;
  version_count: string;
  managed_versions: string;
  estimated_bytes: string;
  migration_confirmed: boolean;
  legacy_references: boolean;
  shared_media: boolean;
  unknown_legacy_ownership: boolean;
}

async function listHealthRows(transaction: AssetCoreSqlTransaction, assetId?: string): Promise<HealthRow[]> {
  const result = await transaction.query<HealthRow>(
    `SELECT
       a.id AS asset_id,
       a.status,
       a.updated_at,
       max(placement.deleted_at) AS trashed_at,
       count(DISTINCT placement.id) FILTER (WHERE placement.status = 'active')::text AS active_placements,
       count(DISTINCT version.id)::text AS version_count,
       count(DISTINCT version.id) FILTER (
         WHERE version.storage_key IS NOT NULL OR version.file_url LIKE '/api/serve-upload/%'
       )::text AS managed_versions,
       coalesce((
         SELECT sum(media.byte_size) FROM (
           SELECT max(unique_version.byte_size) AS byte_size
           FROM wujie_asset_versions unique_version
           WHERE unique_version.asset_id = a.id
             AND unique_version.owner_id = a.owner_id
             AND unique_version.project_id = a.project_id
           GROUP BY coalesce(nullif(unique_version.storage_key, ''), 'url:' || unique_version.file_url)
         ) media
       ), 0)::text AS estimated_bytes,
       EXISTS (
         SELECT 1 FROM wujie_asset_migration_checkpoints checkpoint
         WHERE checkpoint.owner_id = a.owner_id
           AND checkpoint.project_id = a.project_id
           AND checkpoint.legacy_project_id = a.project_id
           AND checkpoint.status = 'completed'
       ) AS migration_confirmed,
       ${legacyReferenceExpression()} AS legacy_references,
       EXISTS (
         SELECT 1 FROM wujie_asset_versions peer
         JOIN wujie_asset_versions current_version
           ON current_version.asset_id = a.id
          AND current_version.owner_id = a.owner_id
          AND current_version.project_id = a.project_id
         WHERE peer.id <> current_version.id
           AND ((current_version.storage_key IS NOT NULL AND peer.storage_key = current_version.storage_key)
             OR peer.file_url = current_version.file_url)
       ) AS shared_media,
       NOT EXISTS (
         SELECT 1 FROM wujie_user_data ownership
         WHERE ownership.user_id = a.owner_id AND ownership.data_key = 'projects'
       ) AS unknown_legacy_ownership
     FROM wujie_assets a
     JOIN wujie_projects project ON project.id = a.project_id AND project.owner_id = a.owner_id
     LEFT JOIN wujie_asset_versions version
       ON version.asset_id = a.id AND version.owner_id = a.owner_id AND version.project_id = a.project_id
     LEFT JOIN wujie_workspace_placements placement
       ON placement.asset_id = a.id AND placement.owner_id = a.owner_id AND placement.project_id = a.project_id
     WHERE ($1::text IS NULL OR a.id = $1)
      GROUP BY a.id`,
    [assetId ?? null],
  );
  return result.rows;
}

function toCandidate(row: HealthRow): {
  input: OrphanCandidateInput;
  candidateId: string;
  confirmationDigest: string;
  trashedAt: string | null;
} {
  const estimatedBytes = Number(row.estimated_bytes);
  const confirmationDigest = digestCandidate(row);
  const candidateId = `gc_${confirmationDigest.slice(0, 24)}`;
  return {
    input: {
      managed: Number(row.managed_versions) > 0 && Number(row.version_count) === Number(row.managed_versions),
      activePlacements: Number(row.active_placements),
      legacyReferences: row.legacy_references || row.shared_media || row.unknown_legacy_ownership ? 1 : 0,
      migrationConfirmed: row.migration_confirmed,
      byteSize: estimatedBytes,
    },
    candidateId,
    confirmationDigest,
    trashedAt: row.trashed_at?.toISOString() ?? null,
  };
}

export async function scanMediaHealth(input: { dryRun?: boolean } = {}): Promise<{
  dryRun: boolean;
  candidates: MediaHealthCandidate[];
  protected: MediaHealthProtection[];
  estimatedBytes: number;
}> {
  const dryRun = input.dryRun !== false;
  const candidates: MediaHealthCandidate[] = [];
  const protectedRows: MediaHealthProtection[] = [];
  return withAssetCoreTransaction(async (transaction) => {
  for (const row of await listHealthRows(transaction)) {
    const candidate = toCandidate(row);
    const verdict = evaluateOrphanCandidate(candidate.input);
    if (row.status !== 'trashed') verdict.protectionReasons.unshift('ASSET_NOT_TRASHED');
    if (verdict.protectionReasons.length > 0) {
      protectedRows.push({ assetId: row.asset_id, reasons: verdict.protectionReasons, estimatedBytes: verdict.estimatedBytes });
      continue;
    }
    if (!dryRun) {
      await markGcCandidate({ assetId: row.asset_id, candidateId: candidate.candidateId, confirmationDigest: candidate.confirmationDigest, trashedAt: candidate.trashedAt }, transaction);
    }
    candidates.push({
      assetId: row.asset_id,
      ...(dryRun ? {} : { candidateId: candidate.candidateId, confirmationDigest: candidate.confirmationDigest }),
      estimatedBytes: verdict.estimatedBytes,
    });
  }
  return {
    dryRun,
    candidates,
    protected: protectedRows,
    estimatedBytes: candidates.reduce((total, candidate) => total + candidate.estimatedBytes, 0),
  };
  });
}

export async function markGcCandidate(input: {
  assetId: string;
  candidateId: string;
  confirmationDigest: string;
  trashedAt: string | null;
}, transaction?: AssetCoreSqlTransaction): Promise<void> {
  if (!input.trashedAt) throw new MediaHealthError('ASSET_PURGE_REJECTED');
  const notBefore = new Date(new Date(input.trashedAt).getTime() + DEFAULT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const write = async (client: AssetCoreSqlTransaction): Promise<void> => {
  await client.query(
    `INSERT INTO wujie_media_gc_candidates(
       id, asset_id, owner_id, project_id, status, reason, not_before, confirmation_digest, last_checked_at
     )
     SELECT $2, a.id, a.owner_id, a.project_id, 'pending', 'managed-orphan', $3, $4, now()
     FROM wujie_assets a
     WHERE a.id = $1
     ON CONFLICT (asset_id, owner_id, project_id) DO UPDATE
       SET id = EXCLUDED.id,
           status = 'pending',
           reason = EXCLUDED.reason,
           not_before = EXCLUDED.not_before,
           confirmation_digest = EXCLUDED.confirmation_digest,
           last_checked_at = now(),
           updated_at = now()`,
    [input.assetId, input.candidateId, notBefore.toISOString(), input.confirmationDigest],
  );
  };
  if (transaction) return write(transaction);
  return withAssetCoreTransaction(write);
}

export async function purgeEligibleAsset(input: {
  assetId: string;
  candidateId: string;
  confirmationDigest: string;
}): Promise<{ eligible: boolean; physicalPurgeDisabled: true; reasons: string[] }> {
  return withAssetCoreTransaction(async (client) => {
    const candidate = await client.query<{
      id: string;
      confirmation_digest: string;
      not_before: Date;
    }>(
      `SELECT id, confirmation_digest, not_before
       FROM wujie_media_gc_candidates
       WHERE asset_id = $1 FOR UPDATE`,
      [input.assetId],
    );
    await client.query(
      'SELECT id FROM wujie_assets WHERE id = $1 FOR UPDATE',
      [input.assetId],
    );
    const row = (await listHealthRows(client, input.assetId))[0];
    const stored = candidate.rows[0];
    if (!row || !stored) throw new MediaHealthError('ASSET_NOT_FOUND');
    const verdict = evaluatePurgeEligibility({
      assetStatus: row.status,
      trashedAt: row.trashed_at?.toISOString() ?? null,
      activePlacements: Number(row.active_placements),
      versionCount: Number(row.version_count),
      legacyReferences: row.legacy_references ? 1 : 0,
      migrationConfirmed: row.migration_confirmed,
      candidateId: input.candidateId,
      expectedCandidateId: stored.id,
      confirmationDigest: input.confirmationDigest,
      expectedConfirmationDigest: stored.confirmation_digest,
    });
    if (new Date() < stored.not_before && !verdict.reasons.includes('RETENTION_NOT_ELAPSED')) {
      verdict.reasons.push('RETENTION_NOT_ELAPSED');
      verdict.eligible = false;
    }
    if (Number(row.version_count) !== Number(row.managed_versions)) {
      verdict.reasons.push('UNMANAGED_MEDIA');
      verdict.eligible = false;
    }
    const fresh = toCandidate(row);
    if (stored.id !== fresh.candidateId) {
      verdict.reasons.push('CANDIDATE_STALE');
      verdict.eligible = false;
    }
    if (stored.confirmation_digest !== fresh.confirmationDigest) {
      verdict.reasons.push('CONFIRMATION_DIGEST_STALE');
      verdict.eligible = false;
    }
    await client.query(
      `UPDATE wujie_media_gc_candidates
       SET status = 'deferred', physical_purge_status = 'disabled', last_checked_at = now(), updated_at = now()
       WHERE asset_id = $1`,
      [input.assetId],
    );
    return { eligible: verdict.eligible, physicalPurgeDisabled: true, reasons: verdict.reasons };
  });
}

export async function recoverAssetMedia(input: {
  actorUserId: string;
  projectId: string;
  assetVersionId: string;
  assetId: string;
  placementId: string;
}): Promise<{ recovered: false; availability: 'recovering'; deferred: true }> {
  return withAssetCoreTransaction(async (client) => {
    const result = await client.query<{
      id: string;
      asset_id: string;
      recovery_source_url: string | null;
      storage_key: string | null;
    }>(
      `SELECT version.id, version.asset_id, version.recovery_source_url, version.storage_key
       FROM wujie_asset_versions version
       JOIN wujie_assets asset ON asset.id = version.asset_id AND asset.owner_id = version.owner_id AND asset.project_id = version.project_id
       JOIN wujie_workspace_placements placement ON placement.id = $5 AND placement.asset_version_id = version.id AND placement.asset_id = version.asset_id
       WHERE version.id = $1 AND version.owner_id = $2 AND version.project_id = $3 AND version.asset_id = $4
         AND version.availability IN ('missing', 'unrecoverable')
         AND asset.status = 'trashed' AND placement.status = 'trashed'
       FOR UPDATE OF version, asset, placement`,
      [input.assetVersionId, input.actorUserId, input.projectId, input.assetId, input.placementId],
    );
    const version = result.rows[0];
    if (!version) throw new MediaHealthError('ASSET_NOT_FOUND');
    await client.query(
      `UPDATE wujie_asset_versions
       SET availability = 'recovering'
       WHERE id = $1 AND owner_id = $2 AND project_id = $3
         AND availability IN ('missing', 'unrecoverable')`,
      [input.assetVersionId, input.actorUserId, input.projectId],
    );
    await client.query(
      `INSERT INTO wujie_asset_media_recovery_attempts(
        id, asset_version_id, asset_id, owner_id, project_id, source_url, status, detail
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), version.id, version.asset_id, input.actorUserId, input.projectId, version.recovery_source_url, 'deferred', 'Recovery is deferred to a managed persistence worker'],
    );
    return { recovered: false, availability: 'recovering', deferred: true };
  });
}
