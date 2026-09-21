import type { CanvasImage as PersistableCanvasImage, Project } from '@/lib/user-types';

export type ProjectMetadata = NonNullable<Project['metadata']>;

export interface CanvasPersistenceSnapshot {
  ownerId: string;
  projectId: string;
  baseProjectRevision: number;
  revision: number;
  images: ReadonlyArray<PersistableCanvasImage>;
  metadata: ProjectMetadata;
}

export interface CanvasPreparedPersistenceSnapshot extends CanvasPersistenceSnapshot {
  signature: string;
  serialized: string;
  recoveryMarker: string;
  hasPendingMedia: boolean;
  beaconPayload?: string;
  beaconByteLength?: number;
}

export type CanvasPersistencePhase =
  | 'idle'
  | 'scheduled'
  | 'preparing'
  | 'writing'
  | 'retrying'
  | 'failed'
  | 'cancelled';

export interface CanvasPersistenceMetrics {
  longestMainThreadTaskMs: number;
  scheduledSnapshots: number;
  writtenSnapshots: number;
  deduplicatedSnapshots: number;
  retryCount: number;
}

type IdleHandle = ReturnType<typeof setTimeout> | number | object;

interface CanvasPersistenceSchedulerOptions {
  writer: (snapshot: CanvasPreparedPersistenceSnapshot, reason: string) => Promise<void> | void;
  prepare?: (
    snapshot: CanvasPersistenceSnapshot,
  ) => Promise<CanvasPreparedPersistenceSnapshot> | CanvasPreparedPersistenceSnapshot;
  prepareForUnload?: (
    snapshot: CanvasPersistenceSnapshot,
  ) => CanvasPreparedPersistenceSnapshot;
  scheduleIdle?: (callback: () => void, timeoutMs: number) => IdleHandle;
  cancelIdle?: (handle: IdleHandle) => void;
  onPhaseChange?: (phase: CanvasPersistencePhase) => void;
  maxWaitMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  now?: () => number;
  deferWork?: () => Promise<void>;
}

function isPendingMediaUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:');
}

// During navigation, one serialized project sync can still finish before the
// unload beacon is processed. Both requests may advance the authoritative
// revision, so recovery must tolerate that bounded two-write race.
const UNLOAD_RECOVERY_REVISION_WINDOW = 2;

export function prepareCanvasPersistenceSnapshot(
  snapshot: CanvasPersistenceSnapshot,
): CanvasPreparedPersistenceSnapshot {
  const signature = JSON.stringify({
    ownerId: snapshot.ownerId,
    projectId: snapshot.projectId,
    images: snapshot.images,
    metadata: snapshot.metadata,
  });
  const hasPendingMedia = snapshot.images.some(image => isPendingMediaUrl(image.url));
  return {
    ...snapshot,
    signature,
    serialized: JSON.stringify({
      version: 4,
      ownerId: snapshot.ownerId,
      baseProjectRevision: snapshot.baseProjectRevision,
      maxRecoverableProjectRevision:
        snapshot.baseProjectRevision + UNLOAD_RECOVERY_REVISION_WINDOW,
      snapshot,
    }),
    recoveryMarker: JSON.stringify({
      version: 2,
      ownerId: snapshot.ownerId,
      projectId: snapshot.projectId,
      baseProjectRevision: snapshot.baseProjectRevision,
      revision: snapshot.revision,
      signature,
      hasPendingMedia,
    }),
    hasPendingMedia,
  };
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function defaultScheduleIdle(callback: () => void, timeoutMs: number): IdleHandle {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout: timeoutMs });
  }
  return setTimeout(callback, 0);
}

function defaultCancelIdle(handle: IdleHandle): void {
  if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function' && typeof handle === 'number') {
    window.cancelIdleCallback(handle);
    return;
  }
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function defaultDeferWork(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export class CanvasPersistenceScheduler {
  readonly metrics: CanvasPersistenceMetrics = {
    longestMainThreadTaskMs: 0,
    scheduledSnapshots: 0,
    writtenSnapshots: 0,
    deduplicatedSnapshots: 0,
    retryCount: 0,
  };

  private readonly writer: CanvasPersistenceSchedulerOptions['writer'];
  private readonly prepareSnapshot: NonNullable<CanvasPersistenceSchedulerOptions['prepare']>;
  private readonly prepareUnloadSnapshot: NonNullable<CanvasPersistenceSchedulerOptions['prepareForUnload']>;
  private readonly scheduleIdleCallback: NonNullable<CanvasPersistenceSchedulerOptions['scheduleIdle']>;
  private readonly cancelIdleCallback: NonNullable<CanvasPersistenceSchedulerOptions['cancelIdle']>;
  private readonly onPhaseChange?: CanvasPersistenceSchedulerOptions['onPhaseChange'];
  private readonly maxWaitMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private readonly deferWork: NonNullable<CanvasPersistenceSchedulerOptions['deferWork']>;
  private readonly projectEpochs = new Map<string, number>();
  private readonly latestSourceSnapshots = new Map<string, CanvasPersistenceSnapshot>();
  private readonly preparedSnapshots = new Map<string, CanvasPreparedPersistenceSnapshot>();
  private readonly savedSignatures = new Map<string, string>();
  private readonly serverFlushedSignatures = new Map<string, string>();
  private readonly serverFlushedRevisions = new Map<string, number>();
  private pendingSnapshot: CanvasPersistenceSnapshot | null = null;
  private idleHandle: IdleHandle | null = null;
  private drainPromise: Promise<void> | null = null;
  private deferredFlushPromise: Promise<void> | null = null;
  private activeSnapshot: { projectId: string; revision: number; epoch: number } | null = null;
  private activeSourceSnapshot: CanvasPersistenceSnapshot | null = null;
  private requestedFlushReason: string | null = null;
  private currentPhase: CanvasPersistencePhase = 'idle';

  constructor(options: CanvasPersistenceSchedulerOptions) {
    this.writer = options.writer;
    this.prepareSnapshot = options.prepare ?? prepareCanvasPersistenceSnapshot;
    this.prepareUnloadSnapshot = options.prepareForUnload ?? prepareCanvasPersistenceSnapshot;
    this.scheduleIdleCallback = options.scheduleIdle ?? defaultScheduleIdle;
    this.cancelIdleCallback = options.cancelIdle ?? defaultCancelIdle;
    this.onPhaseChange = options.onPhaseChange;
    this.maxWaitMs = options.maxWaitMs ?? 1000;
    this.maxRetries = options.maxRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    this.now = options.now ?? defaultNow;
    this.deferWork = options.deferWork ?? defaultDeferWork;
  }

  get phase(): CanvasPersistencePhase {
    return this.currentPhase;
  }

  schedule(snapshot: CanvasPersistenceSnapshot): void {
    const pending = this.pendingSnapshot;
    if (pending?.projectId === snapshot.projectId && pending.revision > snapshot.revision) return;
    const latest = this.latestSourceSnapshots.get(snapshot.projectId);
    if (!latest || snapshot.revision >= latest.revision) {
      this.latestSourceSnapshots.set(snapshot.projectId, snapshot);
    }
    this.pendingSnapshot = snapshot;
    this.metrics.scheduledSnapshots += 1;
    this.setPhase('scheduled');
    if (!this.idleHandle && !this.drainPromise && !this.deferredFlushPromise) {
      this.idleHandle = this.scheduleIdleCallback(() => {
        this.idleHandle = null;
        void this.drain('idle').catch(() => undefined);
      }, this.maxWaitMs);
    }
  }

  flush(reason: string): Promise<void> {
    this.requestFlushReason(reason);
    this.clearIdleHandle();
    if (this.drainPromise) return this.drainPromise;
    if (this.deferredFlushPromise) return this.deferredFlushPromise;

    const deferredFlush = this.deferWork()
      .then(() => this.drain(reason))
      .finally(() => {
        if (this.deferredFlushPromise === deferredFlush) {
          this.deferredFlushPromise = null;
        }
      });
    this.deferredFlushPromise = deferredFlush;
    return deferredFlush;
  }

  cancel(projectId: string): void {
    this.projectEpochs.set(projectId, this.getProjectEpoch(projectId) + 1);
    if (this.pendingSnapshot?.projectId === projectId) this.pendingSnapshot = null;
    this.latestSourceSnapshots.delete(projectId);
    this.preparedSnapshots.delete(projectId);
    if (!this.pendingSnapshot) this.clearIdleHandle();
    this.setPhase('cancelled');
  }

  getPreparedSnapshot(projectId: string): CanvasPreparedPersistenceSnapshot | null {
    return this.preparedSnapshots.get(projectId) ?? null;
  }

  preparePendingSnapshotForUnload(
    projectId: string,
    acknowledgedProjectRevision: number,
  ): CanvasPreparedPersistenceSnapshot | null {
    const prepared = this.preparedSnapshots.get(projectId) ?? null;
    const candidates = [
      this.pendingSnapshot,
      this.activeSourceSnapshot,
      this.latestSourceSnapshots.get(projectId),
    ]
      .filter((candidate): candidate is CanvasPersistenceSnapshot => candidate?.projectId === projectId);
    const latest = candidates.reduce<CanvasPersistenceSnapshot | null>((current, candidate) => (
      !current || candidate.revision > current.revision ? candidate : current
    ), null);
    if (!latest) return prepared;
    const latestAcknowledgedRevision = Number.isSafeInteger(acknowledgedProjectRevision)
      ? Math.max(latest.baseProjectRevision, acknowledgedProjectRevision)
      : latest.baseProjectRevision;
    const unloadSnapshot = latestAcknowledgedRevision === latest.baseProjectRevision
      ? latest
      : { ...latest, baseProjectRevision: latestAcknowledgedRevision };
    if (
      prepared
      && prepared.revision >= unloadSnapshot.revision
      && prepared.baseProjectRevision >= unloadSnapshot.baseProjectRevision
      && prepared.beaconPayload
    ) {
      return prepared;
    }
    const emergencyPrepared = this.prepareUnloadSnapshot(unloadSnapshot);
    this.preparedSnapshots.set(projectId, emergencyPrepared);
    return emergencyPrepared;
  }

  hasPendingSnapshot(projectId: string): boolean {
    const prepared = this.preparedSnapshots.get(projectId);
    return this.pendingSnapshot?.projectId === projectId
      || this.activeSnapshot?.projectId === projectId
      || Boolean(prepared && this.serverFlushedSignatures.get(projectId) !== prepared.signature);
  }

  isSnapshotActive(projectId: string, revision: number): boolean {
    return this.activeSnapshot?.projectId === projectId
      && this.activeSnapshot.revision === revision
      && this.isProjectEpochCurrent(projectId, this.activeSnapshot.epoch);
  }

  private drain(reason: string): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.requestFlushReason(reason);
    this.drainPromise = this.runDrain(reason).finally(() => {
      this.drainPromise = null;
      if (this.pendingSnapshot && this.currentPhase !== 'failed') {
        this.setPhase('scheduled');
        if (!this.idleHandle) {
          this.idleHandle = this.scheduleIdleCallback(() => {
            this.idleHandle = null;
            void this.drain('idle').catch(() => undefined);
          }, this.maxWaitMs);
        }
      } else if (!this.pendingSnapshot && this.currentPhase !== 'failed') {
        this.requestedFlushReason = null;
        this.setPhase('idle');
      }
    });
    return this.drainPromise;
  }

  private async runDrain(defaultReason: string): Promise<void> {
    while (this.pendingSnapshot) {
      const snapshot = this.pendingSnapshot;
      this.pendingSnapshot = null;
      const epoch = this.getProjectEpoch(snapshot.projectId);
      this.activeSnapshot = { projectId: snapshot.projectId, revision: snapshot.revision, epoch };
      this.activeSourceSnapshot = snapshot;
      const prepared = await this.prepare(snapshot);
      if (!this.isProjectEpochCurrent(snapshot.projectId, epoch)) {
        this.clearActiveSnapshot(snapshot);
        continue;
      }

      this.preparedSnapshots.set(snapshot.projectId, prepared);
      const writeReason = this.requestedFlushReason ?? defaultReason;
      this.requestedFlushReason = null;
      const signatureAlreadySaved = this.savedSignatures.get(snapshot.projectId) === prepared.signature;
      const needsImmediateBarrier = writeReason === 'immediate'
        && (
          this.serverFlushedSignatures.get(snapshot.projectId) !== prepared.signature
          || (this.serverFlushedRevisions.get(snapshot.projectId) ?? -1) < snapshot.revision
        );
      if (signatureAlreadySaved && !needsImmediateBarrier) {
        this.metrics.deduplicatedSnapshots += 1;
        this.clearActiveSnapshot(snapshot);
        continue;
      }

      let attempt = 0;
      try {
        for (;;) {
          try {
            this.setPhase('writing');
            const startedAt = this.now();
            const writeResult = this.writer(prepared, writeReason);
            this.recordMainThreadTask(startedAt);
            await writeResult;
            if (this.isProjectEpochCurrent(snapshot.projectId, epoch)) {
              this.savedSignatures.set(snapshot.projectId, prepared.signature);
              if (writeReason === 'immediate') {
                this.serverFlushedSignatures.set(snapshot.projectId, prepared.signature);
                this.serverFlushedRevisions.set(snapshot.projectId, snapshot.revision);
              }
              this.metrics.writtenSnapshots += 1;
            }
            break;
          } catch (error) {
            if (!this.isProjectEpochCurrent(snapshot.projectId, epoch)) break;
            if (attempt >= this.maxRetries) {
              if (!this.pendingSnapshot) this.pendingSnapshot = snapshot;
              this.setPhase('failed');
              throw error;
            }
            attempt += 1;
            this.metrics.retryCount += 1;
            this.setPhase('retrying');
            await wait(this.retryDelayMs);
          }
        }
      } finally {
        this.clearActiveSnapshot(snapshot);
      }
    }
  }

  private requestFlushReason(reason: string): void {
    if (!this.requestedFlushReason || reason === 'immediate') {
      this.requestedFlushReason = reason;
    }
  }

  private async prepare(snapshot: CanvasPersistenceSnapshot): Promise<CanvasPreparedPersistenceSnapshot> {
    this.setPhase('preparing');
    const startedAt = this.now();
    const preparedResult = this.prepareSnapshot(snapshot);
    this.recordMainThreadTask(startedAt);
    return preparedResult;
  }

  private recordMainThreadTask(startedAt: number): void {
    const elapsed = Math.max(0, this.now() - startedAt);
    this.metrics.longestMainThreadTaskMs = Math.max(
      this.metrics.longestMainThreadTaskMs,
      elapsed,
    );
  }

  private clearActiveSnapshot(snapshot: CanvasPersistenceSnapshot): void {
    if (
      this.activeSnapshot?.projectId === snapshot.projectId
      && this.activeSnapshot.revision === snapshot.revision
    ) {
      this.activeSnapshot = null;
      this.activeSourceSnapshot = null;
    }
  }

  private getProjectEpoch(projectId: string): number {
    return this.projectEpochs.get(projectId) ?? 0;
  }

  private isProjectEpochCurrent(projectId: string, epoch: number): boolean {
    return this.getProjectEpoch(projectId) === epoch;
  }

  private clearIdleHandle(): void {
    if (!this.idleHandle) return;
    this.cancelIdleCallback(this.idleHandle);
    this.idleHandle = null;
  }

  private setPhase(phase: CanvasPersistencePhase): void {
    if (this.currentPhase === phase) return;
    this.currentPhase = phase;
    this.onPhaseChange?.(phase);
  }
}
