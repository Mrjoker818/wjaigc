import { describe, expect, it, vi } from 'vitest';

import {
  CanvasPersistenceScheduler,
  prepareCanvasPersistenceSnapshot,
  type CanvasPreparedPersistenceSnapshot,
  type CanvasPersistenceSnapshot,
  type CanvasPersistencePhase,
} from '@/lib/canvas-kernel/persistence';
import {
  consumePreparedCanvasUnloadSnapshot,
  persistPreparedCanvasUnloadSnapshot,
} from '@/lib/canvas-autosave-guard';

function snapshot(
  revision: number,
  overrides: Partial<CanvasPersistenceSnapshot> = {},
): CanvasPersistenceSnapshot {
  return {
    ownerId: 'user-a',
    projectId: 'project-a',
    baseProjectRevision: 7,
    revision,
    images: [{
      id: 'image-1',
      url: '/api/serve-upload/uploads/image-1.png',
      x: revision,
      y: 20,
      width: 200,
      height: 100,
      originalWidth: 400,
      originalHeight: 200,
      rotation: 0,
      zIndex: 1,
      createdAt: 1,
    }],
    metadata: { viewState: { scale: 1, panX: 0, panY: 0 } },
    ...overrides,
  };
}

function controlledIdle() {
  let callback: (() => void) | null = null;
  let requestedTimeout = 0;
  return {
    scheduleIdle(next: () => void, timeoutMs: number) {
      callback = next;
      requestedTimeout = timeoutMs;
      return 1;
    },
    cancelIdle() {
      callback = null;
    },
    run() {
      const next = callback;
      callback = null;
      next?.();
    },
    get requestedTimeout() {
      return requestedTimeout;
    },
  };
}

describe('CanvasPersistenceScheduler', () => {
  it('prepares a bounded version 4 unload recovery window', () => {
    const prepared = prepareCanvasPersistenceSnapshot(snapshot(9));
    expect(JSON.parse(prepared.serialized)).toEqual(expect.objectContaining({
      version: 4,
      baseProjectRevision: 7,
      maxRecoverableProjectRevision: 8,
    }));
  });

  it('defers an immediate flush until the current input task has yielded', async () => {
    const writer = vi.fn(async () => undefined);
    const scheduler = new CanvasPersistenceScheduler({ writer });

    scheduler.schedule(snapshot(1));
    const flush = scheduler.flush('immediate');

    expect(writer).not.toHaveBeenCalled();
    await flush;
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith(expect.any(Object), 'immediate');
  });

  it('writes only the latest snapshot scheduled before an idle flush', async () => {
    const idle = controlledIdle();
    const writer = vi.fn(async () => undefined);
    const scheduler = new CanvasPersistenceScheduler({
      writer,
      scheduleIdle: idle.scheduleIdle,
      cancelIdle: idle.cancelIdle,
      deferWork: async () => undefined,
    });

    scheduler.schedule(snapshot(1));
    scheduler.schedule(snapshot(2));
    await scheduler.flush('idle');

    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }), 'idle');
    expect(idle.requestedTimeout).toBe(1000);
    expect(scheduler.metrics.longestMainThreadTaskMs).toBeLessThanOrEqual(100);
  });

  it('keeps one writer in flight and drains a newer revision afterwards', async () => {
    const idle = controlledIdle();
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const writer = vi.fn()
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValue(undefined);
    const scheduler = new CanvasPersistenceScheduler({
      writer,
      scheduleIdle: idle.scheduleIdle,
      cancelIdle: idle.cancelIdle,
      deferWork: async () => undefined,
    });

    scheduler.schedule(snapshot(1));
    const firstFlush = scheduler.flush('immediate');
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(1));
    scheduler.schedule(snapshot(2));
    const secondFlush = scheduler.flush('immediate');

    expect(writer).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([firstFlush, secondFlush]);

    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer.mock.calls.map(([value]) => value.revision)).toEqual([1, 2]);
  });

  it('isolates projects and ignores a cancelled project completion', async () => {
    const idle = controlledIdle();
    let releaseOld!: () => void;
    const oldWrite = new Promise<void>((resolve) => { releaseOld = resolve; });
    const writer = vi.fn()
      .mockImplementationOnce(() => oldWrite)
      .mockResolvedValue(undefined);
    const scheduler = new CanvasPersistenceScheduler({
      writer,
      scheduleIdle: idle.scheduleIdle,
      cancelIdle: idle.cancelIdle,
    });

    scheduler.schedule(snapshot(1));
    const oldFlush = scheduler.flush('immediate');
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(1));
    scheduler.cancel('project-a');
    scheduler.schedule(snapshot(1, { projectId: 'project-b' }));
    releaseOld();
    await oldFlush;
    await scheduler.flush('project-switch');

    expect(writer.mock.calls.map(([value]) => value.projectId)).toEqual(['project-a', 'project-b']);
    expect(scheduler.getPreparedSnapshot('project-a')).toBeNull();
    expect(scheduler.getPreparedSnapshot('project-b')).toEqual(expect.objectContaining({ revision: 1 }));
  });

  it('retries a failed write without marking the failed signature as saved', async () => {
    const phases: CanvasPersistencePhase[] = [];
    const writer = vi.fn()
      .mockRejectedValueOnce(new Error('temporary storage failure'))
      .mockResolvedValue(undefined);
    const scheduler = new CanvasPersistenceScheduler({
      writer,
      maxRetries: 1,
      retryDelayMs: 0,
      onPhaseChange: phase => phases.push(phase),
    });

    scheduler.schedule(snapshot(1));
    await scheduler.flush('immediate');

    expect(writer).toHaveBeenCalledTimes(2);
    expect(phases).toContain('retrying');
    expect(scheduler.phase).toBe('idle');
  });

  it('retains an exhausted write for an explicit later retry without looping', async () => {
    const writer = vi.fn()
      .mockRejectedValueOnce(new Error('storage offline'))
      .mockResolvedValue(undefined);
    const scheduler = new CanvasPersistenceScheduler({ writer, maxRetries: 0 });

    scheduler.schedule(snapshot(1));
    await expect(scheduler.flush('immediate')).rejects.toThrow('storage offline');

    expect(writer).toHaveBeenCalledTimes(1);
    expect(scheduler.phase).toBe('failed');
    await scheduler.flush('retry');
    expect(writer).toHaveBeenCalledTimes(2);
    expect(scheduler.phase).toBe('idle');
  });

  it('does not write a later idle revision with an unchanged prepared signature', async () => {
    const writer = vi.fn(async () => undefined);
    const scheduler = new CanvasPersistenceScheduler({ writer });
    const unchanged = snapshot(1);

    scheduler.schedule(unchanged);
    await scheduler.flush('immediate');
    scheduler.schedule({ ...unchanged, revision: 2 });
    await scheduler.flush('idle');

    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('does not write unchanged canvas content when only the server base revision advances', async () => {
    const writer = vi.fn(async () => undefined);
    const scheduler = new CanvasPersistenceScheduler({ writer });
    const unchanged = snapshot(1);

    scheduler.schedule(unchanged);
    await scheduler.flush('idle');
    scheduler.schedule({
      ...unchanged,
      baseProjectRevision: unchanged.baseProjectRevision + 1,
      revision: 2,
    });
    await scheduler.flush('idle');

    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('writes a later immediate revision when content cycles back to a server-flushed signature', async () => {
    const writer = vi.fn(async (
      _snapshot: CanvasPreparedPersistenceSnapshot,
      _reason: string,
    ): Promise<void> => undefined);
    const scheduler = new CanvasPersistenceScheduler({ writer });
    const original = snapshot(1);

    scheduler.schedule(original);
    await scheduler.flush('immediate');
    scheduler.schedule(snapshot(2));
    scheduler.schedule({ ...original, revision: 3 });
    await scheduler.flush('immediate');

    expect(writer.mock.calls.map(([value, reason]) => [value.revision, reason])).toEqual([
      [1, 'immediate'],
      [3, 'immediate'],
    ]);
  });

  it('upgrades an idle-saved signature to an immediate durability barrier', async () => {
    const writer = vi.fn(async (
      _snapshot: CanvasPreparedPersistenceSnapshot,
      _reason: string,
    ): Promise<void> => undefined);
    const scheduler = new CanvasPersistenceScheduler({ writer });
    const unchanged = snapshot(1);

    scheduler.schedule(unchanged);
    await scheduler.flush('idle');
    scheduler.schedule({ ...unchanged, revision: 2 });
    await scheduler.flush('immediate');

    expect(writer.mock.calls.map(([, reason]) => reason)).toEqual(['idle', 'immediate']);
  });

  it('upgrades an in-flight idle write when an equivalent immediate snapshot is queued', async () => {
    let releaseIdle!: () => void;
    const idleWrite = new Promise<void>((resolve) => { releaseIdle = resolve; });
    const writer = vi.fn(async (
      _snapshot: CanvasPreparedPersistenceSnapshot,
      _reason: string,
    ): Promise<void> => undefined)
      .mockImplementationOnce(() => idleWrite)
      .mockResolvedValue(undefined);
    const scheduler = new CanvasPersistenceScheduler({
      writer,
      deferWork: async () => undefined,
    });
    const unchanged = snapshot(1);

    scheduler.schedule(unchanged);
    const idleFlush = scheduler.flush('idle');
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(1));
    scheduler.schedule({ ...unchanged, revision: 2 });
    const immediateFlush = scheduler.flush('immediate');
    releaseIdle();
    await Promise.all([idleFlush, immediateFlush]);

    expect(writer.mock.calls.map(([, reason]) => reason)).toEqual(['idle', 'immediate']);
  });

  it('marks data and blob media in the prepared unload snapshot', async () => {
    const scheduler = new CanvasPersistenceScheduler({ writer: async () => undefined });
    scheduler.schedule(snapshot(1, {
      images: [
        { ...snapshot(1).images[0], url: 'data:image/png;base64,AAAA' },
        { ...snapshot(1).images[0], id: 'image-2', url: 'blob:https://example.test/image-2' },
      ],
    }));

    await scheduler.flush('immediate');

    expect(scheduler.getPreparedSnapshot('project-a')).toEqual(expect.objectContaining({
      hasPendingMedia: true,
      recoveryMarker: expect.stringContaining('project-a'),
    }));
  });

  it('prepares the latest pending snapshot synchronously for emergency unload', () => {
    const idle = controlledIdle();
    const scheduler = new CanvasPersistenceScheduler({
      writer: async () => undefined,
      scheduleIdle: idle.scheduleIdle,
      cancelIdle: idle.cancelIdle,
      prepareForUnload: value => ({
        ...value,
        signature: `signature-${value.revision}`,
        serialized: JSON.stringify({ version: 2, preparedAt: 200, snapshot: value }),
        recoveryMarker: JSON.stringify({ projectId: value.projectId, revision: value.revision }),
        hasPendingMedia: false,
      }),
    });

    scheduler.schedule(snapshot(1));
    scheduler.schedule(snapshot(2));

    expect(scheduler.preparePendingSnapshotForUnload('project-a', 7)).toEqual(
      expect.objectContaining({ revision: 2, signature: 'signature-2' }),
    );
  });

  it('rebases a pending unload snapshot onto the latest acknowledged server revision', () => {
    const scheduler = new CanvasPersistenceScheduler({ writer: async () => undefined });
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    scheduler.schedule(snapshot(5, { baseProjectRevision: 7 }));

    const prepared = scheduler.preparePendingSnapshotForUnload('project-a', 10);

    expect(prepared).not.toBeNull();
    persistPreparedCanvasUnloadSnapshot(prepared!, {
      storage,
      sendBeacon: () => false,
    });
    expect(consumePreparedCanvasUnloadSnapshot('project-a', 10, storage, 'user-a')).toEqual(expect.objectContaining({
      baseProjectRevision: 10,
      revision: 5,
    }));
  });

  it('adds the unload-only beacon payload after a normal snapshot has already been written', async () => {
    const prepareForUnload = vi.fn(value => ({
      ...prepareCanvasPersistenceSnapshot(value),
      beaconPayload: `beacon-${value.revision}`,
      beaconByteLength: 8,
    }));
    const scheduler = new CanvasPersistenceScheduler({
      writer: async () => undefined,
      prepare: prepareCanvasPersistenceSnapshot,
      prepareForUnload,
      deferWork: async () => undefined,
    });

    scheduler.schedule(snapshot(4));
    await scheduler.flush('immediate');
    expect(scheduler.getPreparedSnapshot('project-a')).not.toHaveProperty('beaconPayload');

    expect(scheduler.preparePendingSnapshotForUnload('project-a', 7)).toEqual(expect.objectContaining({
      revision: 4,
      beaconPayload: 'beacon-4',
    }));
    expect(prepareForUnload).toHaveBeenCalledOnce();
  });
});
