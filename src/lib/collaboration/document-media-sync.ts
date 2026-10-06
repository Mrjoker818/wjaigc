import type { CanvasImage, ImageGroupData } from '@/lib/user-types';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';
import { validateCanvasDocumentProjection, type CanvasDocumentProjection } from './canvas-document';
import { projectCanvasDocumentMetadata, projectDocumentPlacementsOntoImages } from './canvas-document-image-bridge';

export class CanvasDocumentMediaSyncError extends Error {
  readonly code: `DOCUMENT_MEDIA_SYNC_${'INVALID' | 'CANCELLED' | 'TIMEOUT' | 'UNAVAILABLE'}`;
  constructor(code: 'INVALID' | 'CANCELLED' | 'TIMEOUT' | 'UNAVAILABLE') {
    super('协作媒体同步未完成');
    this.name = 'CanvasDocumentMediaSyncError';
    this.code = `DOCUMENT_MEDIA_SYNC_${code}`;
  }
}

export interface DocumentMediaView {
  images: CanvasImage[];
  groups: ImageGroupData[];
  annotations: CanvasAnnotationV2[];
  complete: boolean;
}

interface MediaDirectory {
  sequence: number;
  projection: CanvasDocumentProjection;
  canvasImages: CanvasImage[];
  readOnly: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function parseDocumentMediaDirectory(value: unknown, projectId: string): MediaDirectory {
  try {
    const raw = record(value);
    if (!raw || raw.success !== true || raw.projectId !== projectId ||
        !Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 0 ||
        typeof raw.readOnly !== 'boolean' || !Array.isArray(raw.canvasImages) || raw.canvasImages.length > 2000) {
      throw new Error();
    }
    const projection = validateCanvasDocumentProjection(raw.projection);
    const ids = new Set<string>();
    const placements = new Set<string>();
    const images: CanvasImage[] = [];
    for (const value of raw.canvasImages) {
      const image = record(value);
      if (!image || typeof image.id !== 'string' || !image.id ||
          typeof image.placementId !== 'string' || typeof image.assetVersionId !== 'string' ||
          typeof image.url !== 'string' ||
          (image.mediaType === 'video'
            ? typeof image.videoUrl !== 'string' || !image.videoUrl.trim()
            : !image.url.trim()) || image.isProcessingPlaceholder || image.processing ||
          ids.has(image.id) || placements.has(image.placementId) ||
          (image.mediaType !== undefined && image.mediaType !== 'image' && image.mediaType !== 'video') ||
          ['x', 'y', 'width', 'height', 'originalWidth', 'originalHeight', 'rotation', 'zIndex', 'createdAt']
            .some(key => typeof image[key] !== 'number' || !Number.isFinite(image[key])) ||
          ['width', 'height', 'originalWidth', 'originalHeight'].some(key => (image[key] as number) <= 0)) {
        throw new Error();
      }
      const placement = projection.placements[image.placementId];
      if (!placement || placement.deleted || placement.assetVersionId !== image.assetVersionId) throw new Error();
      ids.add(image.id); placements.add(image.placementId);
      images.push(structuredClone(image) as unknown as CanvasImage);
    }
    if (Object.entries(projection.placements).some(([id, placement]) => !placement.deleted && !placements.has(id))) {
      throw new Error();
    }
    projectCanvasDocumentMetadata(projection, images);
    return { sequence: raw.sequence as number, projection, canvasImages: images, readOnly: raw.readOnly };
  } catch {
    throw new CanvasDocumentMediaSyncError('UNAVAILABLE');
  }
}

/** The deadline includes body decoding, and does not rely on fetch honoring abort. */
export async function readDocumentMediaResponse(projectId: string, signal: AbortSignal,
  transportSettled: () => void = () => {}): Promise<{
  status: number; ok: boolean; payload: unknown;
}> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = (): void => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = (): void => { controller.abort(); reject(new CanvasDocumentMediaSyncError('CANCELLED')); };
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      controller.abort(); reject(new CanvasDocumentMediaSyncError('TIMEOUT'));
    }, 10_000);
  });
  const read = async (): Promise<{ status: number; ok: boolean; payload: unknown }> => {
    if (signal.aborted) throw new CanvasDocumentMediaSyncError('CANCELLED');
    const response = await fetch(`/api/collaboration/document-project?projectId=${encodeURIComponent(projectId)}`, {
      credentials: 'include', cache: 'no-store', signal: controller.signal,
    });
    if (controller.signal.aborted) throw new CanvasDocumentMediaSyncError('CANCELLED');
    // Authorization does not depend on whether an error page is JSON.
    const payload: unknown = response.status === 401 || response.status === 403 ? null : await response.json();
    return { status: response.status, ok: response.ok, payload };
  };
  try { return await Promise.race([read().finally(transportSettled), interrupted]); }
  finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

interface Batch {
  target: number;
  requireDirectorySequence: boolean;
  attempts: number;
  promise: Promise<CanvasImage[]>;
  resolve: (images: CanvasImage[]) => void;
  reject: (error: CanvasDocumentMediaSyncError) => void;
  requesting: boolean;
  accepted: boolean;
  retry: ReturnType<typeof setTimeout> | null;
  deadline: ReturnType<typeof setTimeout>;
  controller: AbortController;
}

/** Media only: HTTP never writes to, replaces, or owns the active Y.Doc. */
export class CanvasDocumentMediaSync {
  private current: CanvasImage[] = [];
  private latest: CanvasImage[] = [];
  private projection: CanvasDocumentProjection = { placements: {} };
  private sequence = -1;
  private directorySequence = -1;
  private batch: Batch | null = null;
  private stopped = false;
  private autoFailed = false;
  private readonly transport = { pending: false };
  lastError: CanvasDocumentMediaSyncError | null = null;

  constructor(private readonly projectId: string, private readonly changed: () => void,
    private readonly accessLost: () => void = () => {}) {}

  acceptDirectory(value: unknown): MediaDirectory {
    const payload = parseDocumentMediaDirectory(value, this.projectId);
    if (payload.sequence < this.directorySequence) return payload;
    this.directorySequence = payload.sequence;
    this.latest = payload.canvasImages;
    return payload;
  }

  setDocument(projection: CanvasDocumentProjection, sequence: number): void {
    this.projection = projection;
    this.sequence = sequence;
    this.select();
    this.check();
  }

  private select(): CanvasImage[] {
    const candidates = new Map([...this.current, ...this.latest].map(image => [
      `${image.placementId}/${image.assetVersionId}`, image,
    ]));
    this.current = Object.entries(this.projection.placements).flatMap(([id, placement]) => {
      const image = candidates.get(`${id}/${placement.assetVersionId}`);
      return !placement.deleted && image ? [image] : [];
    });
    return this.current;
  }

  get view(): DocumentMediaView {
    const selected = this.select();
    const counts = new Map<string, number>();
    for (const image of selected) counts.set(image.id, (counts.get(image.id) ?? 0) + 1);
    const unambiguous = selected.filter(image => counts.get(image.id) === 1);
    const projected = projectDocumentPlacementsOntoImages(unambiguous, this.projection.placements);
    try {
      return { ...projectCanvasDocumentMetadata(this.projection, unambiguous),
        images: projected.images, complete: projected.unresolvedPlacementIds.length === 0 };
    } catch {
      return { images: projected.images, groups: [], annotations: [], complete: false };
    }
  }

  refresh(input: { projectId: string; documentSequence: number; requireDirectorySequence?: boolean }): Promise<CanvasImage[]> {
    if (input.projectId !== this.projectId || !Number.isSafeInteger(input.documentSequence) || input.documentSequence < 0) {
      return Promise.reject(new CanvasDocumentMediaSyncError('INVALID'));
    }
    if (this.stopped) return Promise.reject(new CanvasDocumentMediaSyncError('CANCELLED'));
    if (this.batch) {
      const batch = this.batch;
      batch.target = Math.max(batch.target, input.documentSequence);
      if (input.requireDirectorySequence) {
        batch.requireDirectorySequence = true;
        if (batch.accepted) batch.target = Math.max(batch.target, this.directorySequence);
      }
      this.check();
      return batch.promise;
    }
    if (this.transport.pending) return Promise.reject(new CanvasDocumentMediaSyncError('UNAVAILABLE'));
    this.lastError = null;
    this.autoFailed = false;
    let resolve!: Batch['resolve'];
    let reject!: Batch['reject'];
    const promise = new Promise<CanvasImage[]>((yes, no) => { resolve = yes; reject = no; });
    this.batch = { target: input.documentSequence, requireDirectorySequence: input.requireDirectorySequence === true,
      attempts: 0, promise, resolve, reject,
      requesting: false, accepted: false, retry: null, controller: new AbortController(),
      deadline: setTimeout(() => {
        this.finish(new CanvasDocumentMediaSyncError('TIMEOUT'));
        this.changed();
      }, 30_000) };
    this.check();
    return promise;
  }

  autoRefresh(force = false): void {
    if (this.stopped || this.sequence < 0 || (!force && (this.autoFailed || this.view.complete))) return;
    if (this.batch) {
      this.batch.target = Math.max(this.batch.target, this.sequence);
      this.check();
      return;
    }
    // Exactly one internal rejection handler per batch, even during a remote burst.
    void this.refresh({ projectId: this.projectId, documentSequence: this.sequence }).catch(() => {});
  }

  stop(): void {
    this.stopped = true;
    this.finish(new CanvasDocumentMediaSyncError('CANCELLED'));
  }

  private finish(error?: CanvasDocumentMediaSyncError): void {
    const batch = this.batch;
    if (!batch) return;
    this.batch = null;
    if (batch.retry) clearTimeout(batch.retry);
    clearTimeout(batch.deadline);
    batch.controller.abort();
    if (error) {
      this.lastError = error;
      this.autoFailed = true;
      batch.reject(error);
    } else batch.resolve(structuredClone(this.view.images));
  }

  private check(): void {
    const batch = this.batch;
    if (!batch || batch.requesting || batch.retry) return;
    if (batch.accepted && this.directorySequence >= batch.target) {
      if (this.sequence < batch.target) return;
      if (this.view.complete) { this.finish(); return; }
    }
    if (batch.attempts >= 3) { this.finish(new CanvasDocumentMediaSyncError('UNAVAILABLE')); return; }
    if (batch.attempts === 0) void this.read(batch);
    else batch.retry = setTimeout(() => {
      batch.retry = null;
      void this.read(batch);
    }, batch.attempts * 500);
  }

  private async read(batch: Batch): Promise<void> {
    batch.requesting = true;
    batch.accepted = false;
    batch.attempts += 1;
    try {
      const transport = this.transport;
      transport.pending = true;
      const response = await readDocumentMediaResponse(this.projectId, batch.controller.signal,
        () => { transport.pending = false; });
      const payload = record(response.payload);
      if (this.batch !== batch || this.stopped) return;
      if (response.status === 401 || response.status === 403 || payload?.code === 'DOCUMENT_DISABLED' ||
          payload?.code === 'DOCUMENT_PROJECT_NOT_ENABLED' || payload?.readOnly === true) {
        this.stopped = true;
        this.finish(new CanvasDocumentMediaSyncError('UNAVAILABLE'));
        this.accessLost();
        return;
      }
      if (response.ok) {
        this.acceptDirectory(payload);
        if (batch.requireDirectorySequence) batch.target = Math.max(batch.target, this.directorySequence);
        batch.accepted = true;
      }
    } catch (error) {
      if (this.batch === batch && error instanceof CanvasDocumentMediaSyncError && error.code === 'DOCUMENT_MEDIA_SYNC_TIMEOUT') {
        // A timed-out noncooperative transport may still be pending. Do not start
        // an overlapping retry; this batch ends at its individual GET deadline.
        this.finish(error);
        this.changed();
      }
    }
    finally {
      batch.requesting = false;
      if (this.batch === batch && !this.stopped) {
        this.changed();
        this.check();
      }
    }
  }
}
