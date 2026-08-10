import { describe, expect, it } from 'vitest';

import {
  classifyRecoverySubmissionFailure,
  getRecoverySubmissionDeadline,
  RECOVERY_SUBMISSION_TIMEOUT_MS,
} from '@/lib/task-core/recovery-submission';

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
