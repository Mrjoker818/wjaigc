import 'server-only';

import { fetchWithV1Retry } from '@/lib/api-helpers';
import {
  AgentDownstreamProviderRejectedError,
  type AgentDownstreamRecovery,
} from '@/lib/agent-runtime/downstream-operations';
import { getCloudTaskForUser, type CloudTask } from '@/lib/cloud-task-storage';
import { executeAdmittedToolCall, executeToolCall } from '@/lib/chat-tools';
import { getApiProviders } from '@/lib/server-api-config';
import type { User } from '@/lib/user-types';
import { compileSkillPrompt } from './prompt-compiler';
import type { SkillRunRequest } from './run-request';
import type { ExecuteSkillStepInput } from './executor';
import type { SkillStepAdapter, SkillStepRecoveryFactory } from './service';
import type { SkillStepResult } from './types';

function projectionVersionIds(task: CloudTask): string[] {
  const projection = task.result?.assetProjection;
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) return [];
  const versionIds = (projection as Record<string, unknown>).versionIds;
  return Array.isArray(versionIds)
    ? versionIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : [];
}

async function completedGenerationResult(
  taskId: string,
  actorUserId: string,
): Promise<SkillStepResult> {
  const task = await getCloudTaskForUser(taskId, actorUserId);
  if (!task || task.status !== 'completed') {
    throw new AgentDownstreamProviderRejectedError(undefined, {
      message: task?.error || 'Skill generation task did not complete',
    });
  }
  const assetVersionIds = projectionVersionIds(task);
  return {
    assetVersionIds,
    media: assetVersionIds.map(() => ({})),
  };
}

function promptForStep(input: ExecuteSkillStepInput): string {
  return compileSkillPrompt(input.step.promptTemplate, input.inputValues);
}

async function executeOrchestratorStep(input: ExecuteSkillStepInput): Promise<SkillStepResult> {
  if (!input.modelBinding) {
    throw new AgentDownstreamProviderRejectedError(undefined, {
      message: 'Skill orchestrator model binding is missing',
    });
  }
  const provider = (await getApiProviders()).find(candidate => (
    candidate.id === input.modelBinding!.providerId && candidate.isEnabled
  ));
  if (!provider || !provider.apiKey || !provider.baseUrl) {
    throw new AgentDownstreamProviderRejectedError(undefined, {
      message: 'Skill orchestrator provider is unavailable',
    });
  }
  await input.operation.beginSubmission();
  const response = await fetchWithV1Retry(provider.baseUrl, '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: input.modelBinding.modelId,
      messages: [{ role: 'user', content: promptForStep(input) }],
      stream: false,
    }),
    signal: input.signal,
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    throw new AgentDownstreamProviderRejectedError(response.status, {
      message: 'Skill orchestrator provider rejected the request',
    });
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = choices[0] && typeof choices[0] === 'object'
    ? (choices[0] as Record<string, unknown>).message
    : null;
  const content = message && typeof message === 'object' && !Array.isArray(message)
    ? (message as Record<string, unknown>).content
    : '';
  return {
    assetVersionIds: [],
    media: [],
    ...(typeof content === 'string' && content ? { text: content } : {}),
  };
}

async function reconcileGeneration(
  taskId: string,
  actor: User,
  signal: AbortSignal,
): Promise<SkillStepResult> {
  await executeAdmittedToolCall({
    kind: 'generation',
    taskIds: [taskId],
    userId: actor.id,
    userRole: actor.role || 'user',
  }, signal);
  return completedGenerationResult(taskId, actor.id);
}

async function executeGenerationStep(
  actor: User,
  request: SkillRunRequest,
  input: ExecuteSkillStepInput,
): Promise<SkillStepResult> {
  if (!input.modelBinding) {
    throw new AgentDownstreamProviderRejectedError(undefined, {
      message: 'Skill image model binding is missing',
    });
  }
  await input.operation.beginSubmission();
  const result = await executeToolCall('generate_image', {
    prompt: promptForStep(input),
    aspect_ratio: typeof input.inputValues.aspectRatio === 'string'
      ? input.inputValues.aspectRatio
      : '1:1',
  }, {
    chatApiKey: '', chatBaseUrl: '', origin: 'http://localhost',
    userId: actor.id, userRole: actor.role || 'user',
    imageModel: input.modelBinding.modelId,
    imageProviderId: input.modelBinding.providerId,
    projectId: request.projectId,
    sessionId: request.workspaceId,
    idempotencyKey: input.operation.idempotencyKey,
    deferAgentExecution: true,
    allowedTools: ['generate_image'],
  });
  if (!result.success) {
    throw new AgentDownstreamProviderRejectedError(undefined, {
      message: result.error || 'Skill image generation was rejected',
    });
  }
  const taskId = result.taskIds?.[0]?.taskId;
  if (!taskId || !result.admittedExecution) {
    throw new AgentDownstreamProviderRejectedError(undefined, {
      message: 'Skill image generation did not return a durable task',
    });
  }
  await input.operation.recordAccepted(taskId);
  await executeAdmittedToolCall(result.admittedExecution, input.signal);
  return completedGenerationResult(taskId, input.actorUserId);
}

export function createProductionSkillStepRegistry(input: {
  actor: User;
  request: SkillRunRequest;
}): {
  stepAdapters: Readonly<Record<string, SkillStepAdapter>>;
  stepRecoveries: Readonly<Record<string, SkillStepRecoveryFactory>>;
} {
  const generate: SkillStepAdapter = step => step.step.modelRole === 'orchestrator'
    ? executeOrchestratorStep(step)
    : executeGenerationStep(input.actor, input.request, step);
  const recoverGenerate: SkillStepRecoveryFactory = step => ({
    reconcile: taskId => reconcileGeneration(taskId, input.actor, step.signal),
  } satisfies AgentDownstreamRecovery<SkillStepResult>);
  return {
    stepAdapters: { chat: executeOrchestratorStep, generate_image: generate },
    stepRecoveries: { generate_image: recoverGenerate },
  };
}
