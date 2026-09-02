import { describe, expect, it, vi } from 'vitest';

import {
  createSkillExecutor,
  SkillQualityFailedError,
  skillStepRequestDigest,
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
import { CANVAS_PRESET_SKILLS, SIMPLE_CHAT_PRESET_SKILLS } from '@/lib/skill-runtime/catalog';
import { createProductionSkillStepRegistry } from '@/lib/skill-runtime/step-registry';

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
    const toolIds = new Set(skills.flatMap(skill => skill.steps.map(step => step.toolId)));

    expect(skills).toHaveLength(37);
    expect([...toolIds].sort()).toEqual(['generate_image']);
    for (const toolId of toolIds) {
      expect(registry.stepAdapters).toHaveProperty(toolId);
      expect(registry.stepRecoveries).toHaveProperty(toolId);
    }
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
      steps: [{ id: 'frozen-step', label: 'Frozen step', status: 'pending' }],
      qualityEvents: [{ stepId: 'frozen-step', gateId: 'output-present', passed: true }],
    });
    expect(history).not.toHaveProperty('modelBindings');
    expect(history).not.toHaveProperty('descriptor');
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
