import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';

import {
  type AssetCoreSqlTransaction,
  lockAssetGraphWriteGate,
  withAssetCoreTransaction,
} from './storage';
import type {
  AssetMediaRecoveryExecution,
  AssetMediaRecoveryTarget,
} from './media-recovery-worker';

export const DEFAULT_TRASH_RETENTION_DAYS = 30;
const MEDIA_RECOVERY_LEASE_MS = 5 * 60 * 1000;

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
  candidateId: string;
  confirmationDigest: string;
  estimatedBytes: number;
}

export interface MediaHealthProtection {
  assetId: string;
  reasons: string[];
  estimatedBytes: number;
}

export interface ConfirmationDigestFacts {
  assetId: string;
  assetStatus: 'active' | 'trashed';
  assetUpdatedAt: string;
  retention: {
    days: number;
    trashedAt: string | null;
    notBefore: string | null;
  };
  versions: Array<{
    id: string;
    storageKey: string | null;
    fileUrl: string;
    availability: string;
    byteSize: string | null;
  }>;
  placements: Array<{
    id: string;
    status: 'active' | 'trashed';
    deletedAt: string | null;
  }>;
  migrationCheckpoints: Array<{
    id: string;
    legacyProjectId: string;
    status: string;
    updatedAt: string;
  }>;
  legacyReferences: Array<{
    userId: string;
    dataKey: string;
    versionId: string;
    fileUrl: string;
  }>;
  sharedPhysicalReferences: Array<{
    versionId: string;
    peerAssetId: string;
    peerVersionId: string;
    storageKey: string | null;
    fileUrl: string;
    peerStorageKey?: string | null;
    peerFileUrl?: string;
  }>;
  unknownLegacyOwnership: boolean;
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

function compareFacts(left: object, right: object): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

export function createConfirmationDigest(input: ConfirmationDigestFacts): string {
  const canonical = {
    assetId: input.assetId,
    assetStatus: input.assetStatus,
    assetUpdatedAt: input.assetUpdatedAt,
    legacyReferences: input.legacyReferences
      .map(fact => ({
        dataKey: fact.dataKey,
        fileUrl: fact.fileUrl,
        userId: fact.userId,
        versionId: fact.versionId,
      }))
      .sort(compareFacts),
    migrationCheckpoints: input.migrationCheckpoints
      .map(fact => ({
        id: fact.id,
        legacyProjectId: fact.legacyProjectId,
        status: fact.status,
        updatedAt: fact.updatedAt,
      }))
      .sort(compareFacts),
    placements: input.placements
      .map(fact => ({ deletedAt: fact.deletedAt, id: fact.id, status: fact.status }))
      .sort(compareFacts),
    retention: {
      days: input.retention.days,
      notBefore: input.retention.notBefore,
      trashedAt: input.retention.trashedAt,
    },
    sharedPhysicalReferences: input.sharedPhysicalReferences
      .map(fact => ({
        fileUrl: fact.fileUrl,
        peerAssetId: fact.peerAssetId,
        peerFileUrl: fact.peerFileUrl ?? null,
        peerStorageKey: fact.peerStorageKey ?? null,
        peerVersionId: fact.peerVersionId,
        storageKey: fact.storageKey,
        versionId: fact.versionId,
      }))
      .sort(compareFacts),
    unknownLegacyOwnership: input.unknownLegacyOwnership,
    versions: input.versions
      .map(fact => ({
        availability: fact.availability,
        byteSize: fact.byteSize,
        fileUrl: fact.fileUrl,
        id: fact.id,
        storageKey: fact.storageKey,
      }))
      .sort(compareFacts),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function legacyReferenceExpression(): string {
  return `EXISTS (
    SELECT 1 FROM wujie_user_data legacy_data
    JOIN wujie_asset_versions legacy_version
      ON legacy_version.asset_id = a.id
     AND legacy_version.owner_id = a.owner_id
     AND legacy_version.project_id = a.project_id
    WHERE legacy_data.data_key IN ('projects', 'workflows', 'workflow', 'chat', 'chat-history', 'simple-chat')
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
  version_facts: ConfirmationDigestFacts['versions'];
  placement_facts: ConfirmationDigestFacts['placements'];
  migration_checkpoint_facts: ConfirmationDigestFacts['migrationCheckpoints'];
  legacy_reference_facts: ConfirmationDigestFacts['legacyReferences'];
  shared_physical_reference_facts: ConfirmationDigestFacts['sharedPhysicalReferences'];
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function digestCandidate(row: HealthRow): string {
  const trashedAt = toIso(row.trashed_at);
  const retentionTime = trashedAt
    ? new Date(trashedAt).getTime() + DEFAULT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
    : Number.NaN;
  return createConfirmationDigest({
    assetId: row.asset_id,
    assetStatus: row.status,
    assetUpdatedAt: toIso(row.updated_at) ?? '',
    retention: {
      days: DEFAULT_TRASH_RETENTION_DAYS,
      trashedAt,
      notBefore: Number.isFinite(retentionTime) ? new Date(retentionTime).toISOString() : null,
    },
    versions: row.version_facts,
    placements: row.placement_facts.map(fact => ({ ...fact, deletedAt: toIso(fact.deletedAt) })),
    migrationCheckpoints: row.migration_checkpoint_facts.map(fact => ({
      ...fact,
      updatedAt: toIso(fact.updatedAt) ?? '',
    })),
    legacyReferences: row.legacy_reference_facts,
    sharedPhysicalReferences: row.shared_physical_reference_facts,
    unknownLegacyOwnership: row.unknown_legacy_ownership,
  });
}

async function listHealthRows(transaction: AssetCoreSqlTransaction, assetId?: string): Promise<HealthRow[]> {
  const result = await transaction.query<HealthRow>(
    `SELECT
       a.id AS asset_id,
       a.status,
       a.updated_at,
       coalesce((
         SELECT jsonb_agg(
           jsonb_build_object(
             'id', version_fact.id,
             'storageKey', version_fact.storage_key,
             'fileUrl', version_fact.file_url,
             'availability', version_fact.availability,
             'byteSize', version_fact.byte_size::text
           ) ORDER BY version_fact.id
         )
         FROM wujie_asset_versions version_fact
         WHERE version_fact.asset_id = a.id
           AND version_fact.owner_id = a.owner_id
           AND version_fact.project_id = a.project_id
       ), '[]'::jsonb) AS version_facts,
       coalesce((
         SELECT jsonb_agg(
           jsonb_build_object(
             'id', placement_fact.id,
             'status', placement_fact.status,
             'deletedAt', placement_fact.deleted_at
           ) ORDER BY placement_fact.id
         )
         FROM wujie_workspace_placements placement_fact
         WHERE placement_fact.asset_id = a.id
           AND placement_fact.owner_id = a.owner_id
           AND placement_fact.project_id = a.project_id
       ), '[]'::jsonb) AS placement_facts,
       coalesce((
         SELECT jsonb_agg(
           jsonb_build_object(
             'id', checkpoint_fact.id,
             'legacyProjectId', checkpoint_fact.legacy_project_id,
             'status', checkpoint_fact.status,
             'updatedAt', checkpoint_fact.updated_at
           ) ORDER BY checkpoint_fact.id
         )
         FROM wujie_asset_migration_checkpoints checkpoint_fact
         WHERE checkpoint_fact.owner_id = a.owner_id
           AND checkpoint_fact.project_id = a.project_id
           AND checkpoint_fact.legacy_project_id = a.project_id
       ), '[]'::jsonb) AS migration_checkpoint_facts,
       coalesce((
         SELECT jsonb_agg(
           jsonb_build_object(
             'userId', legacy_data.user_id,
             'dataKey', legacy_data.data_key,
             'versionId', legacy_version.id,
             'fileUrl', legacy_version.file_url
           ) ORDER BY legacy_data.user_id, legacy_data.data_key, legacy_version.id
         )
         FROM wujie_user_data legacy_data
         JOIN wujie_asset_versions legacy_version
           ON legacy_version.asset_id = a.id
          AND legacy_version.owner_id = a.owner_id
          AND legacy_version.project_id = a.project_id
         WHERE legacy_data.data_key IN ('projects', 'workflows', 'workflow', 'chat', 'chat-history', 'simple-chat')
           AND legacy_data.data_value::text LIKE '%' || legacy_version.file_url || '%'
       ), '[]'::jsonb) AS legacy_reference_facts,
       coalesce((
         SELECT jsonb_agg(
           jsonb_build_object(
             'versionId', shared_fact.version_id,
             'peerAssetId', shared_fact.peer_asset_id,
             'peerVersionId', shared_fact.peer_version_id,
             'storageKey', shared_fact.storage_key,
             'fileUrl', shared_fact.file_url,
             'peerStorageKey', shared_fact.peer_storage_key,
             'peerFileUrl', shared_fact.peer_file_url
           ) ORDER BY shared_fact.version_id, shared_fact.peer_asset_id, shared_fact.peer_version_id
         )
         FROM (
           SELECT DISTINCT
             current_version.id AS version_id,
             peer.asset_id AS peer_asset_id,
             peer.id AS peer_version_id,
             current_version.storage_key,
             current_version.file_url,
             peer.storage_key AS peer_storage_key,
             peer.file_url AS peer_file_url
           FROM wujie_asset_versions current_version
           JOIN wujie_asset_versions peer
             ON (
               (current_version.storage_key IS NOT NULL AND peer.storage_key = current_version.storage_key)
               OR peer.file_url = current_version.file_url
             )
           WHERE current_version.asset_id = a.id
             AND current_version.owner_id = a.owner_id
             AND current_version.project_id = a.project_id
             AND (peer.asset_id, peer.owner_id, peer.project_id) <>
               (current_version.asset_id, current_version.owner_id, current_version.project_id)
         ) shared_fact
       ), '[]'::jsonb) AS shared_physical_reference_facts,
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
         WHERE (peer.asset_id, peer.owner_id, peer.project_id) <>
             (current_version.asset_id, current_version.owner_id, current_version.project_id)
           AND ((current_version.storage_key IS NOT NULL AND peer.storage_key = current_version.storage_key)
             OR peer.file_url = current_version.file_url)
       ) AS shared_media,
       NOT EXISTS (
         SELECT 1 FROM wujie_user_data ownership
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE
             WHEN jsonb_typeof(ownership.data_value) = 'array' THEN ownership.data_value
             ELSE '[]'::jsonb
           END
         ) legacy_project(value)
         WHERE ownership.user_id = a.owner_id
           AND ownership.data_key = 'projects'
           AND legacy_project.value->>'id' = a.project_id
           AND (
             NOT legacy_project.value ? 'userId'
             OR legacy_project.value->>'userId' = a.owner_id
           )
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
      candidateId: candidate.candidateId,
      confirmationDigest: candidate.confirmationDigest,
      estimatedBytes: verdict.estimatedBytes,
    });
  }
  return {
    dryRun,
    candidates,
    protected: protectedRows,
    estimatedBytes: candidates.reduce((total, candidate) => total + candidate.estimatedBytes, 0),
  };
  }, undefined, dryRun ? 'none' : 'shared');
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
  return withAssetCoreTransaction(write, undefined, 'shared');
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
    if (row.shared_media) {
      verdict.reasons.push('SHARED_MEDIA');
      verdict.eligible = false;
    }
    if (row.unknown_legacy_ownership) {
      verdict.reasons.push('UNKNOWN_LEGACY_OWNERSHIP');
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
  }, undefined, 'shared');
}

interface AssetMediaRecoveryIdentity {
  actorUserId: string;
  projectId: string;
  assetVersionId: string;
  assetId: string;
  placementId: string;
}

export async function getAssetMediaRecoveryStatus(input: AssetMediaRecoveryIdentity): Promise<
  | { recovered: true; availability: 'ready'; deferred: false; url: string }
  | { recovered: false; availability: 'missing'; deferred: false; error: string }
  | { recovered: false; availability: 'recovering'; deferred: true }
  | { recovered: false; availability: 'unrecoverable'; deferred: false }
> {
  return withAssetCoreTransaction(async (client) => {
    const result = await client.query<{ file_url: string; availability: string }>(
      `SELECT version.file_url, version.availability
       FROM wujie_assets asset
       JOIN wujie_asset_versions version ON version.asset_id = asset.id
       JOIN wujie_workspace_placements placement
         ON placement.asset_id = asset.id AND placement.asset_version_id = version.id
       WHERE asset.id = $1 AND asset.owner_id = $2 AND asset.project_id = $3
         AND asset.status IN ('active', 'trashed')
         AND version.id = $4 AND version.owner_id = $2 AND version.project_id = $3
         AND placement.id = $5 AND placement.owner_id = $2 AND placement.project_id = $3
         AND placement.status IN ('active', 'trashed')`,
      [input.assetId, input.actorUserId, input.projectId, input.assetVersionId, input.placementId],
    );
    const row = result.rows[0];
    if (!row) throw new MediaHealthError('ASSET_NOT_FOUND');
    if (row.availability === 'ready') {
      return { recovered: true, availability: 'ready', deferred: false, url: row.file_url };
    }
    if (row.availability === 'recovering') {
      return { recovered: false, availability: 'recovering', deferred: true };
    }
    if (row.availability === 'unrecoverable') {
      return { recovered: false, availability: 'unrecoverable', deferred: false };
    }
    return { recovered: false, availability: 'missing', deferred: false, error: 'Managed media recovery failed' };
  }, undefined, 'none');
}

export async function recoverAssetMedia(input: AssetMediaRecoveryIdentity, dependencies: {
  executeRecovery?: (target: AssetMediaRecoveryTarget) => Promise<AssetMediaRecoveryExecution>;
  scheduleRecovery?: (work: () => Promise<void>) => void;
} = {}): Promise<
  | { recovered: true; availability: 'ready'; deferred: false; url: string }
  | { recovered: false; availability: 'missing'; deferred: false; error: string }
  | { recovered: false; availability: 'recovering'; deferred: true }
  | { recovered: false; availability: 'unrecoverable'; deferred: false }
> {
  const attemptId = randomUUID();
  const recovery = await withAssetCoreTransaction(async (client) => {
    const asset = await client.query<{ id: string; status: string }>(
      `SELECT id
       FROM wujie_assets
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND status IN ('active', 'trashed')
       FOR UPDATE`,
      [input.assetId, input.actorUserId, input.projectId],
    );
    if (!asset.rows[0]) throw new MediaHealthError('ASSET_NOT_FOUND');
    const result = await client.query<{
      id: string;
      asset_id: string;
      file_url: string;
      recovery_source_url: string | null;
      storage_key: string | null;
      checksum: string | null;
      mime_type: string | null;
      byte_size: string | null;
      availability: string;
    }>(
      `SELECT version.id, version.asset_id, version.file_url, version.recovery_source_url,
              version.storage_key, version.checksum, version.mime_type,
              version.byte_size::text, version.availability
       FROM wujie_asset_versions version
       WHERE version.id = $1 AND version.owner_id = $2 AND version.project_id = $3 AND version.asset_id = $4
         AND version.availability IN ('ready', 'missing', 'recovering', 'unrecoverable')
       FOR UPDATE`,
      [input.assetVersionId, input.actorUserId, input.projectId, input.assetId],
    );
    const version = result.rows[0];
    if (!version) throw new MediaHealthError('ASSET_NOT_FOUND');
    const placement = await client.query<{ id: string; status: string }>(
      `SELECT id
       FROM wujie_workspace_placements
       WHERE id = $1 AND owner_id = $2 AND project_id = $3
         AND asset_id = $4 AND asset_version_id = $5 AND status IN ('active', 'trashed')
       FOR UPDATE`,
      [input.placementId, input.actorUserId, input.projectId, input.assetId, input.assetVersionId],
    );
    if (!placement.rows[0]) throw new MediaHealthError('ASSET_NOT_FOUND');
    if (version.availability === 'recovering') {
      const activeAttempt = await client.query<{ id: string; created_at: Date }>(
        `SELECT id, created_at
         FROM wujie_asset_media_recovery_attempts
         WHERE asset_version_id = $1 AND owner_id = $2 AND project_id = $3 AND status = 'deferred'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [input.assetVersionId, input.actorUserId, input.projectId],
      );
      const lease = activeAttempt.rows[0];
      if (lease && Date.now() - new Date(lease.created_at).getTime() < MEDIA_RECOVERY_LEASE_MS) {
        return { kind: 'deferred' as const };
      }
      if (lease) {
        await client.query(
          `UPDATE wujie_asset_media_recovery_attempts
           SET status = 'failed', detail = 'Recovery lease expired before reaching a terminal state'
           WHERE id = $1 AND status = 'deferred'`,
          [lease.id],
        );
      }
    }
    const recoverable = Boolean(
      version.recovery_source_url
      || version.storage_key
      || version.file_url.startsWith('/api/serve-upload/'),
    );
    const availability = recoverable ? 'recovering' : 'unrecoverable';
    const attemptStatus = recoverable ? 'deferred' : 'unrecoverable';
    const detail = recoverable
      ? 'Recovery is deferred to a managed persistence worker'
      : 'No recovery source or managed storage key is available';
    await client.query(
      `UPDATE wujie_asset_versions
       SET availability = $4
       WHERE id = $1 AND owner_id = $2 AND project_id = $3
         AND availability IN ('ready', 'missing', 'unrecoverable')`,
      [input.assetVersionId, input.actorUserId, input.projectId, availability],
    );
    await client.query(
      `INSERT INTO wujie_asset_media_recovery_attempts(
        id, asset_version_id, asset_id, owner_id, project_id, source_url, status, detail
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [attemptId, version.id, version.asset_id, input.actorUserId, input.projectId, version.recovery_source_url, attemptStatus, detail],
    );
    return recoverable ? {
      kind: 'execute' as const,
      target: {
        fileUrl: version.file_url,
        recoverySourceUrl: version.recovery_source_url,
        storageKey: version.storage_key,
        checksum: version.checksum,
        mimeType: version.mime_type,
        assetVersionId: version.id,
        attemptId,
      },
    } : { kind: 'unrecoverable' as const };
  }, undefined, 'shared');

  if (recovery.kind === 'unrecoverable') {
    return { recovered: false, availability: 'unrecoverable', deferred: false };
  }
  if (recovery.kind === 'deferred') {
    return { recovered: false, availability: 'recovering', deferred: true };
  }
  if (!dependencies.executeRecovery) {
    return { recovered: false, availability: 'recovering', deferred: true };
  }

  const executeAndSettle = async () => {
    let execution: AssetMediaRecoveryExecution;
    try {
      execution = await dependencies.executeRecovery!(recovery.target);
    } catch (error) {
      execution = {
        success: false,
        method: 'worker',
        error: error instanceof Error ? error.message : 'Managed media recovery worker failed',
      };
    }
    const availability = execution.success ? 'ready' : execution.retryable === false ? 'unrecoverable' : 'missing';
    const attemptStatus = execution.success ? 'succeeded' : execution.retryable === false ? 'unrecoverable' : 'failed';
    const detail = execution.success
      ? `Recovered by managed media worker using ${execution.method}`
      : execution.error ?? `Managed media recovery failed using ${execution.method}`;

    const applied = await withAssetCoreTransaction(async (client) => {
    const asset = await client.query<{ id: string }>(
      `SELECT id, current_version_id FROM wujie_assets
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND status IN ('active', 'trashed')
       FOR UPDATE`,
      [input.assetId, input.actorUserId, input.projectId],
    );
    if (!asset.rows[0]) throw new MediaHealthError('ASSET_NOT_FOUND');
    const version = await client.query<{ id: string }>(
      `SELECT id FROM wujie_asset_versions
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND asset_id = $4
       FOR UPDATE`,
      [input.assetVersionId, input.actorUserId, input.projectId, input.assetId],
    );
    if (!version.rows[0]) throw new MediaHealthError('ASSET_NOT_FOUND');
    const placement = await client.query<{ id: string }>(
      `SELECT id FROM wujie_workspace_placements
       WHERE id = $1 AND owner_id = $2 AND project_id = $3
         AND asset_id = $4 AND asset_version_id = $5 AND status IN ('active', 'trashed')
       FOR UPDATE`,
      [input.placementId, input.actorUserId, input.projectId, input.assetId, input.assetVersionId],
    );
    if (!placement.rows[0]) throw new MediaHealthError('ASSET_NOT_FOUND');
    const attempt = await client.query<{ id: string }>(
      `SELECT id FROM wujie_asset_media_recovery_attempts
       WHERE id = $1 AND asset_version_id = $2 AND owner_id = $3 AND project_id = $4
         AND status = 'deferred'
       FOR UPDATE`,
      [attemptId, input.assetVersionId, input.actorUserId, input.projectId],
    );
    if (!attempt.rows[0]) return false;
    const versionUpdate = await client.query(
      `UPDATE wujie_asset_versions
       SET availability = $4,
           file_url = CASE WHEN $4 = 'ready' THEN coalesce($5, file_url) ELSE file_url END,
           storage_key = CASE WHEN $4 = 'ready' THEN coalesce($6, storage_key) ELSE storage_key END,
           checksum = CASE WHEN $4 = 'ready' THEN coalesce($7, checksum) ELSE checksum END,
           mime_type = CASE WHEN $4 = 'ready' THEN coalesce($8, mime_type) ELSE mime_type END,
           byte_size = CASE WHEN $4 = 'ready' THEN coalesce($9, byte_size) ELSE byte_size END
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND availability = 'recovering'`,
      [
        input.assetVersionId,
        input.actorUserId,
        input.projectId,
        availability,
        execution.url ?? null,
        execution.storageKey ?? null,
        execution.checksum ?? null,
        execution.mimeType ?? null,
        execution.byteSize ?? null,
      ],
    );
    if (versionUpdate.rowCount !== 1) {
      await client.query(
        `UPDATE wujie_asset_media_recovery_attempts
         SET status = 'failed', detail = 'Recovery result arrived after the version left recovering state'
         WHERE id = $1 AND status = 'deferred'`,
        [attemptId],
      );
      return false;
    }
    await client.query(
      `UPDATE wujie_assets
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'legacyImage',
         (coalesce(metadata->'legacyImage', '{}'::jsonb) - 'mediaErrorCode')
           || jsonb_build_object('mediaAvailability', $4::text)
       ), updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND current_version_id = $5`,
      [input.assetId, input.actorUserId, input.projectId, availability, input.assetVersionId],
    );
    await client.query(
      `UPDATE wujie_asset_media_recovery_attempts
       SET status = $2, detail = $3
       WHERE id = $1`,
      [attemptId, attemptStatus, detail],
    );
    return true;
    }, undefined, 'shared');

    if (!applied) return { recovered: false, availability: 'recovering', deferred: true } as const;
    return execution.success
      ? { recovered: true, availability: 'ready', deferred: false, url: execution.url ?? recovery.target.fileUrl } as const
      : execution.retryable === false
        ? { recovered: false, availability: 'unrecoverable', deferred: false } as const
        : { recovered: false, availability: 'missing', deferred: false, error: detail } as const;
  };

  if (dependencies.scheduleRecovery) {
    dependencies.scheduleRecovery(async () => { await executeAndSettle(); });
    return { recovered: false, availability: 'recovering', deferred: true };
  }
  return executeAndSettle();
}

export interface LegacyRecoveryOutcomeInput {
  localPath: string;
  success: boolean;
  method: string;
  error?: string;
}

interface LegacyRecoveryVersionRow {
  id: string;
  asset_id: string;
  owner_id: string;
  project_id: string;
  recovery_source_url: string | null;
  storage_key: string | null;
}

function normalizeManagedLocalPath(value: string): string | null {
  const normalized = posix.normalize(value.trim().replaceAll('\\', '/').replace(/^\/+/, ''));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

const LEGACY_RECOVERY_SERIALIZATION_ATTEMPTS = 3;

class LegacyRecoveryCandidatesChangedError extends Error {
  readonly code = '40001';

  constructor() {
    super('Exact-path recovery candidates changed while acquiring asset locks');
    this.name = 'LegacyRecoveryCandidatesChangedError';
  }
}

function isSerializationFailure(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '40001';
}

function sortedAssetIds(rows: Array<{ asset_id: string }>): string[] {
  return [...new Set(rows.map(row => row.asset_id))].sort();
}

function sameAssetIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((assetId, index) => assetId === right[index]);
}

export async function recordLegacyRecoveryOutcome(
  input: LegacyRecoveryOutcomeInput,
): Promise<{ matchedVersions: number; ready: number; missing: number; unrecoverable: number }> {
  const normalizedPath = normalizeManagedLocalPath(input.localPath);
  if (!normalizedPath) return { matchedVersions: 0, ready: 0, missing: 0, unrecoverable: 0 };
  const managedUrl = `/api/serve-upload/${normalizedPath}`;

  for (let attempt = 1; attempt <= LEGACY_RECOVERY_SERIALIZATION_ATTEMPTS; attempt += 1) {
    try {
      return await withAssetCoreTransaction(async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        await lockAssetGraphWriteGate(client, 'shared');
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`asset-media-recovery:${normalizedPath}`],
        );
        const discoverAssetIds = async (): Promise<string[]> => {
          const candidates = await client.query<{ asset_id: string }>(
            `SELECT DISTINCT version.asset_id
             FROM wujie_asset_versions version
             WHERE (version.file_url = $1 OR version.storage_key = $2)
               AND (version.storage_key IS NOT NULL OR version.file_url LIKE '/api/serve-upload/%')
             ORDER BY version.asset_id`,
            [managedUrl, normalizedPath],
          );
          return sortedAssetIds(candidates.rows);
        };

        const assetIds = await discoverAssetIds();
        let lockedAssetIds: string[] = [];
        if (assetIds.length > 0) {
          const lockedAssets = await client.query<{ id: string }>(
            `SELECT id FROM wujie_assets
             WHERE id = ANY($1::text[])
             ORDER BY id
             FOR UPDATE`,
            [assetIds],
          );
          lockedAssetIds = [...new Set(lockedAssets.rows.map(row => row.id))].sort();
        }
        const recheckedAssetIds = await discoverAssetIds();
        if (!sameAssetIds(assetIds, lockedAssetIds) || !sameAssetIds(lockedAssetIds, recheckedAssetIds)) {
          throw new LegacyRecoveryCandidatesChangedError();
        }

        const locked = await client.query<LegacyRecoveryVersionRow>(
          `SELECT version.id, version.asset_id, version.owner_id, version.project_id,
                  version.recovery_source_url, version.storage_key
           FROM wujie_asset_versions version
           WHERE (version.file_url = $1 OR version.storage_key = $2)
             AND (version.storage_key IS NOT NULL OR version.file_url LIKE '/api/serve-upload/%')
           ORDER BY version.asset_id, version.id
           FOR UPDATE`,
          [managedUrl, normalizedPath],
        );
        await client.query(
          `SELECT placement.id
           FROM wujie_workspace_placements placement
           WHERE placement.asset_version_id = ANY($1::text[])
           ORDER BY placement.asset_id, placement.asset_version_id, placement.id
           FOR UPDATE`,
          [locked.rows.map(row => row.id)],
        );

        let ready = 0;
        let missing = 0;
        let unrecoverable = 0;
        for (const version of locked.rows) {
          const provenUnrecoverable = !input.success
            && input.method === 'none'
            && !version.recovery_source_url
            && !version.storage_key;
          const availability = input.success ? 'ready' : provenUnrecoverable ? 'unrecoverable' : 'missing';
          const attemptStatus = input.success ? 'succeeded' : provenUnrecoverable ? 'unrecoverable' : 'failed';
          const detail = input.success
            ? `Recovered by legacy administrator route using ${input.method}`
            : input.error ?? `Legacy administrator recovery failed using ${input.method}`;
          await client.query(
            `UPDATE wujie_asset_versions
             SET availability = $4
             WHERE id = $1 AND owner_id = $2 AND project_id = $3`,
            [version.id, version.owner_id, version.project_id, availability],
          );
          await client.query(
            `INSERT INTO wujie_asset_media_recovery_attempts(
               id, asset_version_id, asset_id, owner_id, project_id, source_url, status, detail
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              randomUUID(),
              version.id,
              version.asset_id,
              version.owner_id,
              version.project_id,
              version.recovery_source_url,
              attemptStatus,
              detail,
            ],
          );
          if (availability === 'ready') ready += 1;
          else if (availability === 'unrecoverable') unrecoverable += 1;
          else missing += 1;
        }

        return { matchedVersions: locked.rows.length, ready, missing, unrecoverable };
      }, undefined, 'none');
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === LEGACY_RECOVERY_SERIALIZATION_ATTEMPTS) throw error;
    }
  }

  throw new Error('Legacy recovery serialization retry loop exhausted');
}
