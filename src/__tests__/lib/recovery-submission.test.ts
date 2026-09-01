import { describe, expect, it } from 'vitest';

import {
  classifyRecoverySubmissionFailure,
  getRecoverySubmissionDeadline,
  RECOVERY_SUBMISSION_TIMEOUT_MS,
} from '@/lib/task-core/recovery-submission';
import * as recoverySubmission from '@/lib/task-core/recovery-submission';

describe('recovery submission failure policy', () => {
  it('uses one absolute deadline across every recovery attempt', () => {
    const createdAt = 1_000;

    expect(getRecoverySubmissionDeadline({
      createdAt,
      now: createdAt + RECOVERY_SUBMISSION_TIMEOUT_MS - 1,
    })).toEqual({
      expired: false,
      deadlineAt: createdAt + RECOVERY_SUBMISSION_TIMEOUT_MS,
      remainingMs: 1,
    });

    expect(getRecoverySubmissionDeadline({
      createdAt,
      now: createdAt + RECOVERY_SUBMISSION_TIMEOUT_MS,
    })).toEqual({
      expired: true,
      deadlineAt: createdAt + RECOVERY_SUBMISSION_TIMEOUT_MS,
      remainingMs: 0,
    });
  });

  it('defers the first rate-limited submission instead of refunding it', () => {
    const decision = classifyRecoverySubmissionFailure({
      status: 429,
      responseData: { success: false, error: 'API 调用次数已达上限，请稍后再试' },
      attemptCount: 1,
      requestId: 'req-rate-limit',
    });

    expect(decision.defer).toBe(true);
    expect(decision.retryDelayMs).toBe(30_000);
    expect(decision.taskError).toEqual(expect.objectContaining({
      code: 'TASK_RECOVERY_RATE_LIMITED',
      source: 'provider',
      retryable: true,
      requestId: 'req-rate-limit',
    }));
  });

  it('defers a transient 5xx response once', () => {
    const decision = classifyRecoverySubmissionFailure({
      status: 500,
      responseData: { success: false, error: 'upstream server error' },
      attemptCount: 1,
      requestId: 'req-server',
    });

    expect(decision.defer).toBe(true);
    expect(decision.retryDelayMs).toBe(15_000);
    expect(decision.taskError.code).toBe('TASK_RECOVERY_PROVIDER_UNAVAILABLE');
  });

  it('stops deferring after the classified retry budget is exhausted', () => {
    const decision = classifyRecoverySubmissionFailure({
      status: 429,
      responseData: { success: false, error: 'rate_limit' },
      attemptCount: 2,
      requestId: 'req-exhausted',
    });

    expect(decision.defer).toBe(false);
    expect(decision.taskError.retryable).toBe(true);
  });

  it('never retries authentication or malformed-request failures', () => {
    const auth = classifyRecoverySubmissionFailure({
      status: 401,
      responseData: { success: false, error: 'invalid api key' },
      attemptCount: 1,
      requestId: 'req-auth',
    });
    const malformed = classifyRecoverySubmissionFailure({
      status: 400,
      responseData: { success: false, error: 'missing image' },
      attemptCount: 1,
      requestId: 'req-request',
    });

    expect(auth.defer).toBe(false);
    expect(auth.taskError).toEqual(expect.objectContaining({
      code: 'TASK_RECOVERY_AUTH_FAILED',
      retryable: false,
    }));
    expect(malformed.defer).toBe(false);
    expect(malformed.taskError).toEqual(expect.objectContaining({
      code: 'TASK_RECOVERY_REQUEST_REJECTED',
      retryable: false,
    }));
  });

  it('retries transport failures twice and keeps their details out of the client message', () => {
    const rawMessage = 'fetch failed ECONNRESET 10.0.0.5:443';
    const first = classifyRecoverySubmissionFailure({
      error: new Error(rawMessage),
      attemptCount: 1,
      requestId: 'req-network-1',
    });
    const third = classifyRecoverySubmissionFailure({
      error: new Error(rawMessage),
      attemptCount: 3,
      requestId: 'req-network-3',
    });

    expect(first.defer).toBe(true);
    expect(first.retryDelayMs).toBe(5_000);
    expect(first.taskError.code).toBe('TASK_RECOVERY_NETWORK_ERROR');
    expect(first.taskError.message).not.toContain('10.0.0.5');
    expect(third.defer).toBe(false);
  });
});

describe('local background task recovery', () => {
  const decision = () => (
    recoverySubmission as unknown as {
      getLocalBackgroundTaskRecoveryDecision?: (input: Record<string, unknown>) => Record<string, unknown>;
    }
  ).getLocalBackgroundTaskRecoveryDecision;

  it('waits for a recent brand worker without resubmitting it', () => {
    expect(typeof decision()).toBe('function');
    expect(decision()!({
      type: 'brand-ecommerce', status: 'processing', remoteTaskId: '',
      updatedAt: 1_000, now: 2_000, staleAfterMs: 10_000,
    })).toMatchObject({ action: 'wait', retryAfterMs: 9_000 });
  });

  it('expires an orphaned font worker so the caller can atomically refund it', () => {
    expect(typeof decision()).toBe('function');
    expect(decision()!({
      type: 'font-design', status: 'processing', remoteTaskId: '',
      updatedAt: 1_000, now: 12_000, staleAfterMs: 10_000,
    })).toMatchObject({ action: 'terminate', terminalStatus: 'timeout' });
  });

  it('does not intercept a provider-backed font task or unrelated task type', () => {
    expect(typeof decision()).toBe('function');
    expect(decision()!({
      type: 'font-design', status: 'processing', remoteTaskId: 'remote-1',
      updatedAt: 1_000, now: 12_000, staleAfterMs: 10_000,
    })).toEqual({ action: 'ignore' });
    expect(decision()!({
      type: 'video', status: 'processing', remoteTaskId: '',
      updatedAt: 1_000, now: 12_000, staleAfterMs: 10_000,
    })).toEqual({ action: 'ignore' });
  });
});
