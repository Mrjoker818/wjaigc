import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithV1Retry: vi.fn(),
  getApiProviders: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: mocks.fetchWithV1Retry }));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: mocks.getApiProviders }));

import { createProductionSkillStepRegistry } from '@/lib/skill-runtime/step-registry';
import { authorizeAgentTools } from '@/lib/agent-runtime/tool-registry';

const plan = {
  schemaId: 'brief-to-video-plan-v1', title: '产品发布', logline: '一条完整成片。',
  durationSeconds: 10, aspectRatio: '16:9',
  scenes: [{ order: 1, timeRange: '0-10s', visual: '产品特写', camera: '推进', action: '旋转' }],
  finalVideoPrompt: '高品质产品视频', negativePrompt: '闪烁', factualConstraints: [],
};

describe('brief video plan Skill adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiProviders.mockResolvedValue([{
      id: 'frozen-chat', isEnabled: true, apiKey: 'secret', baseUrl: 'https://chat.example.com',
    }]);
    mocks.fetchWithV1Retry.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(plan) } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  });

  it('uses only the frozen orchestrator and returns structured plan output', async () => {
    const beginSubmission = vi.fn(async () => undefined);
    const request = {
      skillId: 'preset-brief-to-video-film', skillVersion: 1, surface: 'canvas' as const,
      projectId: 'project-1', workspaceId: 'canvas-1', inputValues: {}, sourceVersionIds: [],
      modelBindings: {}, idempotencyKey: 'run-key',
    };
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request,
    });
    const result = await registry.stepAdapters.brief_video_plan({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      definition: {
        id: request.skillId, version: 1, name: 'Brief', category: 'video', description: '',
        systemPrompt: '先规划再审批', allowedSurfaces: ['canvas'], inputs: [], steps: [],
        enabled: true, builtIn: true, createdAt: 0, updatedAt: 0, usageCount: 0,
      },
      step: {
        id: 'plan-film', label: '规划', toolId: 'brief_video_plan', execution: 'sequential',
        promptTemplate: '规划', modelRole: 'orchestrator', qualityGateIds: ['output-present'],
      },
      inputValues: {
        brief: '产品发布', goal: '产品转化', audience: '消费者', platform: '通用',
        durationSeconds: '10', aspectRatio: '16:9',
      },
      modelBinding: { providerId: 'frozen-chat', modelId: 'gpt-4o' },
      requestDigest: 'digest', signal: new AbortController().signal,
      operation: {
        idempotencyKey: 'operation-key', operationKey: 'plan', recovery: false,
        executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
        signal: new AbortController().signal, beginSubmission,
        recordAccepted: vi.fn(), recordLocalAccepted: vi.fn(), executeOperation: vi.fn(),
      },
    });

    expect(beginSubmission).toHaveBeenCalledTimes(1);
    expect(result.structured).toEqual({ schemaId: 'brief-to-video-plan-v1', value: plan });
    const body = JSON.parse(String(mocks.fetchWithV1Retry.mock.calls[0]?.[2]?.body));
    expect(body).toMatchObject({ model: 'gpt-4o', stream: false, response_format: { type: 'json_object' } });
    expect(String(body.messages[0].content)).toContain('产品发布');
  });

  it('fails closed when the frozen provider returns an invalid plan', async () => {
    mocks.fetchWithV1Retry.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"scenes":[]}' } }],
    }), { status: 200 }));
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request: {
        skillId: 'preset-brief-to-video-film', skillVersion: 1, surface: 'canvas',
        projectId: 'project-1', workspaceId: 'canvas-1', inputValues: {}, sourceVersionIds: [],
        modelBindings: {}, idempotencyKey: 'run-key',
      },
    });
    await expect(registry.stepAdapters.brief_video_plan({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      definition: { id: 'x', version: 1, name: 'x', category: 'x', description: '', systemPrompt: '', allowedSurfaces: ['canvas'], inputs: [], steps: [], enabled: true, builtIn: true, createdAt: 0, updatedAt: 0, usageCount: 0 },
      step: { id: 'plan-film', label: '规划', toolId: 'brief_video_plan', execution: 'sequential', promptTemplate: '规划', modelRole: 'orchestrator', qualityGateIds: [] },
      inputValues: { brief: '产品发布', goal: '产品转化', audience: '消费者', platform: '通用', durationSeconds: '10', aspectRatio: '16:9' },
      modelBinding: { providerId: 'frozen-chat', modelId: 'gpt-4o' }, requestDigest: 'digest', signal: new AbortController().signal,
      operation: { idempotencyKey: 'key', operationKey: 'plan', recovery: false, signal: new AbortController().signal, beginSubmission: vi.fn(), recordAccepted: vi.fn(), recordLocalAccepted: vi.fn(), executeOperation: vi.fn() },
    })).rejects.toThrow('BRIEF_VIDEO_PLAN_INVALID');
  });

  it('admits the planner only through a Skill execution', () => {
    const request = {
      requestedToolIds: ['brief_video_plan'], workspace: 'canvas' as const,
      userProductTypes: ['canvas'], modelCapabilities: ['chat'],
    };
    expect(authorizeAgentTools(request).denials).toContainEqual({
      toolId: 'brief_video_plan', code: 'SKILL_ADMISSION_REQUIRED',
    });
    expect(authorizeAgentTools({ ...request, skillAdmission: true }).tools)
      .toContainEqual(expect.objectContaining({ toolId: 'brief_video_plan', skillOnly: true }));
  });
});
