import { createHash } from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import type {
  AgentDownstreamExecutionContext,
  AgentDownstreamRecovery,
} from '@/lib/agent-runtime/downstream-operations';
import type { AgentEventType, AgentWorkspace } from '@/lib/agent-runtime/types';
import { runSkillQualityGates } from './quality-gates';
import {
  durableSkillOutputFromStructuredResult,
  durableSkillOutputKey,
  parseDurableSkillOutput,
} from './structured-output';
import { buildSkillStepPrompt, selectSkillPredecessorOutputs } from './execution-context';
import { skillStepModelRole } from './step-compiler';
import type {
  DurableSkillOutput,
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
  previousOutputs?: readonly DurableSkillOutput[];
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
  completeRun?(input: {
    actorUserId: string;
    runId: string;
    result: ExecuteSkillRunResult;
    executionFence: NonNullable<AgentDownstreamExecutionContext['executionFence']>;
  }): Promise<unknown>;
  failRun?(input: {
    actorUserId: string;
    runId: string;
    error: SkillQualityFailedError;
    executionFence: NonNullable<AgentDownstreamExecutionContext['executionFence']>;
  }): Promise<unknown>;
  pauseForRetry?(input: {
    actorUserId: string;
    runId: string;
    stepId: string;
    error: unknown;
    executionFence: NonNullable<AgentDownstreamExecutionContext['executionFence']>;
  }): Promise<unknown>;
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
  existingAssetVersionIds?: readonly string[];
  existingOutputs?: readonly DurableSkillOutput[];
}

export interface ExecuteSkillRunResult {
  startedStepIds: string[];
  completedStepIds: string[];
  assetVersionIds: string[];
  outputs: DurableSkillOutput[];
}

export function selectSkillStepsForExecution(input: {
  steps: readonly SkillStepDefinition[];
  completedStepIds?: readonly string[];
  resumeFromStepId?: string;
}): SkillStepDefinition[] {
  const completed = new Set(input.completedStepIds || []);
  const resumeIndex = input.resumeFromStepId
    ? input.steps.findIndex(step => step.id === input.resumeFromStepId)
    : 0;
  if (input.resumeFromStepId && resumeIndex < 0) {
    throw new TypeError('resumeFromStepId is not a Skill step');
  }
  const resumeStep = input.steps[resumeIndex];
  let resumeGroupIndex = Math.max(0, resumeIndex);
  if (resumeStep?.execution === 'parallel' && resumeStep.parallelGroup) {
    while (
      resumeGroupIndex > 0
      && input.steps[resumeGroupIndex - 1]?.execution === 'parallel'
      && input.steps[resumeGroupIndex - 1]?.parallelGroup === resumeStep.parallelGroup
    ) {
      resumeGroupIndex -= 1;
    }
  }
  return input.steps.slice(resumeGroupIndex).filter(step => !completed.has(step.id));
}

export function selectInitialSkillStepIds(
  scheduledSteps: readonly SkillStepDefinition[],
): string[] {
  const first = scheduledSteps[0];
  if (!first) return [];
  if (first.execution !== 'parallel' || !first.parallelGroup) return [first.id];

  const stepIds: string[] = [];
  for (const step of scheduledSteps) {
    if (step.execution !== 'parallel' || step.parallelGroup !== first.parallelGroup) break;
    stepIds.push(step.id);
  }
  return stepIds;
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
  previousOutputs?: readonly DurableSkillOutput[];
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
    ...(input.definition.executionContextVersion === 1 ? {
      executionContextVersion: 1,
      executionPrompt: buildSkillStepPrompt(input),
    } : {}),
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

const SAFE_HTML_ELEMENTS = new Set([
  'a', 'b', 'blockquote', 'br', 'caption', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);
const DROP_HTML_WITH_CONTENT = new Set([
  'embed', 'iframe', 'object', 'script', 'style', 'template',
]);
const SAFE_HTML_GLOBAL_ATTRIBUTES = new Set(['class', 'dir', 'lang', 'title']);
const SAFE_HTML_ELEMENT_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  a: new Set(['href']),
  img: new Set(['alt', 'height', 'src', 'width']),
  ol: new Set(['start']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
};

function isSafeHtmlUrl(value: string, attribute: 'href' | 'src'): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const compact = trimmed.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (/^(?:javascript|data|vbscript):/i.test(compact)) return false;
  if (trimmed.startsWith('#')) return attribute === 'href';
  if (trimmed.startsWith('//')) return false;
  if (/^(?:\/|\.\/|\.\.\/|\?)/.test(trimmed)) return true;
  if (!/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return true;
  try {
    const protocol = new URL(trimmed).protocol.toLowerCase();
    return protocol === 'http:'
      || protocol === 'https:'
      || (attribute === 'href' && protocol === 'mailto:');
  } catch {
    return false;
  }
}

function sanitizeHtmlElement(element: Element): void {
  for (let child = element.firstChild; child;) {
    const next = child.nextSibling;
    if (child.nodeType === child.ELEMENT_NODE) {
      const childElement = child as Element;
      const name = childElement.tagName.toLowerCase();
      if (DROP_HTML_WITH_CONTENT.has(name)) {
        element.removeChild(childElement);
      } else if (!SAFE_HTML_ELEMENTS.has(name)) {
        sanitizeHtmlElement(childElement);
        while (childElement.firstChild) element.insertBefore(childElement.firstChild, childElement);
        element.removeChild(childElement);
      } else {
        sanitizeHtmlElement(childElement);
      }
    } else if (child.nodeType !== child.TEXT_NODE) {
      element.removeChild(child);
    }
    child = next;
  }

  const name = element.tagName.toLowerCase();
  for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
    const attribute = element.attributes.item(index);
    if (!attribute) continue;
    const attributeName = attribute.name.toLowerCase();
    const allowed = SAFE_HTML_GLOBAL_ATTRIBUTES.has(attributeName)
      || SAFE_HTML_ELEMENT_ATTRIBUTES[name]?.has(attributeName) === true;
    if (
      !allowed
      || attributeName.startsWith('on')
      || ((attributeName === 'href' || attributeName === 'src')
        && !isSafeHtmlUrl(attribute.value, attributeName))
    ) {
      element.removeAttribute(attribute.name);
    }
  }
}

function sanitizeDurableSkillHtml(html: string): string {
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: () => undefined,
      fatalError: () => undefined,
    },
  }).parseFromString(`<skill-output>${html}</skill-output>`, 'text/html');
  const root = document.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'skill-output') return '';

  sanitizeHtmlElement(root);
  const serializer = new XMLSerializer();
  let sanitized = '';
  for (let child = root.firstChild; child; child = child.nextSibling) {
    sanitized += serializer.serializeToString(child);
  }
  return sanitized.replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
}

function durableOutputs(stepId: string, result: SkillStepResult): DurableSkillOutput[] {
  return [
    ...(typeof result.text === 'string' && result.text
      ? [{ stepId, kind: 'text' as const, content: result.text }]
      : []),
    ...(typeof result.html === 'string' && result.html
      ? [{ stepId, kind: 'html' as const, content: sanitizeDurableSkillHtml(result.html) }]
      : []),
    ...(result.structured
      ? [durableSkillOutputFromStructuredResult(stepId, result.structured)]
      : []),
  ];
}

export function mergeDurableSkillOutputs(
  steps: readonly { id: string }[],
  outputs: readonly DurableSkillOutput[],
): DurableSkillOutput[] {
  const unique = new Map<string, DurableSkillOutput>();
  for (const rawOutput of outputs) {
    const output = parseDurableSkillOutput(rawOutput);
    const key = durableSkillOutputKey(output);
    if (!unique.has(key)) {
      unique.set(key, {
        ...output,
        content: output.kind === 'html'
          ? sanitizeDurableSkillHtml(output.content)
          : output.content,
      });
    }
  }
  const stepOrder = new Map(steps.map((step, index) => [step.id, index]));
  return [...unique.values()].sort((left, right) => (
    (stepOrder.get(left.stepId) ?? Number.MAX_SAFE_INTEGER)
    - (stepOrder.get(right.stepId) ?? Number.MAX_SAFE_INTEGER)
  ));
}

export function createSkillExecutor(dependencies: SkillExecutorDependencies) {
  return {
    async execute(input: ExecuteSkillRunInput): Promise<ExecuteSkillRunResult> {
      const completed = new Set(input.completedStepIds || []);
      const executionFence = input.operationContext.executionFence;
      if (!executionFence || executionFence.runId !== input.runId) {
        throw new Error('A database execution fence is required');
      }
      const eligible = selectSkillStepsForExecution({
        steps: input.definition.steps,
        completedStepIds: input.completedStepIds,
        resumeFromStepId: input.resumeFromStepId,
      });
      const startedStepIds: string[] = [];
      const assetVersionIds: string[] = [...new Set(input.existingAssetVersionIds || [])];
      const outputs: DurableSkillOutput[] = [...(input.existingOutputs || [])];

      try {
        for (const group of groupSkillSteps(eligible)) {
        if (input.operationContext.signal?.aborted) {
          throw abortError(input.operationContext.signal);
        }
        const controller = new AbortController();
        const onParentAbort = () => controller.abort(input.operationContext.signal?.reason);
        input.operationContext.signal?.addEventListener('abort', onParentAbort, { once: true });
        let groupError: unknown;
        const groupAssets = new Map<string, readonly string[]>();
        const groupOutputs = new Map<string, DurableSkillOutput[]>();
        try {
          const settled = await Promise.allSettled(group.steps.map(async step => {
            try {
              if (controller.signal.aborted) throw abortError(controller.signal);
              startedStepIds.push(step.id);
              const modelRole = skillStepModelRole(step);
              const modelBinding = modelRole ? input.modelBindings[modelRole] : undefined;
              const previousOutputs = selectSkillPredecessorOutputs(input.definition.steps, step.id, outputs);
              const requestDigest = skillStepRequestDigest({
              previousOutputs,
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
                previousOutputs,
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
              previousOutputs,
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
              const qualityGateIds = step.toolId === 'chat' && step.modelRole === 'orchestrator'
                ? [...new Set([...step.qualityGateIds, 'text-output-present'])]
                : step.qualityGateIds;
              const checks = runSkillQualityGates(
              qualityGateIds,
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
              const resultOutputs = durableOutputs(step.id, result);
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
              payload: {
                toolId: step.toolId,
                stepId: step.id,
                ...(resultOutputs.length > 0
                  ? { outputs: resultOutputs }
                  : {}),
              },
              });
              completed.add(step.id);
              groupAssets.set(step.id, result.assetVersionIds);
              groupOutputs.set(step.id, resultOutputs);
            } catch (error) {
              if (error instanceof SkillQualityFailedError || input.operationContext.signal?.aborted) {
                controller.abort(error);
              }
              throw error;
            }
          }));
          groupError = controller.signal.aborted
            ? controller.signal.reason
            : settled.find(result => result.status === 'rejected')?.reason;
          if (groupError) throw groupError;
          for (const step of group.steps) {
            assetVersionIds.push(...(groupAssets.get(step.id) || []));
            outputs.push(...(groupOutputs.get(step.id) || []));
          }
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
          if (!input.operationContext.signal?.aborted) {
            await dependencies.failRun?.({
              actorUserId: input.actorUserId,
              runId: input.runId,
              error,
              executionFence,
            });
          }
        } else if (!input.operationContext.signal?.aborted) {
          const stepId = (error as Partial<SkillStepExecutionError>)?.skillStepId
            || startedStepIds[startedStepIds.length - 1];
          if (stepId) {
            await dependencies.pauseForRetry?.({
              actorUserId: input.actorUserId,
              runId: input.runId,
              stepId,
              error: (error as Partial<SkillStepExecutionError>)?.cause || error,
              executionFence,
            });
          }
        }
        throw (error as Partial<SkillStepExecutionError>)?.cause || error;
      }
      const executionResult = {
        startedStepIds,
        completedStepIds: input.definition.steps
          .filter(step => completed.has(step.id))
          .map(step => step.id),
        assetVersionIds: [...new Set(assetVersionIds)],
        outputs: mergeDurableSkillOutputs(input.definition.steps, outputs),
      };
      if (input.operationContext.signal?.aborted) {
        throw abortError(input.operationContext.signal);
      }
      await dependencies.completeRun?.({
        actorUserId: input.actorUserId,
        runId: input.runId,
        result: executionResult,
        executionFence,
      });
      return executionResult;
    },
  };
}
