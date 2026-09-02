import { afterEach, describe, expect, it, vi } from 'vitest';

import { runWithAbortSignalTimeout } from '@/lib/abort-signal';

describe('runWithAbortSignalTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aborts the operation when the execution pause signal aborts', async () => {
    vi.useFakeTimers();
    const execution = new AbortController();
    const removeListener = vi.spyOn(execution.signal, 'removeEventListener');
    let combinedSignal: AbortSignal | undefined;
    const operation = runWithAbortSignalTimeout(execution.signal, 60_000, signal => {
      combinedSignal = signal;
      return new Promise<string>(resolve => {
        signal.addEventListener('abort', () => resolve(String(signal.reason)), { once: true });
      });
    });

    execution.abort(new Error('paused'));

    await expect(operation).resolves.toContain('paused');
    expect(combinedSignal).not.toBe(execution.signal);
    expect(combinedSignal?.aborted).toBe(true);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the operation when its request timeout expires', async () => {
    vi.useFakeTimers();
    let combinedSignal: AbortSignal | undefined;
    const operation = runWithAbortSignalTimeout(undefined, 30_000, signal => {
      combinedSignal = signal;
      return new Promise<string>(resolve => {
        signal.addEventListener('abort', () => resolve(signal.reason?.name || ''), { once: true });
      });
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(operation).resolves.toBe('TimeoutError');
    expect(combinedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans the timeout and execution listener after normal completion', async () => {
    vi.useFakeTimers();
    const execution = new AbortController();
    const removeListener = vi.spyOn(execution.signal, 'removeEventListener');

    await expect(runWithAbortSignalTimeout(
      execution.signal,
      120_000,
      async () => 'completed',
    )).resolves.toBe('completed');

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
