import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { AgentDownstreamExecutionContext } from '@/lib/agent-runtime/downstream-operations';
import type { AgentEvent, AgentRunProjection } from '@/lib/agent-runtime/types';
import type { CloudTask } from '@/lib/cloud-task-storage';
import {
  createSkillApprovalState,
  parseSkillApprovalState,
} from '@/lib/skill-runtime/approval';
import { createSkillExecutor } from '@/lib/skill-runtime/executor';
import {
  createSkillRuntimeService,
  type SkillRuntimeServiceDependencies,
} from '@/lib/skill-runtime/service';
import type { SkillDefinition } from '@/lib/skill-runtime/types';
import { frozenDefinition } from '@/lib/skill-runtime/continuation';

vi.mock('server-only', () => ({}));

const plan = {
  schemaId: 'brief-to-video-plan-v1', title: '成片', logline: '产品短片',
  durationSeconds: 10, aspectRatio: '16:9',
  scenes: [{ order: 1, timeRange: '0-10s', visual: '产品', camera: '推进', action: '旋转' }],
  finalVideoPrompt: '产品成片', negativePrompt: '闪烁', factualConstraints: [],
};

const definition: SkillDefinition = {
  id: 'preset-brief-to-video-film', version: 1, name: 'Brief', category: 'video',
  description: '', systemPrompt: '', allowedSurfaces: ['canvas'], inputs: [],
  steps: [{
    id: 'plan-film', label: '规划', toolId: 'brief_video_plan', execution: 'sequential',
    promptTemplate: '', modelRole: 'orchestrator', qualityGateIds: ['structured-output-present'],
    approvalCheckpoint: {
      kind: 'user-approval', outputSchemaId: 'brief-to-video-plan-v1',
      nextStepId: 'generate-film', allowRevision: true,
    },
  }, {
    id: 'generate-film', label: '生成', toolId: 'video_generate', execution: 'sequential',
    promptTemplate: '', modelRole: 'video', qualityGateIds: ['output-present'],
  }],
  enabled: true, builtIn: true, createdAt: 0, updatedAt: 0, usageCount: 0,
};

function operationContext(): AgentDownstreamExecutionContext {
  return {
    idempotencyKey: 'root', operationKey: 'root', recovery: false,
    executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 3 },
    signal: new AbortController().signal, beginSubmission: vi.fn(), recordAccepted: vi.fn(),
    executeOperation: vi.fn(async (step, execute) => execute({
      idempotencyKey: `operation:${step.stepId}`, operationKey: step.stepId, recovery: false,
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 3 },
      signal: new AbortController().signal, beginSubmission: vi.fn(), recordAccepted: vi.fn(),
      executeOperation: vi.fn(),
    })),
  };
}

describe('Skill approval checkpoints', () => {
  it('stops after the approved-output step and never submits the next step', async () => {
    const executeStep = vi.fn(async ({ step }: { step: { id: string } }) => {
      if (step.id === 'generate-film') throw new Error('video must not start before approval');
      return { assetVersionIds: [], media: [], structured: { schemaId: 'brief-to-video-plan-v1', value: plan } };
    });
    const pauseForApproval = vi.fn(async () => true);
    const completeRun = vi.fn(async () => true);
    const result = await createSkillExecutor({
      executeStep, appendEvent: vi.fn(async () => true), pauseForApproval, completeRun,
    }).execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition, inputValues: {}, modelBindings: {}, operationContext: operationContext(),
    });

    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(result.completedStepIds).toEqual(['plan-film']);
    expect(pauseForApproval).toHaveBeenCalledWith(expect.objectContaining({
      stepId: 'plan-film', nextStepId: 'generate-film', generation: 3,
      outputSchemaId: 'brief-to-video-plan-v1',
      planChecksum: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    }));
    expect(completeRun).not.toHaveBeenCalled();
  });

  it('parses a bounded persisted approval state and rejects stale commands', () => {
    const state = createSkillApprovalState({
      stepId: 'plan-film', nextStepId: 'generate-film', outputSchemaId: 'brief-to-video-plan-v1',
      planChecksum: 'a'.repeat(64), revision: 8, generation: 3, allowRevision: true,
    });
    expect(parseSkillApprovalState(state)).toEqual(state);
    expect(() => parseSkillApprovalState({ ...state, planChecksum: 'b'.repeat(64), revision: 7 }))
      .not.toThrow();
    expect(() => parseSkillApprovalState({ ...state, revision: -1 }))
      .toThrow('SKILL_APPROVAL_STATE_INVALID');
  });

  it('accepts the initial execution generation used before the first resume', () => {
    const state = createSkillApprovalState({
      stepId: 'plan-film', nextStepId: 'generate-film', outputSchemaId: 'brief-to-video-plan-v1',
      planChecksum: 'a'.repeat(64), revision: 1, generation: 0, allowRevision: true,
    });

    expect(state.generation).toBe(0);
  });

  it('preserves approval checkpoints in the frozen restart snapshot', () => {
    const restored = frozenDefinition({
      ...definition, executionContextVersion: 1, inputs: [],
    }, 'canvas', definition.id, definition.version);
    expect(restored.steps[0]?.approvalCheckpoint).toEqual(definition.steps[0]?.approvalCheckpoint);
  });

  it('approves the exact pending revision once and treats its replay as idempotent', async () => {
    const approval = createSkillApprovalState({
      stepId: 'plan-film', nextStepId: 'generate-film', outputSchemaId: 'brief-to-video-plan-v1',
      planChecksum: 'a'.repeat(64), revision: 8, generation: 3, allowRevision: true,
    });
    const task: CloudTask = {
      id: 'run-1', userId: 'user-1', projectId: 'project-1', type: 'agent-run', status: 'processing',
      progress: 50, creditStatus: 'charged', creditCost: 15, revision: 8, createdAt: 1, updatedAt: 2,
    };
    const created: AgentEvent = {
      eventId: 'created', runId: 'run-1', sequence: 1, type: 'run.created', timestamp: 'now',
      payload: { workspace: 'canvas', workspaceId: 'canvas-1', skill: {
        skillId: definition.id, skillVersion: 1, inputValues: {}, modelBindings: {},
      }, skillSnapshot: { id: definition.id, version: 1, name: definition.name, steps: definition.steps } },
    };
    const paused: AgentEvent = {
      eventId: 'paused', runId: 'run-1', sequence: 2, type: 'run.paused', timestamp: 'now',
      payload: { nextStepId: 'generate-film', pauseReason: 'approval', approval },
    };
    const projection: AgentRunProjection = {
      runId: 'run-1', status: 'paused', lastSequence: 2, plan: [], resumeFromStepId: 'generate-film',
      assetVersionIds: [], ignoredEventIds: [], missingSequences: [], qualityChecks: [],
    };
    const resumeRun = vi.fn(async () => ({ accepted: true, dispatch: { started: true } } as never));
    const dependencies = {
      createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task), listTasks: vi.fn(),
      listEvents: vi.fn(async () => [created, paused]), getProjection: vi.fn(async () => projection),
      pauseRun: vi.fn(), resumeRun, cancelRun: vi.fn(), prepareResume: vi.fn(async () => true),
    } as SkillRuntimeServiceDependencies;
    const service = createSkillRuntimeService(dependencies);

    await expect(service.approve({
      actorUserId: 'user-1', runId: 'run-1', revision: 8,
      generation: 3, planChecksum: 'a'.repeat(64),
    })).resolves.toMatchObject({ accepted: true });
    expect(resumeRun).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1', runId: 'run-1', nextStepId: 'generate-film',
      approval: expect.objectContaining({ action: 'approve', revision: 8 }),
    }));

    dependencies.listEvents = vi.fn(async (): Promise<AgentEvent[]> => [created, paused, {
      eventId: 'resumed', runId: 'run-1', sequence: 3, type: 'run.resumed', timestamp: 'now',
      payload: { nextStepId: 'generate-film', generation: 4, approval: {
        action: 'approve', revision: 8, generation: 3, planChecksum: 'a'.repeat(64),
      } },
    }]);
    dependencies.getProjection = vi.fn(async (): Promise<AgentRunProjection> => ({
      ...projection, status: 'queued',
    }));
    const replay = createSkillRuntimeService(dependencies);
    await expect(replay.approve({
      actorUserId: 'user-1', runId: 'run-1', revision: 8,
      generation: 3, planChecksum: 'a'.repeat(64),
    })).resolves.toMatchObject({ accepted: true, dispatched: false });
    expect(resumeRun).toHaveBeenCalledTimes(1);
  });

  it('rejects an old checksum without dispatching', async () => {
    const approval = createSkillApprovalState({
      stepId: 'plan-film', nextStepId: 'generate-film', outputSchemaId: 'brief-to-video-plan-v1',
      planChecksum: 'a'.repeat(64), revision: 8, generation: 3, allowRevision: true,
    });
    const task = { id: 'run-1', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'processing', progress: 50, creditStatus: 'charged', revision: 8, createdAt: 1, updatedAt: 2 } as CloudTask;
    const events = [{ eventId: 'created', runId: 'run-1', sequence: 1, type: 'run.created', timestamp: 'now',
      payload: { workspace: 'canvas', workspaceId: 'canvas-1', skill: {
        skillId: definition.id, skillVersion: 1, inputValues: {}, modelBindings: {},
      }, skillSnapshot: { id: definition.id, version: 1, name: definition.name, steps: definition.steps } },
    }, { eventId: 'paused', runId: 'run-1', sequence: 2, type: 'run.paused', timestamp: 'now',
      payload: { nextStepId: 'generate-film', pauseReason: 'approval', approval } }] as AgentEvent[];
    const resumeRun = vi.fn();
    const service = createSkillRuntimeService({
      createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task), listTasks: vi.fn(),
      listEvents: vi.fn(async () => events), getProjection: vi.fn(async () => ({
        runId: 'run-1', status: 'paused', lastSequence: 2, plan: [], resumeFromStepId: 'generate-film',
        assetVersionIds: [], ignoredEventIds: [], missingSequences: [], qualityChecks: [],
      })), pauseRun: vi.fn(), resumeRun, cancelRun: vi.fn(),
    } as SkillRuntimeServiceDependencies);
    await expect(service.approve({ actorUserId: 'user-1', runId: 'run-1', revision: 8,
      generation: 3, planChecksum: 'b'.repeat(64) }))
      .rejects.toMatchObject({ code: 'SKILL_APPROVAL_CONFLICT', status: 409 });
    expect(resumeRun).not.toHaveBeenCalled();
  });

  it('revises from the planning step with a frozen bounded instruction', async () => {
    const approval = createSkillApprovalState({
      stepId: 'plan-film', nextStepId: 'generate-film', outputSchemaId: 'brief-to-video-plan-v1',
      planChecksum: 'a'.repeat(64), revision: 8, generation: 3, allowRevision: true,
    });
    const task = { id: 'run-1', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'processing', progress: 50, creditStatus: 'charged', revision: 8,
      createdAt: 1, updatedAt: 2 } as CloudTask;
    const events: AgentEvent[] = [{
      eventId: 'created', runId: 'run-1', sequence: 1, type: 'run.created', timestamp: 'now',
      payload: { workspace: 'canvas', workspaceId: 'canvas-1', skill: {
        skillId: definition.id, skillVersion: 1, inputValues: {}, modelBindings: {},
      }, skillSnapshot: { ...definition, executionContextVersion: 1 } },
    }, {
      eventId: 'paused', runId: 'run-1', sequence: 2, type: 'run.paused', timestamp: 'now',
      payload: { nextStepId: 'generate-film', pauseReason: 'approval', approval },
    }];
    const resumeRun = vi.fn(async () => ({ accepted: true, dispatch: { started: true } } as never));
    const prepareResume = vi.fn(async () => true);
    const service = createSkillRuntimeService({
      createAuthorizedSkillRun: vi.fn(), getTaskForUser: vi.fn(async () => task), listTasks: vi.fn(),
      listEvents: vi.fn(async () => events), getProjection: vi.fn(async () => ({
        runId: 'run-1', status: 'paused', lastSequence: 2, plan: [], resumeFromStepId: 'generate-film',
        assetVersionIds: [], ignoredEventIds: [], missingSequences: [], qualityChecks: [],
      })), pauseRun: vi.fn(), resumeRun, cancelRun: vi.fn(), prepareResume,
    } as SkillRuntimeServiceDependencies);

    await expect(service.revise({ actorUserId: 'user-1', runId: 'run-1', revision: 8,
      generation: 3, planChecksum: 'a'.repeat(64), revisionInstruction: '加快节奏' }))
      .resolves.toMatchObject({ accepted: true, dispatched: true });
    expect(prepareResume).toHaveBeenCalledWith(expect.objectContaining({ nextStepId: 'plan-film' }));
    expect(resumeRun).toHaveBeenCalledWith(expect.objectContaining({
      nextStepId: 'plan-film', approval: expect.objectContaining({
        action: 'revise', revisionInstruction: '加快节奏',
      }),
    }));
  });
});
