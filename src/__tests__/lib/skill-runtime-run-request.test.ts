import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import type { SkillDefinition } from '@/lib/skill-runtime/types';
import { LOVART_PLATFORM_COMPLIANCE_SKILLS } from '@/lib/skill-runtime/platform-compliance-preset';
import {
  assertSourceVersionBindings,
  authorizeSkillAgentRunRequest,
  buildSkillAgentRunRequest,
  createSkillRun,
  requiredSkillModelRoles,
  type SkillRunRequest,
} from '@/lib/skill-runtime/run-request';
import { createBriefToVideoSkill } from '@/lib/skill-runtime/brief-to-video-preset';
import { createMemorySkillStorageAdapter, createSkillStore } from '@/lib/skill-runtime/storage';

function descriptor(
  providerId: string,
  modelId: string,
  kind: TaskModelDescriptor['kind'],
): TaskModelDescriptor {
  return {
    providerId,
    modelId,
    kind,
    sourceType: kind === 'chat' ? 'chat' : 'image',
    protocol: kind === 'chat' ? 'chat-completions' : 'images',
    executionMode: kind === 'chat' ? 'sync' : 'async',
    allowedRatios: [],
    allowedSizes: [],
    qualityOptions: [],
    maxOutputs: 1,
    supportsReferenceImages: false,
    supportsMask: kind === 'edit',
    outputKinds: kind === 'chat' ? ['text'] : ['png'],
    capabilitySources: {},
  };
}

const input: SkillRunRequest = {
  skillId: 'preset-ecommerce-listing',
  skillVersion: 1,
  surface: 'canvas',
  projectId: 'project-1',
  workspaceId: 'canvas-1',
  inputValues: {
    product: '耳机',
    features: '降噪，长续航',
  },
  sourceVersionIds: ['version-1'],
  modelBindings: {
    orchestrator: { providerId: 'pear-chat', modelId: 'gemini-3.1-flash' },
    image: { providerId: 'pear-image', modelId: 'gpt-image-2' },
  },
  idempotencyKey: 'skill-run-1',
};

const actor: User = {
  id: 'user-1',
  name: 'Skill user',
  role: 'user',
  status: 'active',
  productType: 'canvas,chat',
  createdAt: 1,
  updatedAt: 1,
};

function runtimeDependencies() {
  const resolveTaskModel = vi.fn(async (providerId: string, modelId: string) => {
    if (providerId === 'pear-chat' && modelId === 'gemini-3.1-flash') {
      return descriptor(providerId, modelId, 'chat');
    }
    if (providerId === 'pear-image' && modelId === 'gpt-image-2') {
      return descriptor(providerId, modelId, 'image');
    }
    throw new Error('provider/model is not authorized');
  });
  const authorizeContext = vi.fn(async ({ request }: { request: AgentRunRequest }) => ({
    snapshot: request.context,
    mediaByVersionId: {},
    selectedEntityVersionIds: {},
  }));
  return { resolveTaskModel, authorizeContext };
}

describe('Skill runtime run requests', () => {
  it('binds optional single-image fields to the exact frozen source version list', () => {
    const skill = createBriefToVideoSkill(true);
    expect(assertSourceVersionBindings(skill, {
      startFrame: 'version-start', endFrame: 'version-end',
    }, ['version-start', 'version-end'])).toEqual(['version-start', 'version-end']);
    expect(() => assertSourceVersionBindings(skill, {
      startFrame: 'version-start', endFrame: 'version-end',
    }, ['version-start'])).toThrowError(expect.objectContaining({
      code: 'SKILL_INPUT_INVALID_VALUE', field: 'endFrame',
    }));
  });

  it('returns the exact authorized video capability for the frozen Run snapshot', async () => {
    const skill = createBriefToVideoSkill(true);
    const video: TaskModelDescriptor = {
      ...descriptor('pear-video', 'video-model', 'video'),
      sourceType: 'video' as const,
      protocol: 'video',
      executionMode: 'async' as const,
      allowedRatios: ['16:9'],
      allowedSizes: ['1080p'],
      allowedDurationsSeconds: [5, 10],
      supportsReferenceImages: true,
      maxReferenceImages: 2,
      supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame'],
      outputKinds: ['mp4'],
    };
    const orchestrator = descriptor('pear-chat', 'gemini-3.1-flash', 'chat');
    const request = await buildSkillAgentRunRequest({
      skillId: skill.id, skillVersion: skill.version, surface: 'canvas',
      projectId: 'project-1', workspaceId: 'canvas-1', sourceVersionIds: [],
      inputValues: {
        brief: '新品广告', goal: '产品转化', audience: '年轻用户', platform: '抖音',
        style: '电影感', durationSeconds: '10', aspectRatio: '16:9', resolution: '1080p',
        generateAudio: false,
      },
      modelBindings: {
        orchestrator: { providerId: orchestrator.providerId, modelId: orchestrator.modelId },
        video: { providerId: video.providerId, modelId: video.modelId },
      },
      idempotencyKey: 'brief-video-run-1',
    }, {
      actorUserId: actor.id,
      resolveTaskModel: vi.fn(async (providerId, modelId) => (
        providerId === video.providerId && modelId === video.modelId ? video : orchestrator
      )),
      resolveSkill: vi.fn(async () => skill),
    });

    const admitted = await authorizeSkillAgentRunRequest(request, {
      actorUserId: actor.id,
      resolveTaskModel: vi.fn(async (providerId, modelId) => (
        providerId === video.providerId && modelId === video.modelId ? video : orchestrator
      )),
      resolveSkill: vi.fn(async () => skill),
    });

    expect(admitted.modelCapabilities).toEqual({ orchestrator, video });
  });

  it('builds a provider-free request for a pure local Skill', async () => {
    const localSkill: SkillDefinition = {
      id: 'local-export', version: 1, name: 'Local export', category: 'export',
      description: 'test', systemPrompt: 'Run the local export', allowedSurfaces: ['canvas'], inputs: [],
      steps: [{
        id: 'export', label: '批量导出', toolId: 'multi_platform_export',
        runtime: 'local', execution: 'sequential', promptTemplate: '',
        qualityGateIds: ['output-present'],
      }],
      enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
    };
    const dependencies = runtimeDependencies();
    const localRequest: SkillRunRequest = {
      ...input,
      skillId: localSkill.id,
      inputValues: {},
      sourceVersionIds: [],
      modelBindings: {},
    };

    expect(requiredSkillModelRoles(localSkill)).toEqual([]);
    const request = await buildSkillAgentRunRequest(
      localRequest,
      { actorUserId: actor.id, ...dependencies },
      localSkill,
    );

    expect(request).toMatchObject({ executionRuntime: 'local', mode: 'agent' });
    expect(request).not.toHaveProperty('providerId');
    expect(request).not.toHaveProperty('modelId');
    expect(request.skill?.modelBindings).toEqual({});
    expect(dependencies.resolveTaskModel).not.toHaveBeenCalled();
  });

  it('revalidates frozen v1 compliance values, sources, and models against the current v2 definition', async () => {
    const currentSkill = { ...LOVART_PLATFORM_COMPLIANCE_SKILLS[0], version: 2 };
    const resolveTaskModel = vi.fn(async (providerId: string, modelId: string) => ({
      ...descriptor(providerId, modelId, 'chat'),
      sourceType: 'vlm' as const,
    }));
    const request: SkillRunRequest = {
      ...input,
      skillId: currentSkill.id,
      skillVersion: currentSkill.version,
      inputValues: { sourceImages: ['version-1'], platform: 'Amazon', region: 'US', assetType: 'main' },
      sourceVersionIds: ['version-1'],
      modelBindings: {
        orchestrator: { providerId: 'frozen-provider', modelId: 'frozen-chat' },
        vision: { providerId: 'frozen-provider', modelId: 'frozen-vision' },
      },
    };

    const built = await buildSkillAgentRunRequest(request, {
      actorUserId: actor.id,
      resolveTaskModel,
      resolveSkill: vi.fn(async () => currentSkill),
    });
    expect(built.skill).toMatchObject({ skillId: currentSkill.id, skillVersion: 2,
      inputValues: request.inputValues, modelBindings: request.modelBindings });
    expect(resolveTaskModel).toHaveBeenCalledTimes(2);

    await expect(buildSkillAgentRunRequest({
      ...request,
      inputValues: { sourceImages: ['version-1'], platform: 'Amazon', assetType: 'main' },
    }, {
      actorUserId: actor.id,
      resolveTaskModel,
      resolveSkill: vi.fn(async () => currentSkill),
    })).rejects.toMatchObject({ code: 'SKILL_INPUT_REQUIRED', field: 'region' });
  });

  it.each([
    ['empty', [], []],
    ['duplicate binding', ['version-1', 'version-1'], ['version-1']],
    ['URL binding', ['https://example.com/source.png'], ['https://example.com/source.png']],
    ['base64 binding', ['data:image/png;base64,AAAA'], ['data:image/png;base64,AAAA']],
    ['missing binding', ['version-1'], ['version-1', 'version-2']],
    ['extra binding', ['version-1', 'version-2'], ['version-1']],
    ['reordered binding', ['version-2', 'version-1'], ['version-1', 'version-2']],
  ])('rejects %s for any source-bound field before costing or task creation', async (_name, sources, sourceVersionIds) => {
    const boundSkill: SkillDefinition = {
      id: 'custom-source-bound', version: 1, name: 'Source-bound', category: 'custom', description: '',
      executionContextVersion: 1, systemPrompt: 'Use sources', allowedSurfaces: ['canvas'],
      inputs: [{ key: 'sources', label: 'Sources', kind: 'images', required: true, maximumItems: 6, bindToSourceVersions: true }],
      steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: 'Plan', modelRole: 'orchestrator', qualityGateIds: [] }],
      enabled: true, builtIn: false, createdAt: 1, updatedAt: 1, usageCount: 0,
    };
    const dependencies = runtimeDependencies();
    const calculateCreditCost = vi.fn();
    const createAgentRun = vi.fn();
    const request: SkillRunRequest = {
      ...input, skillId: boundSkill.id, inputValues: { sources }, sourceVersionIds,
      modelBindings: { orchestrator: input.modelBindings.orchestrator },
    };

    await expect(createSkillRun({ actor, request }, {
      ...dependencies, calculateCreditCost, createAgentRun,
      resolveSkill: vi.fn(async () => boundSkill),
    })).rejects.toMatchObject({ field: 'sources' });
    expect(calculateCreditCost).not.toHaveBeenCalled();
    expect(createAgentRun).not.toHaveBeenCalled();
  });

  it('accepts every generic source-bound field only when it matches canonical source versions', async () => {
    const boundSkill: SkillDefinition = {
      id: 'custom-source-bound', version: 1, name: 'Source-bound', category: 'custom', description: '',
      executionContextVersion: 1, systemPrompt: 'Use sources', allowedSurfaces: ['canvas'],
      inputs: [
        { key: 'primarySources', label: 'Primary', kind: 'images', required: true, bindToSourceVersions: true },
        { key: 'backupSources', label: 'Backup', kind: 'images', required: true, bindToSourceVersions: true },
      ],
      steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: 'Plan', modelRole: 'orchestrator', qualityGateIds: [] }],
      enabled: true, builtIn: false, createdAt: 1, updatedAt: 1, usageCount: 0,
    };
    const dependencies = runtimeDependencies();
    const request = await buildSkillAgentRunRequest({
      ...input, skillId: boundSkill.id,
      inputValues: { primarySources: ['version-1', 'version-2'], backupSources: ['version-1', 'version-2'] },
      sourceVersionIds: ['version-1', 'version-1', 'version-2'],
      modelBindings: { orchestrator: input.modelBindings.orchestrator },
    }, { ...dependencies, actorUserId: actor.id, resolveSkill: vi.fn(async () => boundSkill) });

    expect(request.sourceVersionIds).toEqual(['version-1', 'version-2']);
    expect(request.skill?.inputValues).toMatchObject({
      primarySources: ['version-1', 'version-2'], backupSources: ['version-1', 'version-2'],
    });
  });

  it.each([
    '550e8400-e29b-41d4-a716-446655440000',
    'version-1',
    'image-1:1:source',
  ])('accepts compatible AssetVersion identifier %s', async versionId => {
    const boundSkill: SkillDefinition = {
      id: 'custom-id-contract', version: 1, name: 'ID contract', category: 'custom', description: '',
      executionContextVersion: 1, systemPrompt: 'Use sources', allowedSurfaces: ['canvas'],
      inputs: [{ key: 'sources', label: 'Sources', kind: 'images', required: true, bindToSourceVersions: true }],
      steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: 'Plan', modelRole: 'orchestrator', qualityGateIds: [] }],
      enabled: true, builtIn: false, createdAt: 1, updatedAt: 1, usageCount: 0,
    };
    await expect(buildSkillAgentRunRequest({
      ...input, skillId: boundSkill.id, inputValues: { sources: [versionId] },
      sourceVersionIds: [versionId], modelBindings: { orchestrator: input.modelBindings.orchestrator },
    }, { ...runtimeDependencies(), actorUserId: actor.id, resolveSkill: vi.fn(async () => boundSkill) }))
      .resolves.toMatchObject({ sourceVersionIds: [versionId] });
  });

  it.each([
    '/api/serve-upload/source.png',
    '//cdn.example.com/source.png',
    'file:source.png',
    'data:image/png;base64,AAAA',
    'blob:source-id',
    'http://example.com/source.png',
    'https://example.com/source.png',
  ])('rejects URL or path source literal %s', async source => {
    const boundSkill: SkillDefinition = {
      id: 'custom-id-contract', version: 1, name: 'ID contract', category: 'custom', description: '',
      executionContextVersion: 1, systemPrompt: 'Use sources', allowedSurfaces: ['canvas'],
      inputs: [{ key: 'sources', label: 'Sources', kind: 'images', required: true, bindToSourceVersions: true }],
      steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: 'Plan', modelRole: 'orchestrator', qualityGateIds: [] }],
      enabled: true, builtIn: false, createdAt: 1, updatedAt: 1, usageCount: 0,
    };
    await expect(buildSkillAgentRunRequest({
      ...input, skillId: boundSkill.id, inputValues: { sources: [source] },
      sourceVersionIds: [source], modelBindings: { orchestrator: input.modelBindings.orchestrator },
    }, { ...runtimeDependencies(), actorUserId: actor.id, resolveSkill: vi.fn(async () => boundSkill) }))
      .rejects.toMatchObject({ code: 'SKILL_INPUT_INVALID_VALUE', field: 'sources' });
  });

  it('executes two owner-scoped conversation Skills from their distinct frozen definitions', async () => {
    let sequence = 0;
    const store = createSkillStore(createMemorySkillStorageAdapter(), {
      createId: () => `skill-${String(++sequence).padStart(24, '0')}`,
    });
    const first = await store.createConversation({ actorUserId: actor.id, name: 'First', description: 'One', category: 'First agent', systemPrompt: 'FIRST SYSTEM PROMPT', conversation: 'FIRST PRIVATE DIALOGUE' });
    const second = await store.createConversation({ actorUserId: actor.id, name: 'Second', description: 'Two', category: 'Second agent', systemPrompt: 'SECOND SYSTEM PROMPT', conversation: 'SECOND PRIVATE DIALOGUE' });
    const dependencies = { actorUserId: actor.id, ...runtimeDependencies(), resolveSkill: store.resolveExecutable };
    const requestFor = (skill: typeof first): SkillRunRequest => ({
      ...input, skillId: skill.id, skillVersion: skill.version,
      inputValues: { request: 'Continue this work' },
      modelBindings: { orchestrator: input.modelBindings.orchestrator },
    });
    const [firstRun, secondRun] = await Promise.all([
      buildSkillAgentRunRequest(requestFor(first), dependencies),
      buildSkillAgentRunRequest(requestFor(second), dependencies),
    ]);
    expect(firstRun.prompt).toContain('FIRST PRIVATE DIALOGUE');
    expect(firstRun.prompt).not.toContain('SECOND PRIVATE DIALOGUE');
    expect(secondRun.prompt).toContain('SECOND PRIVATE DIALOGUE');
    expect(firstRun.skill?.skillId).toBe(first.id);
    expect(secondRun.skill?.skillId).toBe(second.id);
    await expect(buildSkillAgentRunRequest({ ...requestFor(first), skillVersion: 2 }, dependencies))
      .rejects.toMatchObject({ code: 'SKILL_VERSION_CONFLICT' });
  });
  it('freezes the authorized provider and model for every model role', async () => {
    const dependencies = runtimeDependencies();

    const request = await buildSkillAgentRunRequest(input, {
      actorUserId: actor.id,
      ...dependencies,
    });

    expect(request.skill?.modelBindings).toEqual({
      orchestrator: { providerId: 'pear-chat', modelId: 'gemini-3.1-flash' },
      image: { providerId: 'pear-image', modelId: 'gpt-image-2' },
    });
    expect(dependencies.resolveTaskModel.mock.calls).toEqual([
      ['pear-chat', 'gemini-3.1-flash', actor.id],
      ['pear-image', 'gpt-image-2', actor.id],
    ]);
    expect(request).toMatchObject({
      workspace: 'canvas',
      mode: 'agent',
      providerId: 'pear-chat',
      modelId: 'gemini-3.1-flash',
      sourceVersionIds: ['version-1'],
      allowedToolIds: ['generate_image'],
      context: {
        selectedEntityIds: [],
        visibleVersionIds: ['version-1'],
        locale: 'zh-CN',
      },
    });
  });

  it('rejects a canvas Skill forged onto simple-chat before model authorization or costing', async () => {
    const dependencies = runtimeDependencies();
    const calculateCreditCost = vi.fn();

    await expect(buildSkillAgentRunRequest({ ...input, surface: 'simple-chat' }, {
      actorUserId: actor.id,
      ...dependencies,
    })).rejects.toMatchObject({ code: 'SKILL_SURFACE_FORBIDDEN', status: 403 });

    expect(dependencies.resolveTaskModel).not.toHaveBeenCalled();
    expect(calculateCreditCost).not.toHaveBeenCalled();
  });

  it('supports simple-chat Skills only in the chat workspace', async () => {
    const dependencies = runtimeDependencies();
    const request = await buildSkillAgentRunRequest({
      ...input,
      skillId: 'ppt-master',
      surface: 'simple-chat',
      inputValues: {},
      sourceVersionIds: [],
      modelBindings: {
        orchestrator: input.modelBindings.orchestrator,
      },
    }, { actorUserId: actor.id, ...dependencies });

    expect(request.workspace).toBe('chat');
    expect(request.skill?.skillId).toBe('ppt-master');
    expect(request.skill?.modelBindings).toEqual({
      orchestrator: { providerId: 'pear-chat', modelId: 'gemini-3.1-flash' },
    });
  });

  it('fails closed for a stale Skill version before model authorization', async () => {
    const dependencies = runtimeDependencies();

    await expect(buildSkillAgentRunRequest({ ...input, skillVersion: 2 }, {
      actorUserId: actor.id,
      ...dependencies,
    })).rejects.toMatchObject({ code: 'SKILL_VERSION_CONFLICT', status: 409 });
    expect(dependencies.resolveTaskModel).not.toHaveBeenCalled();
  });

  it('fails closed when a required role is missing before costing', async () => {
    const dependencies = runtimeDependencies();
    const calculateCreditCost = vi.fn();

    await expect(buildSkillAgentRunRequest({
      ...input,
      modelBindings: { orchestrator: input.modelBindings.orchestrator },
    }, { actorUserId: actor.id, ...dependencies })).rejects.toMatchObject({
      code: 'SKILL_MODEL_BINDING_REQUIRED',
      status: 400,
    });
    expect(calculateCreditCost).not.toHaveBeenCalled();
  });

  it('rejects an extra known role before resolving any model', async () => {
    const dependencies = runtimeDependencies();

    await expect(buildSkillAgentRunRequest({
      ...input,
      modelBindings: {
        ...input.modelBindings,
        video: { providerId: 'pear-video', modelId: 'video-model' },
      },
    }, { actorUserId: actor.id, ...dependencies })).rejects.toMatchObject({
      code: 'SKILL_MODEL_BINDINGS_INVALID',
      status: 400,
    });
    expect(dependencies.resolveTaskModel).not.toHaveBeenCalled();
  });

  it('fails closed on provider/model rejection or insufficient role capability', async () => {
    const rejected = runtimeDependencies();
    rejected.resolveTaskModel.mockRejectedValueOnce(new Error('not authorized'));
    await expect(buildSkillAgentRunRequest(input, {
      actorUserId: actor.id,
      ...rejected,
    })).rejects.toThrow('not authorized');

    const incapable = runtimeDependencies();
    incapable.resolveTaskModel.mockResolvedValueOnce(
      descriptor('pear-chat', 'gemini-3.1-flash', 'image'),
    );
    await expect(buildSkillAgentRunRequest(input, {
      actorUserId: actor.id,
      ...incapable,
    })).rejects.toMatchObject({
      code: 'SKILL_MODEL_CAPABILITY_REQUIRED',
      status: 422,
    });
  });

  it('recalculates the quote on create and passes it through the Agent Runtime billing boundary', async () => {
    const dependencies = runtimeDependencies();
    const calculateCreditCost = vi.fn(async (operation: string) => (
      operation === 'image_generate' ? 4 : operation === 'chat' ? 2 : 0
    ));
    const createAgentRun = vi.fn(async (value: {
      actor: User;
      request: AgentRunRequest;
      billingQuote?: { creditCost: number; label: string };
    }) => ({
      runId: 'run-1',
      reused: false,
      charged: true,
      event: {} as never,
      projection: {} as never,
      tools: [],
      quote: value.billingQuote!,
    }));

    const result = await createSkillRun({ actor, request: input }, {
      ...dependencies,
      calculateCreditCost,
      createAgentRun,
    });

    expect(calculateCreditCost).toHaveBeenCalledTimes(2);
    expect(calculateCreditCost.mock.calls.map(call => call[0])).toEqual(['chat', 'image_generate']);
    expect(dependencies.authorizeContext).toHaveBeenCalledOnce();
    expect(dependencies.authorizeContext.mock.invocationCallOrder[0]).toBeLessThan(
      calculateCreditCost.mock.invocationCallOrder[0],
    );
    expect(createAgentRun).toHaveBeenCalledOnce();
    expect(createAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      billingQuote: { creditCost: 6, label: '电商商品套图' },
      request: expect.objectContaining({ idempotencyKey: 'skill-run-1' }),
    }));
    expect(result).toMatchObject({ runId: 'run-1' });
  });

  it('charges one orchestrator base step for a zero-step simple-chat Skill on estimate and create', async () => {
    const dependencies = runtimeDependencies();
    const calculateCreditCost = vi.fn(async () => 3);
    const createAgentRun = vi.fn(async () => ({
      runId: 'run-chat', reused: false, charged: true,
      event: {} as never, projection: {} as never, tools: [],
    }));
    const request: SkillRunRequest = {
      ...input,
      skillId: 'ppt-master',
      surface: 'simple-chat',
      inputValues: {},
      sourceVersionIds: [],
      modelBindings: { orchestrator: input.modelBindings.orchestrator },
    };

    await createSkillRun({ actor, request }, {
      ...dependencies,
      calculateCreditCost,
      createAgentRun,
    });

    expect(calculateCreditCost).toHaveBeenCalledOnce();
    expect(calculateCreditCost).toHaveBeenCalledWith(
      'chat',
      'gemini-3.1-flash',
      { providerId: 'pear-chat' },
    );
    expect(createAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      billingQuote: { creditCost: 3, label: 'PPT大师' },
    }));
  });
});
