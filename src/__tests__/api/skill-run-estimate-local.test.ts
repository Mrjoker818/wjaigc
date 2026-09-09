import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  resolveExecutableSkillForUser: vi.fn(),
  resolveTaskModel: vi.fn(),
  authorizeAgentContext: vi.fn(),
  calculateConfiguredCreditCost: vi.fn(),
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
