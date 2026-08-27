import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PsdAnalysisError,
  type PsdAnalysisRequest,
  type PsdAnalysisResult,
} from '@/lib/psd-analysis/contracts';
import { InsufficientCreditsError } from '@/lib/credits';
import {
  executePsdAnalysis,
  type PsdAnalysisServiceDependencies,
} from '@/lib/psd-analysis/service';
import type { User } from '@/lib/user-types';

const request: PsdAnalysisRequest = {
  image: 'data:image/png;base64,aW1hZ2U=',
  idempotencyKey: 'psd-analysis-request-1',
};
const user: User = {
  id: 'user-a',
  name: 'User A',
  role: 'user',
  chatModels: ['pear::gpt-4o'],
  createdAt: 1,
  updatedAt: 1,
};
const analysis: PsdAnalysisResult = {
  backgroundColor: [255, 255, 255],
  backgroundMode: 'white',
  layers: [{ name: 'Background', role: 'bg', description: 'White background' }],
};
const candidate = {
  key: 'pear::gpt-4o',
  kind: 'provider' as const,
  providerId: 'pear',
  providerName: 'PearAPI',
  model: 'gpt-4o',
  baseUrl: 'https://example.test/v1',
  apiKey: 'secret',
};

function processingTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-owner',
    userId: user.id,
    type: 'psd-analysis',
    status: 'processing' as const,
    progress: 5,
    creditStatus: 'pending' as const,
    creditCost: 10,
    createdAt: 10,
    updatedAt: 10,
    revision: 0,
    idempotencyKey: request.idempotencyKey,
    requestDigest: 'digest-a',
    ...overrides,
  };
}

function completedTask() {
  return processingTask({
    status: 'completed',
    progress: 100,
    creditStatus: 'charged',
    result: {
      schema: 'psd-analysis-result.v1',
      requestId: 'req-owner',
      imageSha256: 'sha-image',
      providerId: 'pear',
      model: 'gpt-4o',
      analysis,
    },
  });
}

function dependencies(
  overrides: Partial<PsdAnalysisServiceDependencies> = {},
): PsdAnalysisServiceDependencies {
  return {
    resolveMedia: vi.fn().mockResolvedValue({
      buffer: Buffer.from('image'),
      mimeType: 'image/png',
      width: 16,
      height: 16,
      sha256: 'sha-image',
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
    }),
    loadProviders: vi.fn().mockResolvedValue([]),
    buildCandidates: vi.fn().mockReturnValue([candidate]),
    invokeVision: vi.fn().mockResolvedValue({
      content: JSON.stringify(analysis),
      providerId: 'pear',
      providerName: 'PearAPI',
      model: 'gpt-4o',
    }),
    createTask: vi.fn().mockResolvedValue({
      task: processingTask(),
      reused: false,
      charged: true,
    }),
    getTask: vi.fn().mockResolvedValue(completedTask()),
    completeTask: vi.fn().mockResolvedValue(true),
    claimLease: vi.fn().mockResolvedValue(null),
    settleFailed: vi.fn().mockResolvedValue({ transitioned: true, refunded: true }),
    creditCost: 10,
    createTaskId: () => 'task-owner',
    createLeaseOwner: () => 'worker-owner',
    now: () => 10,
    wait: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PSD_ANALYSIS_PLATFORM_MODEL;
});

function execute(
  deps: PsdAnalysisServiceDependencies,
  signal?: AbortSignal,
  scheduleBackground: (work: () => Promise<void>) => void = work => {
    void work();
  },
) {
  return executePsdAnalysis({
    request,
    user,
    requestId: 'req-caller',
    requestSignal: signal,
    scheduleBackground,
    dependencies: deps,
  });
}

describe('PSD analysis durable service', () => {
  it('creates one billable owner task, invokes one model and persists a bounded result', async () => {
    const deps = dependencies();

    await expect(execute(deps)).resolves.toMatchObject({
      taskId: 'task-owner',
      requestId: 'req-caller',
      providerId: 'pear',
      model: 'gpt-4o',
      analysis,
    });

    expect(deps.createTask).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-a',
      idempotencyKey: request.idempotencyKey,
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      creditCost: 10,
      task: expect.objectContaining({
        id: 'task-owner',
        type: 'psd-analysis',
        status: 'processing',
      }),
    }));
    expect(deps.invokeVision).toHaveBeenCalledTimes(1);
    expect(deps.completeTask).toHaveBeenCalledWith(
      'task-owner',
      expect.objectContaining({
        schema: 'psd-analysis-result.v1',
        analysis,
      }),
      expect.objectContaining({
        leaseOwner: 'worker-owner',
        deadlineAt: expect.any(Number),
      }),
    );
    expect(JSON.stringify(vi.mocked(deps.completeTask).mock.calls[0][1])).not.toContain('base64');
  });

  it('reuses an in-flight durable task without invoking or settling the owner work', async () => {
    const deps = dependencies({
      createTask: vi.fn().mockResolvedValue({
        task: processingTask(),
        reused: true,
        charged: false,
      }),
      getTask: vi.fn()
        .mockResolvedValueOnce(processingTask())
        .mockResolvedValueOnce(completedTask()),
    });

    await expect(execute(deps)).resolves.toMatchObject({
      taskId: 'task-owner',
      providerId: 'pear',
      model: 'gpt-4o',
      analysis,
    });

    expect(deps.invokeVision).not.toHaveBeenCalled();
    expect(deps.completeTask).not.toHaveBeenCalled();
    expect(deps.settleFailed).not.toHaveBeenCalled();
    expect(deps.wait).toHaveBeenCalled();
  });

  it('replays a completed durable task immediately', async () => {
    const deps = dependencies({
      loadProviders: vi.fn().mockRejectedValue(new Error('provider catalog unavailable')),
      createTask: vi.fn().mockResolvedValue({
        task: completedTask(),
        reused: true,
        charged: false,
      }),
    });

    await expect(execute(deps)).resolves.toMatchObject({
      taskId: 'task-owner',
      requestId: 'req-owner',
      analysis,
    });
    expect(deps.getTask).not.toHaveBeenCalled();
    expect(deps.loadProviders).not.toHaveBeenCalled();
    expect(deps.invokeVision).not.toHaveBeenCalled();
  });

  it('aborts a hanging provider catalog lookup through the shared request deadline', async () => {
    const controller = new AbortController();
    const deps = dependencies({
      loadProviders: vi.fn().mockImplementation(() => {
        controller.abort(new Error('caller deadline'));
        return new Promise(() => undefined);
      }),
    });

    const outcome = await Promise.race([
      execute(deps, controller.signal).catch(error => error),
      new Promise(resolve => setTimeout(() => resolve('hung'), 25)),
    ]);

    expect(outcome).toMatchObject({
      code: 'PSD_ANALYSIS_CANCELLED',
      message: 'PSD 分析请求已取消',
    });
    expect(deps.settleFailed).toHaveBeenCalledTimes(1);
  });

  it('aborts a hanging billing admission without invoking an upstream model', async () => {
    const controller = new AbortController();
    const deps = dependencies({
      createTask: vi.fn().mockImplementation(() => {
        controller.abort(new Error('caller deadline'));
        return new Promise(() => undefined);
      }),
    });

    const outcome = await Promise.race([
      execute(deps, controller.signal).catch(error => error),
      new Promise(resolve => setTimeout(() => resolve('hung'), 25)),
    ]);

    expect(outcome).toMatchObject({ code: 'PSD_ANALYSIS_CANCELLED' });
    expect(outcome.taskId).toBeUndefined();
    expect(deps.invokeVision).not.toHaveBeenCalled();
  });

  it('does not expose a speculative task id when delayed admission reuses another task', async () => {
    const controller = new AbortController();
    let resolveAdmission!: (value: Awaited<ReturnType<PsdAnalysisServiceDependencies['createTask']>>) => void;
    const admission = new Promise<Awaited<ReturnType<PsdAnalysisServiceDependencies['createTask']>>>(resolve => {
      resolveAdmission = resolve;
    });
    const scheduled: Array<() => Promise<void>> = [];
    const deps = dependencies({
      createTask: vi.fn().mockImplementation(() => {
        controller.abort(new Error('caller disconnected'));
        return admission;
      }),
    });

    const outcome = await execute(
      deps,
      controller.signal,
      work => scheduled.push(work),
    ).catch(error => error);

    expect(outcome).toMatchObject({ code: 'PSD_ANALYSIS_CANCELLED' });
    expect(outcome.taskId).toBeUndefined();
    expect(scheduled).toHaveLength(1);

    resolveAdmission({
      task: processingTask({ id: 'task-existing' }),
      reused: true,
      charged: false,
    });
    await scheduled[0]();
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it('refuses to commit a successful upstream response after the shared signal aborts', async () => {
    const controller = new AbortController();
    const deps = dependencies({
      invokeVision: vi.fn().mockImplementation(async () => {
        controller.abort(new Error('deadline reached before commit'));
        return {
          content: JSON.stringify(analysis),
          providerId: 'pear',
          providerName: 'PearAPI',
          model: 'gpt-4o',
        };
      }),
    });

    await expect(execute(deps, controller.signal)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_CANCELLED',
      taskId: 'task-owner',
    });
    expect(deps.completeTask).not.toHaveBeenCalled();
    expect(deps.settleFailed).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-owner',
      status: 'cancelled',
      leaseOwner: 'worker-owner',
    }));
  });

  it('takes over an expired processing lease and resumes the durable owner task', async () => {
    const deps = dependencies({
      createTask: vi.fn().mockResolvedValue({
        task: processingTask({ leaseOwner: 'dead-worker', leaseExpiresAt: 1 }),
        reused: true,
        charged: false,
      }),
      getTask: vi.fn().mockResolvedValue(completedTask()),
    });
    const claimLease = vi.fn().mockResolvedValue({
      taskId: 'task-owner',
      owner: 'replacement-worker',
      expiresAt: 45_010,
      attemptCount: 2,
    });
    Object.assign(deps, { claimLease });

    await expect(execute(deps)).resolves.toMatchObject({ taskId: 'task-owner' });

    expect(claimLease).toHaveBeenCalledTimes(1);
    expect(deps.invokeVision).toHaveBeenCalledTimes(1);
    expect(deps.completeTask).toHaveBeenCalledWith(
      'task-owner',
      expect.objectContaining({ schema: 'psd-analysis-result.v1' }),
      expect.objectContaining({
        leaseOwner: 'replacement-worker',
        deadlineAt: expect.any(Number),
      }),
    );
  });

  it('retries lease takeover while waiting and resumes as soon as the old lease expires', async () => {
    const claimLease = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        taskId: 'task-owner',
        owner: 'replacement-worker',
        expiresAt: 45_010,
        attemptCount: 2,
      });
    const deps = dependencies({
      createTask: vi.fn().mockResolvedValue({
        task: processingTask({ leaseOwner: 'old-worker', leaseExpiresAt: Date.now() + 20 }),
        reused: true,
        charged: false,
      }),
      claimLease,
      getTask: vi.fn().mockResolvedValue(processingTask({
        leaseOwner: 'old-worker',
        leaseExpiresAt: Date.now() - 1,
      })),
    });

    await expect(execute(deps)).resolves.toMatchObject({ taskId: 'task-owner' });

    expect(claimLease).toHaveBeenCalledTimes(2);
    expect(deps.wait).toHaveBeenCalledTimes(1);
    expect(deps.invokeVision).toHaveBeenCalledTimes(1);
    expect(deps.completeTask).toHaveBeenCalledWith(
      'task-owner',
      expect.any(Object),
      expect.objectContaining({ leaseOwner: 'replacement-worker' }),
    );
  });

  it('does not inject an unusable platform candidate into the production router', async () => {
    process.env.PSD_ANALYSIS_PLATFORM_MODEL = 'platform-vlm-without-caller';
    const deps = dependencies();
    delete (deps as Partial<PsdAnalysisServiceDependencies>).platformModel;

    await execute(deps);

    expect(deps.buildCandidates).toHaveBeenCalledWith(expect.objectContaining({
      platformModel: undefined,
    }));
  });

  it('does not charge or invoke an upstream model when durable admission fails', async () => {
    const admissionError = new InsufficientCreditsError('user-a', 10, 2);
    const deps = dependencies({
      createTask: vi.fn().mockRejectedValue(admissionError),
    });

    await expect(execute(deps)).rejects.toBe(admissionError);
    expect(deps.invokeVision).not.toHaveBeenCalled();
    expect(deps.completeTask).not.toHaveBeenCalled();
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it.each([
    ['timeout', new PsdAnalysisError('PSD_ANALYSIS_TIMEOUT', 'timeout', 504, true), 'timeout'],
    ['cancelled', new PsdAnalysisError('PSD_ANALYSIS_CANCELLED', 'cancelled', 499, false), 'cancelled'],
    ['invalid output', new PsdAnalysisError('PSD_ANALYSIS_OUTPUT_INVALID', 'invalid', 502, true), 'failed'],
    ['upstream failure', new PsdAnalysisError('PSD_ANALYSIS_UPSTREAM_FAILED', 'failed', 502, true), 'failed'],
  ] as const)(
    'settles an owner %s exactly once with the matching terminal status',
    async (_label, failure, terminalStatus) => {
      const deps = dependencies({
        invokeVision: vi.fn().mockRejectedValue(failure),
      });

      await expect(execute(deps)).rejects.toMatchObject({ code: failure.code });
      expect(deps.settleFailed).toHaveBeenCalledTimes(1);
      expect(deps.settleFailed).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-owner',
        status: terminalStatus,
        lockTimeoutMs: 750,
        statementTimeoutMs: 900,
        error: expect.objectContaining({ code: failure.code }),
      }));
    },
  );

  it('does not settle the owner task when a reused waiter disconnects', async () => {
    const controller = new AbortController();
    const deps = dependencies({
      createTask: vi.fn().mockResolvedValue({
        task: processingTask(),
        reused: true,
        charged: false,
      }),
      getTask: vi.fn().mockResolvedValue(processingTask()),
      wait: vi.fn().mockImplementation(async (_milliseconds, signal) => {
        controller.abort();
        throw signal.reason;
      }),
    });

    await expect(execute(deps, controller.signal)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_CANCELLED',
      taskId: 'task-owner',
    });
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it('preserves task identity when reused-task lease acquisition fails', async () => {
    const deps = dependencies({
      createTask: vi.fn().mockResolvedValue({
        task: processingTask(),
        reused: true,
        charged: false,
      }),
      claimLease: vi.fn().mockRejectedValue(new Error('lease database unavailable')),
    });

    await expect(execute(deps)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_FAILED',
      taskId: 'task-owner',
    });
    expect(deps.invokeVision).not.toHaveBeenCalled();
  });

  it('settles a lease that is acquired after the waiting request has been cancelled', async () => {
    const controller = new AbortController();
    let resolveLease!: (value: Awaited<ReturnType<PsdAnalysisServiceDependencies['claimLease']>>) => void;
    const leaseOperation = new Promise<Awaited<ReturnType<PsdAnalysisServiceDependencies['claimLease']>>>(resolve => {
      resolveLease = resolve;
    });
    const scheduled: Array<() => Promise<void>> = [];
    const deps = dependencies({
      createTask: vi.fn().mockResolvedValue({
        task: processingTask(),
        reused: true,
        charged: false,
      }),
      claimLease: vi.fn().mockImplementation(() => {
        controller.abort(new Error('request cancelled during lease SQL'));
        return leaseOperation;
      }),
    });

    await expect(execute(
      deps,
      controller.signal,
      work => scheduled.push(work),
    )).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_CANCELLED',
      taskId: 'task-owner',
    });
    expect(scheduled).toHaveLength(1);

    resolveLease({
      taskId: 'task-owner',
      owner: 'late-worker',
      expiresAt: Date.now() + 40_000,
      attemptCount: 2,
    });
    await scheduled[0]();
    expect(deps.settleFailed).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-owner',
      status: 'cancelled',
      leaseOwner: 'late-worker',
    }));
  });

  it('replays a persisted failure without invoking or refunding again', async () => {
    const deps = dependencies({
      createTask: vi.fn().mockResolvedValue({
        task: processingTask({
          status: 'timeout',
          error: 'Provider timeout',
          result: {
            errorCode: 'PSD_ANALYSIS_TIMEOUT',
            errorRetryable: true,
            requestId: 'req-owner',
          },
        }),
        reused: true,
        charged: false,
      }),
    });

    await expect(execute(deps)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_TIMEOUT',
      status: 504,
      taskId: 'task-owner',
    });
    expect(deps.invokeVision).not.toHaveBeenCalled();
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it('does not expose a persisted upstream error message when replaying a failed task', async () => {
    const deps = dependencies({
      createTask: vi.fn().mockResolvedValue({
        task: processingTask({
          status: 'failed',
          error: 'Authorization: Bearer secret-provider-key',
          result: {
            errorCode: 'PSD_ANALYSIS_UPSTREAM_FAILED',
            errorStatus: 502,
            errorRetryable: true,
          },
        }),
        reused: true,
        charged: false,
      }),
    });

    await expect(execute(deps)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_UPSTREAM_FAILED',
      message: 'PSD 分析任务失败',
      taskId: 'task-owner',
    });
  });

  it('does not let a stalled refund transaction exceed the request deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const settleFailed = vi.fn()
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce({ transitioned: true, refunded: true });
    const deps = dependencies({
      invokeVision: vi.fn().mockImplementation(async () => {
        controller.abort(new Error('request deadline'));
        throw new Error('upstream interrupted');
      }),
      settleFailed,
    });

    const scheduled: Array<() => Promise<void>> = [];
    const outcome = await Promise.race([
      execute(deps, controller.signal, work => scheduled.push(work)).catch(error => error),
      new Promise(resolve => setTimeout(() => resolve('hung'), 25)),
    ]);

    expect(outcome).toMatchObject({
      code: 'PSD_ANALYSIS_CANCELLED',
      taskId: 'task-owner',
    });
    expect(scheduled).toHaveLength(1);

    const cleanup = scheduled[0]();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settleFailed).toHaveBeenCalledTimes(2);
    await cleanup;
  });

  it('schedules an idempotent settlement retry after a transient database failure', async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const settleFailed = vi.fn()
      .mockRejectedValueOnce(new Error('temporary database outage'))
      .mockResolvedValueOnce({ transitioned: true, refunded: true });
    const deps = dependencies({
      invokeVision: vi.fn().mockRejectedValue(
        new PsdAnalysisError('PSD_ANALYSIS_OUTPUT_INVALID', 'invalid', 502, true),
      ),
      settleFailed,
    });

    await expect(execute(
      deps,
      undefined,
      work => scheduled.push(work),
    )).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_SETTLEMENT_FAILED',
      taskId: 'task-owner',
    });
    expect(scheduled).toHaveLength(1);

    await scheduled[0]();
    expect(settleFailed).toHaveBeenCalledTimes(2);
    expect(settleFailed).toHaveBeenLastCalledWith(expect.objectContaining({
      taskId: 'task-owner',
      status: 'failed',
      leaseOwner: 'worker-owner',
    }));
  });

  it('preserves task identity when a completed replay record is malformed', async () => {
    const deps = dependencies({
      createTask: vi.fn().mockResolvedValue({
        task: completedTask(),
        reused: true,
        charged: false,
      }),
    });
    const malformed = completedTask() as unknown as Awaited<
      ReturnType<PsdAnalysisServiceDependencies['createTask']>
    >['task'];
    malformed.result = { schema: 'psd-analysis-result.v1' };
    vi.mocked(deps.createTask).mockResolvedValue({
      task: malformed,
      reused: true,
      charged: false,
    });

    await expect(execute(deps)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_TASK_RESULT_INVALID',
      taskId: 'task-owner',
    });
  });

  it('preserves task identity when a reused task disappears while waiting', async () => {
    const deps = dependencies({
      createTask: vi.fn().mockResolvedValue({
        task: processingTask(),
        reused: true,
        charged: false,
      }),
      getTask: vi.fn().mockResolvedValue(null),
    });

    await expect(execute(deps)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_TASK_NOT_FOUND',
      taskId: 'task-owner',
    });
  });

  it('replays an authoritative completed winner when failure settlement loses the terminal race', async () => {
    const deps = dependencies({
      completeTask: vi.fn().mockRejectedValue(
        new PsdAnalysisError('PSD_ANALYSIS_TIMEOUT', 'deadline', 504, true),
      ),
      settleFailed: vi.fn().mockResolvedValue({ transitioned: false, refunded: false }),
      getTask: vi.fn().mockResolvedValue(completedTask()),
    });

    await expect(execute(deps)).resolves.toMatchObject({
      taskId: 'task-owner',
      requestId: 'req-owner',
      analysis,
    });
  });

  it('returns a safe post-admission error with the durable task identity', async () => {
    const deps = dependencies({
      invokeVision: vi.fn().mockRejectedValue(
        new Error('postgres://secret-user:secret-pass@private-host/internal'),
      ),
    });

    await expect(execute(deps)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_FAILED',
      message: 'PSD 分析执行失败',
      taskId: 'task-owner',
    });
    expect(deps.settleFailed).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-owner',
      error: expect.objectContaining({ message: 'PSD 分析执行失败' }),
    }));
  });
});
