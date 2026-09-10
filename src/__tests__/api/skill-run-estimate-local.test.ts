import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  resolveExecutableSkillForUser: vi.fn(),
  resolveTaskModel: vi.fn(),
  authorizeAgentContext: vi.fn(),
  calculateConfiguredCreditCost: vi.fn(),
  estimateMultiPlatformExportPlan: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/skill-runtime/storage', () => ({
  resolveExecutableSkillForUser: mocks.resolveExecutableSkillForUser,
}));
vi.mock('@/lib/task-core/model-catalog', () => ({ resolveTaskModel: mocks.resolveTaskModel }));
vi.mock('@/lib/agent-runtime/context-adapters', () => ({
  authorizeAgentContext: mocks.authorizeAgentContext,
}));
vi.mock('@/lib/credits', () => ({
  calculateConfiguredCreditCost: mocks.calculateConfiguredCreditCost,
}));
vi.mock('@/lib/multi-platform-export/estimate', () => ({
  estimateMultiPlatformExportPlan: mocks.estimateMultiPlatformExportPlan,
}));

import { POST } from '@/app/api/skill-runs/estimate/route';
import { createMultiPlatformExportSkill } from '@/lib/skill-runtime/multi-platform-export-preset';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

const localSkill = createMultiPlatformExportSkill(true);
const modelSkill: SkillDefinition = {
  id: 'legacy-model-skill', version: 1, name: 'Legacy model Skill', category: 'image',
  description: 'model path', systemPrompt: 'system', allowedSurfaces: ['workflow'], inputs: [],
  steps: [{
    id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential',
    promptTemplate: 'plan', modelRole: 'orchestrator', qualityGateIds: [],
  }],
  enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
};

function request(skillId: string, modelBindings: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/skill-runs/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      skillId, skillVersion: 1, surface: 'workflow', projectId: 'project-1',
      workspaceId: 'workflow:workflow-1', inputValues: {}, sourceVersionIds: [],
      modelBindings, idempotencyKey: `estimate-${skillId}`, estimateScope: 'workflow-node',
    }),
  });
}

function canvasExportRequest(): NextRequest {
  return new NextRequest('http://localhost/api/skill-runs/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      skillId: localSkill.id,
      skillVersion: 1,
      surface: 'canvas',
      projectId: 'project-1',
      workspaceId: 'canvas:project-1',
      inputValues: {
        sourceAssetVersionIds: ['version-1'],
        targetPresetIds: ['instagram-post-v1'],
        fit: 'contain',
        background: '#ffffffff',
        namingTemplate: '{asset}-{platform}-{size}-{index}',
      },
      sourceVersionIds: ['version-1'],
      modelBindings: {},
      idempotencyKey: 'estimate-local-export-plan',
    }),
  });
}

describe('POST /api/skill-runs/estimate local workflow Skill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true, userId: 'user-1', userRole: 'user', user: { id: 'user-1' }, source: 'cookie',
    });
    mocks.resolveExecutableSkillForUser.mockImplementation(async (_userId: string, skillId: string) => (
      skillId === localSkill.id ? localSkill : modelSkill
    ));
    mocks.resolveTaskModel.mockResolvedValue({
      providerId: 'provider-chat', modelId: 'chat-model', kind: 'chat', sourceType: 'chat',
      protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [],
      qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false, supportsMask: false,
      outputKinds: ['text'], capabilitySources: {},
    });
    mocks.authorizeAgentContext.mockResolvedValue({
      snapshot: {}, mediaByVersionId: {}, selectedEntityVersionIds: {},
    });
    mocks.calculateConfiguredCreditCost.mockResolvedValue(4);
    mocks.estimateMultiPlatformExportPlan.mockResolvedValue({
      fileCount: 1,
      totalPixels: 1_166_400,
      estimatedZipBytes: 840_000,
    });
  });

  it('returns a zero-cost empty frozen binding estimate for the local export Skill', async () => {
    const response = await POST(request(localSkill.id, {}));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      minimum: 0,
      maximum: 0,
      steps: [{ stepId: 'export', cost: 0 }],
      modelBindings: {},
      inputValidation: 'deferred-to-execution',
    });
    expect(mocks.resolveTaskModel).not.toHaveBeenCalled();
    expect(mocks.authorizeAgentContext).not.toHaveBeenCalled();
    expect(mocks.calculateConfiguredCreditCost).not.toHaveBeenCalled();
  });

  it('returns a server-validated export plan for a Canvas batch export', async () => {
    const response = await POST(canvasExportRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      minimum: 0,
      maximum: 0,
      modelBindings: {},
      exportPlan: {
        fileCount: 1,
        totalPixels: 1_166_400,
        estimatedZipBytes: expect.any(Number),
      },
    });
    expect(mocks.estimateMultiPlatformExportPlan).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      projectId: 'project-1',
      skillId: localSkill.id,
      skillVersion: 1,
    }));
  });

  it('returns a controlled non-retryable response for an invalid export source', async () => {
    mocks.estimateMultiPlatformExportPlan.mockRejectedValue(
      Object.assign(new Error('EXPORT_SOURCE_FORMAT_INVALID'), { code: 'EXPORT_SOURCE_FORMAT_INVALID' }),
    );

    const response = await POST(canvasExportRequest());
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload).toMatchObject({
      success: false,
      code: 'EXPORT_SOURCE_FORMAT_INVALID',
      retryable: false,
    });
  });

  it('marks temporary preset storage failures as retryable', async () => {
    mocks.estimateMultiPlatformExportPlan.mockRejectedValue(Object.assign(
      new Error('PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE'),
      { code: 'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE' },
    ));

    const response = await POST(canvasExportRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE',
      retryable: true,
    });
  });

  it('keeps workflow context authorization for model-backed Skills', async () => {
    const response = await POST(request(modelSkill.id, {
      orchestrator: { providerId: 'provider-chat', modelId: 'chat-model' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      minimum: 4,
      maximum: 4,
      modelBindings: { orchestrator: { providerId: 'provider-chat', modelId: 'chat-model' } },
    });
    expect(mocks.authorizeAgentContext).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ providerId: 'provider-chat', modelId: 'chat-model' }),
    }));
  });
});
