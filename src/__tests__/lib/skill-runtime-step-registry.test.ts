import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeToolCall: vi.fn(), executeAdmittedToolCall: vi.fn(),
  getCloudTaskForUser: vi.fn(), updateCloudTask: vi.fn(),
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

const actor = {
  id: 'user-1', name: 'User', role: 'user' as const, status: 'active' as const,
  productType: 'canvas', createdAt: 1, updatedAt: 1,
};
const request = {
  skillId: 'generic-reference-skill', skillVersion: 1, surface: 'canvas' as const,
  projectId: 'project-1', workspaceId: 'canvas-1',
  inputValues: { aspectRatio: '16:9' }, sourceVersionIds: ['source-a', 'source-b'],
  modelBindings: {}, idempotencyKey: 'run-key',
};
const stepInput = {
  actorUserId: actor.id, projectId: request.projectId, runId: 'run-1',
  definition: {
    id: request.skillId, version: 1, name: 'Generic', category: 'image', description: '',
    systemPrompt: '', allowedSurfaces: ['canvas' as const], inputs: [], steps: [],
    enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
  },
  step: {
    id: 'variant-a', label: 'Variant A', toolId: 'img2img', execution: 'parallel' as const,
    parallelGroup: 'outputs', promptTemplate: 'render', modelRole: 'image' as const,
    qualityGateIds: ['output-present'],
  },
  inputValues: request.inputValues,
  modelBinding: { providerId: 'frozen-provider', modelId: 'frozen-image-model' },
  requestDigest: 'digest',
  operation: {
    idempotencyKey: 'step-key', operationKey: 'operation-a', recovery: false,
    executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    signal: new AbortController().signal,
    beginSubmission: vi.fn(), recordAccepted: vi.fn(), recordLocalAccepted: vi.fn(), executeOperation: vi.fn(),
  },
  signal: new AbortController().signal,
};

describe('production Skill img2img adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeToolCall.mockResolvedValue({
      success: true, taskIds: [{ taskId: 'task-1' }],
      admittedExecution: { kind: 'generation', taskIds: ['task-1'] },
    });
    mocks.executeAdmittedToolCall.mockResolvedValue(undefined);
    mocks.getCloudTaskForUser
      .mockResolvedValueOnce({ id: 'task-1', status: 'queued', result: { submissionPayload: {} } })
      .mockResolvedValueOnce({ id: 'task-1', status: 'completed', result: { assetProjection: { versionIds: ['asset-a'] } } });
    mocks.updateCloudTask.mockResolvedValue(true);
  });

  it('submits every authorized reference in sourceVersionIds order with frozen routing and billing', async () => {
    const registry = createProductionSkillStepRegistry({
      actor, request,
      mediaByVersionId: {
        'source-b': '/api/serve-upload/source-b.png',
        'source-a': '/api/serve-upload/source-a.png',
      },
    });

    await registry.stepAdapters.img2img(stepInput);

    expect(mocks.executeToolCall).toHaveBeenCalledWith('img2img', expect.objectContaining({
      image_urls: ['/api/serve-upload/source-a.png', '/api/serve-upload/source-b.png'],
      aspect_ratio: '16:9',
    }), expect.objectContaining({
      imageModel: 'frozen-image-model', imageProviderId: 'frozen-provider',
      canonicalImageUrls: ['/api/serve-upload/source-a.png', '/api/serve-upload/source-b.png'],
      idempotencyKey: 'step-key',
      skillBillingContext: expect.objectContaining({ operationKey: 'operation-a' }),
    }));
    expect(stepInput.operation.recordLocalAccepted).toHaveBeenCalledWith('task-1');
  });

  it.each([
    ['missing mapping', { 'source-a': '/api/serve-upload/source-a.png' }],
    ['blank mapping', { 'source-a': '/api/serve-upload/source-a.png', 'source-b': '   ' }],
  ])('rejects %s before provider admission', async (_name, mediaByVersionId) => {
    const registry = createProductionSkillStepRegistry({ actor, request, mediaByVersionId });
    await expect(Promise.resolve().then(() => registry.stepAdapters.img2img(stepInput)))
      .rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND' });
    expect(mocks.executeToolCall).not.toHaveBeenCalled();
  });

  it.each([[[]], [Array.from({ length: 7 }, (_, index) => `source-${index}`)]])(
    'rejects a source count outside 1-6 before provider admission: %#',
    async sourceVersionIds => {
      const boundedRequest = { ...request, sourceVersionIds };
      const registry = createProductionSkillStepRegistry({
        actor, request: boundedRequest,
        mediaByVersionId: Object.fromEntries(sourceVersionIds.map(id => [id, `/uploads/${id}.png`])),
      });
      await expect(Promise.resolve().then(() => registry.stepAdapters.img2img(stepInput)))
        .rejects.toMatchObject({ code: 'SKILL_IMAGE_ADMISSION_FAILED' });
      expect(mocks.executeToolCall).not.toHaveBeenCalled();
    },
  );

  it('surfaces the authoritative multi-reference capability rejection', async () => {
    mocks.executeToolCall.mockResolvedValue({
      success: false, errorCode: 'MODEL_CAPABILITY_MISMATCH',
      error: '所选模型不支持当前参数：referenceImages', resultText: 'received 2, allowed 0-1',
    });
    const registry = createProductionSkillStepRegistry({
      actor, request,
      mediaByVersionId: {
        'source-a': '/api/serve-upload/source-a.png',
        'source-b': '/api/serve-upload/source-b.png',
      },
    });

    await expect(registry.stepAdapters.img2img(stepInput)).rejects.toMatchObject({
      code: 'MODEL_CAPABILITY_MISMATCH',
      message: expect.stringContaining('referenceImages'),
    });
    expect(mocks.executeToolCall.mock.calls[0]?.[1]?.image_urls).toHaveLength(2);
  });
});
