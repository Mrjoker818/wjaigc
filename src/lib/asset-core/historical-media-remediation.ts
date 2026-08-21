import { createHash, randomUUID } from 'node:crypto';

import { trashCanvasPlacementSnapshotInTransaction } from './canvas-placement-snapshot';
import {
  type AssetCoreSqlTransaction,
  withAssetCoreTransaction,
} from './storage';
import type {
  MediaAvailability,
  WorkspaceEntityType,
  WorkspaceKind,
  WorkspacePlacement,
} from './types';

const MAX_CANONICAL_JSON_BYTES = 64 * 1024;
const MAX_CANDIDATES = 20;
const MAX_DISCOVERY_CANDIDATES = 100;
const MAX_DATABASE_FACT_CHARACTERS = 256;
const MAX_ESCAPED_DATABASE_FACT = '\u0001'.repeat(MAX_DATABASE_FACT_CHARACTERS);
const MAX_CANONICAL_PLACEMENT_BYTES = Buffer.byteLength(JSON.stringify({
  id: MAX_ESCAPED_DATABASE_FACT,
  workspace: MAX_ESCAPED_DATABASE_FACT,
  workspaceId: MAX_ESCAPED_DATABASE_FACT,
  entityType: MAX_ESCAPED_DATABASE_FACT,
  entityId: MAX_ESCAPED_DATABASE_FACT,
}), 'utf8');
const MAX_CANONICAL_CANDIDATE_BASE_BYTES = Buffer.byteLength(JSON.stringify({
  ownerId: MAX_ESCAPED_DATABASE_FACT,
  projectId: MAX_ESCAPED_DATABASE_FACT,
  assetId: MAX_ESCAPED_DATABASE_FACT,
  assetVersionId: MAX_ESCAPED_DATABASE_FACT,
  isCurrentVersion: true,
  availability: MAX_ESCAPED_DATABASE_FACT,
  urlClass: MAX_ESCAPED_DATABASE_FACT,
  placements: [],
}), 'utf8');
const MAX_CANDIDATE_PLACEMENTS = Math.floor(
  (MAX_CANONICAL_JSON_BYTES - MAX_CANONICAL_CANDIDATE_BASE_BYTES + 1)
  / (MAX_CANONICAL_PLACEMENT_BYTES + 1),
);
const INVALID_REQUEST = 'HISTORICAL_MEDIA_REQUEST_INVALID';
const HISTORICAL_MEDIA_ELIGIBILITY_WHERE = `
  asset.status = 'active'
  AND nullif(btrim(coalesce(version.storage_key, '')), '') IS NULL
  AND nullif(btrim(coalesce(version.recovery_source_url, '')), '') IS NULL
  AND (
    btrim(coalesce(version.file_url, '')) = ''
    OR version.file_url LIKE '/v1/images/proxy/%'
  )
  AND version.availability IN ('ready', 'missing', 'unrecoverable')
`;

export type HistoricalMediaRemediationErrorCode =
  | 'HISTORICAL_MEDIA_REQUEST_INVALID'
  | 'HISTORICAL_MEDIA_NOT_FOUND'
  | 'HISTORICAL_MEDIA_CANDIDATE_STALE'
  | 'HISTORICAL_MEDIA_IDEMPOTENCY_CONFLICT';

export class HistoricalMediaRemediationError extends Error {
  constructor(readonly code: HistoricalMediaRemediationErrorCode) {
    super(code);
    this.name = 'HistoricalMediaRemediationError';
  }
}

export interface HistoricalMediaPlacementFact {
  id: string;
  workspace: WorkspaceKind;
  workspaceId: string;
  entityType: WorkspaceEntityType;
  entityId: string;
}

export interface HistoricalMediaCandidate {
  ownerId: string;
  projectId: string;
  assetId: string;
  assetVersionId: string;
  isCurrentVersion: boolean;
  availability: MediaAvailability;
  urlClass: 'empty' | 'ephemeral-proxy';
  placements: HistoricalMediaPlacementFact[];
  candidateDigest: string;
}

export interface HistoricalMediaDiscoveryCounts {
  versions: number;
  activePlacements: number;
  currentVersions: number;
  nonCurrentVersions: number;
}

export interface HistoricalMediaCoverage {
  eligibleBlockingPlacements: number;
  candidatePlacements: number;
  uncoveredBlockingPlacements: number;
  complete: boolean;
}

export interface HistoricalMediaDiscovery extends Record<string, unknown> {
  candidates: HistoricalMediaCandidate[];
  counts: HistoricalMediaDiscoveryCounts;
  coverage: HistoricalMediaCoverage;
}

export interface HistoricalMediaArchiveSelection {
  projectId: string;
  assetId: string;
  assetVersionId: string;
  candidateDigest: string;
}

export interface HistoricalMediaArchiveRequest {
  action: 'archive-unrecoverable';
  idempotencyKey: string;
  reason: string;
  candidates: HistoricalMediaArchiveSelection[];
}

export interface HistoricalMediaArchiveResult {
  remediationId: string;
  reused: boolean;
  archivedVersionCount: number;
  archivedPlacementCount: number;
  projectRevisions: Record<string, number>;
}

type StringRecord = Record<string, unknown>;

interface DiscoveryRow {
  owner_id: string;
  project_id: string;
  asset_id: string;
  asset_version_id: string;
  is_current_version: boolean;
  availability: MediaAvailability;
  url_class: 'empty' | 'ephemeral-proxy';
  placement_id: string;
  workspace_kind: WorkspaceKind;
  workspace_id: string;
  entity_type: WorkspaceEntityType;
  entity_id: string;
}

interface DiscoveryCoverageRow {
  eligible_blocking_placements: number;
}

interface LockedCandidateRow {
  owner_id: string;
  project_id: string;
  asset_id: string;
  asset_version_id: string;
  asset_status: 'active' | 'trashed';
  current_version_id: string | null;
  file_url: string;
  storage_key: string | null;
  recovery_source_url: string | null;
  availability: MediaAvailability;
}

interface LockedPlacementRow {
  id: string;
  owner_id: string;
  project_id: string;
  asset_id: string;
  asset_version_id: string;
  workspace_kind: WorkspaceKind;
  workspace_id: string;
  entity_type: WorkspaceEntityType;
  entity_id: string;
  transform: unknown;
  metadata: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LockedHistoricalMediaCandidate extends Omit<HistoricalMediaCandidate, 'placements'> {
  placements: WorkspacePlacement[];
}

interface ResolvedArchiveSelection extends HistoricalMediaArchiveSelection {
  ownerId: string;
}

interface ResolvedArchiveOwnerRow {
  owner_id: string;
}

interface RemediationLedgerRow {
  id: string;
  request_digest: string;
  result: unknown;
}

interface HistoricalMediaBeforeCandidate {
  ownerId: string;
  projectId: string;
  assetId: string;
  assetVersionId: string;
  availability: MediaAvailability;
  urlClass: 'empty' | 'ephemeral-proxy';
  candidateDigest: string;
  placementCount: number;
}

interface HistoricalMediaBeforeState {
  candidateCount: number;
  placementCount: number;
  candidates: HistoricalMediaBeforeCandidate[];
}

interface ArchiveExecutionContext {
  actorUserId: string;
  actorUserName: string;
  ipAddress: string | null;
  request: HistoricalMediaArchiveRequest;
  requestDigest: string;
}

function normalizeString(value: string): string {
  return value.trim();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareByFields<T extends object>(fields: readonly (keyof T)[]) {
  return (left: T, right: T): number => {
    for (const field of fields) {
      const comparison = compareStrings(
        String(left[field]),
        String(right[field]),
      );
      if (comparison !== 0) return comparison;
    }
    return 0;
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as StringRecord)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  const json = JSON.stringify(canonicalize(value));
  if (Buffer.byteLength(json, 'utf8') > MAX_CANONICAL_JSON_BYTES) {
    throw new Error(INVALID_REQUEST);
  }
  return json;
}

function digestCanonicalValue(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isRecord(value: unknown): value is StringRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readBoundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== 'string') throw new Error(INVALID_REQUEST);
  const normalized = normalizeString(value);
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(INVALID_REQUEST);
  }
  return normalized;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error(INVALID_REQUEST);
  return value;
}

function remediationError(
  code: HistoricalMediaRemediationErrorCode,
): HistoricalMediaRemediationError {
  return new HistoricalMediaRemediationError(code);
}

function readServiceString(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  try {
    return readBoundedString(value, minimum, maximum);
  } catch {
    throw remediationError('HISTORICAL_MEDIA_REQUEST_INVALID');
  }
}

function parseServiceRequest(value: unknown): HistoricalMediaArchiveRequest {
  try {
    return parseHistoricalMediaArchiveRequest(value);
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_REQUEST) {
      throw remediationError('HISTORICAL_MEDIA_REQUEST_INVALID');
    }
    throw error;
  }
}

function parseDiscoveryLimit(input?: { limit?: number }): number {
  const limit = input?.limit ?? MAX_CANDIDATES;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DISCOVERY_CANDIDATES) {
    throw remediationError('HISTORICAL_MEDIA_REQUEST_INVALID');
  }
  return limit;
}

function normalizeArchiveInput(input: {
  actorUserId: string;
  actorUserName: string;
  ipAddress: string | null;
  request: HistoricalMediaArchiveRequest;
}): ArchiveExecutionContext {
  const actorUserId = readServiceString(input.actorUserId, 1, 256);
  const actorUserName = readServiceString(input.actorUserName, 1, 128);
  const ipAddress = input.ipAddress === null
    ? null
    : readServiceString(input.ipAddress, 1, 64);
  const request = parseServiceRequest(input.request);
  return {
    actorUserId,
    actorUserName,
    ipAddress,
    request,
    requestDigest: buildHistoricalMediaArchiveRequestDigest(request),
  };
}

function normalizePlacement(placement: HistoricalMediaPlacementFact): HistoricalMediaPlacementFact {
  if (!placement || typeof placement !== 'object') throw new Error(INVALID_REQUEST);
  return {
    id: readBoundedString(placement.id, 1, 256),
    workspace: readBoundedString(placement.workspace, 1, 256) as WorkspaceKind,
    workspaceId: readBoundedString(placement.workspaceId, 1, 256),
    entityType: readBoundedString(placement.entityType, 1, 256) as WorkspaceEntityType,
    entityId: readBoundedString(placement.entityId, 1, 256),
  };
}

function normalizeCandidateSelection(
  selection: HistoricalMediaArchiveSelection,
): HistoricalMediaArchiveSelection {
  return {
    projectId: readBoundedString(selection.projectId, 1, 256),
    assetId: readBoundedString(selection.assetId, 1, 256),
    assetVersionId: readBoundedString(selection.assetVersionId, 1, 256),
    candidateDigest: readBoundedString(selection.candidateDigest, 1, 256),
  };
}

function candidateCanonicalValue(candidate: HistoricalMediaCandidate): StringRecord {
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.placements)) {
    throw new Error(INVALID_REQUEST);
  }
  if (candidate.placements.length > MAX_CANDIDATE_PLACEMENTS) {
    throw new Error(INVALID_REQUEST);
  }

  const ownerId = readBoundedString(candidate.ownerId, 1, 256);
  const projectId = readBoundedString(candidate.projectId, 1, 256);
  const assetId = readBoundedString(candidate.assetId, 1, 256);
  const assetVersionId = readBoundedString(candidate.assetVersionId, 1, 256);
  const isCurrentVersion = readBoolean(candidate.isCurrentVersion);
  const availability = readBoundedString(candidate.availability, 1, 256);
  const urlClass = readBoundedString(candidate.urlClass, 1, 256);

  const placements = candidate.placements
    .map(normalizePlacement)
    .sort(compareByFields<HistoricalMediaPlacementFact>([
      'id',
      'workspace',
      'workspaceId',
      'entityType',
      'entityId',
    ] as const));

  return {
    ownerId,
    projectId,
    assetId,
    assetVersionId,
    isCurrentVersion,
    availability,
    urlClass,
    placements,
  };
}

function requestCanonicalValue(input: HistoricalMediaArchiveRequest): StringRecord {
  if (!input || typeof input !== 'object' || !Array.isArray(input.candidates)) {
    throw new Error(INVALID_REQUEST);
  }
  if (input.candidates.length < 1 || input.candidates.length > MAX_CANDIDATES) {
    throw new Error(INVALID_REQUEST);
  }

  const candidates = input.candidates
    .map(normalizeCandidateSelection)
    .sort(compareByFields<HistoricalMediaArchiveSelection>([
      'projectId',
      'assetId',
      'assetVersionId',
      'candidateDigest',
    ] as const));

  return {
    action: readBoundedString(input.action, 1, 256),
    idempotencyKey: readBoundedString(input.idempotencyKey, 8, 128),
    reason: readBoundedString(input.reason, 8, 512),
    candidates,
  };
}

export function classifyHistoricalMediaUrl(
  url: string,
): 'empty' | 'ephemeral-proxy' | 'durable-or-external' {
  const normalized = normalizeString(url);
  if (!normalized) return 'empty';

  if (normalized.startsWith('/v1/images/proxy/')) return 'ephemeral-proxy';

  return 'durable-or-external';
}

export function buildHistoricalMediaCandidateDigest(
  candidate: HistoricalMediaCandidate,
): string {
  return digestCanonicalValue(candidateCanonicalValue(candidate));
}

export function parseHistoricalMediaArchiveRequest(
  value: unknown,
): HistoricalMediaArchiveRequest {
  if (!isRecord(value)) throw new Error(INVALID_REQUEST);

  const action = readBoundedString(value.action, 1, 256);
  const idempotencyKey = readBoundedString(value.idempotencyKey, 8, 128);
  const reason = readBoundedString(value.reason, 8, 512);
  if (action !== 'archive-unrecoverable') throw new Error(INVALID_REQUEST);
  if (!Array.isArray(value.candidates)) throw new Error(INVALID_REQUEST);
  if (value.candidates.length < 1 || value.candidates.length > MAX_CANDIDATES) {
    throw new Error(INVALID_REQUEST);
  }

  const candidates = value.candidates.map((candidate): HistoricalMediaArchiveSelection => {
    if (!isRecord(candidate)) throw new Error(INVALID_REQUEST);
    return {
      projectId: readBoundedString(candidate.projectId, 1, 256),
      assetId: readBoundedString(candidate.assetId, 1, 256),
      assetVersionId: readBoundedString(candidate.assetVersionId, 1, 256),
      candidateDigest: readBoundedString(candidate.candidateDigest, 1, 256),
    };
  });

  const identities = new Set(
    candidates.map(({ projectId, assetId, assetVersionId }) =>
      JSON.stringify([projectId, assetId, assetVersionId]),
    ),
  );
  if (identities.size !== candidates.length) throw new Error(INVALID_REQUEST);

  const request = { action, idempotencyKey, reason, candidates } as HistoricalMediaArchiveRequest;
  canonicalJson(requestCanonicalValue(request));
  return request;
}

export function buildHistoricalMediaArchiveRequestDigest(
  input: HistoricalMediaArchiveRequest,
): string {
  return digestCanonicalValue(requestCanonicalValue(input));
}

function mapDiscoveryCandidates(rows: DiscoveryRow[]): HistoricalMediaCandidate[] {
  const candidates = new Map<string, HistoricalMediaCandidate>();
  for (const row of rows) {
    const identity = JSON.stringify([
      row.owner_id,
      row.project_id,
      row.asset_id,
      row.asset_version_id,
    ]);
    let candidate = candidates.get(identity);
    if (!candidate) {
      candidate = {
        ownerId: row.owner_id,
        projectId: row.project_id,
        assetId: row.asset_id,
        assetVersionId: row.asset_version_id,
        isCurrentVersion: row.is_current_version,
        availability: row.availability,
        urlClass: row.url_class,
        placements: [],
        candidateDigest: '',
      };
      candidates.set(identity, candidate);
    }
    candidate.placements.push({
      id: row.placement_id,
      workspace: row.workspace_kind,
      workspaceId: row.workspace_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
    });
  }

  const mapped: HistoricalMediaCandidate[] = [];
  for (const candidate of candidates.values()) {
    try {
      mapped.push({
        ...candidate,
        candidateDigest: buildHistoricalMediaCandidateDigest(candidate),
      });
    } catch (error) {
      if (error instanceof Error && error.message === INVALID_REQUEST) continue;
      throw error;
    }
  }
  return mapped;
}

export async function discoverHistoricalMediaArchiveCandidates(
  input?: { limit?: number },
): Promise<HistoricalMediaDiscovery> {
  const limit = parseDiscoveryLimit(input);
  return withAssetCoreTransaction(async (client) => {
    const coverageResult = await client.query<DiscoveryCoverageRow>(
      `SELECT count(*)::int AS eligible_blocking_placements
       FROM wujie_assets asset
       JOIN wujie_workspace_placements placement
         ON placement.asset_id = asset.id
        AND placement.owner_id = asset.owner_id
        AND placement.project_id = asset.project_id
        AND placement.status = 'active'
       JOIN wujie_asset_versions version
         ON version.id = placement.asset_version_id
        AND version.asset_id = asset.id
        AND version.owner_id = asset.owner_id
        AND version.project_id = asset.project_id
       WHERE ${HISTORICAL_MEDIA_ELIGIBILITY_WHERE}`,
    );
    const result = await client.query<DiscoveryRow>(
      `WITH candidate_versions AS (
         SELECT
           asset.owner_id,
           asset.project_id,
           asset.id AS asset_id,
           version.id AS asset_version_id,
           coalesce(asset.current_version_id = version.id, false) AS is_current_version,
           version.availability,
           CASE
             WHEN btrim(version.file_url) = '' THEN 'empty'
             ELSE 'ephemeral-proxy'
           END AS url_class
          FROM wujie_assets asset
          JOIN wujie_workspace_placements placement
            ON placement.asset_id = asset.id
           AND placement.owner_id = asset.owner_id
           AND placement.project_id = asset.project_id
           AND placement.status = 'active'
          JOIN wujie_asset_versions version
            ON version.id = placement.asset_version_id
           AND version.asset_id = asset.id
           AND version.owner_id = asset.owner_id
           AND version.project_id = asset.project_id
          WHERE ${HISTORICAL_MEDIA_ELIGIBILITY_WHERE}
          GROUP BY
           asset.owner_id,
           asset.project_id,
            asset.id,
            version.id,
            coalesce(asset.current_version_id = version.id, false),
            version.availability,
           CASE
             WHEN btrim(version.file_url) = '' THEN 'empty'
             ELSE 'ephemeral-proxy'
           END
         HAVING count(*) BETWEEN 1 AND $2
         ORDER BY asset.owner_id, asset.project_id, asset.id, version.id
         LIMIT $1
       )
       SELECT
         candidate.owner_id,
         candidate.project_id,
          candidate.asset_id,
          candidate.asset_version_id,
          candidate.is_current_version,
          candidate.availability,
         candidate.url_class,
         placement.id AS placement_id,
         placement.workspace_kind,
         placement.workspace_id,
         placement.entity_type,
         placement.entity_id
       FROM candidate_versions candidate
       JOIN wujie_workspace_placements placement
         ON placement.asset_version_id = candidate.asset_version_id
        AND placement.asset_id = candidate.asset_id
        AND placement.owner_id = candidate.owner_id
        AND placement.project_id = candidate.project_id
        AND placement.status = 'active'
       ORDER BY
         candidate.owner_id,
         candidate.project_id,
         candidate.asset_id,
         candidate.asset_version_id,
         placement.id`,
      [limit, MAX_CANDIDATE_PLACEMENTS],
    );
    const candidates = mapDiscoveryCandidates(result.rows);
    const candidatePlacements = candidates.reduce(
      (count, candidate) => count + candidate.placements.length,
      0,
    );
    const eligibleBlockingPlacements = coverageResult.rows[0]?.eligible_blocking_placements ?? 0;
    const uncoveredBlockingPlacements = Math.max(
      0,
      eligibleBlockingPlacements - candidatePlacements,
    );
    return {
      candidates,
      counts: {
        versions: candidates.length,
        activePlacements: candidatePlacements,
        currentVersions: candidates.filter(candidate => candidate.isCurrentVersion).length,
        nonCurrentVersions: candidates.filter(candidate => !candidate.isCurrentVersion).length,
      },
      coverage: {
        eligibleBlockingPlacements,
        candidatePlacements,
        uncoveredBlockingPlacements,
        complete: uncoveredBlockingPlacements === 0,
      },
    };
  });
}

function timestampToIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function mapLockedPlacement(row: LockedPlacementRow): WorkspacePlacement {
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
    status: 'active',
    deletedAt: null,
    transform: isRecord(row.transform) ? row.transform : {},
    metadata: isRecord(row.metadata) ? row.metadata : {},
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  } as WorkspacePlacement;
}

function isAllowedBrokenCandidate(row: LockedCandidateRow): boolean {
  return row.storage_key === null
    && row.recovery_source_url === null
    && classifyHistoricalMediaUrl(row.file_url) !== 'durable-or-external'
    && (
      row.availability === 'ready'
      || row.availability === 'missing'
      || row.availability === 'unrecoverable'
    );
}

async function loadRemediationByIdempotency(
  client: AssetCoreSqlTransaction,
  actorUserId: string,
  idempotencyKey: string,
): Promise<RemediationLedgerRow | null> {
  const result = await client.query<RemediationLedgerRow>(
    `SELECT id, request_digest, result
     FROM wujie_asset_media_remediations
     WHERE actor_user_id = $1 AND idempotency_key = $2`,
    [actorUserId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

function readPersistedArchiveResult(
  row: RemediationLedgerRow,
): HistoricalMediaArchiveResult {
  if (!isRecord(row.result)) {
    throw new Error('Historical media remediation ledger result is invalid');
  }
  const remediationId = row.result.remediationId;
  const archivedVersionCount = row.result.archivedVersionCount;
  const archivedPlacementCount = row.result.archivedPlacementCount;
  const storedProjectRevisions = row.result.projectRevisions;
  if (
    typeof remediationId !== 'string'
    || remediationId !== row.id
    || !Number.isInteger(archivedVersionCount)
    || Number(archivedVersionCount) < 0
    || !Number.isInteger(archivedPlacementCount)
    || Number(archivedPlacementCount) < 0
    || !isRecord(storedProjectRevisions)
  ) {
    throw new Error('Historical media remediation ledger result is invalid');
  }
  const projectRevisions: Record<string, number> = {};
  for (const [projectId, revision] of Object.entries(storedProjectRevisions)) {
    if (!Number.isInteger(revision) || Number(revision) < 0) {
      throw new Error('Historical media remediation ledger result is invalid');
    }
    projectRevisions[projectId] = Number(revision);
  }
  return {
    remediationId,
    reused: true,
    archivedVersionCount: Number(archivedVersionCount),
    archivedPlacementCount: Number(archivedPlacementCount),
    projectRevisions,
  };
}

function resolveExistingOrConflict(
  existing: RemediationLedgerRow,
  requestDigest: string,
): HistoricalMediaArchiveResult {
  if (existing.request_digest !== requestDigest) {
    throw remediationError('HISTORICAL_MEDIA_IDEMPOTENCY_CONFLICT');
  }
  return readPersistedArchiveResult(existing);
}

async function resolveArchiveSelections(
  client: AssetCoreSqlTransaction,
  selections: HistoricalMediaArchiveSelection[],
): Promise<ResolvedArchiveSelection[]> {
  const resolved: ResolvedArchiveSelection[] = [];
  for (const selection of selections) {
    const result = await client.query<ResolvedArchiveOwnerRow>(
      `SELECT asset.owner_id
       FROM wujie_assets asset
       JOIN wujie_asset_versions version
         ON version.id = $3
        AND version.asset_id = asset.id
        AND version.owner_id = asset.owner_id
        AND version.project_id = asset.project_id
       WHERE asset.project_id = $1 AND asset.id = $2`,
      [selection.projectId, selection.assetId, selection.assetVersionId],
    );
    const ownerId = result.rows[0]?.owner_id;
    if (!ownerId) throw remediationError('HISTORICAL_MEDIA_NOT_FOUND');
    resolved.push({ ...selection, ownerId });
  }
  return resolved.sort(compareByFields<ResolvedArchiveSelection>([
    'ownerId',
    'projectId',
    'assetId',
    'assetVersionId',
    'candidateDigest',
  ] as const));
}

async function lockArchiveOwnerSnapshots(
  client: AssetCoreSqlTransaction,
  selections: ResolvedArchiveSelection[],
): Promise<void> {
  const ownerIds = [...new Set(selections.map(selection => selection.ownerId))].sort(compareStrings);
  for (const ownerId of ownerIds) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [ownerId, '__asset_graph_projects_revision'],
    );
  }
}

async function lockCandidateFacts(
  client: AssetCoreSqlTransaction,
  selection: ResolvedArchiveSelection,
): Promise<LockedHistoricalMediaCandidate> {
  const candidateResult = await client.query<LockedCandidateRow>(
    `SELECT
       asset.owner_id,
       asset.project_id,
       asset.id AS asset_id,
       asset.status AS asset_status,
       asset.current_version_id,
       version.id AS asset_version_id,
       version.file_url,
       version.storage_key,
       version.recovery_source_url,
       version.availability
     FROM wujie_assets asset
     JOIN wujie_asset_versions version
       ON version.id = $3
      AND version.asset_id = asset.id
      AND version.owner_id = asset.owner_id
      AND version.project_id = asset.project_id
     WHERE asset.project_id = $1 AND asset.id = $2
     FOR UPDATE OF asset, version`,
    [selection.projectId, selection.assetId, selection.assetVersionId],
  );
  const row = candidateResult.rows[0];
  if (!row) throw remediationError('HISTORICAL_MEDIA_NOT_FOUND');
  if (
    row.owner_id !== selection.ownerId
    || row.asset_status !== 'active'
    || row.current_version_id !== row.asset_version_id
    || !isAllowedBrokenCandidate(row)
  ) {
    throw remediationError('HISTORICAL_MEDIA_CANDIDATE_STALE');
  }

  const placementsResult = await client.query<LockedPlacementRow>(
    `SELECT
       id,
       owner_id,
       project_id,
       asset_id,
       asset_version_id,
       workspace_kind,
       workspace_id,
       entity_type,
       entity_id,
       transform,
       metadata,
       created_at,
       updated_at
     FROM wujie_workspace_placements
     WHERE owner_id = $1
       AND project_id = $2
       AND asset_id = $3
       AND asset_version_id = $4
       AND status = 'active'
     ORDER BY id
     FOR UPDATE`,
    [row.owner_id, row.project_id, row.asset_id, row.asset_version_id],
  );
  if (placementsResult.rows.length < 1) {
    throw remediationError('HISTORICAL_MEDIA_CANDIDATE_STALE');
  }
  if (placementsResult.rows.length > MAX_CANDIDATE_PLACEMENTS) {
    throw remediationError('HISTORICAL_MEDIA_CANDIDATE_STALE');
  }

  const urlClass = classifyHistoricalMediaUrl(row.file_url);
  if (urlClass === 'durable-or-external') {
    throw remediationError('HISTORICAL_MEDIA_CANDIDATE_STALE');
  }
  return {
    ownerId: row.owner_id,
    projectId: row.project_id,
    assetId: row.asset_id,
    assetVersionId: row.asset_version_id,
    isCurrentVersion: true,
    availability: row.availability,
    urlClass,
    placements: placementsResult.rows.map(mapLockedPlacement),
    candidateDigest: '',
  };
}

function assertCandidateDigest(
  locked: LockedHistoricalMediaCandidate,
  expectedDigest: string,
): string {
  let candidateDigest: string;
  try {
    candidateDigest = buildHistoricalMediaCandidateDigest(locked);
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_REQUEST) {
      throw remediationError('HISTORICAL_MEDIA_CANDIDATE_STALE');
    }
    throw error;
  }
  if (candidateDigest !== expectedDigest) {
    throw remediationError('HISTORICAL_MEDIA_CANDIDATE_STALE');
  }
  locked.candidateDigest = candidateDigest;
  return candidateDigest;
}

async function markVersionUnrecoverable(
  client: AssetCoreSqlTransaction,
  locked: LockedHistoricalMediaCandidate,
): Promise<void> {
  const result = await client.query(
    `UPDATE wujie_asset_versions
     SET availability = 'unrecoverable'
     WHERE id = $1
       AND asset_id = $2
       AND owner_id = $3
       AND project_id = $4
       AND storage_key IS NULL
       AND recovery_source_url IS NULL
       AND (btrim(file_url) = '' OR file_url LIKE '/v1/images/proxy/%')
       AND availability IN ('ready', 'missing', 'unrecoverable')`,
    [locked.assetVersionId, locked.assetId, locked.ownerId, locked.projectId],
  );
  if ((result.rowCount ?? 0) !== 1) {
    throw remediationError('HISTORICAL_MEDIA_CANDIDATE_STALE');
  }
}

async function softTrashPlacement(
  client: AssetCoreSqlTransaction,
  placement: WorkspacePlacement,
): Promise<void> {
  const result = await client.query<{ deleted_at: Date | string }>(
    `UPDATE wujie_workspace_placements
     SET status = 'trashed', deleted_at = now(), updated_at = now()
     WHERE id = $1
       AND owner_id = $2
       AND project_id = $3
       AND asset_id = $4
       AND asset_version_id = $5
       AND status = 'active'
     RETURNING deleted_at`,
    [
      placement.id,
      placement.ownerId,
      placement.projectId,
      placement.assetId,
      placement.assetVersionId,
    ],
  );
  const deletedAt = result.rows[0]?.deleted_at;
  if (!deletedAt) throw remediationError('HISTORICAL_MEDIA_CANDIDATE_STALE');
  placement.status = 'trashed';
  placement.deletedAt = timestampToIso(deletedAt);
}

async function trashAssetWhenUnreferenced(
  client: AssetCoreSqlTransaction,
  locked: LockedHistoricalMediaCandidate,
): Promise<void> {
  await client.query(
    `UPDATE wujie_assets asset
     SET status = 'trashed', updated_at = now()
     WHERE asset.id = $1
       AND asset.owner_id = $2
       AND asset.project_id = $3
       AND asset.status = 'active'
       AND NOT EXISTS (
         SELECT 1
         FROM wujie_workspace_placements placement
         WHERE placement.asset_id = asset.id
           AND placement.owner_id = asset.owner_id
           AND placement.project_id = asset.project_id
           AND placement.status = 'active'
       )`,
    [locked.assetId, locked.ownerId, locked.projectId],
  );
}

function createBeforeCandidate(
  locked: LockedHistoricalMediaCandidate,
): HistoricalMediaBeforeCandidate {
  return {
    ownerId: locked.ownerId,
    projectId: locked.projectId,
    assetId: locked.assetId,
    assetVersionId: locked.assetVersionId,
    availability: locked.availability,
    urlClass: locked.urlClass,
    candidateDigest: locked.candidateDigest,
    placementCount: locked.placements.length,
  };
}

async function insertRemediationLedger(
  client: AssetCoreSqlTransaction,
  input: {
    actorUserId: string;
    request: HistoricalMediaArchiveRequest;
    requestDigest: string;
    beforeState: HistoricalMediaBeforeState;
    result: HistoricalMediaArchiveResult;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO wujie_asset_media_remediations(
       id,
       actor_user_id,
       idempotency_key,
       request_digest,
       action,
       reason,
       before_state,
       result,
       status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'completed')`,
    [
      input.result.remediationId,
      input.actorUserId,
      input.request.idempotencyKey,
      input.requestDigest,
      input.request.action,
      input.request.reason,
      JSON.stringify(input.beforeState),
      JSON.stringify(input.result),
    ],
  );
}

async function insertRedactedAdministratorAudit(
  client: AssetCoreSqlTransaction,
  input: {
    actorUserId: string;
    actorUserName: string;
    ipAddress: string | null;
    result: HistoricalMediaArchiveResult;
  },
): Promise<void> {
  const detail = {
    remediationId: input.result.remediationId,
    candidateCount: input.result.archivedVersionCount,
    placementCount: input.result.archivedPlacementCount,
  };
  await client.query(
    `INSERT INTO wujie_audit_log(
       id,
       user_id,
       user_name,
       action,
       target_type,
       target_id,
       detail,
       ip_address,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      `audit_${randomUUID()}`,
      input.actorUserId,
      input.actorUserName,
      'historical_media_archive',
      'asset_media_remediation',
      input.result.remediationId,
      JSON.stringify(detail),
      input.ipAddress,
      Date.now(),
    ],
  );
}

export async function archiveHistoricalMedia(input: {
  actorUserId: string;
  actorUserName: string;
  ipAddress: string | null;
  request: HistoricalMediaArchiveRequest;
}): Promise<HistoricalMediaArchiveResult> {
  const normalized = normalizeArchiveInput(input);

  return withAssetCoreTransaction(async (client) => {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [
        `historical-media-remediation:${normalized.actorUserId}:${normalized.request.idempotencyKey}`,
      ],
    );
    const existing = await loadRemediationByIdempotency(
      client,
      normalized.actorUserId,
      normalized.request.idempotencyKey,
    );
    if (existing) {
      return resolveExistingOrConflict(existing, normalized.requestDigest);
    }

    const sortedSelections = await resolveArchiveSelections(
      client,
      normalized.request.candidates,
    );
    await lockArchiveOwnerSnapshots(client, sortedSelections);

    const beforeCandidates: HistoricalMediaBeforeCandidate[] = [];
    const projectRevisions: Record<string, number> = {};
    let archivedPlacementCount = 0;
    for (const selection of sortedSelections) {
      const locked = await lockCandidateFacts(client, selection);
      assertCandidateDigest(locked, selection.candidateDigest);
      beforeCandidates.push(createBeforeCandidate(locked));
      await markVersionUnrecoverable(client, locked);
      for (const placement of locked.placements) {
        await softTrashPlacement(client, placement);
        archivedPlacementCount += 1;
        if (
          placement.workspace === 'canvas'
          && placement.entityType === 'canvas-image'
        ) {
          projectRevisions[locked.projectId] = await trashCanvasPlacementSnapshotInTransaction(
            client,
            locked.ownerId,
            locked.projectId,
            placement,
          );
        }
      }
      await trashAssetWhenUnreferenced(client, locked);
    }

    const result: HistoricalMediaArchiveResult = {
      remediationId: `remediation_${randomUUID()}`,
      reused: false,
      archivedVersionCount: beforeCandidates.length,
      archivedPlacementCount,
      projectRevisions,
    };
    const beforeState: HistoricalMediaBeforeState = {
      candidateCount: beforeCandidates.length,
      placementCount: archivedPlacementCount,
      candidates: beforeCandidates,
    };
    await insertRemediationLedger(client, {
      actorUserId: normalized.actorUserId,
      request: normalized.request,
      requestDigest: normalized.requestDigest,
      beforeState,
      result,
    });
    await insertRedactedAdministratorAudit(client, {
      actorUserId: normalized.actorUserId,
      actorUserName: normalized.actorUserName,
      ipAddress: normalized.ipAddress,
      result,
    });
    return result;
  });
}
