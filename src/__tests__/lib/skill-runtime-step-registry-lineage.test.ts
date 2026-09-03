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

  it('passes the frozen source versions into the authoritative generation task', async () => {
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
      beginSubmission: vi.fn(), recordAccepted: vi.fn(), executeOperation: vi.fn(),
    };

    await registry.stepAdapters.generate_image({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      definition: {
        id: request.skillId, version: 1, name: 'Skill', category: 'image', description: '',
        systemPrompt: '', allowedSurfaces: ['canvas'], inputs: [], steps: [], enabled: true,
        builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
      },
      step: {
        id: 'generate', label: 'Generate', toolId: 'generate_image', execution: 'sequential',
        promptTemplate: 'render', modelRole: 'image', qualityGateIds: [],
      },
      inputValues: {}, modelBinding: { providerId: 'provider-1', modelId: 'image-1' },
      requestDigest: 'digest', operation, signal: operation.signal,
    });

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
