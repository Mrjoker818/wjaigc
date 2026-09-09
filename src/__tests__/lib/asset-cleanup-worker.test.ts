import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { startAssetCleanupWorker, stopAssetCleanupWorker } from '@/lib/asset-core/cleanup-worker';

describe('asset cleanup worker', () => {
  afterEach(() => {
    stopAssetCleanupWorker();
    vi.useRealTimers();
  });

  it('drains immediately at startup without waiting for a new export request', async () => {
    const drain = vi.fn(async () => ({ completed: 0, failed: 0 }));
    startAssetCleanupWorker({ drain, intervalMs: 60_000 });
    await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce());
  });

  it('is singleton across hot reload starts and stop prevents later interval drains', async () => {
    vi.useFakeTimers();
    const drain = vi.fn(async () => ({ completed: 0, failed: 0 }));
    const first = startAssetCleanupWorker({ drain, intervalMs: 1_000 });
    const second = startAssetCleanupWorker({ drain, intervalMs: 1_000 });
    expect(second).toBe(first);
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(drain).toHaveBeenCalledTimes(2);
    stopAssetCleanupWorker();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(drain).toHaveBeenCalledTimes(2);
  });
});
