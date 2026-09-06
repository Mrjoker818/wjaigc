import 'server-only';

import { fetchWithV1Retry } from '@/lib/api-helpers';
import {
  AgentDownstreamProviderRejectedError,
  AgentDownstreamSubmissionUnknownError,
  type AgentDownstreamRecovery,
} from '@/lib/agent-runtime/downstream-operations';
import { getCloudTaskForUser, updateCloudTask, type CloudTask } from '@/lib/cloud-task-storage';
import { executeAdmittedToolCall, executeToolCall, type AdmittedToolExecution } from '@/lib/chat-tools';
import { getApiProviders } from '@/lib/server-api-config';
import type { User } from '@/lib/user-types';
import { parseWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { buildSkillStepPrompt } from './execution-context';
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

function assertKnownSubmission(task: CloudTask | null): void {
  if (task?.status === 'processing' && task.result?.skillBillingProvenance
    && (task.result.taskError as Record<string, unknown> | undefined)?.code === 'SKILL_SUBMISSION_UNKNOWN') {
    throw new AgentDownstreamSubmissionUnknownError();
  }
}

async function monitorGeneration(execution: AdmittedToolExecution, signal: AbortSignal): Promise<void> {
  try {
    await executeAdmittedToolCall(execution, signal);
  } catch (error) {
    if (execution.kind === 'generation') {
      for (const taskId of execution.taskIds) assertKnownSubmission(await getCloudTaskForUser(taskId, execution.userId));
    }
    throw error;
  }
}

async function completedGenerationResult(
  taskId: string,
  actorUserId: string,
): Promise<SkillStepResult> {
  const task = await getCloudTaskForUser(taskId, actorUserId);
  assertKnownSubmission(task);
  if (!task || task.status !== 'completed') {
    const error = task?.result?.taskError;
    const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    throw new AgentDownstreamProviderRejectedError(typeof details.providerStatus === 'number' ? details.providerStatus : undefined, {
      message: task?.error || 'Skill generation task did not complete',
      providerCode: typeof details.code === 'string' ? details.code : undefined,
    });
  }
  const assetVersionIds = projectionVersionIds(task);
  return {
    assetVersionIds,
    media: assetVersionIds.map(() => ({})),
  };
}

function promptForStep(input: ExecuteSkillStepInput): string {
  return buildSkillStepPrompt(input);
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
  await monitorGeneration({
    kind: 'generation',
    taskIds: [taskId],
    userId: actor.id,
    userRole: actor.role || 'user',
  }, signal);
  return completedGenerationResult(taskId, actor.id);
}

function imageAdmissionError(message: string, code = 'SKILL_IMAGE_ADMISSION_FAILED'): Error {
  return Object.assign(new Error(message), { code });
}

async function executeGenerationStep(
  actor: User,
  request: SkillRunRequest,
  input: ExecuteSkillStepInput,
  toolId: 'generate_image' | 'img2img' = 'generate_image',
  canonicalImageUrls?: readonly string[],
): Promise<SkillStepResult> {
  if (!input.modelBinding) {
    throw imageAdmissionError('Skill image model binding is missing');
  }
  const result = await executeToolCall(toolId, {
    prompt: promptForStep(input),
    aspect_ratio: typeof input.inputValues.aspectRatio === 'string'
      ? input.inputValues.aspectRatio
      : '1:1',
    ...(toolId === 'img2img' ? { image_urls: [...(canonicalImageUrls || [])] } : {}),
  }, {
    chatApiKey: '', chatBaseUrl: '', origin: 'http://localhost',
    userId: actor.id, userRole: actor.role || 'user',
    imageModel: input.modelBinding.modelId,
    imageProviderId: input.modelBinding.providerId,
    projectId: request.projectId,
    sessionId: request.workspaceId,
    idempotencyKey: input.operation.idempotencyKey,
    skillBillingContext: input.operation.executionFence ? {
      runId: input.runId,
      stepId: input.step.id,
      requestDigest: input.requestDigest,
      operationKey: input.operation.operationKey,
      executionFence: input.operation.executionFence,
    } : undefined,
    deferAgentExecution: true,
    allowedTools: [toolId],
    ...(canonicalImageUrls ? { canonicalImageUrls } : {}),
  });
  if (!result.success) {
    throw imageAdmissionError(
      result.error || 'Skill image admission failed before provider submission',
      result.errorCode || 'SKILL_IMAGE_ADMISSION_FAILED',
    );
  }
  const taskId = result.taskIds?.[0]?.taskId;
  if (!taskId || !result.admittedExecution) {
    throw imageAdmissionError('Skill image generation did not return a durable task');
  }
  const task = await getCloudTaskForUser(taskId, actor.id);
  const submissionPayload = task?.result?.submissionPayload;
  const assetSourceTrace = parseWorkspaceSourceTrace({
    source: 'canvas-skill', runId: input.runId, skillId: request.skillId,
    skillVersion: request.skillVersion, sourceVersionIds: request.sourceVersionIds,
    modelBindings: request.modelBindings, createdAt: new Date().toISOString(),
  });
  if (!assetSourceTrace) {
    throw imageAdmissionError('Skill generation source trace could not be frozen');
  }
  const updated = task && await updateCloudTask(taskId, {
    result: {
      ...task.result,
      submissionPayload: {
        ...(submissionPayload && typeof submissionPayload === 'object' && !Array.isArray(submissionPayload)
          ? submissionPayload
          : {}),
        assetParentVersionIds: [...request.sourceVersionIds],
        assetSourceTrace,
      },
    },
  });
  if (!updated) {
    throw imageAdmissionError('Skill generation lineage could not be persisted');
  }
  if (!input.operation.recordLocalAccepted) throw new Error('Local Skill task confirmation is unavailable');
  await input.operation.recordLocalAccepted(taskId);
  await monitorGeneration(result.admittedExecution, input.signal);
  return completedGenerationResult(taskId, input.actorUserId);
}

export function createProductionSkillStepRegistry(input: {
  actor: User;
  request: SkillRunRequest;
  mediaByVersionId?: Readonly<Record<string, string>>;
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
  const img2img: SkillStepAdapter = step => {
    if (input.request.sourceVersionIds.length < 1 || input.request.sourceVersionIds.length > 6) {
      throw imageAdmissionError('Skill img2img requires between 1 and 6 authorized sources');
    }
    const canonicalImageUrls = input.request.sourceVersionIds.map(versionId => {
      const url = input.mediaByVersionId?.[versionId];
      if (typeof url !== 'string' || !url.trim()) {
        throw imageAdmissionError('Authorized Skill source media is unavailable', 'AGENT_CONTEXT_NOT_FOUND');
      }
      return url;
    });
    return executeGenerationStep(input.actor, input.request, step, 'img2img', canonicalImageUrls);
  };
  return {
    stepAdapters: { chat: executeOrchestratorStep, generate_image: generate, img2img },
    stepRecoveries: { generate_image: recoverGenerate, img2img: recoverGenerate },
  };
}
