import type { CanvasPersistenceSnapshot } from '@/lib/canvas-kernel/persistence';
import type { Project } from '@/lib/user-types';

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

interface CanvasUnloadRecoveryStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
}

interface CanvasUnloadCleanupStorage {
  removeItem: (key: string) => void;
}

interface RecoveredCanvasPersistenceManager {
  updateProjectInMemory: (projectId: string, updates: Partial<Project>) => unknown;
  flushProjectsToServerWithConflictRecovery: () => Promise<unknown>;
}

interface StoredCanvasUnloadSnapshot {
  version: 3 | 4;
  ownerId: string;
  baseProjectRevision: number;
  maxRecoverableProjectRevision?: number;
  snapshot: CanvasPersistenceSnapshot;
}

function isStoredCanvasUnloadSnapshot(value: unknown): value is StoredCanvasUnloadSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredCanvasUnloadSnapshot>;
  const snapshot = candidate.snapshot as Partial<CanvasPersistenceSnapshot> | undefined;
  const revisionWindowIsValid = candidate.version === 3
    || (
      candidate.version === 4
      && Number.isSafeInteger(candidate.maxRecoverableProjectRevision)
      && (candidate.maxRecoverableProjectRevision ?? -1) >= (candidate.baseProjectRevision ?? 0)
    );
  return revisionWindowIsValid
    && typeof candidate.ownerId === 'string'
    && Number.isSafeInteger(candidate.baseProjectRevision)
    && typeof snapshot?.projectId === 'string'
    && snapshot.ownerId === candidate.ownerId
    && snapshot.baseProjectRevision === candidate.baseProjectRevision
    && Number.isSafeInteger(snapshot.revision)
    && Array.isArray(snapshot.images)
    && Boolean(snapshot.metadata && typeof snapshot.metadata === 'object');
}

export function consumePreparedCanvasUnloadSnapshot(
  projectId: string,
  projectRevision: number,
  storage: CanvasUnloadRecoveryStorage,
  ownerId: string,
): CanvasPersistenceSnapshot | null {
  const serialized = storage.getItem(CANVAS_PREPARED_SNAPSHOT_KEY);
  if (!serialized) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(serialized);
  } catch {
    storage.removeItem(CANVAS_PREPARED_SNAPSHOT_KEY);
    return null;
  }
  if (!isStoredCanvasUnloadSnapshot(stored)) {
    storage.removeItem(CANVAS_PREPARED_SNAPSHOT_KEY);
    return null;
  }
  if (stored.ownerId !== ownerId) {
    storage.removeItem(CANVAS_PREPARED_SNAPSHOT_KEY);
    return null;
  }
  if (stored.snapshot.projectId !== projectId) return null;
  const maxRecoverableRevision = stored.version === 4
    ? stored.maxRecoverableProjectRevision ?? stored.baseProjectRevision
    : stored.baseProjectRevision;
  if (
    projectRevision < stored.baseProjectRevision
    || projectRevision > maxRecoverableRevision
  ) {
    storage.removeItem(CANVAS_PREPARED_SNAPSHOT_KEY);
    return null;
  }
  storage.removeItem(CANVAS_PREPARED_SNAPSHOT_KEY);
  return stored.snapshot;
}

export function consumeCanvasPendingMediaRecovery(
  projectId: string,
  storage: CanvasUnloadRecoveryStorage,
  ownerId: string,
): boolean {
  const serialized = storage.getItem(CANVAS_PENDING_MEDIA_RECOVERY_KEY);
  if (!serialized) return false;
  let marker: unknown;
  try {
    marker = JSON.parse(serialized);
  } catch {
    storage.removeItem(CANVAS_PENDING_MEDIA_RECOVERY_KEY);
    return false;
  }
  if (!marker || typeof marker !== 'object') {
    storage.removeItem(CANVAS_PENDING_MEDIA_RECOVERY_KEY);
    return false;
  }
  const candidate = marker as Record<string, unknown>;
  if (candidate.version !== 2 || candidate.ownerId !== ownerId) {
    storage.removeItem(CANVAS_PENDING_MEDIA_RECOVERY_KEY);
    return false;
  }
  if (candidate.projectId !== projectId || candidate.hasPendingMedia !== true) return false;
  storage.removeItem(CANVAS_PENDING_MEDIA_RECOVERY_KEY);
  return true;
}

export function reconcileRecoveredCanvasImages<T extends { id: string; url: string }>(
  recoveredImages: ReadonlyArray<T>,
  savedImages: ReadonlyArray<T>,
): { images: T[]; discardedBlobIds: string[] } {
  const savedById = new Map(savedImages.map(image => [image.id, image]));
  const images: T[] = [];
  const discardedBlobIds: string[] = [];
  for (const image of recoveredImages) {
    if (!image.url.startsWith('blob:')) {
      images.push(image);
      continue;
    }
    const saved = savedById.get(image.id);
    if (saved && !saved.url.startsWith('blob:')) {
      images.push({ ...saved, ...image, url: saved.url });
    } else {
      discardedBlobIds.push(image.id);
    }
  }
  return { images, discardedBlobIds };
}

export async function persistRecoveredCanvasSnapshot(
  manager: RecoveredCanvasPersistenceManager,
  projectId: string,
  images: CanvasPersistenceSnapshot['images'],
  metadata: CanvasPersistenceSnapshot['metadata'],
): Promise<void> {
  manager.updateProjectInMemory(projectId, {
    canvasImages: [...images],
    metadata,
  });
  await manager.flushProjectsToServerWithConflictRecovery();
}

export function clearCanvasUnloadRecovery(storage: CanvasUnloadCleanupStorage): void {
  storage.removeItem(CANVAS_PREPARED_SNAPSHOT_KEY);
  storage.removeItem(CANVAS_PENDING_MEDIA_RECOVERY_KEY);
}

export function persistPreparedCanvasUnloadSnapshot(
  prepared: PreparedCanvasUnloadSnapshot,
  target: CanvasUnloadPersistenceTarget,
): void {
  if (prepared.hasPendingMedia) {
    target.storage.setItem(CANVAS_PREPARED_SNAPSHOT_KEY, prepared.serialized);
    target.storage.setItem(CANVAS_PENDING_MEDIA_RECOVERY_KEY, prepared.recoveryMarker);
    return;
  }

  let storageError: unknown;
  try {
    target.storage.setItem(CANVAS_PREPARED_SNAPSHOT_KEY, prepared.serialized);
    target.storage.removeItem(CANVAS_PENDING_MEDIA_RECOVERY_KEY);
  } catch (error) {
    storageError = error;
  }

  let beaconAccepted = false;
  if (
    prepared.beaconPayload
    && (prepared.beaconByteLength ?? prepared.beaconPayload.length) <= 65536
  ) {
    try {
      beaconAccepted = target.sendBeacon('/api/user-data/sync', prepared.beaconPayload);
    } catch {
      beaconAccepted = false;
    }
  }
  if (storageError && !beaconAccepted) throw storageError;
}

export interface CanvasHydrationGuard {
  projectId: string;
  signature: string;
}

const MAX_CANVAS_HYDRATION_GUARDS = 32;

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

export function enqueueCanvasHydrationGuard(
  guards: readonly CanvasHydrationGuard[],
  projectId: string,
  images: CanvasHydrationImage[],
): CanvasHydrationGuard[] {
  const nextGuard = createCanvasHydrationGuard(projectId, images);
  const lastGuard = guards.at(-1);
  if (
    lastGuard?.projectId === nextGuard.projectId
    && lastGuard.signature === nextGuard.signature
  ) {
    return [...guards];
  }
  return [...guards, nextGuard].slice(-MAX_CANVAS_HYDRATION_GUARDS);
}

export function consumeCanvasHydrationGuardQueue(
  guards: readonly CanvasHydrationGuard[],
  projectId: string,
  images: CanvasHydrationImage[],
): { suppress: boolean; nextGuards: CanvasHydrationGuard[] } {
  const signature = hydrationSignature(images);
  let matchingIndex = -1;
  for (let index = guards.length - 1; index >= 0; index -= 1) {
    const guard = guards[index];
    if (guard.projectId === projectId && guard.signature === signature) {
      matchingIndex = index;
      break;
    }
  }

  if (matchingIndex >= 0) {
    return {
      suppress: true,
      nextGuards: guards.filter((guard, index) => (
        guard.projectId !== projectId || index > matchingIndex
      )),
    };
  }

  return {
    suppress: false,
    nextGuards: guards.filter(guard => guard.projectId !== projectId),
  };
}
