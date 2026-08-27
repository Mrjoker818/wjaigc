import { describe, expect, it, vi } from 'vitest';

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
    settleFailed: vi.fn().mockResolvedValue({ transitioned: true, refunded: true }),
    creditCost: 10,
    createTaskId: () => 'task-owner',
    now: () => 10,
    wait: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function execute(deps: PsdAnalysisServiceDependencies, signal?: AbortSignal) {
  return executePsdAnalysis({
    request,
    user,
    requestId: 'req-caller',
    requestSignal: signal,
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
    expect(deps.completeTask).toHaveBeenCalledWith('task-owner', expect.objectContaining({
      schema: 'psd-analysis-result.v1',
      analysis,
    }));
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
    expect(deps.invokeVision).not.toHaveBeenCalled();
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
      wait: vi.fn().mockImplementation(async () => {
        controller.abort();
      }),
    });

    await expect(execute(deps, controller.signal)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_CANCELLED',
    });
    expect(deps.settleFailed).not.toHaveBeenCalled();
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
    });
    expect(deps.invokeVision).not.toHaveBeenCalled();
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });
});
