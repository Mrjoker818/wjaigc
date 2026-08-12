import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';

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
}): Promise<
  | { recovered: false; availability: 'recovering'; deferred: true }
  | { recovered: false; availability: 'unrecoverable'; deferred: false }
> {
  return withAssetCoreTransaction(async (client) => {
    const asset = await client.query<{ id: string }>(
      `SELECT id
       FROM wujie_assets
       WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND status = 'trashed'
       FOR UPDATE`,
      [input.assetId, input.actorUserId, input.projectId],
    );
    if (!asset.rows[0]) throw new MediaHealthError('ASSET_NOT_FOUND');
    const result = await client.query<{
      id: string;
      asset_id: string;
      recovery_source_url: string | null;
      storage_key: string | null;
    }>(
      `SELECT version.id, version.asset_id, version.recovery_source_url, version.storage_key
       FROM wujie_asset_versions version
       WHERE version.id = $1 AND version.owner_id = $2 AND version.project_id = $3 AND version.asset_id = $4
         AND version.availability IN ('missing', 'unrecoverable')
       FOR UPDATE`,
      [input.assetVersionId, input.actorUserId, input.projectId, input.assetId],
    );
    const version = result.rows[0];
    if (!version) throw new MediaHealthError('ASSET_NOT_FOUND');
    const placement = await client.query<{ id: string }>(
      `SELECT id
       FROM wujie_workspace_placements
       WHERE id = $1 AND owner_id = $2 AND project_id = $3
         AND asset_id = $4 AND asset_version_id = $5 AND status = 'trashed'
       FOR UPDATE`,
      [input.placementId, input.actorUserId, input.projectId, input.assetId, input.assetVersionId],
    );
    if (!placement.rows[0]) throw new MediaHealthError('ASSET_NOT_FOUND');
    const recoverable = Boolean(version.recovery_source_url || version.storage_key);
    const availability = recoverable ? 'recovering' : 'unrecoverable';
    const attemptStatus = recoverable ? 'deferred' : 'unrecoverable';
    const detail = recoverable
      ? 'Recovery is deferred to a managed persistence worker'
      : 'No recovery source or managed storage key is available';
    await client.query(
      `UPDATE wujie_asset_versions
       SET availability = $4
       WHERE id = $1 AND owner_id = $2 AND project_id = $3
         AND availability IN ('missing', 'unrecoverable')`,
      [input.assetVersionId, input.actorUserId, input.projectId, availability],
    );
    await client.query(
      `INSERT INTO wujie_asset_media_recovery_attempts(
        id, asset_version_id, asset_id, owner_id, project_id, source_url, status, detail
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), version.id, version.asset_id, input.actorUserId, input.projectId, version.recovery_source_url, attemptStatus, detail],
    );
    return recoverable
      ? { recovered: false, availability: 'recovering', deferred: true }
      : { recovered: false, availability: 'unrecoverable', deferred: false };
  });
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

export async function recordLegacyRecoveryOutcome(
  input: LegacyRecoveryOutcomeInput,
): Promise<{ matchedVersions: number; ready: number; missing: number; unrecoverable: number }> {
  const normalizedPath = normalizeManagedLocalPath(input.localPath);
  if (!normalizedPath) return { matchedVersions: 0, ready: 0, missing: 0, unrecoverable: 0 };
  const managedUrl = `/api/serve-upload/${normalizedPath}`;

  return withAssetCoreTransaction(async (client) => {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`asset-media-recovery:${normalizedPath}`],
    );
    const candidates = await client.query<{ asset_id: string }>(
      `SELECT DISTINCT version.asset_id
       FROM wujie_asset_versions version
       WHERE (version.file_url = $1 OR version.storage_key = $2)
         AND (version.storage_key IS NOT NULL OR version.file_url LIKE '/api/serve-upload/%')
       ORDER BY version.asset_id`,
      [managedUrl, normalizedPath],
    );

    const assetIds = [...new Set(candidates.rows.map(row => row.asset_id))].sort();
    if (assetIds.length > 0) {
      await client.query(
        `SELECT id FROM wujie_assets
         WHERE id = ANY($1::text[])
         ORDER BY id
         FOR UPDATE`,
        [assetIds],
      );
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
  });
}
