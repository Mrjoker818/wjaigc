import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { startCpuRemoveBgTimeoutWorker, stopCpuRemoveBgTimeoutWorker } from
  '@/lib/collaboration/cpu-removebg-timeout-recovery';

afterEach((): void => {
  stopCpuRemoveBgTimeoutWorker();
  vi.useRealTimers();
});

it('starts one CPU timeout drain and never overlaps or runs after stop', async (): Promise<void> => {
  vi.useFakeTimers();
  let finishFirst: (() => void) | undefined;
  const drain = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => {
    finishFirst = resolve;
  })).mockResolvedValue(undefined);

  const first = startCpuRemoveBgTimeoutWorker({ drain, intervalMs: 1_000 });
  const duplicate = startCpuRemoveBgTimeoutWorker({ drain, intervalMs: 1_000 });
  expect(duplicate).toBe(first);
  expect(drain).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(2_000);
  expect(drain).toHaveBeenCalledTimes(1);
  finishFirst?.();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(drain).toHaveBeenCalledTimes(2);

  first.stop();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(drain).toHaveBeenCalledTimes(2);
});

it('retries a later tick after one timeout drain fails', async (): Promise<void> => {
  vi.useFakeTimers();
  const drain = vi.fn().mockRejectedValueOnce(new Error('temporary database outage'))
    .mockResolvedValue(undefined);
  startCpuRemoveBgTimeoutWorker({ drain, intervalMs: 1_000 });

  await vi.advanceTimersByTimeAsync(1_000);

  expect(drain).toHaveBeenCalledTimes(2);
});
