import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeToolCall: vi.fn(),
  executeAdmittedToolCall: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  updateCloudTask: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: vi.fn() }));
vi.mock('@/lib/chat-tools', () => ({
  executeToolCall: mocks.executeToolCall,
  executeAdmittedToolCall: mocks.executeAdmittedToolCall,
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: mocks.getCloudTaskForUser,
  updateCloudTask: mocks.updateCloudTask,
}));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: vi.fn() }));

import { createProductionSkillStepRegistry } from '@/lib/skill-runtime/step-registry';

describe('production Skill generation lineage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeToolCall.mockResolvedValue({
      success: true,
      taskIds: [{ taskId: 'task-1' }],
      admittedExecution: { kind: 'generation', taskIds: ['task-1'] },
    });
    mocks.executeAdmittedToolCall.mockResolvedValue(undefined);
    mocks.getCloudTaskForUser.mockResolvedValueOnce({
      id: 'task-1', status: 'queued',
      result: { submissionPayload: { prompt: 'render' } },
    }).mockResolvedValueOnce({
      id: 'task-1', status: 'completed',
      result: {
        assetProjection: { versionIds: ['output-version'] },
      },
    });
    mocks.updateCloudTask.mockResolvedValue(true);
  });

  it.each(['success', 'provider-failed', 'admission-failed', 'lineage-failed', 'missing-task', 'submission-unknown'])('preserves user requirements and distinguishes local admission from provider work (%s)', async (outcome) => {
    if (outcome === 'submission-unknown') {
      mocks.executeAdmittedToolCall.mockRejectedValue(new Error('monitor stopped'));
      mocks.getCloudTaskForUser.mockReset()
        .mockResolvedValueOnce({ id: 'task-1', status: 'queued', result: { submissionPayload: { prompt: 'render' } } })
        .mockResolvedValue({ id: 'task-1', status: 'processing', result: {
          taskError: { code: 'SKILL_SUBMISSION_UNKNOWN' }, skillBillingProvenance: { runId: 'run-1' },
        } });
    }
    if (outcome === 'lineage-failed') mocks.updateCloudTask.mockResolvedValue(false);
    if (outcome === 'missing-task') mocks.executeToolCall.mockResolvedValue({ success: true, taskIds: [] });
    if (outcome === 'admission-failed') {
      mocks.executeToolCall.mockResolvedValue({ success: false, error: 'internal admission failed', errorCode: 'SKILL_BILLING_NOT_AUTHORIZED' });
    }
    if (outcome === 'provider-failed') {
      mocks.getCloudTaskForUser.mockReset()
        .mockResolvedValueOnce({ id: 'task-1', status: 'queued', result: { submissionPayload: { prompt: 'render' } } })
        .mockResolvedValueOnce({ id: 'task-1', status: 'failed', error: 'request rejected', result: {
          taskError: { code: 'TASK_RECOVERY_REQUEST_REJECTED', providerStatus: 400 },
        } });
    }
    const request = {
      skillId: 'preset-concept-art', skillVersion: 1, surface: 'canvas' as const,
      projectId: 'project-1', workspaceId: 'canvas:project-1', inputValues: {},
      sourceVersionIds: ['source-a', 'source-b'], modelBindings: {}, idempotencyKey: 'run-key',
    };
    const registry = createProductionSkillStepRegistry({
      actor: {
        id: 'user-1', name: 'User', role: 'user', status: 'active',
        productType: 'canvas', createdAt: 1, updatedAt: 1,
      },
      request,
    });
    const operation = {
      idempotencyKey: 'step-key', operationKey: 'operation-1', recovery: false,
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
      signal: new AbortController().signal,
      beginSubmission: vi.fn(), recordAccepted: vi.fn(), recordLocalAccepted: vi.fn(), executeOperation: vi.fn(),
    };

    const execution = registry.stepAdapters.generate_image({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      definition: {
        executionContextVersion: 1,
        id: request.skillId, version: 1, name: 'Skill', category: 'image', description: '',
        systemPrompt: '', allowedSurfaces: ['canvas'], inputs: [
          { key: 'dish', label: 'Dish', kind: 'text', required: true },
          { key: 'purpose', label: 'Purpose', kind: 'text', required: true },
        ], steps: [], enabled: true,
        builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
      },
      step: {
        id: 'generate', label: 'Generate', toolId: 'generate_image', execution: 'sequential',
        promptTemplate: 'render', modelRole: 'image', qualityGateIds: [],
      },
      inputValues: { dish: 'strawberry cake', purpose: 'restaurant menu' },
      modelBinding: { providerId: 'provider-1', modelId: 'image-1' },
      requestDigest: 'digest', operation, signal: operation.signal,
    });
    if (['admission-failed', 'lineage-failed', 'missing-task'].includes(outcome)) {
      await expect(execution).rejects.toMatchObject({
        code: outcome === 'admission-failed' ? 'SKILL_BILLING_NOT_AUTHORIZED' : 'SKILL_IMAGE_ADMISSION_FAILED',
      });
      expect(operation.beginSubmission).not.toHaveBeenCalled();
      expect(operation.recordAccepted).not.toHaveBeenCalled();
      expect(operation.recordLocalAccepted).not.toHaveBeenCalled();
      expect(mocks.executeAdmittedToolCall).not.toHaveBeenCalled();
      return;
    }
    if (outcome === 'submission-unknown') {
      await expect(execution).rejects.toMatchObject({ code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN' });
    } else if (outcome === 'provider-failed') {
      await expect(execution).rejects.toMatchObject({ providerStatus: 400, providerCode: 'TASK_RECOVERY_REQUEST_REJECTED' });
    } else {
      await execution;
    }

    const submittedPrompt = mocks.executeToolCall.mock.calls[0]?.[1]?.prompt;
    expect(operation.beginSubmission).not.toHaveBeenCalled();
    expect(operation.recordAccepted).not.toHaveBeenCalled();
    expect(operation.recordLocalAccepted).toHaveBeenCalledWith('task-1');
    expect(submittedPrompt).toContain('strawberry cake');
    expect(submittedPrompt).toContain('restaurant menu');

    // The receiving route must verify this identity against persisted billing and execution state.
    expect(mocks.executeToolCall.mock.calls[0]?.[2]).toMatchObject({
      skillBillingContext: {
        runId: 'run-1',
        stepId: 'generate',
        requestDigest: 'digest',
        operationKey: 'operation-1',
        executionFence: operation.executionFence,
      },
    });
    expect(mocks.executeToolCall.mock.calls[0]?.[1]).not.toHaveProperty('_skipCredits');

    expect(mocks.updateCloudTask).toHaveBeenCalledWith('task-1', {
      result: expect.objectContaining({
        submissionPayload: expect.objectContaining({
          prompt: 'render',
          assetParentVersionIds: ['source-a', 'source-b'],
          assetSourceTrace: {
            source: 'canvas-skill', runId: 'run-1', skillId: 'preset-concept-art', skillVersion: 1,
            sourceVersionIds: ['source-a', 'source-b'], createdAt: expect.any(String),
            modelBindings: {},
          },
        }),
      }),
    });
  });
});
