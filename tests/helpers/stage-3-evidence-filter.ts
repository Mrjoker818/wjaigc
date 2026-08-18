import { createHash } from 'node:crypto';

export interface Stage3EvidenceEntry {
  method?: string;
  occurredAt?: number;
  requestDigest?: string;
  status?: number;
  text?: string;
  type?: string;
  url?: string;
}

function canonicalizeSyncValue(value: unknown, key?: string): unknown {
  if (key === 'projectRevision' || key === 'updatedAt') return undefined;
  if (Array.isArray(value)) return value.map(item => canonicalizeSyncValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([entryKey, entryValue]) => {
        const canonical = canonicalizeSyncValue(entryValue, entryKey);
        return canonical === undefined ? [] : [[entryKey, canonical]];
      }),
  );
}

export function stage3RequestFingerprint(postData: string | null): string | undefined {
  if (!postData) return undefined;
  try {
    const parsed = JSON.parse(postData) as unknown;
    return createHash('sha256')
      .update(JSON.stringify(canonicalizeSyncValue(parsed)))
      .digest('hex');
  } catch {
    return undefined;
  }
}

function isAborted(entry: Stage3EvidenceEntry): boolean {
  return !entry.status
    && /ERR_ABORTED|NS_ERROR_ABORT|NS_BINDING_ABORTED|Load request cancelled/i.test(entry.text ?? '');
}

export function isBenignStage3RequestAbort(entry: Stage3EvidenceEntry): boolean {
  const aborted = isAborted(entry);
  if (!aborted || !entry.method || !entry.url) return false;

  let pathname: string;
  try {
    pathname = new URL(entry.url).pathname;
  } catch {
    return false;
  }

  return (
    entry.method === 'GET'
    && (
      pathname === '/api/task-events'
      || pathname === '/api/models'
      || pathname.startsWith('/api/serve-upload/')
      || pathname.startsWith('/_next/static/chunks/')
    )
  ) || (
    entry.method === 'POST'
    && (pathname === '/api/activity' || pathname === '/api/user-data/record')
  );
}

export function isRecoveredStage3RequestAbort(
  entry: Stage3EvidenceEntry,
  evidence: Stage3EvidenceEntry[],
): boolean {
  if (!isAborted(entry) || entry.method !== 'POST' || !entry.url || !entry.requestDigest) return false;
  let pathname: string;
  try {
    pathname = new URL(entry.url).pathname;
  } catch {
    return false;
  }
  if (pathname !== '/api/user-data/sync') return false;
  return evidence.some(candidate => (
    candidate.method === 'POST'
    && candidate.status !== undefined
    && candidate.status >= 200
    && candidate.status < 300
    && candidate.requestDigest === entry.requestDigest
  ));
}

export function isRecoveredStage3SyncConflict(
  entry: Stage3EvidenceEntry,
  evidence: Stage3EvidenceEntry[],
): boolean {
  if (entry.method !== 'POST' || entry.status !== 409 || !entry.url) return false;
  let pathname: string;
  try {
    pathname = new URL(entry.url).pathname;
  } catch {
    return false;
  }
  if (pathname !== '/api/user-data/sync') return false;
  return evidence.some(candidate => (
    candidate.method === 'POST'
    && candidate.status !== undefined
    && candidate.status >= 200
    && candidate.status < 300
    && candidate.url !== undefined
    && new URL(candidate.url).pathname === pathname
    && (candidate.occurredAt ?? 0) >= (entry.occurredAt ?? Number.POSITIVE_INFINITY)
  ));
}
