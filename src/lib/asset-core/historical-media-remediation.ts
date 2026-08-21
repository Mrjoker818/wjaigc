import { createHash } from 'node:crypto';

import type {
  MediaAvailability,
  WorkspaceEntityType,
  WorkspaceKind,
} from './types';

const MAX_CANONICAL_JSON_BYTES = 64 * 1024;
const MAX_CANDIDATES = 20;
const MAX_CANDIDATE_PLACEMENTS = Math.floor(MAX_CANONICAL_JSON_BYTES / 64);
const INVALID_REQUEST = 'HISTORICAL_MEDIA_REQUEST_INVALID';

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
  availability: MediaAvailability;
  urlClass: 'empty' | 'ephemeral-proxy';
  placements: HistoricalMediaPlacementFact[];
  candidateDigest: string;
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
