export interface RemoveBgSubmissionMarker {
  version: 1;
  actorId: string;
  projectId: string;
  imageId: string;
  sourceVersionId: string;
  idempotencyKey: string;
  createdAt: number;
}

const PREFIX = 'wujie:removebg:attempt:';

function validMarker(value: unknown): value is RemoveBgSubmissionMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  return marker.version === 1
    && typeof marker.actorId === 'string' && marker.actorId.length > 0
    && typeof marker.projectId === 'string' && marker.projectId.length > 0
    && typeof marker.imageId === 'string' && marker.imageId.length > 0
    && typeof marker.sourceVersionId === 'string' && marker.sourceVersionId.length > 0
    && typeof marker.idempotencyKey === 'string' && marker.idempotencyKey.length > 0
    && marker.idempotencyKey.length <= 256 && marker.idempotencyKey.trim() === marker.idempotencyKey
    && Number.isSafeInteger(marker.createdAt) && (marker.createdAt as number) > 0;
}

function storageKey(marker: RemoveBgSubmissionMarker): string {
  return PREFIX + encodeURIComponent(JSON.stringify([marker.actorId, marker.projectId,
    marker.imageId, marker.sourceVersionId, marker.idempotencyKey]));
}

function readMarker(storage: Storage, key: string): RemoveBgSubmissionMarker {
  const raw = storage.getItem(key);
  if (!raw) throw new Error('Pending remove-background marker is unreadable');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Pending remove-background marker is corrupt'); }
  if (!validMarker(parsed) || storageKey(parsed) !== key) {
    throw new Error('Pending remove-background marker is invalid');
  }
  return parsed;
}

export function findRemoveBgSubmissionMarker(
  storage: Storage,
  source: Pick<RemoveBgSubmissionMarker, 'projectId' | 'imageId' | 'sourceVersionId'>,
  actorId: string,
): RemoveBgSubmissionMarker | null {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const marker = readMarker(storage, key);
    if (marker.actorId === actorId && marker.projectId === source.projectId
      && marker.imageId === source.imageId) {
      return marker;
    }
  }
  return null;
}

export async function claimRemoveBgSubmissionMarker(
  locks: LockManager | undefined,
  storage: Storage,
  marker: RemoveBgSubmissionMarker,
): Promise<{ claimed: true } | { claimed: false; existing: RemoveBgSubmissionMarker }> {
  if (!validMarker(marker) || !locks?.request) throw new Error('Remove-background submission lock unavailable');
  const lockName = `wujie:removebg:${JSON.stringify([marker.actorId, marker.projectId,
    marker.imageId])}`;
  return locks.request(lockName, async () => {
    const existing = findRemoveBgSubmissionMarker(storage, marker, marker.actorId);
    if (existing) return { claimed: false as const, existing };
    const key = storageKey(marker);
    const raw = JSON.stringify(marker);
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error('Pending remove-background marker was not saved');
    return { claimed: true as const };
  });
}

export function clearRemoveBgSubmissionMarker(storage: Storage, marker: RemoveBgSubmissionMarker): void {
  if (!validMarker(marker)) throw new Error('Invalid remove-background marker');
  const key = storageKey(marker);
  const existing = storage.getItem(key);
  if (!existing) return;
  const saved = readMarker(storage, key);
  if (saved.idempotencyKey === marker.idempotencyKey) storage.removeItem(key);
}
