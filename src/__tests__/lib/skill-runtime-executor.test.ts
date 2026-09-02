import { describe, expect, it, vi } from 'vitest';

import {
  createSkillExecutor,
  SkillQualityFailedError,
  skillStepRequestDigest,
  type SkillExecutorEventInput,
  type ExecuteSkillStepInput,
} from '@/lib/skill-runtime/executor';
import type { AgentDownstreamExecutionContext } from '@/lib/agent-runtime/downstream-operations';
import type { SkillDefinition, SkillStepResult } from '@/lib/skill-runtime/types';
import {
  createSkillRuntimeService,
  parseSkillRunRequest,
  SkillRunRequestError,
  type SkillRuntimeServiceDependencies,
} from '@/lib/skill-runtime/service';
import { agentRunRequestDigest } from '@/lib/agent-runtime/service';
import type { AgentEvent, AgentRunProjection, AgentRunRequest } from '@/lib/agent-runtime/types';
import type { CloudTask } from '@/lib/cloud-task-storage';
import {
  CANVAS_PRESET_SKILLS,
  requireSkillForSurface,
  SIMPLE_CHAT_PRESET_SKILLS,
} from '@/lib/skill-runtime/catalog';
import { createProductionSkillStepRegistry } from '@/lib/skill-runtime/step-registry';
import { skillExecutionSteps } from '@/lib/skill-runtime/cost-estimator';

vi.mock('server-only', () => ({}));

const definition: SkillDefinition = {
  id: 'preset-ecommerce-listing', version: 1, name: 'Ecommerce', category: 'image',
  description: 'test', systemPrompt: 'test', allowedSurfaces: ['canvas'], inputs: [],
  steps: [
    { id: 'plan', label: 'Plan', toolId: 'generate_image', execution: 'sequential', promptTemplate: 'plan', modelRole: 'orchestrator', qualityGateIds: [] },
    { id: 'generate-3', label: 'Generate', toolId: 'generate_image', execution: 'parallel', parallelGroup: 'images', promptTemplate: 'generate', modelRole: 'image', qualityGateIds: ['output-present'] },
    { id: 'generate-4', label: 'Generate alternate', toolId: 'generate_image', execution: 'parallel', parallelGroup: 'images', promptTemplate: 'alternate', modelRole: 'image', qualityGateIds: ['output-present'] },
    { id: 'quality-3', label: 'Quality', toolId: 'analyze_image', execution: 'sequential', promptTemplate: 'quality', modelRole: 'vision', qualityGateIds: ['output-present'] },
  ],
  enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
};

function operationContext(): AgentDownstreamExecutionContext {
  return {
    idempotencyKey: 'root-provider-key', operationKey: 'root-operation', recovery: false,
    executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 9 },
    signal: new AbortController().signal,
    beginSubmission: vi.fn(), recordAccepted: vi.fn(),
    executeOperation: vi.fn(async (step, execute) => execute({
      idempotencyKey: `provider:${step.stepId}`,
      operationKey: `operation:${step.stepId}`,
      recovery: false,
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 9 },
      signal: new AbortController().signal,
      beginSubmission: vi.fn(), recordAccepted: vi.fn(),
      executeOperation: vi.fn(),
    })),
  };
}

function operationContextWithSignal(signal: AbortSignal): AgentDownstreamExecutionContext {
  return { ...operationContext(), signal };
}

function result(id: string): SkillStepResult {
  return { assetVersionIds: [id], media: [{}] };
}

describe('durable Skill executor', () => {
  it('keeps step operation identity stable across generations and skips completed steps on retry', async () => {
    const executeStep = vi.fn(async ({ step }: ExecuteSkillStepInput) => result(`version-${step.id}`));
    const appendEvent = vi.fn(async () => true);
    const reconcile = vi.fn(async () => result('reconciled-version'));
    const recoverStep = vi.fn(() => ({ reconcile }));
    const executor = createSkillExecutor({ executeStep, appendEvent, recoverStep });
    const context = operationContext();

    await executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition, inputValues: {}, modelBindings: {}, operationContext: context,
      completedStepIds: ['plan'], resumeFromStepId: 'generate-3',
    });

    expect(executeStep.mock.calls.map(call => call[0].step.id)).toEqual(['generate-3', 'generate-4', 'quality-3']);
    expect(vi.mocked(context.executeOperation).mock.calls[0][2]).toEqual({ reconcile });
    expect(recoverStep).toHaveBeenCalledWith(expect.objectContaining({
      step: expect.objectContaining({ id: 'generate-3' }),
    }));
    const expectedDigest = skillStepRequestDigest({
      runId: 'run-1', definition, step: definition.steps[1], inputValues: {},
    });
    const firstStep = vi.mocked(executeStep).mock.calls[0][0];
    expect(firstStep.requestDigest).toBe(expectedDigest);
    expect(skillStepRequestDigest({
      runId: 'run-1', definition, step: definition.steps[1], inputValues: {},
    })).toBe(expectedDigest);
    expect(firstStep.operation.idempotencyKey).toBe('provider:generate-3');
  });

  it('resumes every unfinished sibling in the failed parallel group without rerunning completed siblings', async () => {
    const executeStep = vi.fn(async ({ step }: ExecuteSkillStepInput) => result(`version-${step.id}`));
    const executor = createSkillExecutor({
      executeStep,
      appendEvent: vi.fn(async () => true),
    });

    await executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition, inputValues: {}, modelBindings: {}, operationContext: operationContext(),
      completedStepIds: ['plan'], resumeFromStepId: 'generate-4',
    });
    expect(executeStep.mock.calls.map(call => call[0].step.id)).toEqual([
      'generate-3', 'generate-4', 'quality-3',
    ]);

    executeStep.mockClear();
    await executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition, inputValues: {}, modelBindings: {}, operationContext: operationContext(),
      completedStepIds: ['plan', 'generate-3'], resumeFromStepId: 'generate-4',
    });
    expect(executeStep.mock.calls.map(call => call[0].step.id)).toEqual([
      'generate-4', 'quality-3',
    ]);
  });

  it('aborts parallel siblings, records quality failure, and does not execute later groups', async () => {
    let siblingAborted = false;
    const appendEvent = vi.fn(async () => true);
    const failRun = vi.fn(async () => true);
    const pauseForRetry = vi.fn(async () => true);
    const completeRun = vi.fn(async () => true);
    const executeStep = vi.fn(async ({ step, signal }: { step: { id: string }; signal: AbortSignal }) => {
      if (step.id === 'plan') return result('version-plan');
      if (step.id === 'generate-3') return { assetVersionIds: [], media: [] };
      if (step.id === 'generate-4') {
        await new Promise<void>(resolve => signal.addEventListener('abort', () => { siblingAborted = true; resolve(); }, { once: true }));
        throw new DOMException('Aborted', 'AbortError');
      }
      throw new Error('later group must not execute');
    });
    const executor = createSkillExecutor({ executeStep, appendEvent, failRun, pauseForRetry, completeRun });

    await expect(executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition, inputValues: {}, modelBindings: {}, operationContext: operationContext(),
    })).rejects.toBeInstanceOf(SkillQualityFailedError);

    expect(siblingAborted).toBe(true);
    expect(executeStep.mock.calls.map(call => call[0].step.id)).not.toContain('quality-3');
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'quality.checked', payload: expect.objectContaining({ stepId: 'generate-3', passed: false }),
    }));
    expect(failRun).toHaveBeenCalledTimes(1);
    expect(failRun).toHaveBeenCalledWith(expect.objectContaining({
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 9 },
    }));
    expect(pauseForRetry).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
  });

  it('refuses a late completion after the active execution signal is aborted', async () => {
    const controller = new AbortController();
    const completeRun = vi.fn(async () => true);
    const failRun = vi.fn(async () => true);
    const executor = createSkillExecutor({
      appendEvent: vi.fn(async () => true), completeRun, failRun,
      executeStep: vi.fn(async ({ step }) => {
        if (step.id === 'quality-3') controller.abort(new DOMException('replaced', 'AbortError'));
        return result(`version-${step.id}`);
      }),
    });

    await expect(executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition, inputValues: {}, modelBindings: {},
      operationContext: operationContextWithSignal(controller.signal),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(completeRun).not.toHaveBeenCalled();
    expect(failRun).not.toHaveBeenCalled();
  });

  it('merges historical and current generation assets in stable order without duplicates', async () => {
    const completeRun = vi.fn(async () => true);
    const executor = createSkillExecutor({
      appendEvent: vi.fn(async () => true),
      completeRun,
      executeStep: vi.fn(async ({ step }) => (
        step.id === 'generate-3'
          ? { assetVersionIds: ['shared-version', 'new-version'], media: [{}, {}] }
          : result(`version-${step.id}`)
      )),
    });

    const execution = await executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition, inputValues: {}, modelBindings: {}, operationContext: operationContext(),
      completedStepIds: ['plan'], resumeFromStepId: 'generate-3',
      existingAssetVersionIds: ['old-version', 'shared-version'],
    });

    expect(execution.assetVersionIds).toEqual([
      'old-version', 'shared-version', 'new-version', 'version-generate-4', 'version-quality-3',
    ]);
    expect(completeRun).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ assetVersionIds: execution.assetVersionIds }),
    }));
  });

  it('persists a retry point for an execution error without settling or rerunning completed work', async () => {
    const appendEvent = vi.fn(async () => true);
    const failRun = vi.fn(async () => true);
    const pauseForRetry = vi.fn(async () => true);
    const executor = createSkillExecutor({
      appendEvent, failRun, pauseForRetry,
      executeStep: vi.fn(async ({ step }) => {
        if (step.id === 'generate-3') throw new Error('temporary provider failure');
        return result(`version-${step.id}`);
      }),
    });

    await expect(executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition, inputValues: {}, modelBindings: {}, operationContext: operationContext(),
    })).rejects.toThrow('temporary provider failure');

    expect(pauseForRetry).toHaveBeenCalledWith(expect.objectContaining({
      stepId: 'generate-3',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 9 },
    }));
    expect(failRun).not.toHaveBeenCalled();
  });

  it('registers production adapters for every tool used by all 37 built-in Skills', () => {
    const skills = [...CANVAS_PRESET_SKILLS, ...SIMPLE_CHAT_PRESET_SKILLS];
    const registry = createProductionSkillStepRegistry({
      actor: {
        id: 'user-1', name: 'User', role: 'user', status: 'active',
        productType: 'canvas,chat', createdAt: 1, updatedAt: 1,
      },
      request: {
        skillId: definition.id, skillVersion: definition.version, surface: 'canvas',
        projectId: 'project-1', workspaceId: 'canvas-1', inputValues: {},
        sourceVersionIds: [], modelBindings: {}, idempotencyKey: 'registry-audit',
      },
    });
    const toolIds = new Set(skills.flatMap(skill => skillExecutionSteps(skill).map(step => step.toolId)));

    expect(skills).toHaveLength(37);
    expect([...toolIds].sort()).toEqual(['chat', 'generate_image']);
    for (const toolId of toolIds) {
      expect(registry.stepAdapters).toHaveProperty(toolId);
    }
    expect(registry.stepRecoveries).toHaveProperty('generate_image');
  });

  it('returns ordinary orchestrator chat content as text instead of html', async () => {
    const apiHelpers = await import('@/lib/api-helpers');
    const serverApiConfig = await import('@/lib/server-api-config');
    const fetchSpy = vi.spyOn(apiHelpers, 'fetchWithV1Retry').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '完成内容' } }],
    }), { status: 200 }));
    const providersSpy = vi.spyOn(serverApiConfig, 'getApiProviders').mockResolvedValue([{
      id: 'provider-1', name: 'Provider', baseUrl: 'https://example.test', apiKey: 'secret',
      type: 'chat', isEnabled: true, selectedModels: ['chat-1'], createdAt: 1, updatedAt: 1,
    }]);
    const simpleChatSkill = requireSkillForSurface('ppt-master', 'simple-chat');
    const normalized = { ...simpleChatSkill, steps: skillExecutionSteps(simpleChatSkill) };
    const registry = createProductionSkillStepRegistry({
      actor: {
        id: 'user-1', name: 'User', role: 'user', status: 'active',
        productType: 'canvas,chat', createdAt: 1, updatedAt: 1,
      },
      request: {
        skillId: normalized.id, skillVersion: normalized.version, surface: 'simple-chat',
        projectId: 'project-1', workspaceId: 'chat-1', inputValues: {}, sourceVersionIds: [],
        modelBindings: {}, idempotencyKey: 'chat-adapter-test',
      },
    });
    const operation = operationContext();

    try {
      await expect(registry.stepAdapters.chat({
        actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
        definition: normalized, step: normalized.steps[0], inputValues: {},
        modelBinding: { providerId: 'provider-1', modelId: 'chat-1' },
        requestDigest: 'digest', operation, signal: operation.signal!,
      })).resolves.toEqual({ assetVersionIds: [], media: [], text: '完成内容' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      providersSpy.mockRestore();
    }
  });

  it('executes a normalized simple-chat Skill through one shared orchestrator step and one terminal write', async () => {
    const simpleChatSkill = requireSkillForSurface('ppt-master', 'simple-chat');
    const normalized = { ...simpleChatSkill, steps: skillExecutionSteps(simpleChatSkill) };
    const executeStep = vi.fn(async ({ step }: ExecuteSkillStepInput) => {
      expect(step).toMatchObject({ id: 'orchestrator', toolId: 'chat', modelRole: 'orchestrator' });
      return { assetVersionIds: [], media: [], text: '完成内容' };
    });
    const completeRun = vi.fn(async () => true);
    const executor = createSkillExecutor({
      executeStep, completeRun, appendEvent: vi.fn(async () => true),
    });

    const execution = await executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'chat',
      definition: normalized, inputValues: {},
      modelBindings: { orchestrator: { providerId: 'provider-1', modelId: 'chat-1' } },
      operationContext: operationContext(),
    });

    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(completeRun).toHaveBeenCalledTimes(1);
    expect(execution).toMatchObject({
      startedStepIds: ['orchestrator'], completedStepIds: ['orchestrator'], assetVersionIds: [],
      outputs: [{ stepId: 'orchestrator', kind: 'text', content: '完成内容' }],
    });
    expect(completeRun).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ outputs: execution.outputs }),
    }));
  });

  it('merges historical and new outputs in definition order and deduplicates by stepId plus kind', async () => {
    const completeRun = vi.fn(async () => true);
    const executor = createSkillExecutor({
      appendEvent: vi.fn(async () => true), completeRun,
      executeStep: vi.fn(async ({ step }) => ({
        assetVersionIds: [`version-${step.id}`], media: [{}],
        ...(step.id === 'generate-3' ? { text: 'new image note' } : {}),
        ...(step.id === 'generate-4' ? { html: '<p>new alternate</p>' } : {}),
      })),
    });

    const execution = await executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition, inputValues: {}, modelBindings: {}, operationContext: operationContext(),
      completedStepIds: ['plan'], resumeFromStepId: 'generate-3',
      existingOutputs: [
        { stepId: 'generate-4', kind: 'html', content: '<p>historical alternate</p>' },
        { stepId: 'plan', kind: 'text', content: 'historical plan' },
        { stepId: 'plan', kind: 'text', content: 'duplicate plan' },
      ],
    });

    expect(execution.outputs).toEqual([
      { stepId: 'plan', kind: 'text', content: 'historical plan' },
      { stepId: 'generate-3', kind: 'text', content: 'new image note' },
      { stepId: 'generate-4', kind: 'html', content: '<p>historical alternate</p>' },
    ]);
    expect(completeRun).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ outputs: execution.outputs }),
    }));
  });

  it('sanitizes current and historical HTML before merge and final persistence', async () => {
    const completeRun = vi.fn(async () => true);
    const appendedEvents: SkillExecutorEventInput[] = [];
    const appendEvent = vi.fn(async (event: SkillExecutorEventInput) => {
      appendedEvents.push(event);
      return true;
    });
    const executor = createSkillExecutor({
      appendEvent, completeRun,
      executeStep: vi.fn(async ({ step }) => ({
        assetVersionIds: [`version-${step.id}`], media: [{}],
        ...(step.id === 'generate-4' ? {
          html: [
            '<div onload="steal()">current</div>',
            '<style>body{display:none}</style>',
            '<iframe src="https://attacker.example"></iframe>',
            '<embed src="https://attacker.example">',
            '<template><p>hidden attack</p></template>',
            '<a href="javascript:steal()">unsafe link</a>',
            '<a href="data:text/html,steal()">unsafe data</a>',
            '<a href="/safe/path">safe link</a>',
            '<img src="https://cdn.example/safe.png" onerror="steal()">',
          ].join(''),
        } : {}),
      })),
    });

    const execution = await executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition, inputValues: {}, modelBindings: {}, operationContext: operationContext(),
      completedStepIds: ['plan'], resumeFromStepId: 'generate-3',
      existingOutputs: [{
        stepId: 'plan', kind: 'html',
        content: [
          '<p onload="steal()">historical</p>',
          '<script>steal()</script>',
          '<object data="https://attacker.example"></object>',
          '<img src="javascript:steal()" onerror="steal()">',
          '<img src="vbscript:steal()">',
          '<a href="mailto:safe@example.com">mail</a>',
        ].join(''),
      }],
    });

    const historical = execution.outputs.find(output => output.stepId === 'plan');
    const current = execution.outputs.find(output => output.stepId === 'generate-4');
    expect(historical?.content).toContain('<p>historical</p>');
    expect(historical?.content).toContain('href="mailto:safe@example.com"');
    expect(current?.content).toContain('href="/safe/path"');
    expect(current?.content).toContain('src="https://cdn.example/safe.png"');
    for (const output of [historical, current]) {
      expect(output?.content).not.toMatch(/<(?:script|style|iframe|object|embed|template)\b/i);
      expect(output?.content).not.toMatch(/\son(?:error|load)\s*=/i);
      expect(output?.content).not.toMatch(/(?:href|src)\s*=\s*["'](?:javascript|data|vbscript):/i);
    }
    expect(completeRun).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ outputs: execution.outputs }),
    }));
    const completedEvent = appendedEvents
      .find(event => event.type === 'tool.completed' && event.payload.stepId === 'generate-4');
    expect(completedEvent?.payload.outputs).toEqual([current]);
  });
});

describe('Skill run history', () => {
  it('validates the durable Skill continuation before changing a paused run to resumed', async () => {
    const task: CloudTask = {
      id: 'run-resume', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'processing', progress: 40, creditStatus: 'charged', creditCost: 3,
      createdAt: 10, updatedAt: 20,
    };
    const events: AgentEvent[] = [{
      eventId: 'created', runId: task.id, sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: 'canvas',
        skill: { skillId: definition.id, skillVersion: 1, inputValues: {}, modelBindings: {} },
        skillSnapshot: { id: definition.id, version: 1, name: definition.name, steps: definition.steps },
      },
    }];
    const projection: AgentRunProjection = {
      runId: task.id, status: 'paused', lastSequence: 2, plan: [],
      resumeFromStepId: 'generate-3', assetVersionIds: [], ignoredEventIds: [],
      missingSequences: [], qualityChecks: [],
    };
    const resumeRun = vi.fn();
    const prepareResume = vi.fn(async () => { throw new Error('frozen continuation is invalid'); });
    const dependencies: SkillRuntimeServiceDependencies = {
      createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task),
      listTasks: vi.fn(async () => [task]), listEvents: vi.fn(async () => events),
      getProjection: vi.fn(async () => projection), pauseRun: vi.fn(), resumeRun,
      cancelRun: vi.fn(), prepareResume,
    };

    await expect(createSkillRuntimeService(dependencies).resume({
      actorUserId: 'user-1', runId: task.id,
    })).rejects.toThrow('frozen continuation is invalid');
    expect(prepareResume).toHaveBeenCalledWith({
      actorUserId: 'user-1', projectId: 'project-1', runId: task.id,
      nextStepId: 'generate-3',
    });
    expect(resumeRun).not.toHaveBeenCalled();
  });

  it('separates the initial parallel retry group from the complete retry schedule', async () => {
    const task: CloudTask = {
      id: 'run-parallel-retry', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'processing', progress: 40, creditStatus: 'charged', creditCost: 3,
      createdAt: 10, updatedAt: 20,
    };
    const created: AgentEvent = {
      eventId: 'created', runId: task.id, sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: 'canvas', workspaceId: 'canvas-1',
        skill: { skillId: definition.id, skillVersion: 1, inputValues: {}, modelBindings: {} },
        skillSnapshot: { id: definition.id, version: 1, name: definition.name, steps: definition.steps },
      },
    };
    const paused: AgentRunProjection = {
      runId: task.id, status: 'paused', lastSequence: 3, plan: [], currentStepId: 'generate-4',
      resumeFromStepId: 'generate-4', assetVersionIds: [], ignoredEventIds: [],
      missingSequences: [], qualityChecks: [],
    };
    const makeService = (completedStepIds: string[]) => {
      const events: AgentEvent[] = [
        created,
        ...completedStepIds.map((stepId, index) => ({
          eventId: `completed-${stepId}`, runId: task.id, sequence: index + 2,
          type: 'tool.completed' as const, timestamp: 'now', payload: { stepId },
        })),
        {
          eventId: 'paused', runId: task.id, sequence: completedStepIds.length + 2,
          type: 'run.paused' as const, timestamp: 'now',
          payload: { nextStepId: 'generate-4', pauseReason: 'execution-error' },
        },
      ];
      return createSkillRuntimeService({
        createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task),
        listTasks: vi.fn(async () => [task]), listEvents: vi.fn(async () => events),
        getProjection: vi.fn(async () => paused), pauseRun: vi.fn(),
        resumeRun: vi.fn(async () => ({ accepted: true } as never)), cancelRun: vi.fn(),
        prepareResume: vi.fn(async () => true),
      });
    };

    await expect(makeService(['plan']).retry({
      actorUserId: 'user-1', runId: task.id, stepId: 'generate-4',
    })).resolves.toEqual({
      accepted: true,
      startedStepIds: ['generate-3', 'generate-4'],
      scheduledStepIds: ['generate-3', 'generate-4', 'quality-3'],
    });
    await expect(makeService(['plan', 'generate-3']).retry({
      actorUserId: 'user-1', runId: task.id, stepId: 'generate-4',
    })).resolves.toEqual({
      accepted: true,
      startedStepIds: ['generate-4'],
      scheduledStepIds: ['generate-4', 'quality-3'],
    });
  });

  it('reports only the first sequential step as started while scheduling all unfinished work', async () => {
    const task: CloudTask = {
      id: 'run-sequential-retry', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'processing', progress: 10, creditStatus: 'charged', creditCost: 3,
      createdAt: 10, updatedAt: 20,
    };
    const events: AgentEvent[] = [{
      eventId: 'created', runId: task.id, sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: 'canvas', workspaceId: 'canvas-1',
        skill: { skillId: definition.id, skillVersion: 1, inputValues: {}, modelBindings: {} },
        skillSnapshot: { id: definition.id, version: 1, name: definition.name, steps: definition.steps },
      },
    }, {
      eventId: 'paused', runId: task.id, sequence: 2, type: 'run.paused', timestamp: 'now',
      payload: { nextStepId: 'plan', pauseReason: 'execution-error' },
    }];
    const projection: AgentRunProjection = {
      runId: task.id, status: 'paused', lastSequence: 2, plan: [], currentStepId: 'plan',
      resumeFromStepId: 'plan', assetVersionIds: [], ignoredEventIds: [],
      missingSequences: [], qualityChecks: [],
    };
    const service = createSkillRuntimeService({
      createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task),
      listTasks: vi.fn(async () => [task]), listEvents: vi.fn(async () => events),
      getProjection: vi.fn(async () => projection), pauseRun: vi.fn(),
      resumeRun: vi.fn(async () => ({ accepted: true } as never)), cancelRun: vi.fn(),
      prepareResume: vi.fn(async () => true),
    });

    await expect(service.retry({
      actorUserId: 'user-1', runId: task.id, stepId: 'plan',
    })).resolves.toEqual({
      accepted: true,
      startedStepIds: ['plan'],
      scheduledStepIds: ['plan', 'generate-3', 'generate-4', 'quality-3'],
    });
  });

  it('uses the frozen Skill step snapshot and exposes only lineage plus final credit state', async () => {
    const task: CloudTask = {
      id: 'run-1', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'completed', progress: 100, creditStatus: 'charged', creditCost: 7,
      createdAt: 10, updatedAt: 20,
    };
    const events: AgentEvent[] = [{
      eventId: 'created', runId: 'run-1', sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: 'canvas',
        skill: { skillId: definition.id, skillVersion: 1, inputValues: {}, modelBindings: {} },
        skillSnapshot: {
          id: definition.id, version: 1, name: 'Frozen name',
          steps: [{ id: 'frozen-step', label: 'Frozen step' }],
        },
      },
    }];
    const projection: AgentRunProjection = {
      runId: 'run-1', status: 'completed', lastSequence: 4, plan: [],
      assetVersionIds: ['result-version-1'], ignoredEventIds: [], missingSequences: [],
      qualityChecks: [{ stepId: 'frozen-step', gateId: 'output-present', passed: true }],
      result: {
        assetVersionIds: ['result-version-1'],
        outputs: [{ stepId: 'frozen-step', kind: 'text', content: 'durable response' }],
        apiKey: 'must-not-leak', upstreamResponse: { choices: ['must-not-leak'] },
      },
    };
    const dependencies: SkillRuntimeServiceDependencies = {
      createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task),
      listTasks: vi.fn(async () => [task]), listEvents: vi.fn(async () => events),
      getProjection: vi.fn(async () => projection), pauseRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(),
    };
    const history = await createSkillRuntimeService(dependencies).get({ actorUserId: 'user-1', runId: 'run-1' });

    expect(history).toMatchObject({
      skillId: definition.id, skillVersion: 1, creditStatus: 'charged', creditCost: 7,
      assetVersionIds: ['result-version-1'],
      outputs: [{ stepId: 'frozen-step', kind: 'text', content: 'durable response' }],
      steps: [{ id: 'frozen-step', label: 'Frozen step', status: 'pending' }],
      qualityEvents: [{ stepId: 'frozen-step', gateId: 'output-present', passed: true }],
    });
    expect(history).not.toHaveProperty('modelBindings');
    expect(history).not.toHaveProperty('descriptor');
    expect(history).not.toHaveProperty('apiKey');
    expect(history).not.toHaveProperty('upstreamResponse');
  });

  it('keeps frozen history readable after the catalog no longer contains that Skill version', async () => {
    const task: CloudTask = {
      id: 'run-removed', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'completed', progress: 100, creditStatus: 'charged', creditCost: 3,
      createdAt: 10, updatedAt: 20,
    };
    const events: AgentEvent[] = [{
      eventId: 'created', runId: task.id, sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: 'canvas',
        skill: { skillId: 'removed-skill', skillVersion: 7, inputValues: {}, modelBindings: {} },
        skillSnapshot: {
          id: 'removed-skill', version: 7, name: 'Removed Skill',
          steps: [{ id: 'archived-step', label: 'Archived step' }],
        },
      },
    }];
    const projection: AgentRunProjection = {
      runId: task.id, status: 'completed', lastSequence: 1, plan: [],
      assetVersionIds: [], ignoredEventIds: [], missingSequences: [], qualityChecks: [],
    };
    const dependencies: SkillRuntimeServiceDependencies = {
      createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task),
      listTasks: vi.fn(async () => [task]), listEvents: vi.fn(async () => events),
      getProjection: vi.fn(async () => projection), pauseRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(),
    };

    await expect(createSkillRuntimeService(dependencies).get({
      actorUserId: 'user-1', runId: task.id,
    })).resolves.toMatchObject({
      skillId: 'removed-skill', skillVersion: 7,
      steps: [{ id: 'archived-step', label: 'Archived step', status: 'pending' }],
    });
  });

  it('projects a quality-failed paused step as failed instead of processing', async () => {
    const task: CloudTask = {
      id: 'run-failed-step', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'processing', progress: 20, creditStatus: 'charged', creditCost: 3,
      createdAt: 10, updatedAt: 20,
    };
    const events: AgentEvent[] = [{
      eventId: 'created', runId: task.id, sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: 'canvas',
        skill: { skillId: definition.id, skillVersion: 1, inputValues: {}, modelBindings: {} },
        skillSnapshot: { id: definition.id, version: 1, name: definition.name, steps: definition.steps },
      },
    }, {
      eventId: 'quality', runId: task.id, sequence: 2, type: 'quality.checked', timestamp: 'now',
      payload: { stepId: 'generate-3', gateId: 'output-present', passed: false },
    }, {
      eventId: 'paused', runId: task.id, sequence: 3, type: 'run.paused', timestamp: 'now',
      payload: { nextStepId: 'generate-3' },
    }];
    const projection: AgentRunProjection = {
      runId: task.id, status: 'paused', lastSequence: 3, plan: [], currentStepId: 'generate-3',
      resumeFromStepId: 'generate-3', assetVersionIds: [], ignoredEventIds: [], missingSequences: [],
      qualityChecks: [{ stepId: 'generate-3', gateId: 'output-present', passed: false }],
    };
    const dependencies: SkillRuntimeServiceDependencies = {
      createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task),
      listTasks: vi.fn(async () => [task]), listEvents: vi.fn(async () => events),
      getProjection: vi.fn(async () => projection), pauseRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(),
    };

    await expect(createSkillRuntimeService(dependencies).get({
      actorUserId: 'user-1', runId: task.id,
    })).resolves.toMatchObject({
      steps: expect.arrayContaining([expect.objectContaining({ id: 'generate-3', status: 'failed' })]),
    });
  });

  it('keeps a user-paused unfinished step pending instead of projecting it as failed', async () => {
    const task: CloudTask = {
      id: 'run-user-paused', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'processing', progress: 20, creditStatus: 'charged', creditCost: 3,
      createdAt: 10, updatedAt: 20,
    };
    const events: AgentEvent[] = [{
      eventId: 'created', runId: task.id, sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: 'canvas',
        skill: { skillId: definition.id, skillVersion: 1, inputValues: {}, modelBindings: {} },
        skillSnapshot: { id: definition.id, version: 1, name: definition.name, steps: definition.steps },
      },
    }, {
      eventId: 'paused', runId: task.id, sequence: 2, type: 'run.paused', timestamp: 'now',
      payload: { nextStepId: 'generate-3', pauseReason: 'user' },
    }];
    const projection: AgentRunProjection = {
      runId: task.id, status: 'paused', lastSequence: 2, plan: [], currentStepId: 'generate-3',
      resumeFromStepId: 'generate-3', assetVersionIds: [], ignoredEventIds: [],
      missingSequences: [], qualityChecks: [],
    };
    const dependencies: SkillRuntimeServiceDependencies = {
      createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task),
      listTasks: vi.fn(async () => [task]), listEvents: vi.fn(async () => events),
      getProjection: vi.fn(async () => projection), pauseRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(),
    };

    await expect(createSkillRuntimeService(dependencies).get({
      actorUserId: 'user-1', runId: task.id,
    })).resolves.toMatchObject({
      steps: expect.arrayContaining([expect.objectContaining({ id: 'generate-3', status: 'pending' })]),
    });
  });

  it('projects only an execution-error pause resume step as failed', async () => {
    const task: CloudTask = {
      id: 'run-error-paused', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'processing', progress: 20, creditStatus: 'charged', creditCost: 3,
      createdAt: 10, updatedAt: 20,
    };
    const events: AgentEvent[] = [{
      eventId: 'created', runId: task.id, sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: 'canvas',
        skill: { skillId: definition.id, skillVersion: 1, inputValues: {}, modelBindings: {} },
        skillSnapshot: { id: definition.id, version: 1, name: definition.name, steps: definition.steps },
      },
    }, {
      eventId: 'paused', runId: task.id, sequence: 2, type: 'run.paused', timestamp: 'now',
      payload: { nextStepId: 'generate-3', pauseReason: 'execution-error' },
    }];
    const projection: AgentRunProjection = {
      runId: task.id, status: 'paused', lastSequence: 2, plan: [], currentStepId: 'generate-3',
      resumeFromStepId: 'generate-3', assetVersionIds: [], ignoredEventIds: [],
      missingSequences: [], qualityChecks: [],
    };
    const dependencies: SkillRuntimeServiceDependencies = {
      createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task),
      listTasks: vi.fn(async () => [task]), listEvents: vi.fn(async () => events),
      getProjection: vi.fn(async () => projection), pauseRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(),
    };

    await expect(createSkillRuntimeService(dependencies).get({
      actorUserId: 'user-1', runId: task.id,
    })).resolves.toMatchObject({
      steps: expect.arrayContaining([expect.objectContaining({ id: 'generate-3', status: 'failed' })]),
    });
  });

  it('rejects unknown fields inside model bindings instead of silently dropping them', () => {
    expect(() => parseSkillRunRequest({
      skillId: definition.id,
      skillVersion: 1,
      surface: 'canvas',
      projectId: 'project-1',
      workspaceId: 'canvas-1',
      inputValues: {},
      sourceVersionIds: [],
      modelBindings: {
        orchestrator: {
          providerId: 'provider-1',
          modelId: 'model-1',
          actorUserId: 'attacker',
        },
      },
      idempotencyKey: 'request-1',
    })).toThrow(SkillRunRequestError);
  });

  it('derives one canonical request digest for create and recovery validation', () => {
    const request: AgentRunRequest = {
      projectId: 'project-1', workspace: 'canvas', workspaceId: 'canvas-1', mode: 'agent',
      providerId: 'provider-1', modelId: 'model-1', prompt: 'prompt', sourceVersionIds: [],
      allowedToolIds: ['generate_image'], idempotencyKey: 'key-1',
      context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
    };
    expect(agentRunRequestDigest(request)).toBe(agentRunRequestDigest(structuredClone(request)));
    expect(agentRunRequestDigest({ ...request, prompt: 'different' })).not.toBe(agentRunRequestDigest(request));
  });
});
