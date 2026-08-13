type CanvasHydrationImage = {
  id: string;
  url: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  zIndex?: number;
};

export const CANVAS_PREPARED_SNAPSHOT_KEY = 'wujie:canvas:prepared-snapshot:v1';
export const CANVAS_PENDING_MEDIA_RECOVERY_KEY = 'wujie:canvas:pending-media:v1';

export interface PreparedCanvasUnloadSnapshot {
  projectId: string;
  revision: number;
  signature: string;
  serialized: string;
  recoveryMarker: string;
  hasPendingMedia: boolean;
  beaconPayload?: string;
  beaconByteLength?: number;
}

interface CanvasUnloadPersistenceTarget {
  storage: Pick<Storage, 'setItem' | 'removeItem'>;
  sendBeacon: (url: string, data: string) => boolean;
}

export function persistPreparedCanvasUnloadSnapshot(
  prepared: PreparedCanvasUnloadSnapshot,
  target: CanvasUnloadPersistenceTarget,
): void {
  if (prepared.hasPendingMedia) {
    target.storage.setItem(CANVAS_PENDING_MEDIA_RECOVERY_KEY, prepared.recoveryMarker);
    return;
  }

  target.storage.setItem(CANVAS_PREPARED_SNAPSHOT_KEY, prepared.serialized);
  target.storage.removeItem(CANVAS_PENDING_MEDIA_RECOVERY_KEY);
  if (
    prepared.beaconPayload
    && (prepared.beaconByteLength ?? prepared.beaconPayload.length) <= 65536
  ) {
    target.sendBeacon('/api/user-data/sync', prepared.beaconPayload);
  }
}

export interface CanvasHydrationGuard {
  projectId: string;
  signature: string;
}

function hydrationSignature(images: CanvasHydrationImage[]): string {
  return JSON.stringify(images.map(image => ({
    id: image.id,
    url: image.url,
    x: image.x ?? 0,
    y: image.y ?? 0,
    width: image.width ?? 0,
    height: image.height ?? 0,
    rotation: image.rotation ?? 0,
    zIndex: image.zIndex ?? 0,
  })));
}

export function createCanvasHydrationGuard(
  projectId: string,
  images: CanvasHydrationImage[],
): CanvasHydrationGuard {
  return { projectId, signature: hydrationSignature(images) };
}

export function shouldConsumeCanvasHydrationGuard(
  guard: CanvasHydrationGuard | null,
  projectId: string,
  images: CanvasHydrationImage[],
): boolean {
  return guard?.projectId === projectId && guard.signature === hydrationSignature(images);
}

export function consumeCanvasHydrationGuard(
  guard: CanvasHydrationGuard | null,
  projectId: string,
  images: CanvasHydrationImage[],
): { suppress: boolean; nextGuard: CanvasHydrationGuard | null } {
  if (!guard) return { suppress: false, nextGuard: null };
  if (guard.projectId !== projectId) return { suppress: false, nextGuard: guard };
  return {
    suppress: guard.signature === hydrationSignature(images),
    nextGuard: null,
  };
}
