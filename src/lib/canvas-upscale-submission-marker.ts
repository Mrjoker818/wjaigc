/** Non-secret browser breadcrumb for a quoted 302 upscale POST whose response may be lost. */
export interface UpscaleSubmissionMarker {
  version: 1;
  actorId: string;
  projectId: string;
  imageId: string;
  sourceVersionId: string | null;
  idempotencyKey: string;
  createdAt: number;
}

const PREFIX = 'wujie:upscale302:attempt:';

export function isRecoverableUpscaleIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value;
}

function markerStorageKey(marker: Pick<UpscaleSubmissionMarker,
  'actorId' | 'projectId' | 'imageId' | 'sourceVersionId' | 'idempotencyKey'>): string {
  return PREFIX + encodeURIComponent(JSON.stringify([marker.actorId, marker.projectId,
    marker.imageId, marker.sourceVersionId, marker.idempotencyKey]));
}

function validMarker(value: unknown): value is UpscaleSubmissionMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.version === 1 && typeof item.actorId === 'string' && item.actorId.length > 0
    && typeof item.projectId === 'string' && typeof item.imageId === 'string' && item.imageId.length > 0
    && (item.sourceVersionId === null || typeof item.sourceVersionId === 'string')
    && isRecoverableUpscaleIdempotencyKey(item.idempotencyKey)
    && Number.isSafeInteger(item.createdAt) && (item.createdAt as number) > 0;
}

export function findUpscaleSubmissionMarker(storage: Storage, source: Pick<UpscaleSubmissionMarker,
  'projectId' | 'imageId' | 'sourceVersionId'>, actorId?: string): UpscaleSubmissionMarker | null {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const raw = storage.getItem(key);
    if (!raw) throw new Error('Pending upscale marker is unreadable');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Pending upscale marker is corrupt'); }
    if (!validMarker(parsed) || (key !== PREFIX + parsed.idempotencyKey
      && key !== markerStorageKey(parsed))) {
      throw new Error('Pending upscale marker is invalid');
    }
    if (parsed.projectId === source.projectId && parsed.imageId === source.imageId
      && parsed.sourceVersionId === source.sourceVersionId
      && (!actorId || parsed.actorId === actorId)) return parsed;
  }
  return null;
}

export function writeUpscaleSubmissionMarker(storage: Storage, marker: UpscaleSubmissionMarker): void {
  if (!validMarker(marker)) throw new Error('Invalid pending upscale marker');
  const key = markerStorageKey(marker);
  storage.setItem(key, JSON.stringify(marker));
  if (storage.getItem(key) !== JSON.stringify(marker)) throw new Error('Pending upscale marker was not saved');
}

/** Claim one source before a paid POST; the durable marker outlives the browser lock. */
export async function claimUpscaleSubmissionMarker(
  locks: LockManager | undefined,
  storage: Storage,
  marker: UpscaleSubmissionMarker,
): Promise<{ claimed: true } | { claimed: false; existing: UpscaleSubmissionMarker }> {
  if (!validMarker(marker) || !locks?.request) throw new Error('Upscale submission lock unavailable');
  const source = { projectId: marker.projectId, imageId: marker.imageId,
    sourceVersionId: marker.sourceVersionId };
  const lockName = `wujie:upscale302:${JSON.stringify([marker.actorId, marker.projectId,
    marker.imageId, marker.sourceVersionId])}`;
  return locks.request(lockName, async () => {
    const existing = findUpscaleSubmissionMarker(storage, source, marker.actorId);
    if (existing) return { claimed: false as const, existing };
    writeUpscaleSubmissionMarker(storage, marker);
    return { claimed: true as const };
  });
}

export function clearUpscaleSubmissionMarker(storage: Storage, idempotencyKey: string,
  source: Pick<UpscaleSubmissionMarker, 'projectId' | 'imageId' | 'sourceVersionId'>,
  actorId: string): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const raw = storage.getItem(key);
    if (!raw) throw new Error('Pending upscale marker is unreadable');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Pending upscale marker is corrupt'); }
    if (!validMarker(parsed) || (key !== PREFIX + parsed.idempotencyKey
      && key !== markerStorageKey(parsed))) throw new Error('Pending upscale marker is invalid');
    if (parsed.idempotencyKey === idempotencyKey && parsed.actorId === actorId
      && parsed.projectId === source.projectId && parsed.imageId === source.imageId
      && parsed.sourceVersionId === source.sourceVersionId) storage.removeItem(key);
  }
}
