import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const continuationMocks = vi.hoisted(() => ({
  listManagedUsers: vi.fn(),
  authorizeAgentContext: vi.fn(),
  createRegistry: vi.fn(() => ({ stepAdapters: {}, stepRecoveries: {} })),
}));

vi.mock('@/lib/server-auth', () => ({ listManagedUsers: continuationMocks.listManagedUsers }));
vi.mock('@/lib/agent-runtime/context-adapters', () => ({
  authorizeAgentContext: continuationMocks.authorizeAgentContext,
}));
vi.mock('@/lib/skill-runtime/step-registry', () => ({
  createProductionSkillStepRegistry: continuationMocks.createRegistry,
}));

import { agentRunRequestDigest } from '@/lib/agent-runtime/service';
import type { AgentEvent, AgentRunRequest } from '@/lib/agent-runtime/types';
import type { CloudTask } from '@/lib/cloud-task-storage';
import { frozenDefinition, loadPersistedSkillContinuation } from '@/lib/skill-runtime/continuation';
import { compileConditionalSkillSteps } from '@/lib/skill-runtime/step-compiler';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

const actor = {
  id: 'user-1', name: 'User', role: 'user' as const, status: 'active' as const,
  productType: 'canvas,chat', createdAt: 1, updatedAt: 1,
};

const frozenSnapshot = {
  id: 'custom-continuation-bound', version: 1, name: 'Continuation bound',
  executionContextVersion: 1, systemPrompt: 'Frozen prompt',
  inputs: [
    { key: 'campaignName', label: 'Campaign', kind: 'text', required: true },
    { key: 'channels', label: 'Channels', kind: 'multi-select', required: true, options: ['Web', 'Email'], maximumItems: 2 },
    { key: 'sources', label: 'Sources', kind: 'images', required: true, maximumItems: 3, bindToSourceVersions: true },
  ],
  steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: 'Plan', modelRole: 'orchestrator', qualityGateIds: [] }],
};

function persistedFixture(
  inputValues: Record<string, unknown>,
  sourceVersionIds: string[],
  executionRuntime?: 'model',
  persistedExecutionRuntime: 'model' | undefined = executionRuntime,
): { task: CloudTask; events: AgentEvent[] } {
  const request: AgentRunRequest = {
    projectId: 'project-1', workspace: 'canvas', workspaceId: 'canvas-1', mode: 'agent',
    ...(executionRuntime ? { executionRuntime } : {}),
    providerId: 'provider-1', modelId: 'model-1', prompt: 'Persisted prompt',
    sourceVersionIds, allowedToolIds: ['chat'], idempotencyKey: 'continuation-1',
    context: { selectedEntityIds: [], visibleVersionIds: sourceVersionIds, locale: 'zh-CN' },
    skill: {
      skillId: frozenSnapshot.id, skillVersion: frozenSnapshot.version, inputValues,
      modelBindings: { orchestrator: { providerId: 'provider-1', modelId: 'model-1' } },
    },
  };
  const requestDigest = agentRunRequestDigest(request);
  return {
    task: {
      id: 'run-1', userId: actor.id, projectId: request.projectId, type: 'agent-run',
      status: 'processing', progress: 40, creditStatus: 'charged', creditCost: 3,
      createdAt: 1, updatedAt: 2, idempotencyKey: request.idempotencyKey, requestDigest,
    },
    events: [{
      eventId: 'created', runId: 'run-1', sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: request.workspace, workspaceId: request.workspaceId,
        ...(persistedExecutionRuntime ? { executionRuntime: persistedExecutionRuntime } : {}),
        providerId: request.providerId, modelId: request.modelId, prompt: request.prompt,
        sourceVersionIds, allowedToolIds: request.allowedToolIds, context: request.context,
        requestDigest, skill: request.skill, skillSnapshot: frozenSnapshot,
      },
    }],
  };
}

beforeEach(() => {
  continuationMocks.listManagedUsers.mockReset();
  continuationMocks.listManagedUsers.mockResolvedValue([actor]);
  continuationMocks.authorizeAgentContext.mockReset();
  continuationMocks.authorizeAgentContext.mockImplementation(async ({ request }: { request: AgentRunRequest }) => ({
    snapshot: request.context,
    mediaByVersionId: Object.fromEntries(request.sourceVersionIds.map(id => [id, `/api/serve-upload/${id}.png`])),
    selectedEntityVersionIds: {},
  }));
  continuationMocks.createRegistry.mockClear();
});

describe('Skill runtime frozen continuation', () => {
  it('passes an exact persisted video capability to the registry and rejects a swapped provider', async () => {
    const fixture = persistedFixture({
      campaignName: 'Launch', channels: ['Web'], sources: ['version-1'],
    }, ['version-1']);
    const created = fixture.events[0]!.payload;
    const descriptor = {
      providerId: 'pear-video', modelId: 'video-model', kind: 'video', sourceType: 'video',
      protocol: 'video', executionMode: 'async', allowedRatios: ['16:9'], allowedSizes: ['1080p'],
      qualityOptions: [], maxOutputs: 1, supportsReferenceImages: true, maxReferenceImages: 2,
      supportsMask: false, allowedDurationsSeconds: [5, 10],
      supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame'],
      outputKinds: ['mp4'], capabilitySources: {},
    };
    created.allowedToolIds = ['video_generate'];
    created.skill = {
      ...(created.skill as Record<string, unknown>),
      modelBindings: {
        orchestrator: { providerId: 'provider-1', modelId: 'model-1' },
        video: { providerId: 'pear-video', modelId: 'video-model' },
      },
    };
    created.skillSnapshot = {
      ...frozenSnapshot,
      steps: [{
        id: 'generate-film', label: 'Generate', toolId: 'video_generate', execution: 'sequential',
        promptTemplate: 'Generate', modelRole: 'video', qualityGateIds: [],
      }],
      modelCapabilities: { video: descriptor },
    };
    const request: AgentRunRequest = {
      projectId: 'project-1', workspace: 'canvas', workspaceId: 'canvas-1', mode: 'agent',
      providerId: 'provider-1', modelId: 'model-1', prompt: 'Persisted prompt',
      sourceVersionIds: ['version-1'], allowedToolIds: ['video_generate'],
      idempotencyKey: 'continuation-1',
      context: { selectedEntityIds: [], visibleVersionIds: ['version-1'], locale: 'zh-CN' },
      skill: created.skill as AgentRunRequest['skill'],
    };
    const digest = agentRunRequestDigest(request);
    created.requestDigest = digest;
    fixture.task.requestDigest = digest;

    await loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: 'project-1', runId: 'run-1', ...fixture,
    });
    expect(continuationMocks.createRegistry).toHaveBeenCalledWith(expect.objectContaining({
      videoModelBinding: {
        providerId: 'pear-video', modelId: 'video-model', descriptor,
      },
    }));

    continuationMocks.createRegistry.mockClear();
    (descriptor as Record<string, unknown>).providerId = 'swapped-provider';
    await expect(loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: 'project-1', runId: 'run-1', ...fixture,
    })).rejects.toMatchObject({ code: 'BRIEF_VIDEO_MODEL_CAPABILITY_MISMATCH' });
    expect(continuationMocks.createRegistry).not.toHaveBeenCalled();
  });

  it('restores local runtime and catalog visibility while defaulting legacy steps to model', () => {
    const local = frozenDefinition({
      ...frozenSnapshot,
      allowedSurfaces: ['canvas', 'simple-chat'],
      catalogSurfaces: ['canvas'],
      steps: [{
        id: 'export', label: 'Export', toolId: 'multi_platform_export', runtime: 'local',
        execution: 'sequential', promptTemplate: '', qualityGateIds: ['output-present'],
      }],
    }, 'canvas', frozenSnapshot.id, frozenSnapshot.version);

    expect(local.allowedSurfaces).toEqual(['canvas', 'simple-chat']);
    expect(local.catalogSurfaces).toEqual(['canvas']);
    expect(local.steps[0]).toMatchObject({ runtime: 'local' });
    expect(local.steps[0]).not.toHaveProperty('modelRole');

    const legacy = frozenDefinition(frozenSnapshot, 'canvas', frozenSnapshot.id, frozenSnapshot.version);
    expect(legacy.steps[0]).not.toHaveProperty('runtime');
    expect(legacy.steps[0]?.modelRole).toBe('orchestrator');
    expect(legacy.catalogSurfaces).toEqual(legacy.allowedSurfaces);
  });

  it('restores a validated compiled image fan-out identity from the frozen snapshot', () => {
    const compiledFanOut = {
      inputKey: 'sources', itemIndex: 1, itemDigest: '0123456789abcdef',
    };
    const definition = frozenDefinition({
      ...frozenSnapshot,
      steps: [{
        id: 'audit-image:0123456789abcdef', label: 'Audit image 2', toolId: 'audit',
        execution: 'parallel', parallelGroup: 'audit:chunk:0', promptTemplate: 'Audit image',
        modelRole: 'vision', qualityGateIds: [], compiledFanOut,
      }],
    }, 'canvas', frozenSnapshot.id, frozenSnapshot.version);

    expect(definition.steps[0]?.compiledFanOut).toEqual(compiledFanOut);
  });

  it.each([
    { inputKey: '', itemIndex: 0, itemDigest: '0123456789abcdef' },
    { inputKey: 'sources', itemIndex: -1, itemDigest: '0123456789abcdef' },
    { inputKey: 'sources', itemIndex: 0, itemDigest: 'not-a-digest' },
  ])('rejects malformed frozen compiled fan-out identity %#', compiledFanOut => {
    expect(() => frozenDefinition({
      ...frozenSnapshot,
      steps: [{
        ...frozenSnapshot.steps[0], compiledFanOut,
      }],
    }, 'canvas', frozenSnapshot.id, frozenSnapshot.version))
      .toThrow('Frozen Skill step is invalid');
  });

  it('rejects a frozen step with both source and compiled fan-out metadata', () => {
    expect(() => frozenDefinition({
      ...frozenSnapshot,
      steps: [{
        id: 'audit-image:0123456789abcdef', label: 'Audit image 1', toolId: 'audit',
        execution: 'parallel', parallelGroup: 'audit:chunk:0', promptTemplate: 'Audit image',
        modelRole: 'vision', qualityGateIds: [],
        fanOut: {
          inputKey: 'sources', itemAlias: 'sourceImage', maximumItems: 3, concurrency: 2,
        },
        compiledFanOut: {
          inputKey: 'sources', itemIndex: 0, itemDigest: '0123456789abcdef',
        },
      }],
    }, 'canvas', frozenSnapshot.id, frozenSnapshot.version))
      .toThrow('Frozen Skill step is invalid');
  });

  it.each([
    { execution: 'sequential' },
    { parallelGroup: undefined },
    { compiledFanOut: {
      inputKey: 'sources', itemIndex: 0, itemDigest: '0123456789abcdef', extra: true,
    } },
  ])('rejects inconsistent compiled fan-out snapshot structure %#', override => {
    expect(() => frozenDefinition({
      ...frozenSnapshot,
      steps: [{
        id: 'audit-image:0123456789abcdef', label: 'Audit image 1', toolId: 'audit',
        execution: 'parallel', parallelGroup: 'audit:chunk:0', promptTemplate: 'Audit image',
        modelRole: 'vision', qualityGateIds: [],
        compiledFanOut: {
          inputKey: 'sources', itemIndex: 0, itemDigest: '0123456789abcdef',
        },
        ...override,
      }],
    }, 'canvas', frozenSnapshot.id, frozenSnapshot.version))
      .toThrow('Frozen Skill step is invalid');
  });

  it('rejects continuation when compiled fan-out digest drifts from frozen input values', async () => {
    const fanOutDefinition: SkillDefinition = {
      ...frozenSnapshot,
      executionContextVersion: 1,
      inputs: frozenSnapshot.inputs as SkillDefinition['inputs'],
      allowedSurfaces: ['canvas'], category: 'test', description: 'test',
      enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
      steps: [{
        id: 'audit-image', label: 'Audit image', toolId: 'audit', execution: 'parallel',
        parallelGroup: 'audit', promptTemplate: 'Audit image', modelRole: 'vision',
        qualityGateIds: [], fanOut: {
          inputKey: 'sources', itemAlias: 'sourceImage', maximumItems: 3, concurrency: 2,
        },
      }],
    };
    const fixture = persistedFixture({
      campaignName: 'Launch', channels: ['Web'], sources: ['version-1'],
    }, ['version-1']);
    fixture.events[0]!.payload.skillSnapshot = {
      ...frozenSnapshot,
      steps: compileConditionalSkillSteps(fanOutDefinition, { sources: ['version-2'] }),
    };

    await expect(loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: 'project-1', runId: 'run-1', ...fixture,
    })).rejects.toMatchObject({ code: 'SKILL_STEP_FAN_OUT_INVALID' });
    expect(continuationMocks.createRegistry).not.toHaveBeenCalled();
  });

  it('rejects continuation when a compiled fan-out step id is detached from its digest', async () => {
    const fanOutDefinition: SkillDefinition = {
      ...frozenSnapshot,
      executionContextVersion: 1,
      inputs: [{
        key: 'sources', label: 'Sources', kind: 'images', required: true,
        maximumItems: 3, bindToSourceVersions: true,
      }],
      allowedSurfaces: ['canvas'], category: 'test', description: 'test',
      enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
      steps: [{
        id: 'audit-image', label: 'Audit image', toolId: 'audit', execution: 'parallel',
        parallelGroup: 'audit', promptTemplate: 'Audit image', modelRole: 'vision',
        qualityGateIds: [], fanOut: {
          inputKey: 'sources', itemAlias: 'sourceImage', maximumItems: 3, concurrency: 2,
        },
      }],
    };
    const fixture = persistedFixture({ sources: ['version-1'] }, ['version-1']);
    const [compiled] = compileConditionalSkillSteps(fanOutDefinition, {
      sources: ['version-1'],
    });
    fixture.events[0]!.payload.skillSnapshot = {
      ...frozenSnapshot,
      inputs: fanOutDefinition.inputs,
      steps: [{ ...compiled!, id: 'audit-image:ffffffffffffffff' }],
    };

    await expect(loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: 'project-1', runId: 'run-1', ...fixture,
    })).rejects.toMatchObject({ code: 'SKILL_STEP_FAN_OUT_INVALID' });
    expect(continuationMocks.createRegistry).not.toHaveBeenCalled();
  });

  it('restores the complete validated input contract from the frozen snapshot', () => {
    const definition = frozenDefinition({
      id: 'custom-source-bound', version: 4, name: 'Frozen source skill',
      executionContextVersion: 1, systemPrompt: 'Use frozen constraints',
      inputs: [{
        key: 'sources', label: 'Sources', kind: 'multi-select', required: true,
        defaultValue: ['version-a'], options: ['version-a', 'version-b'], maximumItems: 2,
        bindToSourceVersions: true, uniqueItems: true,
      }, {
        key: 'platform', label: 'Platform', kind: 'select', required: true, options: ['Amazon', '京东'],
      }, {
        key: 'region', label: 'Region', kind: 'select', required: true,
        dependentOptions: { inputKey: 'platform', values: { Amazon: ['US'], '京东': ['CN'] } },
      }, { key: 'claims', label: 'Claims', kind: 'text', required: false, maximumLength: 4_000 }],
      steps: [{
        id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential',
        promptTemplate: '{{sources}}', modelRole: 'orchestrator', qualityGateIds: [],
      }],
    }, 'canvas', 'custom-source-bound', 4);

    expect(definition.inputs).toEqual([{
      key: 'sources', label: 'Sources', kind: 'multi-select', required: true,
      defaultValue: ['version-a'], options: ['version-a', 'version-b'], maximumItems: 2,
      bindToSourceVersions: true, uniqueItems: true,
    }, {
      key: 'platform', label: 'Platform', kind: 'select', required: true, options: ['Amazon', '京东'],
    }, {
      key: 'region', label: 'Region', kind: 'select', required: true,
      dependentOptions: { inputKey: 'platform', values: { Amazon: ['US'], '京东': ['CN'] } },
    }, { key: 'claims', label: 'Claims', kind: 'text', required: false, maximumLength: 4_000 }]);
  });

  it.each([
    [{ defaultValue: ['version-a', 1] }],
    [{ options: ['version-a', 1] }],
    [{ maximumItems: 0 }],
    [{ bindToSourceVersions: 'true' }],
    [{ uniqueItems: 'true' }],
    [{ maximumLength: 0 }],
    [{ dependentOptions: { inputKey: 'missing', values: { Amazon: ['US'] } } }],
  ])('rejects malformed frozen input metadata %#', extra => {
    expect(() => frozenDefinition({
      id: 'bad', version: 1, name: 'Bad', executionContextVersion: 1, systemPrompt: 'Bad',
      inputs: [{ key: 'sources', label: 'Sources', kind: 'multi-select', required: true, ...extra }],
      steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: '', modelRole: 'orchestrator', qualityGateIds: [] }],
    }, 'canvas', 'bad', 1)).toThrow('Frozen Skill input is invalid');
  });

  it('rejects frozen dependentOptions getters before cloning or invocation', () => {
    let getterCalls = 0;
    const region: Record<string, unknown> = {
      key: 'region', label: 'Region', kind: 'select', required: true,
    };
    Object.defineProperty(region, 'dependentOptions', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('frozen getter must not run');
      },
    });

    expect(() => frozenDefinition({
      id: 'bad', version: 1, name: 'Bad', executionContextVersion: 1, systemPrompt: 'Bad',
      inputs: [
        { key: 'platform', label: 'Platform', kind: 'select', required: true, options: ['Amazon'] },
        region,
      ],
      steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: '', modelRole: 'orchestrator', qualityGateIds: [] }],
    }, 'canvas', 'bad', 1)).toThrow('Frozen Skill input is invalid');
    expect(getterCalls).toBe(0);
  });

  it('rejects frozen nested option getters before cloning or invocation', () => {
    let getterCalls = 0;
    const values: Record<string, unknown> = {};
    Object.defineProperty(values, 'Amazon', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('frozen mapping getter must not run');
      },
    });

    expect(() => frozenDefinition({
      id: 'bad', version: 1, name: 'Bad', executionContextVersion: 1, systemPrompt: 'Bad',
      inputs: [
        { key: 'platform', label: 'Platform', kind: 'select', required: true, options: ['Amazon'] },
        {
          key: 'region', label: 'Region', kind: 'select', required: true,
          dependentOptions: { inputKey: 'platform', values },
        },
      ],
      steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: '', modelRole: 'orchestrator', qualityGateIds: [] }],
    }, 'canvas', 'bad', 1)).toThrow('Frozen Skill input is invalid');
    expect(getterCalls).toBe(0);
  });

  it.each([
    ['duplicate selection', { campaignName: 'Launch', channels: ['Web', 'Web'], sources: ['version-1'] }, ['version-1']],
    ['unknown selection', { campaignName: 'Launch', channels: ['Unknown'], sources: ['version-1'] }, ['version-1']],
    ['selection limit', { campaignName: 'Launch', channels: ['Web', 'Email', 'Social'], sources: ['version-1'] }, ['version-1']],
    ['missing required', { channels: ['Web'], sources: ['version-1'] }, ['version-1']],
    ['missing binding', { campaignName: 'Launch', channels: ['Web'], sources: ['version-1'] }, ['version-1', 'version-2']],
    ['extra binding', { campaignName: 'Launch', channels: ['Web'], sources: ['version-1', 'version-2'] }, ['version-1']],
    ['reordered binding', { campaignName: 'Launch', channels: ['Web'], sources: ['version-2', 'version-1'] }, ['version-1', 'version-2']],
  ])('rejects invalid persisted input on the real continuation load path: %s', async (_name, inputValues, sourceVersionIds) => {
    const fixture = persistedFixture(inputValues, sourceVersionIds);

    await expect(loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: 'project-1', runId: 'run-1', ...fixture,
    })).rejects.toMatchObject({ code: expect.stringMatching(/^SKILL_INPUT_/), field: expect.any(String) });
    expect(continuationMocks.createRegistry).not.toHaveBeenCalled();
  });

  it('reauthorizes the persisted Agent Request and passes its media mapping to the registry', async () => {
    const fixture = persistedFixture({
      campaignName: 'Launch', channels: ['Web'], sources: ['version-1', 'version-2'],
    }, ['version-1', 'version-2']);

    await loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: 'project-1', runId: 'run-1', ...fixture,
    });

    expect(continuationMocks.authorizeAgentContext).toHaveBeenCalledWith({
      actorUserId: actor.id,
      request: expect.objectContaining({
        projectId: 'project-1', workspace: 'canvas', workspaceId: 'canvas-1',
        sourceVersionIds: ['version-1', 'version-2'],
      }),
    });
    expect(continuationMocks.createRegistry).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      mediaByVersionId: {
        'version-1': '/api/serve-upload/version-1.png',
        'version-2': '/api/serve-upload/version-2.png',
      },
    }));
  });

  it('preserves an explicit model runtime while rebuilding the persisted request digest', async () => {
    const fixture = persistedFixture({
      campaignName: 'Launch', channels: ['Web'], sources: ['version-1'],
    }, ['version-1'], 'model');

    await expect(loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: 'project-1', runId: 'run-1', ...fixture,
    })).resolves.toMatchObject({ requestDigest: fixture.task.requestDigest });
    expect(continuationMocks.authorizeAgentContext).toHaveBeenCalledWith({
      actorUserId: actor.id,
      request: expect.objectContaining({ executionRuntime: 'model' }),
    });
  });

  it('accepts a normalized model event for a request digest that omitted executionRuntime', async () => {
    const fixture = persistedFixture({
      campaignName: 'Launch', channels: ['Web'], sources: ['version-1'],
    }, ['version-1'], undefined, 'model');

    await expect(loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: 'project-1', runId: 'run-1', ...fixture,
    })).resolves.toMatchObject({ requestDigest: fixture.task.requestDigest });
    expect(continuationMocks.authorizeAgentContext).toHaveBeenCalledWith({
      actorUserId: actor.id,
      request: expect.not.objectContaining({ executionRuntime: 'model' }),
    });
  });

  it('reconstructs a persisted local Skill without provider or model identity', async () => {
    const localSnapshot = {
      id: 'local-export', version: 1, name: 'Local export', executionContextVersion: 1,
      systemPrompt: 'Export locally', allowedSurfaces: ['canvas'], catalogSurfaces: ['canvas'],
      inputs: [],
      steps: [{
        id: 'export', label: 'Export', toolId: 'multi_platform_export', runtime: 'local',
        execution: 'sequential', promptTemplate: '', qualityGateIds: ['output-present'],
      }],
    };
    const request: AgentRunRequest = {
      projectId: 'project-1', workspace: 'canvas', workspaceId: 'canvas-1', mode: 'agent',
      executionRuntime: 'local', prompt: 'Export locally', sourceVersionIds: [],
      allowedToolIds: ['multi_platform_export'], idempotencyKey: 'local-continuation',
      context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
      skill: {
        skillId: localSnapshot.id, skillVersion: 1, inputValues: {}, modelBindings: {},
      },
    };
    const requestDigest = agentRunRequestDigest(request);
    const task: CloudTask = {
      id: 'run-local', userId: actor.id, projectId: request.projectId, type: 'agent-run',
      status: 'processing', progress: 40, creditStatus: 'charged', creditCost: 0,
      createdAt: 1, updatedAt: 2, idempotencyKey: request.idempotencyKey, requestDigest,
    };
    const events: AgentEvent[] = [{
      eventId: 'created-local', runId: task.id, sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: request.workspace, workspaceId: request.workspaceId,
        executionRuntime: 'local', prompt: request.prompt, sourceVersionIds: [],
        allowedToolIds: request.allowedToolIds, context: request.context, requestDigest,
        skill: request.skill, skillSnapshot: localSnapshot,
      },
    }];

    const continuation = await loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: request.projectId, runId: task.id, task, events,
    });

    expect(continuation.definition).toMatchObject({
      allowedSurfaces: ['canvas'], catalogSurfaces: ['canvas'],
      steps: [expect.objectContaining({ runtime: 'local' })],
    });
    expect(continuationMocks.authorizeAgentContext).toHaveBeenCalledWith({
      actorUserId: actor.id,
      request,
    });
  });

  it('stops continuation before registry creation when source media reauthorization fails', async () => {
    const fixture = persistedFixture({
      campaignName: 'Launch', channels: ['Web'], sources: ['version-1'],
    }, ['version-1']);
    continuationMocks.authorizeAgentContext.mockRejectedValue(Object.assign(
      new Error('Agent context not found'),
      { code: 'AGENT_CONTEXT_NOT_FOUND', status: 404 },
    ));

    await expect(loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: 'project-1', runId: 'run-1', ...fixture,
    })).rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND', status: 404 });
    expect(continuationMocks.createRegistry).not.toHaveBeenCalled();
  });
});
