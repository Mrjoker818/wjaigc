import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getTaskInfo: vi.fn(),
  isTaskCancelled: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  claimCloudTaskLease: vi.fn(),
  registerTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  findProviderForModel: vi.fn(),
  findProviderById: vi.fn(),
  getRequestUser: vi.fn(),
  after: vi.fn(),
  inspectSkillPrepaidPoll: vi.fn(),
  readSkillPrepaidExecutionReference: vi.fn(),
  buildRecoveredTaskContext: vi.fn(),
  updateCloudTask: vi.fn(),
  releaseCloudTaskLease: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
  completeCloudTask: vi.fn(),
  getSkillPrepaidSubmissionDeadline: vi.fn(),
  reconcileSkillPrepaidDispatch: vi.fn(),
}));

vi.mock('next/server', async importOriginal => ({
  ...await importOriginal<typeof import('next/server')>(),
  after: mocks.after,
}));
vi.mock('@/lib/skill-runtime/prepaid-generation', () => ({
  inspectSkillPrepaidPoll: mocks.inspectSkillPrepaidPoll,
  readSkillPrepaidExecutionReference: mocks.readSkillPrepaidExecutionReference,
  getSkillPrepaidSubmissionDeadline: mocks.getSkillPrepaidSubmissionDeadline,
  reconcileSkillPrepaidDispatch: mocks.reconcileSkillPrepaidDispatch,
}));

vi.mock('@/lib/task-registry', () => ({
  getTaskInfo: mocks.getTaskInfo,
  isTaskCancelled: mocks.isTaskCancelled,
  registerTask: mocks.registerTask,
  registerTaskAbortController: vi.fn(),
  releaseQueueSlot: vi.fn(),
  unregisterTaskAbortController: vi.fn(),
  updateTaskProgress: mocks.updateTaskProgress,
  abortTaskExecution: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: mocks.getCloudTaskForUser,
  claimCloudTaskLease: mocks.claimCloudTaskLease,
  completeCloudTask: mocks.completeCloudTask,
  refundCloudTaskCredits: vi.fn(),
  terminateCloudTaskAndRefund: mocks.terminateCloudTaskAndRefund,
  releaseCloudTaskLease: mocks.releaseCloudTaskLease,
  updateCloudTask: mocks.updateCloudTask,
}));

vi.mock('@/lib/cloud-task-persistence', () => ({
  buildRecoveredTaskContext: mocks.buildRecoveredTaskContext,
  recordImageTaskTerminal: vi.fn(),
  recordVideoTaskTerminal: vi.fn(),
}));

vi.mock('@/lib/server-api-config', () => ({
  findProviderForModel: mocks.findProviderForModel,
  findProviderById: mocks.findProviderById,
  normalizeApiBaseUrl: (value: string) => value,
}));

vi.mock('@/lib/model-capabilities', () => ({
  normalizeModelForApi: (model: string) => ({
    apiModelName: model,
    wasNormalized: false,
  }),
}));

vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn(),
  getRequestUser: mocks.getRequestUser,
  getTrustedRequestAgentExecutionFence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/remove-bg-postprocess', () => ({ postProcessAIRemoveBG: vi.fn() }));
vi.mock('@/lib/fetch-image-buffer', () => ({ fetchImageBuffer: vi.fn() }));
vi.mock('@/lib/image-tools/masked-edit-composite', () => ({ compositeMaskedEdit: vi.fn() }));
vi.mock('@/lib/edit-task-store', () => ({
  getEditTask: vi.fn(),
  deleteEditTask: vi.fn(),
  setEditTask: vi.fn(),
  failEditTask: vi.fn(),
}));
vi.mock('@/app/api/refine-engine/result-store', () => ({ getRefineResult: vi.fn() }));
vi.mock('@/app/api/brand-ecommerce/result-store', () => ({ getBrandResult: vi.fn() }));
vi.mock('@/lib/font-design-task-store', () => ({ getFontDesignResult: vi.fn() }));
vi.mock('@/lib/quality-enhance', () => ({ enhanceViaAI: vi.fn() }));
vi.mock('@/lib/layer-decomposition/service', () => ({ getLayerTaskStatus: vi.fn() }));

import { POST } from '@/app/api/poll-task/route';

describe('poll-task authoritative direct recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'user-a', role: 'user' },
      source: 'cookie',
    });
    mocks.getTaskInfo.mockReturnValue(undefined);
    mocks.isTaskCancelled.mockReturnValue(false);
    mocks.reconcileSkillPrepaidDispatch.mockResolvedValue(false);
    mocks.terminateCloudTaskAndRefund.mockResolvedValue({ transitioned: true, status: 'timeout' });
    mocks.getSkillPrepaidSubmissionDeadline.mockImplementation(async () => ({
      expired: false, deadlineAt: Date.now() + 500_000, remainingMs: 500_000,
    }));
  });

  it('keeps an orphaned dispatch pending reconciliation before the creation-time timeout', async () => {
    const child = { id: 'async-orphan', userId: 'user-a', projectId: 'project-a', type: 'generate-async',
      status: 'processing', progress: 1, createdAt: Date.now() - 1_200_000, leaseExpiresAt: 1,
      result: { skillBillingProvenance: { runId: 'run-a' }, skillProviderDispatch: { token: 'orphan-token' },
        submissionPayload: { prompt: 'original' } } };
    mocks.getCloudTaskForUser.mockResolvedValue(child);
    mocks.inspectSkillPrepaidPoll.mockResolvedValue({ action: 'allow' });
    mocks.reconcileSkillPrepaidDispatch.mockResolvedValue(true);
    mocks.getSkillPrepaidSubmissionDeadline.mockResolvedValue({ expired: true, deadlineAt: 1, remainingMs: 0 });
    mocks.buildRecoveredTaskContext.mockReturnValue({ taskId: child.id, userId: 'user-a', type: 'generate-async', remoteTaskId: child.id });
    const response = await POST(new Request('http://localhost/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: child.id }),
    }) as NextRequest);
    expect(await response.json()).toMatchObject({ code: 'SKILL_SUBMISSION_UNKNOWN', requiresReconciliation: true, retryable: false });
    expect(mocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('does not timeout a prepaid dispatch that appears after the first read', async () => {
    const child = { id: 'async-late-dispatch', userId: 'user-a', projectId: 'project-a', type: 'generate-async',
      status: 'processing', progress: 1, createdAt: Date.now() - 1_200_000,
      result: { skillBillingProvenance: { runId: 'run-a' }, submissionPayload: { prompt: 'original' } } };
    mocks.getCloudTaskForUser.mockResolvedValueOnce(child).mockResolvedValue({ ...child,
      leaseExpiresAt: Date.now() + 60_000,
      result: { ...child.result, skillProviderDispatch: { token: 'new-dispatch' } },
    });
    mocks.inspectSkillPrepaidPoll.mockResolvedValue({ action: 'allow' });
    mocks.getSkillPrepaidSubmissionDeadline.mockResolvedValue({ expired: true, deadlineAt: 1, remainingMs: 0 });
    mocks.buildRecoveredTaskContext.mockReturnValue({ taskId: child.id, userId: 'user-a', type: 'generate-async', remoteTaskId: child.id });
    const response = await POST(new Request('http://localhost/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: child.id }),
    }) as NextRequest);
    expect(await response.json()).toMatchObject({ success: true, status: 'processing' });
    expect(mocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
    expect(mocks.claimCloudTaskLease).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('publishes a deferred prepaid image after resume without dispatching it again', async () => {
    const result = { imageUrl: '/deferred-image.png', imageUrls: ['/deferred-image.png'],
      assetProjection: { status: 'projected' } };
    const child = { id: 'async-deferred', userId: 'user-a', projectId: 'project-a', type: 'generate-async',
      status: 'processing', progress: 80, providerId: 'provider-a', model: 'image-a',
      result: { skillBillingProvenance: { runId: 'run-a' }, skillDeferredCompletion: { result } } as Record<string, unknown> };
    mocks.getCloudTaskForUser.mockImplementation(async () => child);
    mocks.inspectSkillPrepaidPoll.mockResolvedValue({ action: 'allow' });
    mocks.completeCloudTask.mockImplementation(async () => { child.status = 'completed'; child.result = result; return true; });
    mocks.findProviderById.mockResolvedValue({ id: 'provider-a', name: 'Provider A' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const response = await POST(new Request('http://localhost/api/poll-task', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: child.id }),
      }) as NextRequest);
      expect(await response.json()).toMatchObject({ success: true, status: 'completed', imageUrl: result.imageUrl });
      expect(mocks.completeCloudTask).toHaveBeenCalledWith(child.id, result);
      expect(mocks.after).not.toHaveBeenCalled();
      expect(mocks.claimCloudTaskLease).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it.each(['cancelled', 'paused', 'suspended-in-generate', 'cancelled-in-generate', 'active', 'resumed-after-long-pause', 'unknown-in-generate'])('honors prepaid parent control at callback and generate boundaries (%s)', async status => {
    const taskId = `async-parent-${status}`;
    const child = {
      id: taskId, userId: 'user-a', projectId: 'project-a', type: 'generate-async', status: 'processing',
      progress: 1, creditCost: 0, creditStatus: 'not-applicable',
      providerId: 'provider-a', model: 'image-a', createdAt: Date.now() - (status === 'resumed-after-long-pause' ? 1_200_000 : 10_000), updatedAt: Date.now() - 10_000,
      result: { skillBillingProvenance: { runId: 'run-a', stepId: 'image', operationKey: 'operation-a' },
        submissionPayload: { prompt: 'image', workerMode: 'recovery', agentStrictRouting: true,
          agentProviderIdempotencyKey: 'provider-key' } },
    };
    mocks.getCloudTaskForUser.mockResolvedValue(child);
    mocks.inspectSkillPrepaidPoll.mockResolvedValue({ action: 'allow' });
    mocks.buildRecoveredTaskContext.mockReturnValue({
      taskId, userId: 'user-a', type: 'generate-async', remoteTaskId: taskId,
      progress: 1, label: 'Image', model: 'image-a', providerId: 'provider-a',
    });
    mocks.claimCloudTaskLease.mockResolvedValue({ attemptCount: 1 });
    mocks.registerTask.mockReturnValue({ taskId });
    mocks.findProviderById.mockResolvedValue({ id: 'provider-a', name: 'Test', baseUrl: 'https://provider.invalid' });
    mocks.updateCloudTask.mockResolvedValue(true);
    const reference = { taskId, workerId: 'worker-a', attemptCount: 1, parentGeneration: 2 };
    mocks.readSkillPrepaidExecutionReference.mockResolvedValue(reference);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: status === 'active' || status === 'resumed-after-long-pause', taskIds: ['remote-task-a'],
      ...(status === 'suspended-in-generate' ? { code: 'SKILL_EXECUTION_SUSPENDED' } : {}),
      ...(status === 'cancelled-in-generate' ? { code: 'SKILL_PARENT_CANCELLED' } : {}),
      ...(status === 'unknown-in-generate' ? { code: 'SKILL_SUBMISSION_ALREADY_CLAIMED' } : {}),
    }), { headers: { 'content-type': 'application/json' } }));
    try {
      const response = await POST(new Request('http://localhost/api/poll-task', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId }),
      }) as NextRequest);
      expect(await response.json()).toMatchObject({ success: true, status: 'processing' });
      expect(mocks.after).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      if (status === 'unknown-in-generate') Object.assign(child.result, { skillProviderDispatch: { token: 'dispatch-token' } });
      mocks.inspectSkillPrepaidPoll.mockResolvedValue(status === 'paused' ? { action: 'wait', message: 'Parent paused' }
        : status === 'cancelled' ? { action: 'stop', status: 'cancelled', message: 'Parent cancelled' }
          : { action: 'allow' });
      await mocks.after.mock.calls[0][0]();
      if (status === 'paused' || status === 'cancelled') {
        expect(fetchSpy).not.toHaveBeenCalled();
      } else {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({ skillPrepaidExecution: reference });
      }
      if (status === 'unknown-in-generate') {
        expect(mocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
        expect(mocks.updateCloudTask).toHaveBeenCalledWith(taskId, expect.objectContaining({
          mergeResult: true, result: expect.objectContaining({ taskError: expect.objectContaining({ code: 'SKILL_SUBMISSION_UNKNOWN' }) }),
        }));
      } else if (status === 'paused' || status === 'suspended-in-generate') {
        expect(mocks.releaseCloudTaskLease).toHaveBeenCalledWith(taskId, expect.any(String));
        expect(mocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
      } else if (status === 'cancelled') {
        expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith(taskId, 'cancelled', 'Parent cancelled', expect.any(String));
      } else if (status === 'cancelled-in-generate') {
        expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith(taskId, 'cancelled', '父 Skill 已取消', expect.any(String));
      } else {
        expect(mocks.updateCloudTask).toHaveBeenCalledWith(taskId, expect.objectContaining({ remoteTaskId: 'remote-task-a' }));
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns a completed durable direct snapshot without rebuilding or remotely polling it', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'direct-task',
      userId: 'user-a',
      type: 'generate',
      status: 'completed',
      progress: 100,
      result: {
        imageUrl: '/authoritative.png',
        imageUrls: ['/authoritative.png'],
      },
      createdAt: 1,
      updatedAt: 2,
      revision: 2,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const request = new Request('http://localhost/api/poll-task', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId: 'direct-task',
        model: 'image-model',
      }),
    });

    const response = await POST(request as NextRequest);
    const payload = await response.json();

    expect(payload).toMatchObject({
      success: true,
      status: 'completed',
      progress: 100,
      imageUrl: '/authoritative.png',
      imageUrls: ['/authoritative.png'],
    });
    expect(mocks.getTaskInfo).toHaveBeenCalledWith('direct-task');
    expect(mocks.registerTask).not.toHaveBeenCalled();
    expect(mocks.updateTaskProgress).not.toHaveBeenCalled();
    expect(mocks.claimCloudTaskLease).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a signed internal user when no browser cookie exists', async () => {
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'user-a', role: 'admin' },
      source: 'internal',
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'internal-task',
      userId: 'user-a',
      type: 'generate-async',
      status: 'completed',
      progress: 100,
      result: {
        imageUrl: '/internal.png',
        imageUrls: ['/internal.png'],
      },
      createdAt: 1,
      updatedAt: 2,
      revision: 2,
    });
    const request = new Request('http://localhost/api/poll-task', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 'internal-task' }),
    });

    const response = await POST(request as NextRequest);
    const payload = await response.json();

    expect(payload).toMatchObject({
      success: true,
      status: 'completed',
      imageUrl: '/internal.png',
    });
    expect(mocks.getRequestUser).toHaveBeenCalledWith(request);
    expect(mocks.getCloudTaskForUser).toHaveBeenCalledWith('internal-task', 'user-a');
  });
});
