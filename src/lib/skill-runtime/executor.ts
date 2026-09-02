import { createHash } from 'node:crypto';

import type {
  AgentDownstreamExecutionContext,
  AgentDownstreamRecovery,
} from '@/lib/agent-runtime/downstream-operations';
import type { AgentEventType, AgentWorkspace } from '@/lib/agent-runtime/types';
import { runSkillQualityGates } from './quality-gates';
import type {
  SkillDefinition,
  SkillModelBinding,
  SkillQualityContext,
  SkillStepDefinition,
  SkillStepResult,
} from './types';

type SkillModelRole = SkillModelBinding['role'];

export interface SkillExecutorEventInput {
  actorUserId: string;
  runId: string;
  eventId: string;
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export interface ExecuteSkillStepInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  definition: SkillDefinition;
  step: SkillStepDefinition;
  inputValues: Record<string, unknown>;
  modelBinding?: { providerId: string; modelId: string };
  requestDigest: string;
  operation: AgentDownstreamExecutionContext;
  signal: AbortSignal;
}

export interface SkillExecutorDependencies {
  executeStep(input: ExecuteSkillStepInput): Promise<SkillStepResult>;
  recoverStep?(
    input: Omit<ExecuteSkillStepInput, 'operation'>,
  ): AgentDownstreamRecovery<SkillStepResult> | undefined;
  appendEvent(input: SkillExecutorEventInput): Promise<unknown>;
  qualityContext?(input: ExecuteSkillStepInput): SkillQualityContext;
  completeRun?(input: { actorUserId: string; runId: string; result: ExecuteSkillRunResult }): Promise<unknown>;
  failRun?(input: { actorUserId: string; runId: string; error: SkillQualityFailedError }): Promise<unknown>;
  pauseForRetry?(input: { actorUserId: string; runId: string; stepId: string; error: unknown }): Promise<unknown>;
}

export interface ExecuteSkillRunInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  workspace: AgentWorkspace;
  definition: SkillDefinition;
  inputValues: Record<string, unknown>;
  modelBindings: Partial<Record<SkillModelRole, { providerId: string; modelId: string }>>;
  operationContext: AgentDownstreamExecutionContext;
  completedStepIds?: readonly string[];
  resumeFromStepId?: string;
}

export interface ExecuteSkillRunResult {
  startedStepIds: string[];
  completedStepIds: string[];
  assetVersionIds: string[];
}

export class SkillQualityFailedError extends Error {
  readonly code = 'SKILL_QUALITY_FAILED';
  readonly status = 422;

  constructor(readonly stepId: string) {
    super(`Skill quality gates failed for step: ${stepId}`);
    this.name = 'SkillQualityFailedError';
  }
}

interface SkillStepExecutionError extends Error {
  skillStepId: string;
  cause: unknown;
}

function stepExecutionError(stepId: string, error: unknown): SkillStepExecutionError {
  const wrapped = new Error(error instanceof Error ? error.message : String(error), { cause: error });
  return Object.assign(wrapped, { skillStepId: stepId, cause: error });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export function skillStepRequestDigest(input: {
  runId: string;
  definition: SkillDefinition;
  step: SkillStepDefinition;
  inputValues: Record<string, unknown>;
  modelBinding?: { providerId: string; modelId: string };
}): string {
  return createHash('sha256').update(JSON.stringify(canonicalize({
    runId: input.runId,
    skillId: input.definition.id,
    skillVersion: input.definition.version,
    stepId: input.step.id,
    promptTemplate: input.step.promptTemplate,
    inputValues: input.inputValues,
    modelBinding: input.modelBinding || null,
  }))).digest('hex');
}

interface SkillStepGroup {
  steps: SkillStepDefinition[];
}

export function groupSkillSteps(steps: readonly SkillStepDefinition[]): SkillStepGroup[] {
  const groups: SkillStepGroup[] = [];
  for (const step of steps) {
    const previous = groups[groups.length - 1];
    if (
      step.execution === 'parallel'
      && step.parallelGroup
      && previous?.steps[0]?.execution === 'parallel'
      && previous.steps[0].parallelGroup === step.parallelGroup
    ) {
      previous.steps.push(step);
    } else {
      groups.push({ steps: [step] });
    }
  }
  return groups;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The Skill run was aborted', 'AbortError');
}

export function createSkillExecutor(dependencies: SkillExecutorDependencies) {
  return {
    async execute(input: ExecuteSkillRunInput): Promise<ExecuteSkillRunResult> {
      const completed = new Set(input.completedStepIds || []);
      const resumeIndex = input.resumeFromStepId
        ? input.definition.steps.findIndex(step => step.id === input.resumeFromStepId)
        : 0;
      if (input.resumeFromStepId && resumeIndex < 0) {
        throw new TypeError('resumeFromStepId is not a Skill step');
      }
      const eligible = input.definition.steps.slice(Math.max(0, resumeIndex))
        .filter(step => !completed.has(step.id));
      const startedStepIds: string[] = [];
      const assetVersionIds: string[] = [];

      try {
        for (const group of groupSkillSteps(eligible)) {
        if (input.operationContext.signal?.aborted) {
          throw abortError(input.operationContext.signal);
        }
        const controller = new AbortController();
        const onParentAbort = () => controller.abort(input.operationContext.signal?.reason);
        input.operationContext.signal?.addEventListener('abort', onParentAbort, { once: true });
        let groupError: unknown;
        try {
          const settled = await Promise.allSettled(group.steps.map(async step => {
            try {
              if (controller.signal.aborted) throw abortError(controller.signal);
              startedStepIds.push(step.id);
              const modelBinding = input.modelBindings[step.modelRole];
              const requestDigest = skillStepRequestDigest({
              runId: input.runId,
              definition: input.definition,
              step,
              inputValues: input.inputValues,
              modelBinding,
            });
              await dependencies.appendEvent({
              actorUserId: input.actorUserId,
              runId: input.runId,
              eventId: `skill:${input.runId}:step:${step.id}:started`,
              type: 'tool.started',
              payload: { toolId: step.toolId, stepId: step.id },
            });
              let result: SkillStepResult;
              const stepExecutionInput = {
                actorUserId: input.actorUserId,
                projectId: input.projectId,
                runId: input.runId,
                definition: input.definition,
                step,
                inputValues: input.inputValues,
                modelBinding,
                requestDigest,
                signal: controller.signal,
              };
              try {
                result = await input.operationContext.executeOperation({
                  stepId: step.id,
                  toolId: step.toolId,
                  requestDigest,
                }, operation => dependencies.executeStep({
                  ...stepExecutionInput,
                  operation,
                }), dependencies.recoverStep?.(stepExecutionInput));
              } catch (error) {
                throw stepExecutionError(step.id, error);
              }
              const stepInput: ExecuteSkillStepInput = {
              actorUserId: input.actorUserId,
              projectId: input.projectId,
              runId: input.runId,
              definition: input.definition,
              step,
              inputValues: input.inputValues,
              modelBinding,
              requestDigest,
              operation: input.operationContext,
              signal: controller.signal,
            };
              const checks = runSkillQualityGates(
              step.qualityGateIds,
              result,
              dependencies.qualityContext?.(stepInput) || {},
            );
              for (const check of checks) {
                await dependencies.appendEvent({
                actorUserId: input.actorUserId,
                runId: input.runId,
                eventId: `skill:${input.runId}:step:${step.id}:quality:${check.id}`,
                type: 'quality.checked',
                payload: { stepId: step.id, gateId: check.id, passed: check.passed, ...(check.error ? { error: check.error } : {}) },
                });
              }
              if (checks.some(check => !check.passed)) {
                throw new SkillQualityFailedError(step.id);
              }
              for (const assetVersionId of result.assetVersionIds) {
                await dependencies.appendEvent({
                actorUserId: input.actorUserId,
                runId: input.runId,
                eventId: `skill:${input.runId}:step:${step.id}:asset:${assetVersionId}`,
                type: 'asset.created',
                payload: { stepId: step.id, assetVersionId },
                });
              }
              await dependencies.appendEvent({
              actorUserId: input.actorUserId,
              runId: input.runId,
              eventId: `skill:${input.runId}:step:${step.id}:completed`,
              type: 'tool.completed',
              payload: { toolId: step.toolId, stepId: step.id },
              });
              completed.add(step.id);
              assetVersionIds.push(...result.assetVersionIds);
            } catch (error) {
              controller.abort(error);
              throw error;
            }
          }));
          groupError = controller.signal.aborted
            ? controller.signal.reason
            : settled.find(result => result.status === 'rejected')?.reason;
          if (groupError) throw groupError;
        } catch (error) {
          groupError = error;
          controller.abort(error);
          throw error;
        } finally {
          input.operationContext.signal?.removeEventListener('abort', onParentAbort);
          if (groupError) controller.abort(groupError);
        }
        }
      } catch (error) {
        if (error instanceof SkillQualityFailedError) {
          await dependencies.failRun?.({
            actorUserId: input.actorUserId,
            runId: input.runId,
            error,
          });
        } else if (!input.operationContext.signal?.aborted) {
          const stepId = (error as Partial<SkillStepExecutionError>)?.skillStepId
            || startedStepIds[startedStepIds.length - 1];
          if (stepId) {
            await dependencies.pauseForRetry?.({
              actorUserId: input.actorUserId,
              runId: input.runId,
              stepId,
              error: (error as Partial<SkillStepExecutionError>)?.cause || error,
            });
          }
        }
        throw (error as Partial<SkillStepExecutionError>)?.cause || error;
      }
      const executionResult = {
        startedStepIds,
        completedStepIds: [...completed],
        assetVersionIds: [...new Set(assetVersionIds)],
      };
      await dependencies.completeRun?.({
        actorUserId: input.actorUserId,
        runId: input.runId,
        result: executionResult,
      });
      return executionResult;
    },
  };
}
