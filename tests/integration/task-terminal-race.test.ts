import { describe, expect, it, vi } from 'vitest';
import {
  abortTaskExecution,
  createTaskAbortScope,
  getTaskRecoveryBackoff,
} from '@/lib/task-core/task-abort';
import { canTransitionTaskStatus } from '@/lib/task-core/task-state';
import { normalizeTaskError } from '@/lib/task-core/task-error';

describe('task terminal race boundaries', () => {
  it('actively aborts the underlying operation when cancellation wins', async () => {
    const scope = createTaskAbortScope('task-cancel-race');
    const observedAbort = new Promise<unknown>((resolve) => {
      scope.signal.addEventListener('abort', () => resolve(scope.signal.reason), {
        once: true,
      });
    });

    expect(abortTaskExecution('task-cancel-race', 'cancelled')).toBe(true);

    await expect(observedAbort).resolves.toEqual(expect.objectContaining({
      code: 'TASK_CANCELLED',
      source: 'client',
      retryable: false,
    }));
    expect(scope.signal.aborted).toBe(true);
    scope.dispose();
  });

  it('turns timeout into an abort signal and never allows late completion', async () => {
    vi.useFakeTimers();
    try {
      const scope = createTaskAbortScope('task-timeout-race', {
        timeoutMs: 50,
        requestId: 'req_timeout_race_01',
      });

      await vi.advanceTimersByTimeAsync(50);

      expect(scope.signal.aborted).toBe(true);
      expect(scope.signal.reason).toEqual(expect.objectContaining({
        code: 'TASK_TIMEOUT',
        source: 'wujie',
        retryable: true,
        requestId: 'req_timeout_race_01',
      }));
      expect(canTransitionTaskStatus('timeout', 'completed')).toBe(false);
      scope.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes provider failures without exposing raw response bodies', () => {
    const error = normalizeTaskError(
      new Error('422 {"apiKey":"secret","message":"provider raw body"}'),
      {
        code: 'PROVIDER_REJECTED',
        message: '供应商拒绝了任务，请调整参数后重试',
        source: 'provider',
        retryable: false,
        requestId: 'req_provider_01',
        providerStatus: 422,
      },
    );

    expect(error).toEqual({
      code: 'PROVIDER_REJECTED',
      message: '供应商拒绝了任务，请调整参数后重试',
      source: 'provider',
      retryable: false,
      requestId: 'req_provider_01',
      providerStatus: 422,
    });
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(JSON.stringify(error)).not.toContain('raw body');
  });

  it('returns a bounded recovery backoff while another lease is active', () => {
    const now = 10_000;
    expect(getTaskRecoveryBackoff({
      status: 'processing',
      updatedAt: 9_000,
      leaseExpiresAt: 18_000,
      attemptCount: 2,
    }, now)).toEqual({
      recoveryAllowed: false,
      retryAfterMs: 8_000,
      nextRecoveryAt: 18_000,
      reason: 'lease-active',
    });

    expect(getTaskRecoveryBackoff({
      status: 'processing',
      updatedAt: 1_000,
      leaseExpiresAt: 9_000,
      attemptCount: 2,
    }, now)).toEqual(expect.objectContaining({
      recoveryAllowed: true,
      retryAfterMs: 0,
      reason: 'lease-expired',
    }));
  });
});
