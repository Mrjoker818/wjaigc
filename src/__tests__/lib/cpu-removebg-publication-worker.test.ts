import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  candidateQuery: vi.fn(),
  lockQuery: vi.fn(),
  release: vi.fn(),
  task: vi.fn(),
  publish: vi.fn(),
  pending: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({
  getPool: () => ({ query: boundary.candidateQuery }),
  getAdvisoryLockPool: () => ({ connect: async () => ({ query: boundary.lockQuery,
    release: boundary.release }) }),
}));
vi.mock('@/lib/cloud-task-storage', () => ({ getCloudTaskForUser: boundary.task }));
vi.mock('@/lib/asset-core/task-projector', () => ({ recordTaskProjectionPending: boundary.pending }));
vi.mock('@/lib/collaboration/task-result-publication', () => ({ projectCanvasTaskResult: boundary.publish }));

import { drainPendingCpuRemoveBgPublications,
  startCpuRemoveBgPublicationWorker, stopCpuRemoveBgPublicationWorker,
} from '@/lib/collaboration/cpu-removebg-publication-worker';

describe('CPU remove-background autonomous publication drain', () => {
  const now = Date.parse('2026-10-01T04:40:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    boundary.candidateQuery.mockResolvedValue({ rows: [{ task_id: 'paid-task', user_id: 'editor',
      project_id: 'document' }] });
    boundary.lockQuery.mockImplementation(async (sql: string) => ({ rows: [{
      [sql.includes('unlock') ? 'released' : 'acquired']: true,
    }] }));
    boundary.task.mockResolvedValue({ id: 'paid-task', userId: 'editor', projectId: 'document',
      status: 'completed', providerId: 'local-rembg', result: {
        imageEditAdmission: { kind: 'document-cpu-removebg' },
        assetProjection: { status: 'projection_pending' },
      } });
    boundary.publish.mockResolvedValue([{ assetVersionId: 'main' }, { assetVersionId: 'mask' }]);
  });

  afterEach(() => {
    stopCpuRemoveBgPublicationWorker();
    vi.useRealTimers();
  });

  it('rechecks backoff after acquiring the lock so a stale candidate is not retried twice', async () => {
    boundary.task.mockResolvedValueOnce({ id: 'paid-task', userId: 'editor', projectId: 'document',
      status: 'completed', providerId: 'local-rembg', result: {
        imageEditAdmission: { kind: 'document-cpu-removebg' },
        assetProjection: { status: 'projection_pending',
          lastAttemptAt: new Date(now - 10_000).toISOString() },
      } });

    const result = await drainPendingCpuRemoveBgPublications({ now });

    expect(result).toEqual({ selected: 1, attempted: 0 });
  });

  it('skips a candidate owned by another worker without publishing', async () => {
    boundary.lockQuery.mockResolvedValueOnce({ rows: [{ acquired: false }] });

    const result = await drainPendingCpuRemoveBgPublications({ now });

    expect(result).toEqual({ selected: 1, attempted: 0 });
    expect(boundary.publish).not.toHaveBeenCalled();
    expect(boundary.release).toHaveBeenCalledWith(false);
  });

  it('discards the advisory connection if unlocking cannot be confirmed', async () => {
    boundary.lockQuery.mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ released: false }] });

    const result = await drainPendingCpuRemoveBgPublications({ now });

    expect(result).toEqual({ selected: 1, attempted: 1 });
    expect(boundary.release).toHaveBeenCalledWith(true);
  });

  it('starts one immediate drain, does not overlap ticks, and stops cleanly', async () => {
    vi.useFakeTimers();
    let completeFirst: (() => void) | undefined;
    const drain = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => {
      completeFirst = resolve;
    })).mockResolvedValue(undefined);

    const first = startCpuRemoveBgPublicationWorker({ drain, intervalMs: 1_000 });
    const duplicate = startCpuRemoveBgPublicationWorker({ drain, intervalMs: 1_000 });
    expect(duplicate).toBe(first);
    expect(drain).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(drain).toHaveBeenCalledTimes(1);
    completeFirst?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(drain).toHaveBeenCalledTimes(2);

    first.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it('tries again after a failed drain instead of disabling the worker', async () => {
    vi.useFakeTimers();
    const drain = vi.fn().mockRejectedValueOnce(new Error('temporary database outage'))
      .mockResolvedValue(undefined);
    startCpuRemoveBgPublicationWorker({ drain, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(drain).toHaveBeenCalledTimes(2);
  });
});
