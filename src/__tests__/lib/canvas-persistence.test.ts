import { describe, expect, it, vi } from 'vitest';

import {
  CanvasPersistenceScheduler,
  type CanvasPersistenceSnapshot,
  type CanvasPersistencePhase,
} from '@/lib/canvas-kernel/persistence';

function snapshot(
  revision: number,
  overrides: Partial<CanvasPersistenceSnapshot> = {},
): CanvasPersistenceSnapshot {
  return {
    projectId: 'project-a',
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
  it('defers an immediate flush until the current input task has yielded', async () => {
    const writer = vi.fn(async () => undefined);
    const scheduler = new CanvasPersistenceScheduler({ writer });

    scheduler.schedule(snapshot(1));
    const flush = scheduler.flush('immediate');

    expect(writer).not.toHaveBeenCalled();
    await flush;
    expect(writer).toHaveBeenCalledTimes(1);
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
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
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

  it('does not write a later revision with an unchanged prepared signature', async () => {
    const writer = vi.fn(async () => undefined);
    const scheduler = new CanvasPersistenceScheduler({ writer });
    const unchanged = snapshot(1);

    scheduler.schedule(unchanged);
    await scheduler.flush('immediate');
    scheduler.schedule({ ...unchanged, revision: 2 });
    await scheduler.flush('immediate');

    expect(writer).toHaveBeenCalledTimes(1);
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
});
