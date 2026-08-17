import { createHash } from 'node:crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { findProviderForFeature, findProviderById, findProviderForModel } from '@/lib/server-api-config';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import type { ApiProvider } from '@/lib/universal-api-types';
import { fetchWithV1Retry, getInternalApiUrl } from '@/lib/api-helpers';
import { getInternalRequestHeaders, requireApiAuthOrReject } from '@/lib/api-auth';
import { canAccessAgentTask } from '@/lib/agent-task-access';
import { recordAgentTaskProgress, recordAgentTaskSubmitted, recordAgentTaskTerminal } from '@/lib/agent-task-persistence';
import { getCloudTaskForUser, getCloudTaskForUserByIdempotencyKey } from '@/lib/cloud-task-storage';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, tryChatCompletionsImageFallback, isChannelUnavailableError } from '@/lib/api-compatibility';
import { calculateActualPixelsFromRatio } from '@/lib/canvas-generation-group';
import { executeAgentLoop, getToolsForLLM, type AgentContext, type AgentResult } from '@/lib/agent-engine';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { translateApiError } from '@/lib/api-error-translate';
import { isTaskCancelled as isRegistryCancelled } from '@/lib/task-registry';
import { getSessionUser } from '@/lib/server-auth';
import {
  calculateConfiguredCreditCost,
  consumeCredits,
  refundCredits,
  InsufficientCreditsError,
} from '@/lib/credits';
import { validateApiInputs } from '@/lib/api-validator';
import { logError, OP_ACTIONS } from '@/lib/op-log';
import {
  createTaskEntryAudit,
  executeTaskEntryMigration,
  resolveTaskCoreMode,
} from '@/lib/task-core/entry-migration';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import type { DurableTaskStatus } from '@/lib/task-core/task-state';
import { getRequestId } from '@/lib/request-id';
import { buildAgentEditRequest, parseBoundedAgentSurfaceBody } from '@/lib/agent-runtime/surface-requests';
import { prepareAdmittedAgentTaskExecution } from '@/lib/agent-runtime/surface-dispatch';
import { resolveAgentRuntimeMode } from '@/lib/agent-runtime/mode';
import { admitAuthorizedAgentExecution } from '@/lib/agent-runtime/admission-gate';
import { resolveSelectedAgentMediaUrl } from '@/lib/agent-runtime/context-adapters';
import { submitAgentImageProviderRequest } from '@/lib/agent-runtime/provider-submission';
import { AgentModelRouteMismatchError } from '@/lib/agent-runtime/same-task-adapter';
import { resolveTaskModel } from '@/lib/task-core/model-catalog';
import { submitStrictAgentGeneration } from '@/lib/agent-runtime/generate-image-adapter';
import {
  AgentDownstreamProviderRejectedError,
  AgentDownstreamSubmissionUnknownError,
  type AgentDownstreamExecutionContext,
  type AgentDownstreamStepInput,
} from '@/lib/agent-runtime/downstream-operations';
export const runtime = 'nodejs';
export const maxDuration = 600;

const MAX_AGENT_EDIT_ROUNDS = 8;
const AGENT_EDIT_ALLOWED_TOOLS = [
  'image_edit',
  'generate_image',
  'remove_background',
  'upscale',
  'svg_trace',
  'generate_video',
  'extend_video',
];

class AgentMediaUrlMismatchError extends Error {
  readonly code = 'AGENT_MEDIA_URL_MISMATCH';
  readonly status = 409;

  constructor() {
    super('Image URL does not match the authorized Asset Version');
    this.name = 'AgentMediaUrlMismatchError';
  }
}

function digestAgentDownstreamRequest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function createNonDurableAgentOperationContext(
  idempotencyKey: string,
): AgentDownstreamExecutionContext {
  const context: AgentDownstreamExecutionContext = {
    idempotencyKey,
    operationKey: `${idempotencyKey}:operation`,
    recovery: false,
    beginSubmission: async () => undefined,
    recordAccepted: async () => undefined,
    executeOperation: async <T>(
      step: AgentDownstreamStepInput,
      execute: (stepContext: AgentDownstreamExecutionContext) => Promise<T>,
    ) => execute(createNonDurableAgentOperationContext(`${idempotencyKey}:${step.stepId}`)),
  };
  return context;
}

function safeProviderText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function knownProviderTaskRejection(
  data: Record<string, unknown>,
  status: string,
): AgentDownstreamProviderRejectedError {
  const providerError = data.error && typeof data.error === 'object'
    ? data.error as Record<string, unknown>
    : undefined;
  const message = safeProviderText(providerError?.message, 500)
    || safeProviderText(data.message, 500)
    || safeProviderText(data.error, 500)
    || `Agent provider task ${status}`;
  const providerCode = safeProviderText(providerError?.code, 100)
    || safeProviderText(data.code, 100);
  return new AgentDownstreamProviderRejectedError(undefined, { message, providerCode });
}

function retryableProviderTaskPollError(
  data: Record<string, unknown>,
  status: string,
): Error {
  return new Error(knownProviderTaskRejection(data, status).message);
}

async function pollAcceptedAgentGeneration(input: {
  providerTaskId: string;
  userId: string;
  userRole: 'user' | 'admin';
  isCancelled: () => boolean;
}): Promise<string> {
  const internalHeaders = await getInternalRequestHeaders(input.userId, input.userRole);
  for (let poll = 0; poll < 120; poll++) {
    if (input.isCancelled()) throw new Error('Agent task was cancelled');
    await new Promise(resolve => setTimeout(resolve, 2000));
    const response = await fetch(
      getInternalApiUrl('/api/poll-task'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalHeaders },
        body: JSON.stringify({ taskId: input.providerTaskId }),
      },
    );
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    const status = String(data?.status || '').toLowerCase();
    if (status === 'completed' && data?.imageUrl) return String(data.imageUrl);
    if (status === 'failed' || status === 'error') {
      if (status === 'error' && data?.retryable === true) {
        throw retryableProviderTaskPollError(data, status);
      }
      throw knownProviderTaskRejection(data || {}, status);
    }
    if (['cancelled', 'timeout'].includes(status)) {
      throw new Error(String(data?.error || `Agent image generation ${status}`));
    }
  }
  throw new Error('Agent image generation reconciliation timed out');
}

async function pollAcceptedAgentVideo(input: {
  providerTaskId: string;
  userId: string;
  userRole: 'user' | 'admin';
  isCancelled: () => boolean;
}): Promise<Record<string, unknown>> {
  const internalHeaders = await getInternalRequestHeaders(input.userId, input.userRole);
  for (let poll = 0; poll < 180; poll++) {
    if (input.isCancelled()) throw new Error('Agent task was cancelled');
    await new Promise(resolve => setTimeout(resolve, 2000));
    const response = await fetch(getInternalApiUrl('/api/poll-task'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...internalHeaders },
      body: JSON.stringify({ taskId: input.providerTaskId }),
    });
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    const status = String(data?.status || '').toLowerCase();
    if (status === 'completed' && data) return data;
    if (status === 'failed' || status === 'error') {
      if (status === 'error' && data?.retryable === true) {
        throw retryableProviderTaskPollError(data, status);
      }
      throw knownProviderTaskRejection(data || {}, status);
    }
    if (['cancelled', 'timeout'].includes(status)) {
      throw new Error(String(data?.error || `Agent video task ${status}`));
    }
  }
  throw new Error('Agent video reconciliation timed out');
}

function extractReconciledImageUrl(data: Record<string, unknown>): string {
  const direct = data.imageUrl || data.url;
  if (typeof direct === 'string' && direct) return direct;
  const candidates = data.results || data.images || data.data;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const first = candidates[0];
  if (!first || typeof first !== 'object') return '';
  const item = first as Record<string, unknown>;
  if (typeof item.url === 'string' && item.url) return item.url;
  if (typeof item.b64_json === 'string' && item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }
  return '';
}

async function reconcileAcceptedAgentProviderTask(input: {
  providerTaskId: string;
  userId: string;
  userRole: 'user' | 'admin';
  imageProviderId: string;
  isCancelled: () => boolean;
}): Promise<string> {
  const durableTask = await getCloudTaskForUser(input.providerTaskId, input.userId);
  if (durableTask) return pollAcceptedAgentGeneration(input);

  const provider = await findProviderById(input.imageProviderId);
  if (!provider?.baseUrl || !provider.apiKey) {
    throw new Error('Accepted Agent provider task cannot be reconciled');
  }
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const profile = resolveCompatProfile(provider);
  const pollUrl = (profile.pollPathTemplate || '/tasks/{taskId}')
    .replace('{taskId}', input.providerTaskId);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (input.isCancelled()) throw new Error('Agent task was cancelled');
    await new Promise(resolve => setTimeout(resolve, 5000));
    const response = await fetchWithV1Retry(baseUrl, pollUrl, {
      headers: { 'Authorization': `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) continue;
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    const status = String(data?.status || '').toLowerCase();
    if (['completed', 'success', 'succeeded'].includes(status) && data) {
      const imageUrl = extractReconciledImageUrl(data);
      if (imageUrl) return imageUrl;
      throw new Error('Accepted Agent provider task completed without an image');
    }
    if (status === 'failed' || status === 'error') {
      if (status === 'error' && data?.retryable === true) {
        throw retryableProviderTaskPollError(data, status);
      }
      throw knownProviderTaskRejection(data || {}, status);
    }
    if (['cancelled', 'timeout'].includes(status)) {
      throw new Error(String(data?.message || data?.error || `Agent provider task ${status}`));
    }
  }
  throw new Error('Accepted Agent provider task reconciliation timed out');
}

interface AgentEditPostBody {
  image?: string;
  prompt?: string;
  maskDataUrl?: string;
  model?: string;
  providerId?: string;
  maxRounds?: number;
  imagePrompt?: string;
  imageModel?: string;
  imageProviderId?: string;
  quality?: string;
  aspectRatio?: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  selectedEntityId?: string;
  assetParentVersionIds?: string[];
  assetProjectionMode?: string;
}

// ─── 本地任务存储 ──────────────────────────────────────────────────
// 由于 Next.js dev 模式下不同路由的内存不共享，
// 在本文件内维护独立的任务状态存储，供 GET 查询使用
interface LocalTaskInfo {
  userId: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  progress: number;
  label: string;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: number;
}

const localTaskStore = new Map<string, LocalTaskInfo>();

// 30 分钟自动清理过期任务
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of localTaskStore) {
      if (now - v.createdAt > 30 * 60 * 1000) localTaskStore.delete(k);
    }
  }, 60_000).unref?.();
}

/**
 * POST /api/agent-edit
 * Agent 编排编辑 — 智能选择工具，多轮编辑
 *
 * Body: {
 *   image: string,         // 图片 URL/data URL
 *   prompt: string,        // 用户指令
 *   maskDataUrl?: string,  // 蒙版
 *   model?: string,        // LLM 模型
 *   providerId?: string,   // API 提供商 ID
 *   maxRounds?: number,    // 最大执行轮次
 * }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = getRequestId(request);
  const taskCoreMode = resolveTaskCoreMode(process.env.WUJIE_TASK_CORE_MODE);
  const agentRuntimeMode = resolveAgentRuntimeMode(process.env.WUJIE_AGENT_RUNTIME_MODE);
  let deductedCredits = 0;
  let sessionUser: import('@/lib/user-types').User | null = null;
  let localTaskId: string | null = null;
  const selectedModel = '';
  const providerId = '';
  try {
    const authResult = await requireApiAuthOrReject(request);
    if (authResult instanceof NextResponse) return authResult;

    const body = parseBoundedAgentSurfaceBody(await request.text()) as AgentEditPostBody;
    // 输入校验
    const _validationError = validateApiInputs(body, {
        prompt: 'optionalPrompt',
        imageUrl: 'optionalImageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const {
      image, prompt, maskDataUrl, model, providerId, maxRounds, imagePrompt,
      imageModel, imageProviderId, quality, aspectRatio, projectId, sessionId,
      messageId, selectedEntityId, assetParentVersionIds, assetProjectionMode,
    } = body;

    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || requestId;
    const requestDigest = createHash('sha256').update(JSON.stringify({
      image, prompt, maskDataUrl, providerId, model, imageProviderId, imageModel,
      imagePrompt, quality, aspectRatio, maxRounds,
    })).digest('hex');
    if (agentRuntimeMode === 'agent-v2') {
      const existing = await getCloudTaskForUserByIdempotencyKey(authResult.userId, idempotencyKey);
      if (existing && existing.requestDigest && existing.requestDigest !== requestDigest) {
        throw new IdempotencyConflictError({
          userId: authResult.userId,
          idempotencyKey,
          requestDigest,
          existingDigest: existing.requestDigest,
        });
      }
      if (existing && ['completed', 'failed', 'cancelled', 'timeout'].includes(existing.status)) {
        let runId: string | undefined;
        if (existing.projectId) {
          const { listAgentEventsForActor } = await import('@/lib/agent-runtime/event-storage');
          const events = await listAgentEventsForActor({
            actorUserId: authResult.userId,
            projectId: existing.projectId,
            runId: existing.id,
          }).catch(() => []);
          if (events.length > 0) runId = existing.id;
        }
        if (existing.status === 'completed') {
          return NextResponse.json({
            success: true, taskId: existing.id, status: existing.status,
            result: existing.result, mode: 'agent', replayed: true,
            ...(runId ? { runId } : {}),
          });
        }
        return NextResponse.json({
          success: false, code: 'AGENT_TASK_TERMINAL',
          error: `Agent task is already ${existing.status}`, taskId: existing.id,
          status: existing.status, replayed: true,
        }, { status: 409 });
      }
    }

    // ★ 从 model 中提取纯 modelId（前端可能传 providerId::modelId 格式）
    let pureModel = model;
    if (agentRuntimeMode !== 'agent-v2' && typeof model === 'string' && model.includes('::')) {
      pureModel = model.split('::').pop()!;
      console.log(`[agent-edit] Stripped provider prefix from model: "${model}" → "${pureModel}"`);
    }
    // ★ 规范化模型名（如 gpt-image-2-2k → gpt-image-2）
    if (agentRuntimeMode !== 'agent-v2') {
      const modelNorm = normalizeModelForApi(pureModel || '');
      if (modelNorm.wasNormalized) {
        console.log(`[agent-edit] Normalized model alias: "${pureModel}" → "${modelNorm.apiModelName}"`);
        pureModel = modelNorm.apiModelName;
      }
    }
    let pureImageModel = imageModel;
    if (agentRuntimeMode !== 'agent-v2' && typeof imageModel === 'string' && imageModel.includes('::')) {
      pureImageModel = imageModel.split('::').pop()!;
      console.log(`[agent-edit] Stripped provider prefix from imageModel: "${imageModel}" → "${pureImageModel}"`);
    }
    if (agentRuntimeMode !== 'agent-v2') {
      const imgModelNorm = normalizeModelForApi(pureImageModel || '');
      if (imgModelNorm.wasNormalized) {
        console.log(`[agent-edit] Normalized imageModel alias: "${pureImageModel}" → "${imgModelNorm.apiModelName}"`);
        pureImageModel = imgModelNorm.apiModelName;
      }
    }

    if (!image || !prompt) {
      return NextResponse.json({ success: false, error: '缺少图片或描述' }, { status: 400 });
    }

    // Content safety check
    const safetyResult = checkPromptSafety(prompt);
    if (safetyResult.level === 'block') {
      return NextResponse.json({ success: false, error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    sessionUser = await getSessionUser(request).catch(() => null);
    const sourceVersionIds = Array.isArray(assetParentVersionIds)
      ? assetParentVersionIds.filter((value): value is string => typeof value === 'string')
      : [];
    const selectedEntityIds = typeof selectedEntityId === 'string' && selectedEntityId
      ? [selectedEntityId]
      : [];
    const runtimeActor = sessionUser || authResult.user;
    const buildRuntimeRequest = (stableIdempotencyKey: string) => buildAgentEditRequest({
      projectId: typeof projectId === 'string' ? projectId : '',
      workspaceId: `canvas:${typeof projectId === 'string' ? projectId : requestId}`,
      providerId: typeof providerId === 'string' ? providerId : '',
      modelId: typeof pureModel === 'string' ? pureModel : '',
      prompt: typeof prompt === 'string' ? prompt : '',
      selectedEntityId: typeof selectedEntityId === 'string' ? selectedEntityId : '',
      sourceVersionIds,
      visibleVersionIds: sourceVersionIds,
      conversationId: typeof sessionId === 'string' ? sessionId : undefined,
      idempotencyKey: stableIdempotencyKey,
    });
    if (agentRuntimeMode === 'agent-v2') {
      if (
        typeof providerId !== 'string' || !providerId
        || typeof pureModel !== 'string' || !pureModel
        || typeof imageProviderId !== 'string' || !imageProviderId
        || typeof pureImageModel !== 'string' || !pureImageModel
      ) {
        throw new AgentModelRouteMismatchError();
      }
      try {
        const [chatModel, exactImageModel] = await Promise.all([
          resolveTaskModel(providerId, pureModel, runtimeActor.id),
          resolveTaskModel(imageProviderId, pureImageModel, runtimeActor.id),
        ]);
        if (chatModel.kind !== 'chat' || !['image', 'edit'].includes(exactImageModel.kind)) {
          throw new Error('Model kind mismatch');
        }
      } catch {
        throw new AgentModelRouteMismatchError();
      }
    }
    const plannedCreditCost = sessionUser
      ? await calculateConfiguredCreditCost(
          'image_retouch',
          typeof pureModel === 'string' ? pureModel : undefined,
          { providerId: typeof providerId === 'string' ? providerId : undefined },
        )
      : 0;
    type AgentAdmission = {
      taskId: string;
      creditCost: number;
      reused: boolean;
      status: DurableTaskStatus;
      result?: Record<string, unknown>;
    };
    const admitAgentTask = () => executeTaskEntryMigration<AgentAdmission>({
      mode: taskCoreMode,
      legacy: async () => {
        let creditCost = 0;
        if (sessionUser) {
          const creditResult = await consumeCredits(
            sessionUser.id,
            'image_retouch',
            undefined,
            undefined,
            model,
          );
          if (!creditResult.success) {
            throw new InsufficientCreditsError(
              sessionUser.id,
              plannedCreditCost,
              creditResult.balance || 0,
            );
          }
          creditCost = creditResult.cost;
          deductedCredits = creditCost;
        }
        const taskId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const created = await recordAgentTaskSubmitted({
          taskId,
          userId: authResult.userId,
          projectId: typeof projectId === 'string' ? projectId : undefined,
          sessionId: typeof sessionId === 'string' ? sessionId : undefined,
          messageId: typeof messageId === 'string' ? messageId : undefined,
          providerId: typeof providerId === 'string' ? providerId : undefined,
          model: typeof pureModel === 'string' ? pureModel : undefined,
          label: 'Agent processing',
          creditCost,
          creditStatus: creditCost > 0 ? 'pending' : 'not-applicable',
          submissionPayload: {
            assetParentVersionIds: Array.isArray(assetParentVersionIds) ? assetParentVersionIds : [],
            assetProjectionMode: assetProjectionMode === 'revision' ? 'revision' : 'derived',
          },
          taskEntryAudit: createTaskEntryAudit({
            entry: 'agent',
            mode: taskCoreMode,
            requestId,
            requestedProviderId: typeof providerId === 'string' ? providerId : undefined,
            requestedModelId: typeof model === 'string' ? model : undefined,
            actualProviderId: typeof providerId === 'string' ? providerId : undefined,
            actualModelId: typeof pureModel === 'string' ? pureModel : undefined,
            startedAt: startTime,
            creditCost,
            creditStatus: creditCost > 0 ? 'pending' : 'not-applicable',
          }),
        });
        if (!created) throw new Error('Agent task could not be created');
        return { taskId, creditCost, reused: false, status: 'processing' };
      },
      coreV2: async () => {
        const now = Date.now();
        const result = await createBillableTask({
          userId: authResult.userId,
          idempotencyKey,
          requestDigest,
          creditCost: plannedCreditCost,
          task: {
            id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            projectId: typeof projectId === 'string' ? projectId : undefined,
            sessionId: typeof sessionId === 'string' ? sessionId : undefined,
            messageId: typeof messageId === 'string' ? messageId : undefined,
            type: 'agent-edit',
            status: 'processing',
            providerId: typeof providerId === 'string' ? providerId : undefined,
            model: typeof pureModel === 'string' ? pureModel : undefined,
            progress: 5,
            label: 'Agent processing',
            result: {
              submissionPayload: {
                assetParentVersionIds: Array.isArray(assetParentVersionIds) ? assetParentVersionIds : [],
                assetProjectionMode: assetProjectionMode === 'revision' ? 'revision' : 'derived',
              },
              taskEntryAudit: createTaskEntryAudit({
                entry: 'agent',
                mode: 'core-v2',
                requestId,
                requestedProviderId: typeof providerId === 'string' ? providerId : undefined,
                requestedModelId: typeof model === 'string' ? model : undefined,
                actualProviderId: typeof providerId === 'string' ? providerId : undefined,
                actualModelId: typeof pureModel === 'string' ? pureModel : undefined,
                startedAt: startTime,
                creditCost: plannedCreditCost,
                creditStatus: plannedCreditCost > 0 ? 'pending' : 'not-applicable',
              }),
            },
            createdAt: now,
            updatedAt: now,
          },
        });
        return {
          taskId: result.task.id,
          creditCost: result.task.creditCost || 0,
          reused: result.reused,
          status: result.task.status,
          result: result.task.result,
        };
      },
      factsFromResult: value => ({
        providerId: typeof providerId === 'string' ? providerId : undefined,
        modelId: typeof pureModel === 'string' ? pureModel : undefined,
        creditCost: value.creditCost,
        status: value.status === 'completed'
          || value.status === 'failed'
          || value.status === 'cancelled'
          || value.status === 'timeout'
          ? value.status
          : 'processing',
      }),
      previewCoreFacts: async () => ({
        providerId: typeof providerId === 'string' ? providerId : undefined,
        modelId: typeof pureModel === 'string' ? pureModel : undefined,
        creditCost: plannedCreditCost,
        status: 'processing',
      }),
    });
    let executionImage = String(image);
    const admission = agentRuntimeMode === 'agent-v2'
      ? await admitAuthorizedAgentExecution({
          actor: runtimeActor,
          request: buildRuntimeRequest(idempotencyKey),
          toolId: 'agent_edit',
          admit: authorizedContext => {
            const canonicalImageUrl = resolveSelectedAgentMediaUrl(authorizedContext, selectedEntityIds);
            if (!canonicalImageUrl || canonicalImageUrl !== image) {
              throw new AgentMediaUrlMismatchError();
            }
            executionImage = canonicalImageUrl;
            return admitAgentTask();
          },
        })
      : await admitAgentTask();
    const taskId = admission.value.taskId;
    localTaskId = taskId;
    deductedCredits = admission.value.creditCost;
    if (admission.value.reused) {
      if (
        admission.value.status === 'failed'
        || admission.value.status === 'cancelled'
        || admission.value.status === 'timeout'
      ) {
        return NextResponse.json({
          success: false,
          code: 'AGENT_TASK_TERMINAL',
          error: `Agent task is already ${admission.value.status}`,
          taskId,
          status: admission.value.status,
          replayed: true,
        }, { status: 409 });
      }
      if (admission.value.status === 'completed') {
        let adoptedRunId: string | undefined;
        if (agentRuntimeMode === 'agent-v2' && typeof projectId === 'string' && projectId) {
          const { listAgentEventsForActor } = await import('@/lib/agent-runtime/event-storage');
          const events = await listAgentEventsForActor({
            actorUserId: authResult.userId,
            projectId,
            runId: taskId,
          }).catch(() => []);
          if (events.some(event => event.type === 'run.created' && event.payload.adopted === true)) {
            adoptedRunId = taskId;
          }
        }
        return NextResponse.json({
          success: true,
          taskId,
          status: admission.value.status,
          result: admission.value.result,
          mode: 'agent',
          replayed: true,
          ...(adoptedRunId ? { runId: adoptedRunId } : {}),
        });
      }
      if (agentRuntimeMode !== 'agent-v2') {
        return NextResponse.json({
          success: true,
          taskId,
          status: admission.value.status,
          result: admission.value.result,
          mode: 'agent',
          replayed: true,
        });
      }
    }

    // 注册任务到本地存储
    localTaskStore.set(taskId, {
      userId: authResult.userId,
      status: 'processing',
      progress: 5,
      label: 'Agent 分析中',
      createdAt: Date.now(),
    });

    await recordAgentTaskProgress(taskId, 5, 'Agent processing');

    const runtimeRequest = () => buildRuntimeRequest(taskId);
    const executeAgentEditTask = async (
      operationContext: AgentDownstreamExecutionContext = createNonDurableAgentOperationContext(
        `agent-provider:${taskId}`,
      ),
    ): Promise<void> => {
      const EDIT_GLOBAL_TIMEOUT_MS = 5 * 60 * 1000;
      const timeout = setTimeout(() => {
        void (async () => {
          const task = localTaskStore.get(taskId);
          if (task && task.status === 'processing') {
            await recordAgentTaskTerminal(taskId, {
              status: 'timeout', error: 'Agent task timed out',
            });
            localTaskStore.set(taskId, { ...task, status: 'timeout', error: 'Agent task timed out', progress: 0 });
          }
        })().catch(error => console.error('[agent-edit] timeout persistence failed:', error));
      }, EDIT_GLOBAL_TIMEOUT_MS);

      // 辅助函数：检查任务是否已被取消（同时检查本地 store 和全局 task-registry）
      const isCancelled = () => {
        const task = localTaskStore.get(taskId);
        return !task || task.status === 'cancelled' || isRegistryCancelled(taskId);
      };

      try {
        // 解析 LLM 提供商：优先使用前端传入的 providerId 精确定位，避免静默降级
        const isChatType = (p: ApiProvider): boolean => {
          const t = p.modelType ?? p.type;
          return t === 'chat' || t === 'universal' || t === 'general';
        };

        let chatProvider: ApiProvider | null = null;
        let chatModel = '';

        if (typeof providerId === 'string' && providerId.trim()) {
          chatProvider = await findProviderById(providerId.trim());
          if (chatProvider && !isChatType(chatProvider)) {
            console.warn(`[agent-edit] Provider ${providerId} is not a chat-type provider, rejecting`);
            chatProvider = null;
          }
        }

        if (chatProvider) {
          if (pureModel) {
            // 前端指定模型时，必须精确匹配该提供商的授权模型，禁止静默降级
            const authorized = new Set<string>([
              ...(chatProvider.selectedModels || []),
              ...(chatProvider.selectedModel ? [chatProvider.selectedModel] : []),
            ]);
            if (authorized.has(pureModel)) {
              chatModel = pureModel;
            } else {
              await recordAgentTaskTerminal(taskId, {
                status: 'failed', error: `Model ${pureModel} is not authorized on provider ${chatProvider.name}`,
              });
              localTaskStore.set(taskId, {
                userId: authResult.userId,
                status: 'failed',
                error: `模型 ${pureModel} 不在提供商 ${chatProvider.name} 的授权列表中，请切换其他模型`,
                progress: 100, label: '失败', createdAt: Date.now(),
              });
              return;
            }
          } else {
            chatModel = chatProvider.selectedModels?.[0] || '';
          }
        }

        // 未指定 providerId 或指定提供商不可用 → 兼容旧调用，回退到功能查找
        if (!chatProvider && agentRuntimeMode !== 'agent-v2') {
          chatProvider = await findProviderForFeature('chat');
          if (!chatProvider || isCancelled()) {
            if (!chatProvider) {
              await recordAgentTaskTerminal(taskId, {
                status: 'failed', error: 'No chat model is configured for Agent execution',
              });
              localTaskStore.set(taskId, {
                userId: authResult.userId,
                status: 'failed', error: '未配置聊天模型，请在管理员面板添加 LLM 模型', progress: 100, label: '失败', createdAt: Date.now(),
              });
            }
            return;
          }
          if (!chatModel) {
            chatModel = chatProvider.selectedModels?.[0] || pureModel || 'gpt-4o';
          }
        }

        // 最终兜底：仍无可用模型时给出明确错误，而非带空模型继续执行
        if (!chatProvider || !chatModel) {
          await recordAgentTaskTerminal(taskId, {
            status: 'failed', error: 'No authorized chat model is available for Agent execution',
          });
          localTaskStore.set(taskId, {
            userId: authResult.userId,
            status: 'failed', error: '聊天模型未授权，请在管理员面板配置可用的 LLM 模型', progress: 100, label: '失败', createdAt: Date.now(),
          });
          return;
        }

        // 构建 Agent 上下文
        const requestedRounds = typeof maxRounds === 'number' ? Math.trunc(maxRounds) : 5;
        const boundedMaxRounds = Math.min(Math.max(requestedRounds || 5, 1), MAX_AGENT_EDIT_ROUNDS);
        const context: AgentContext = {
          taskId,
          userPrompt: prompt,
          imageUrl: executionImage,
          imagePrompt: imagePrompt || '',
          maskDataUrl,
          model: chatModel,
          maxRounds: boundedMaxRounds,
          allowedTools: AGENT_EDIT_ALLOWED_TOOLS,
          currentRound: 0,
          contextHistory: [],
          isCancelled,
          onProgress: (info) => {
            if (isCancelled()) return;
            const task = localTaskStore.get(taskId);
            if (!task || task.status !== 'processing') return;
            const progress = Math.min(95, 10 + (info.round / (context.maxRounds || 5)) * 80);
            const progressLabel = `Agent round ${info.round}: ${info.step}`;
            void recordAgentTaskProgress(taskId, progress, progressLabel).catch(error => {
              console.warn('[agent-edit] progress persistence failed:', error);
            });
            localTaskStore.set(taskId, {
              ...task,
              progress,
              label: `第${info.round}轮: ${info.step}${info.detail ? ' - ' + info.detail : ''}`,
            });
          },
        };

        // LLM 调用函数
        let llmCallIndex = 0;
        let llmProviderRejection: AgentDownstreamProviderRejectedError | null = null;
        let llmSubmissionUnknown: AgentDownstreamSubmissionUnknownError | null = null;
        const llmCall = async (
          messages: Array<{ role: string; content: string }>,
          tools: ReturnType<typeof getToolsForLLM>
        ) => {
          const currentLlmCallIndex = llmCallIndex++;
          const baseUrl = chatProvider.baseUrl.replace(/\/+$/, '');
          const headers: Record<string, string> = {
            'Authorization': `Bearer ${chatProvider.apiKey}`,
            'Content-Type': 'application/json',
          };

          // Apply advanced params
          if (Array.isArray(chatProvider.advancedParams)) {
            for (const p of chatProvider.advancedParams as Array<{ key?: string; value?: unknown }>) {
              if (p.key?.trim() && p.value !== undefined) {
                headers[p.key.trim()] = String(p.value);
              }
            }
          }
          const requestBody: Record<string, unknown> = {
            model: chatModel,
            messages,
            tools,
            tool_choice: 'auto',
            stream: false,
            max_tokens: 2048,
          };
          try {
            return await operationContext.executeOperation({
              stepId: `llm:${currentLlmCallIndex}`,
              toolId: 'agent_llm',
              requestDigest: digestAgentDownstreamRequest({
                providerId: chatProvider.id,
                model: chatModel,
                requestBody,
              }),
            }, async stepContext => {
            headers['Idempotency-Key'] = stepContext.idempotencyKey;
            await stepContext.beginSubmission();
            const resp = await fetchWithV1Retry(baseUrl, '/chat/completions', {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody),
              signal: AbortSignal.timeout(60000),
              skipV1Retry: agentRuntimeMode === 'agent-v2',
            });

            if (!resp.ok) {
              const errText = await resp.text().catch(() => '');
              console.error('[agent-edit] LLM API rejected request:', resp.status, errText.slice(0, 200));
              throw new AgentDownstreamProviderRejectedError(resp.status);
            }

          // 检测响应类型：SSE 流式 vs JSON
          const contentType = resp.headers.get('content-type') || '';
          let data: Record<string, unknown>;

          if (contentType.includes('text/event-stream') || contentType.includes('text/stream')) {
            // API 返回了 SSE 流，需要解析流事件提取完整消息
            data = await parseSSEToJSON(resp);
          } else {
            // 标准 JSON 响应
            const text = await resp.text();
            // 兜底：文本以 "data: " 开头也按 SSE 处理
            if (text.startsWith('data: ')) {
              data = parseSSETextToJSON(text);
            } else {
              try {
                data = JSON.parse(text) as Record<string, unknown>;
              } catch {
                throw new Error(`LLM 响应解析失败: ${text.slice(0, 200)}`);
              }
            }
          }

          const choices = data.choices as Array<Record<string, unknown>> | undefined;
          const choice = choices?.[0];
          if (!choice) throw new Error('LLM 返回空响应');

          const message = choice.message as Record<string, unknown> | undefined;
          if (!message) throw new Error('LLM 返回无消息');

          // 解析 tool calls
          const toolCalls = (message.tool_calls as Array<Record<string, unknown>> | undefined)?.map(tc => {
            const fn = tc.function as Record<string, unknown>;
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(String(fn.arguments || '{}'));
            } catch { /* ignore */ }
            return {
              name: String(fn.name || ''),
              arguments: args,
            };
          });

            return {
              toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
              content: String(message.content || ''),
              finishReason: String(choice.finish_reason || ''),
            };
            });
          } catch (error) {
            if (error instanceof AgentDownstreamProviderRejectedError) {
              llmProviderRejection = error;
            }
            if (error instanceof AgentDownstreamSubmissionUnknownError) {
              llmSubmissionUnknown = error;
            }
            throw error;
          }
        };

        // 执行 Agent 循环
        console.log('[agent-edit] Starting agent loop, chatModel:', chatModel, 'maxRounds:', context.maxRounds);
        const result: AgentResult = await executeAgentLoop(context, llmCall);
        if (llmSubmissionUnknown) throw llmSubmissionUnknown;
        if (llmProviderRejection) throw llmProviderRejection;
        console.log('[agent-edit] Agent loop completed, steps:', result.steps.length, 'success:', result.success);

        // 实际执行所有图像编辑步骤（按轮次顺序）
        if (isCancelled()) return;

        let finalImageUrl = executionImage;
        const allEditSteps = result.steps.filter(s => s.toolName === 'image_edit' && s.success);

        if (allEditSteps.length > 0) {
          // 逐步执行所有 image_edit 操作，每步使用上一步的结果
          console.log('[agent-edit] Executing', allEditSteps.length, 'image edit steps');
          for (let i = 0; i < allEditSteps.length; i++) {
            if (isCancelled()) break;
            const step = allEditSteps[i];
            const progressBase = Math.round(70 + (20 * i / allEditSteps.length));
            const task = localTaskStore.get(taskId);
            if (task) localTaskStore.set(taskId, { ...task, progress: progressBase, label: `执行图像编辑 (${i + 1}/${allEditSteps.length})...` });

            try {
              const editPrompt = String(step.params.prompt || prompt);
              const editMask = i === 0 ? maskDataUrl : undefined;
              const editStepId = `image_edit:${result.steps.indexOf(step)}`;
              const editResult = await operationContext.executeOperation({
                stepId: editStepId,
                toolId: 'image_edit',
                requestDigest: digestAgentDownstreamRequest({
                  imageUrl: finalImageUrl,
                  prompt: editPrompt,
                  maskDataUrl: editMask,
                  model: pureImageModel,
                  providerId: imageProviderId,
                  quality,
                  aspectRatio,
                }),
              }, stepContext => performImageEdit(
                finalImageUrl,
                editPrompt,
                editMask,
                pureImageModel,
                imageProviderId,
                quality,
                aspectRatio,
                agentRuntimeMode === 'agent-v2',
                stepContext.idempotencyKey,
                stepContext.recordAccepted,
                stepContext.beginSubmission,
              ), {
                reconcile: async providerTaskId => ({
                  success: true,
                  imageUrl: await reconcileAcceptedAgentProviderTask({
                    providerTaskId,
                    userId: authResult.userId,
                    userRole: authResult.userRole === 'admin' ? 'admin' : 'user',
                    imageProviderId: String(imageProviderId),
                    isCancelled,
                  }),
                }),
              });
              console.log(`[agent-edit] Edit step ${i + 1} result: success=${editResult.success} hasUrl=${!!editResult.imageUrl} url=${editResult.imageUrl?.substring(0, 80)} error=${editResult.error || ''}`);
              if (editResult.success && editResult.imageUrl) {
                finalImageUrl = editResult.imageUrl;
                // 更新步骤结果为实际编辑结果
                step.result = `编辑成功: ${String(step.params.prompt || prompt)}`;
              } else {
                step.result = `编辑失败: ${translateApiError(editResult.error || '未知错误')}`;
                step.success = false;
              }
            } catch (err) {
              console.error(`[agent-edit] Image edit step ${i + 1} failed:`, err);
              if (agentRuntimeMode === 'agent-v2') throw err;
              step.result = `编辑异常: ${err instanceof Error ? err.message : '未知错误'}`;
              step.success = false;
            }
          }
        }

        // 执行其他非 image_edit 工具的实际操作
        const otherSteps = result.steps.filter(s => s.toolName !== 'image_edit' && s.success);
        for (const step of otherSteps) {
          const stepKey = `${step.toolName}:${result.steps.indexOf(step)}`;
          if (isCancelled()) break;
          try {
            if (step.toolName === 'upscale') {
              // 调用放大 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行无损放大...' });
              const upscaleRequest = { imageUrl: finalImageUrl, scale: step.params.scale || '2', outputFormat: 'png' };
              const upscaleData = await operationContext.executeOperation({
                stepId: stepKey,
                toolId: 'upscale',
                requestDigest: digestAgentDownstreamRequest(upscaleRequest),
              }, async stepContext => {
                await stepContext.beginSubmission();
                const response = await fetch(getInternalApiUrl('/api/image/upscale'), {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(await getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user')),
                    'idempotency-key': stepContext.idempotencyKey,
                  },
                  body: JSON.stringify(upscaleRequest),
                });
                return response.json();
              });
              if (upscaleData.success && upscaleData.imageUrl) {
                finalImageUrl = upscaleData.imageUrl;
                step.result = '放大成功';
              }
            } else if (step.toolName === 'remove_background') {
              // 调用去背景 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行移除背景...' });
              const removeBackgroundRequest = {
                imageUrl: finalImageUrl,
                action: 'removebg',
                model: imageModel,
                providerId: imageProviderId,
                engine: imageModel ? 'ai' : 'auto',
              };
              const pollRemoveBackground = async (providerTaskId: string) => ({
                success: true as const,
                imageUrl: await pollAcceptedAgentGeneration({
                  providerTaskId,
                  userId: authResult.userId,
                  userRole: authResult.userRole === 'admin' ? 'admin' : 'user',
                  isCancelled,
                }),
              });
              const rbData = await operationContext.executeOperation({
                stepId: stepKey,
                toolId: 'remove_background',
                requestDigest: digestAgentDownstreamRequest(removeBackgroundRequest),
              }, async stepContext => {
                await stepContext.beginSubmission();
                const response = await fetch(getInternalApiUrl('/api/image-edit'), {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(await getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user')),
                    'idempotency-key': stepContext.idempotencyKey,
                  },
                  body: JSON.stringify(removeBackgroundRequest),
                });
                const data = await response.json() as Record<string, unknown>;
                if (data.success && data.taskId) {
                  const providerTaskId = String(data.taskId);
                  await stepContext.recordAccepted(providerTaskId);
                  return pollRemoveBackground(providerTaskId);
                }
                return data;
              }, { reconcile: pollRemoveBackground });
              if (rbData.success && typeof rbData.imageUrl === 'string' && rbData.imageUrl) {
                finalImageUrl = rbData.imageUrl;
                step.result = '移除背景成功';
              }
            } else if (step.toolName === 'svg_trace') {
              // 调用 SVG 描摹 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行SVG描摹...' });
              const svgRequest = {
                imageUrl: finalImageUrl,
                mode: step.params.mode || 'color',
                quality: step.params.quality || 'balanced',
              };
              const svgData = await operationContext.executeOperation({
                stepId: stepKey,
                toolId: 'svg_trace',
                requestDigest: digestAgentDownstreamRequest(svgRequest),
              }, async stepContext => {
                await stepContext.beginSubmission();
                const response = await fetch(getInternalApiUrl('/api/svg-trace'), {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(await getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user')),
                    'idempotency-key': stepContext.idempotencyKey,
                  },
                  body: JSON.stringify(svgRequest),
                });
                return response.json();
              });
              if (svgData.success && svgData.svgDataUrl) {
                finalImageUrl = svgData.previewUrl || finalImageUrl;
                step.result = 'SVG描摹成功';
              }
            } else if (step.toolName === 'generate_image') {
              // 调用图像生成 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行图像生成...' });
              const generationPrompt = String(step.params.prompt || prompt);
              const generationAspectRatio = String(step.params.size || '1:1');
              const generationResult = await operationContext.executeOperation({
                stepId: stepKey,
                toolId: 'generate_image',
                requestDigest: digestAgentDownstreamRequest({
                  prompt: generationPrompt,
                  aspectRatio: generationAspectRatio,
                  model: pureImageModel,
                  providerId: imageProviderId,
                }),
              }, async stepContext => {
                await stepContext.beginSubmission();
                const genData = await submitStrictAgentGeneration({
                  userId: authResult.userId,
                  userRole: authResult.userRole === 'admin' ? 'admin' : 'user',
                  prompt: generationPrompt,
                  aspectRatio: generationAspectRatio,
                  model: String(pureImageModel),
                  providerId: String(imageProviderId),
                  idempotencyKey: stepContext.idempotencyKey,
                  submitOnly: true,
                });
                if (!genData.success || !genData.taskId) {
                  throw new AgentDownstreamProviderRejectedError();
                }
                const genTaskId = String(genData.taskId);
                await stepContext.recordAccepted(genTaskId);
                return {
                  success: true as const,
                  imageUrl: await pollAcceptedAgentGeneration({
                    providerTaskId: genTaskId,
                    userId: authResult.userId,
                    userRole: authResult.userRole === 'admin' ? 'admin' : 'user',
                    isCancelled,
                  }),
                };
              }, {
                reconcile: async providerTaskId => ({
                  success: true as const,
                  imageUrl: await pollAcceptedAgentGeneration({
                    providerTaskId,
                    userId: authResult.userId,
                    userRole: authResult.userRole === 'admin' ? 'admin' : 'user',
                    isCancelled,
                  }),
                }),
              });
              finalImageUrl = generationResult.imageUrl;
              step.result = '图像生成成功';
            } else if (step.toolName === 'generate_video') {
              // 调用视频生成 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行视频生成...' });
              const videoRequest = {
                prompt: String(step.params.prompt || prompt),
                mode: step.params.mode === 'image2video' ? 'image2video' : 'text2video',
                imageUrl: step.params.mode === 'image2video' ? finalImageUrl : undefined,
                aspectRatio: step.params.aspect_ratio || '16:9',
                duration: String(step.params.duration || '5'),
              };
              const pollVideo = (providerTaskId: string) => pollAcceptedAgentVideo({
                providerTaskId,
                userId: authResult.userId,
                userRole: authResult.userRole === 'admin' ? 'admin' : 'user',
                isCancelled,
              });
              const pollData = await operationContext.executeOperation({
                stepId: stepKey,
                toolId: 'generate_video',
                requestDigest: digestAgentDownstreamRequest(videoRequest),
              }, async stepContext => {
                await stepContext.beginSubmission();
                const response = await fetch(getInternalApiUrl('/api/video/generate'), {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(await getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user')),
                    'idempotency-key': stepContext.idempotencyKey,
                  },
                  body: JSON.stringify(videoRequest),
                });
                const data = await response.json() as Record<string, unknown>;
                if (!data.success || !data.taskId) throw new Error(String(data.error || 'Video generation was not accepted'));
                const providerTaskId = String(data.taskId);
                await stepContext.recordAccepted(providerTaskId);
                return pollVideo(providerTaskId);
              }, { reconcile: pollVideo });
              const videoUrl = pollData.videoUrl || pollData.url;
              if (videoUrl) {
                step.result = '视频生成成功';
                step.params.videoUrl = videoUrl;
              }
            } else if (step.toolName === 'extend_video') {
              // 调用视频延长 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行视频延长...' });
              const extendRequest = {
                videoUrl: String(step.params.videoUrl || context.videoUrl || ''),
                prompt: String(step.params.prompt || ''),
                extendDuration: Number(step.params.duration || 5),
              };
              const pollVideo = (providerTaskId: string) => pollAcceptedAgentVideo({
                providerTaskId,
                userId: authResult.userId,
                userRole: authResult.userRole === 'admin' ? 'admin' : 'user',
                isCancelled,
              });
              await operationContext.executeOperation({
                stepId: stepKey,
                toolId: 'extend_video',
                requestDigest: digestAgentDownstreamRequest(extendRequest),
              }, async stepContext => {
                await stepContext.beginSubmission();
                const response = await fetch(getInternalApiUrl('/api/video/extend'), {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(await getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user')),
                    'idempotency-key': stepContext.idempotencyKey,
                  },
                  body: JSON.stringify(extendRequest),
                });
                const data = await response.json() as Record<string, unknown>;
                if (!data.success || !data.taskId) throw new Error(String(data.error || 'Video extension was not accepted'));
                const providerTaskId = String(data.taskId);
                await stepContext.recordAccepted(providerTaskId);
                return pollVideo(providerTaskId);
              }, { reconcile: pollVideo });
              step.result = '视频延长成功';
            }
          } catch (err) {
            console.error(`[agent-edit] Tool ${step.toolName} execution failed:`, err);
            if (agentRuntimeMode === 'agent-v2') throw err;
            step.result = `执行失败: ${err instanceof Error ? err.message : '未知错误'}`;
            step.success = false;
          }
        }

        // 任务完成 - 如果已被取消则不覆盖状态
        if (isCancelled()) return;

        // 根据 Agent 结果决定任务状态
        console.log(`[agent-edit] Task ${taskId} finishing, result.success=${result.success} finalImageUrl=${finalImageUrl?.substring(0, 80) || 'none'}`);

        // 持久化 base64 data URL 到服务器文件，避免轮询时序列化巨大 base64 字符串
        let persistedImageUrl = finalImageUrl;
        if (finalImageUrl && (finalImageUrl.startsWith('data:') || finalImageUrl.length > 500_000)) {
          try {
            const saveResp = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/save-image`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(await getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user')),
              },
              body: JSON.stringify({ imageData: finalImageUrl }),
            });
            if (saveResp.ok) {
              const saveData = await saveResp.json();
              if (saveData.url) {
                const domainBase = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
                persistedImageUrl = domainBase
                  ? `${domainBase.startsWith('http') ? '' : 'https://'}${domainBase}${saveData.url}`
                  : saveData.url;
                console.log(`[agent-edit] Persisted base64 image to ${persistedImageUrl.substring(0, 80)}`);
              }
            }
          } catch (persistErr) {
            console.warn('[agent-edit] Failed to persist image, keeping original URL:', persistErr);
          }
        }

        if (result.success) {
          await recordAgentTaskTerminal(taskId, {
            status: 'completed', imageUrl: persistedImageUrl, steps: result.steps, finalResponse: result.finalResponse,
          });
          localTaskStore.set(taskId, {
            userId: authResult.userId,
            status: 'completed',
            progress: 100,
            label: '完成',
            result: {
              imageUrl: persistedImageUrl,
              steps: result.steps,
              finalResponse: result.finalResponse,
            },
            createdAt: localTaskStore.get(taskId)?.createdAt || Date.now(),
          });
        } else {
          await recordAgentTaskTerminal(taskId, {
            status: 'failed', imageUrl: persistedImageUrl, steps: result.steps, finalResponse: result.finalResponse,
            error: translateApiError(result.error || result.finalResponse || 'Agent execution failed'),
          });
          // Agent 执行失败（LLM 调用失败、工具执行失败等）
          localTaskStore.set(taskId, {
            userId: authResult.userId,
            status: 'failed',
            progress: 100,
            label: '失败',
            error: translateApiError(result.error || result.finalResponse || 'Agent 执行失败'),
            result: {
              imageUrl: persistedImageUrl,
              steps: result.steps,
              finalResponse: result.finalResponse,
            },
            createdAt: localTaskStore.get(taskId)?.createdAt || Date.now(),
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '未知错误';
        console.error('[agent-edit] Error:', errMsg);
        if (agentRuntimeMode === 'agent-v2') throw err;
        const task = localTaskStore.get(taskId);
        if (task && task.status === 'processing') {
          await recordAgentTaskTerminal(taskId, {
            status: 'failed', error: translateApiError(errMsg),
          });
          localTaskStore.set(taskId, { ...task, status: 'failed', error: translateApiError(errMsg), progress: 100 });
        }
      } finally {
        clearTimeout(timeout);
      }
    };
    const preparedAgentTask = await prepareAdmittedAgentTaskExecution({
      mode: agentRuntimeMode,
      observation: () => {
        const agentRequest = runtimeRequest();
        return {
          runId: taskId,
          actorUserId: authResult.userId,
          projectId: agentRequest.projectId,
          workspace: agentRequest.workspace,
          providerId: agentRequest.providerId,
          modelId: agentRequest.modelId,
          mode: agentRequest.mode,
          prompt: agentRequest.prompt,
          sourceVersionIds: agentRequest.sourceVersionIds,
          allowedToolIds: agentRequest.allowedToolIds,
        };
      },
      adoption: () => ({
        actor: runtimeActor,
        taskId,
        request: runtimeRequest(),
        toolId: 'agent_edit',
      }),
      execute: executeAgentEditTask,
      recovery: {
        reconcile: async providerTaskId => {
          try {
            const imageUrl = await reconcileAcceptedAgentProviderTask({
              providerTaskId,
              userId: authResult.userId,
              userRole: authResult.userRole === 'admin' ? 'admin' : 'user',
              imageProviderId: String(imageProviderId),
              isCancelled: () => isRegistryCancelled(taskId),
            });
            await recordAgentTaskTerminal(taskId, {
              status: 'completed', imageUrl, steps: [], finalResponse: 'Recovered accepted generation',
            });
            const current = localTaskStore.get(taskId);
            if (current) {
              localTaskStore.set(taskId, {
                ...current, status: 'completed', progress: 100, label: '完成',
                result: { imageUrl, steps: [], finalResponse: 'Recovered accepted generation' },
              });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await recordAgentTaskTerminal(taskId, {
              status: 'failed', code: 'AGENT_DOWNSTREAM_RECONCILIATION_FAILED', error: message,
            });
            const current = localTaskStore.get(taskId);
            if (current) localTaskStore.set(taskId, { ...current, status: 'failed', progress: 100, error: message });
          }
        },
      },
    });
    after(() => {
      void preparedAgentTask.execute().catch(error => {
        console.error('[agent-edit] admitted task execution failed:', error);
      });
    });

    // 立即返回 taskId
    return NextResponse.json({
      success: true,
      taskId,
      mode: 'agent',
      ...(preparedAgentTask.runId ? { runId: preparedAgentTask.runId } : {}),
      ...(admission.value.reused ? {
        status: admission.value.status,
        result: admission.value.result,
        replayed: true,
      } : {}),
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error('[agent-edit] POST error:', err);
    logError(OP_ACTIONS.AGENT_EDIT, err, {
      userId: sessionUser?.id || 'unknown',
      userName: sessionUser?.name || 'unknown',
      model: selectedModel,
      providerId: providerId,
      durationMs,
      detail: `Agent编排编辑请求失败`,
    });
    if (localTaskId) {
      try {
        await recordAgentTaskTerminal(localTaskId, {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Agent request failed',
        });
      } catch (settleError) {
        console.error('[agent-edit] Task settlement failed:', settleError);
      }
    } else if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `Agent编排失败退款`);
      } catch (refundErr) { console.error('[agent-edit] Refund failed:', refundErr); }
    }
    if (err instanceof InsufficientCreditsError || err instanceof IdempotencyConflictError) {
      return NextResponse.json({
        success: false,
        code: err.code,
        error: err.message,
      }, { status: err.statusCode });
    }
    if (
      err instanceof Error
      && 'code' in err
      && 'status' in err
      && typeof err.code === 'string'
      && typeof err.status === 'number'
    ) {
      return NextResponse.json({
        success: false,
        code: err.code,
        error: err.message,
        ...(localTaskId ? { taskId: localTaskId } : {}),
      }, { status: err.status });
    }
    return NextResponse.json(
      { success: false, error: '请求处理失败' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agent-edit
 * 获取支持的 Agent 工具列表 或 查询任务状态
 * 
 * 查询任务状态: /api/agent-edit?taskId=xxx
 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  const action = searchParams.get('action');

  if (taskId && action !== 'cancel' && !localTaskStore.has(taskId)) {
    const persisted = await getCloudTaskForUser(taskId, authResult.userId);
    if (persisted) {
      return NextResponse.json({
        success: persisted.status === 'completed',
        status: persisted.status,
        progress: persisted.progress,
        label: persisted.label,
        result: persisted.result,
        error: persisted.error,
      });
    }
  }

  if (taskId && action === 'cancel') {
    // 取消任务
    const task = localTaskStore.get(taskId);
    if (!task || !canAccessAgentTask(task.userId, authResult.userId, authResult.userRole)) {
      return NextResponse.json({ success: false, error: 'Task not found or access denied' }, { status: 404 });
    }
    if (task && task.status === 'processing') {
      await recordAgentTaskTerminal(taskId, { status: 'cancelled', error: 'Task cancelled by user' });
      localTaskStore.set(taskId, { ...task, status: 'cancelled', error: '任务已取消' });
      return NextResponse.json({ success: true, status: 'cancelled' });
    }
    return NextResponse.json({ success: false, error: '任务不存在或无法取消' });
  }

  if (taskId) {
    // 查询任务状态
    const task = localTaskStore.get(taskId);
    if (!task || !canAccessAgentTask(task.userId, authResult.userId, authResult.userRole)) {
      return NextResponse.json({
        success: false,
        status: 'not_found',
        error: '任务不存在或已过期',
        retryable: false,
      });
    }

    return NextResponse.json({
      success: task.status === 'completed',
      status: task.status,
      progress: task.progress,
      label: task.label,
      result: task.result,
      error: task.error,
    });
  }

  // 默认：获取工具列表
  const { getToolsForLLM: getTools } = await import('@/lib/agent-engine');
  return NextResponse.json({
    tools: getTools(),
  });
}

// ─── 实际图像编辑执行 ──────────────────────────────────────────────

async function performImageEdit(
  imageUrl: string,
  editPrompt: string,
  maskDataUrl: string | undefined,
  imageModelFromFrontend?: string,
  imageProviderIdFromFrontend?: string,
  qualityFromFrontend?: string,
  aspectRatioFromFrontend?: string,
  strictProviderModel = false,
  providerIdempotencyKey?: string,
  recordAccepted?: (providerTaskId: string) => Promise<void>,
  beginSubmission?: () => Promise<void>,
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  // 优先使用前端传递的图像模型和提供商，遵循用户在图像生成面板的选择
  console.log('[agent-edit] performImageEdit called, model:', imageModelFromFrontend, 'providerId:', imageProviderIdFromFrontend);
  let imageProvider: ApiProvider | null = null;
  if (imageProviderIdFromFrontend) {
    imageProvider = await findProviderById(imageProviderIdFromFrontend);
    console.log('[agent-edit] findProviderById result:', imageProvider ? imageProvider.name : 'null');
  }
  if (!imageProvider && imageModelFromFrontend && !strictProviderModel) {
    imageProvider = await findProviderForModel(imageModelFromFrontend, 'image', imageProviderIdFromFrontend);
    console.log('[agent-edit] findProviderForModel result:', imageProvider ? imageProvider.name : 'null');
  }
  if (!imageProvider && !strictProviderModel) {
    // 兜底：查找图像编辑提供商
    imageProvider = await findProviderForFeature('imageEdit');
    console.log('[agent-edit] findProviderForFeature(imageEdit) result:', imageProvider ? imageProvider.name : 'null');
  }
  if (!imageProvider) {
    console.error('[agent-edit] No image provider configured');
    return { success: false, error: '未配置图像模型，请在管理员面板添加图像模型提供商' };
  }

  const baseUrl = imageProvider.baseUrl?.replace(/\/+$/, '') || '';
  const apiKey = imageProvider.apiKey || '';
  const exactImageModel = imageModelFromFrontend || imageProvider.selectedModels?.[0] || '';
  let imageModel = strictProviderModel ? exactImageModel : stripProviderModelPrefix(exactImageModel);
  const pImgNorm = strictProviderModel ? imageModel : normalizeModelForApi(imageModel);
  if (typeof pImgNorm !== 'string' && pImgNorm.wasNormalized) {
    console.log(`[agent-edit] Normalized performImageEdit model: "${imageModel}" → "${pImgNorm.apiModelName}"`);
    imageModel = pImgNorm.apiModelName;
  }

  if (!baseUrl || !apiKey || !imageModel) {
    console.error('[agent-edit] Image provider config incomplete:', { baseUrl: !!baseUrl, apiKey: !!apiKey, imageModel });
    return { success: false, error: '图像提供商配置不完整（缺少 URL / Key / 模型名）' };
  }

  // 使用 API 兼容层确定正确的端点
  const profile = resolveCompatProfile(imageProvider);
  const resolvedEndpoint = profile.editEndpoint || '/images/edits';

  // Path A: 支持 /images/edits 端点的提供商（OpenAI 官方等）
  if (resolvedEndpoint === '/images/edits') {
    console.log('[agent-edit] Path A: /images/edits, baseUrl:', baseUrl, 'model:', imageModel);
    let providerSubmissionStarted = false;
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        ...(providerIdempotencyKey ? { 'Idempotency-Key': providerIdempotencyKey } : {}),
      };

      const formData = new FormData();
      formData.append('model', imageModel);
      formData.append('prompt', editPrompt);
      formData.append('n', '1');
      const effectiveQuality = qualityFromFrontend || '1K';
      const effectiveAspectRatio = aspectRatioFromFrontend || '1:1';
      const dynamicSize = calculateActualPixelsFromRatio(effectiveAspectRatio, effectiveQuality, imageModel) || '1024x1024';
      formData.append('size', dynamicSize);

      // 添加图片
      if (imageUrl.startsWith('data:')) {
        const blob = dataUrlToBlob(imageUrl);
        formData.append('image', blob, 'image.png');
      } else {
        const imgResp = await fetch(imageUrl.startsWith('/') ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}` : imageUrl, {
          signal: AbortSignal.timeout(30000),
        });
        if (!imgResp.ok) return { success: false, error: `无法下载图片: ${imgResp.status}` };
        const imgBlob = await imgResp.blob();
        formData.append('image', imgBlob, 'image.png');
      }

      // 添加蒙版
      if (maskDataUrl?.startsWith('data:')) {
        const maskBlob = dataUrlToBlob(maskDataUrl);
        formData.append('mask', maskBlob, 'mask.png');
      }

      console.log('[agent-edit] Path A: sending request to', `${baseUrl}/images/edits`);
      await beginSubmission?.();
      providerSubmissionStarted = true;
      const resp = await submitAgentImageProviderRequest({
        baseUrl,
        path: '/images/edits',
        exactModel: imageModel,
        headers,
        body: formData,
        signal: AbortSignal.timeout(120000),
        strictProviderModel,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.error('[agent-edit] Path A: API error', resp.status, errText.slice(0, 300));
        if (strictProviderModel) throw new AgentDownstreamProviderRejectedError(resp.status);
        if (errText.includes('No available channel') || errText.includes('model_not_found') || errText.includes('not configured')) {
          return { success: false, error: `模型在当前渠道暂不可用，请稍后重试或更换模型` };
        }

        // ★ Try /chat/completions fallback for channel errors
        if (!strictProviderModel && isChannelUnavailableError(`${errText} ${resp.status}`)) {
          console.info('[agent-edit] Path A: channel error, trying /chat/completions fallback...');
          try {
            const chatImageUrls = await tryChatCompletionsImageFallback({
              baseUrl,
              apiKey,
              model: imageModel,
              prompt: editPrompt,
              imageBase64: imageUrl,
              imageUrls: imageUrl ? [imageUrl] : undefined,
              originalError: errText,
              requestIdPrefix: 'agent-edit-pathA',
              skipChannelCheck: true,
            });
            if (chatImageUrls && chatImageUrls.length > 0) {
              console.log('[agent-edit] Path A: /chat/completions fallback succeeded');
              return { success: true, imageUrl: chatImageUrls[0] };
            }
          } catch (chatErr) {
            console.warn('[agent-edit] Path A: /chat/completions fallback error:', chatErr);
          }
        }

        return { success: false, error: `OpenAI edit 失败 (${resp.status}): ${errText.slice(0, 200)}` };
      }

      const data = await resp.json() as Record<string, unknown>;
      const images = data.data as Array<Record<string, unknown>> | undefined;
      if (images && images.length > 0) {
        let resultUrl = '';
        const rawB64 = images[0].b64_json;
        const rawUrl = images[0].url ? String(images[0].url) : '';
        if (rawB64) {
          resultUrl = `data:image/png;base64,${rawB64}`;
        } else if (rawUrl) {
          // 某些API在url字段直接返回base64字符串（无data:前缀）
          if (rawUrl.startsWith('data:') || rawUrl.startsWith('http')) {
            resultUrl = rawUrl;
          } else if (/^[A-Za-z0-9+/=\s]+$/.test(rawUrl.slice(0, 100)) && rawUrl.length > 200) {
            resultUrl = `data:image/png;base64,${rawUrl}`;
          } else {
            resultUrl = rawUrl;
          }
        }
        console.log('[agent-edit] Path A: success, got result, b64_json:', !!rawB64, 'url type:', rawUrl.startsWith('http') ? 'http' : rawUrl.startsWith('data:') ? 'data-url' : rawUrl.length > 200 ? 'raw-base64' : 'short', 'length:', resultUrl.length);
        return { success: true, imageUrl: resultUrl };
      }

      console.error('[agent-edit] Path A: no images in response', JSON.stringify(data).slice(0, 200));
      return { success: false, error: 'OpenAI 未返回图片' };
    } catch (err) {
      if (strictProviderModel && providerSubmissionStarted) throw err;
      // Timeout → try /chat/completions fallback
      const isTimeout = err instanceof Error && (err.name === 'AbortError' || /timeout|aborted/i.test(err.message));
      if (isTimeout && !strictProviderModel) {
        console.info('[agent-edit] Path A: timed out, trying /chat/completions fallback...');
        try {
          const chatImageUrls = await tryChatCompletionsImageFallback({
            baseUrl,
            apiKey,
            model: imageModel,
            prompt: editPrompt,
            imageBase64: imageUrl,
            imageUrls: imageUrl ? [imageUrl] : undefined,
            originalError: 'timeout',
            requestIdPrefix: 'agent-edit-pathA',
            skipChannelCheck: true,
          });
          if (chatImageUrls && chatImageUrls.length > 0) {
            console.log('[agent-edit] Path A: /chat/completions fallback succeeded (after timeout)');
            return { success: true, imageUrl: chatImageUrls[0] };
          }
        } catch (chatErr) {
          console.warn('[agent-edit] Path A: /chat/completions fallback error (after timeout):', chatErr);
        }
      }
      console.error('[agent-edit] Path A: exception', err);
      return { success: false, error: err instanceof Error ? translateApiError(err.message) : '编辑请求异常' };
    }
  }

  // Path B: /images/generations 端点（APImart 等兼容 API）
  if (resolvedEndpoint === '/images/generations') {
    console.log('[agent-edit] Path B: /images/generations, baseUrl:', baseUrl, 'model:', imageModel);
    let imageBase64 = '';
    let imageMimeType = 'image/png';
    let providerSubmissionStarted = false;
    try {
      // 解析图片为 base64
      if (imageUrl.startsWith('data:')) {
        const commaIdx = imageUrl.indexOf(',');
        const header = imageUrl.substring(0, commaIdx);
        const mimeMatch = header.match(/data:([^;]+)/);
        imageMimeType = mimeMatch?.[1] || 'image/png';
        imageBase64 = imageUrl.substring(commaIdx + 1);
      } else {
        const imgResp = await fetch(imageUrl.startsWith('/') ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}` : imageUrl, {
          signal: AbortSignal.timeout(30000),
        });
        if (!imgResp.ok) return { success: false, error: `无法下载图片: ${imgResp.status}` };
        const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
        imageBase64 = imgBuffer.toString('base64');
        imageMimeType = imgResp.headers.get('content-type') || 'image/png';
      }

      // 构建 images/generations 请求体
      const effectiveQuality = qualityFromFrontend || '1K';
      const effectiveAspectRatio = aspectRatioFromFrontend || '1:1';
      const dynamicSize = calculateActualPixelsFromRatio(effectiveAspectRatio, effectiveQuality, imageModel) || '2048x2048';
      const { body: genBody } = adjustRequestForProfile(
        {
          model: imageModel,
          prompt: editPrompt,
          n: 1,
          size: dynamicSize,
          quality: effectiveQuality,
          image_urls: [`data:${imageMimeType};base64,${imageBase64}`],
        },
        profile,
        { hasImage: true, isEditEndpoint: false }
      );

      const genHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(providerIdempotencyKey ? { 'Idempotency-Key': providerIdempotencyKey } : {}),
      };

      console.log('[agent-edit] Path B: sending request to', `${baseUrl}/images/generations`, 'with image_urls');
      await beginSubmission?.();
      providerSubmissionStarted = true;
      const genResp = await submitAgentImageProviderRequest({
        baseUrl,
        path: '/images/generations',
        exactModel: imageModel,
        headers: genHeaders,
        body: genBody,
        signal: AbortSignal.timeout(120000),
        strictProviderModel,
      });

      if (!genResp.ok) {
        const errText = await genResp.text().catch(() => '');
        console.error('[agent-edit] Path B: API error', genResp.status, errText.slice(0, 300));
        if (strictProviderModel) throw new AgentDownstreamProviderRejectedError(genResp.status);

        // ★ Try /chat/completions fallback for channel errors
        if (!strictProviderModel && isChannelUnavailableError(`${errText} ${genResp.status}`)) {
          console.info('[agent-edit] Path B: channel error, trying /chat/completions fallback...');
          try {
            const chatImageUrls = await tryChatCompletionsImageFallback({
              baseUrl,
              apiKey,
              model: imageModel,
              prompt: editPrompt,
              imageBase64: `data:${imageMimeType};base64,${imageBase64}`,
              imageUrls: [`data:${imageMimeType};base64,${imageBase64}`],
              originalError: errText,
              requestIdPrefix: 'agent-edit-pathB',
              skipChannelCheck: true,
            });
            if (chatImageUrls && chatImageUrls.length > 0) {
              console.log('[agent-edit] Path B: /chat/completions fallback succeeded');
              return { success: true, imageUrl: chatImageUrls[0] };
            }
          } catch (chatErr) {
            console.warn('[agent-edit] Path B: /chat/completions fallback error:', chatErr);
          }
        }

        const parsed = translateApiError(`编辑请求失败 (${genResp.status}): ${errText.slice(0, 200)}`);
        return { success: false, error: parsed };
      }

      // 解析响应 JSON
      const genData = await genResp.json() as Record<string, unknown>;
      const parsedResult = parseResponseForProfile(genData, profile);

      if (parsedResult.mode === 'polling' && parsedResult.taskIds.length > 0) {
        // 异步任务 - 轮询等待结果
        const remoteTaskId = parsedResult.taskIds[0];
        await recordAccepted?.(remoteTaskId);
        let pollAttempts = 0;
        const maxPollAttempts = 60;
        const pollInterval = 5000;
        const pollUrl = (profile.pollPathTemplate || '/tasks/{taskId}').replace('{taskId}', remoteTaskId);

        while (pollAttempts < maxPollAttempts) {
          await new Promise(r => setTimeout(r, pollInterval));
          pollAttempts++;

          const pollResp = await fetchWithV1Retry(baseUrl, pollUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(30000),
          });

          if (!pollResp.ok) continue;

          const pollData = await pollResp.json() as Record<string, unknown>;
          const status = String(pollData.status || '').toLowerCase();

          function extractImgUrl(obj: Record<string, unknown>): string {
            const rawB64 = obj.b64_json ? String(obj.b64_json) : '';
            const rawUrl = obj.url ? String(obj.url) : '';
            if (rawB64) return `data:image/png;base64,${rawB64}`;
            if (!rawUrl) return '';
            if (rawUrl.startsWith('data:') || rawUrl.startsWith('http')) return rawUrl;
            if (/^[A-Za-z0-9+/=\s]+$/.test(rawUrl.slice(0, 100)) && rawUrl.length > 200) return `data:image/png;base64,${rawUrl}`;
            return rawUrl;
          }
          if (status === 'completed' || status === 'success' || status === 'succeeded') {
            const resultsRaw = pollData.results || pollData.images || pollData.data;
            if (Array.isArray(resultsRaw) && resultsRaw.length > 0) {
              const first = resultsRaw[0] as Record<string, unknown>;
              const resultUrl = extractImgUrl(first);
              if (resultUrl) return { success: true, imageUrl: resultUrl };
            } else if (resultsRaw && typeof resultsRaw === 'object' && !Array.isArray(resultsRaw)) {
              const dataObj = resultsRaw as Record<string, unknown>;
              const imagesArr = dataObj.images || dataObj.results;
              if (Array.isArray(imagesArr) && imagesArr.length > 0) {
                const first = imagesArr[0] as Record<string, unknown>;
                const resultUrl = extractImgUrl(first);
                if (resultUrl) return { success: true, imageUrl: resultUrl };
              }
            }
            break;
          }

          if (status === 'failed' || status === 'error') {
            const errMsg = String((pollData.error as Record<string, unknown>)?.message || pollData.message || '远程任务失败');
            if (strictProviderModel) {
              if (status === 'error' && pollData.retryable === true) {
                throw retryableProviderTaskPollError(pollData, status);
              }
              throw knownProviderTaskRejection(pollData, status);
            }
            return { success: false, error: translateApiError(errMsg) };
          }
        }

        if (strictProviderModel) throw new Error('编辑任务轮询超时');
        return { success: false, error: '编辑任务轮询超时' };
      }

      // 直接返回结果
      if (parsedResult.directImageUrls.length > 0) {
        console.log('[agent-edit] Path B: direct result, got', parsedResult.directImageUrls.length, 'images');
        return { success: true, imageUrl: parsedResult.directImageUrls[0] };
      }

      console.error('[agent-edit] Path B: no images in response');
      return { success: false, error: '模型未返回编辑后的图片' };
    } catch (err) {
      if (strictProviderModel && providerSubmissionStarted) throw err;
      // Timeout → try /chat/completions fallback
      const isTimeout = err instanceof Error && (err.name === 'AbortError' || /timeout|aborted/i.test(err.message));
      if (isTimeout && !strictProviderModel) {
        console.info('[agent-edit] Path B: timed out, trying /chat/completions fallback...');
        try {
          const chatImageUrls = await tryChatCompletionsImageFallback({
            baseUrl,
            apiKey,
            model: imageModel,
            prompt: editPrompt,
            imageBase64: `data:${imageMimeType};base64,${imageBase64}`,
            imageUrls: [`data:${imageMimeType};base64,${imageBase64}`],
            originalError: 'timeout',
            requestIdPrefix: 'agent-edit-pathB',
            skipChannelCheck: true,
          });
          if (chatImageUrls && chatImageUrls.length > 0) {
            console.log('[agent-edit] Path B: /chat/completions fallback succeeded (after timeout)');
            return { success: true, imageUrl: chatImageUrls[0] };
          }
        } catch (chatErr) {
          console.warn('[agent-edit] Path B: /chat/completions fallback error (after timeout):', chatErr);
        }
      }
      console.error('[agent-edit] Path B: exception', err);
      return { success: false, error: err instanceof Error ? translateApiError(err.message) : '编辑请求失败' };
    }
  }

  // 非 OpenAI: 使用 chat/completions + 图片输入 (Gemini / 兼容 API)
  // 直接调用提供商 API，不经过 /api/edit 路由（避免 Next.js dev 模式内存隔离问题）
  console.log('[agent-edit] Path C: chat/completions, baseUrl:', baseUrl, 'model:', imageModel);
  let providerSubmissionStarted = false;
  try {
    // 解析图片为 base64
    let imageBase64 = '';
    let imageMimeType = 'image/png';
    if (imageUrl.startsWith('data:')) {
      const commaIdx = imageUrl.indexOf(',');
      const header = imageUrl.substring(0, commaIdx);
      const mimeMatch = header.match(/data:([^;]+)/);
      imageMimeType = mimeMatch?.[1] || 'image/png';
      imageBase64 = imageUrl.substring(commaIdx + 1);
    } else {
      // 下载图片
      const imgResp = await fetch(imageUrl.startsWith('/') ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}` : imageUrl, {
        signal: AbortSignal.timeout(30000),
      });
      if (!imgResp.ok) return { success: false, error: `无法下载图片: ${imgResp.status}` };
      const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
      imageBase64 = imgBuffer.toString('base64');
      imageMimeType = imgResp.headers.get('content-type') || 'image/png';
    }

    // 构建 chat/completions 请求
    const chatMessages: Array<Record<string, unknown>> = [
      {
        role: 'user',
        content: [
          { type: 'text', text: editPrompt },
          { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
        ],
      },
    ];

    // 如果有蒙版，也添加进去
    if (maskDataUrl?.startsWith('data:')) {
      const maskCommaIdx = maskDataUrl.indexOf(',');
      const maskHeader = maskDataUrl.substring(0, maskCommaIdx);
      const maskMimeMatch = maskHeader.match(/data:([^;]+)/);
      const maskMime = maskMimeMatch?.[1] || 'image/png';
      const maskBase64 = maskDataUrl.substring(maskCommaIdx + 1);
      const maskContent = (chatMessages[0].content as Array<Record<string, unknown>>);
      maskContent.push({ type: 'image_url', image_url: { url: `data:${maskMime};base64,${maskBase64}` } });
      maskContent[0] = { type: 'text', text: `${editPrompt}\n\n第二张图片是需要修改的蒙版区域（白色=修改区域）。请仅修改蒙版标记的区域。` };
    }

    const chatBody = {
      model: imageModel,
      messages: chatMessages,
      max_tokens: 4096,
      stream: false,
    };

    const chatHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(providerIdempotencyKey ? { 'Idempotency-Key': providerIdempotencyKey } : {}),
    };

    console.log('[agent-edit] Path C: sending request to', `${baseUrl}/chat/completions`);
    await beginSubmission?.();
    providerSubmissionStarted = true;
    const chatResp = await submitAgentImageProviderRequest({
      baseUrl,
      path: '/chat/completions',
      exactModel: imageModel,
      headers: chatHeaders,
      body: chatBody,
      signal: AbortSignal.timeout(120000),
      strictProviderModel,
    });

    if (!chatResp.ok) {
      const errText = await chatResp.text().catch(() => '');
      console.error('[agent-edit] Path C: API error', chatResp.status, errText.slice(0, 300));
      if (strictProviderModel) throw new AgentDownstreamProviderRejectedError(chatResp.status);
      return { success: false, error: `编辑请求失败 (${chatResp.status}): ${errText.slice(0, 200)}` };
    }

    // 解析响应（兼容 SSE 流式响应）
    const chatData = await parseAPIResponse(chatResp);

    // 提取图片 URL
    const choices = chatData.choices as Array<Record<string, unknown>> | undefined;
    if (choices && choices.length > 0) {
      const message = choices[0].message as Record<string, unknown> | undefined;
      if (message) {
        // 检查 message.content 是否包含图片
        const content = message.content;
        if (typeof content === 'string' && content.includes('data:image')) {
          // 从文本中提取 base64 图片
          const imgMatch = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
          if (imgMatch) return { success: true, imageUrl: imgMatch[0] };
        }
        // 检查 Gemini 格式的 inline_data
        if (Array.isArray(content)) {
          for (const part of content) {
            const p = part as Record<string, unknown>;
            if (p.type === 'image_url' && p.image_url) {
              const iu = p.image_url as Record<string, unknown>;
              if (iu.url) return { success: true, imageUrl: String(iu.url) };
            }
            if (p.inline_data) {
              const id = p.inline_data as Record<string, unknown>;
              if (id.data) return { success: true, imageUrl: `data:${id.mime_type || 'image/png'};base64,${id.data}` };
            }
          }
        }
      }
    }

    // 尝试 images/generations 格式的响应
    const dataArr = chatData.data as Array<Record<string, unknown>> | undefined;
    if (dataArr && dataArr.length > 0) {
      const resultUrl = String(dataArr[0].url || dataArr[0].b64_json || '');
      if (resultUrl) {
        return { success: true, imageUrl: resultUrl.startsWith('data:') ? resultUrl : resultUrl };
      }
    }

    return { success: false, error: '模型未返回编辑后的图片' };
  } catch (err) {
    if (strictProviderModel && providerSubmissionStarted) throw err;
    console.error('[agent-edit] Path C: exception', err);
    return { success: false, error: err instanceof Error ? translateApiError(err.message) : '编辑请求失败' };
  }
}

function stripProviderModelPrefix(model: string): string {
  return model.includes('::') ? model.split('::').pop()! : model;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

// ─── SSE 解析工具 ──────────────────────────────────────────────────

/**
 * 从 SSE 流式响应中解析出完整的 JSON 对象
 * 将多个 data: {...} 事件中的 delta 合并为完整 message
 */
/**
 * 自动检测响应格式并解析为 JSON（兼容 SSE 流和普通 JSON）
 */
async function parseAPIResponse(resp: Response): Promise<Record<string, unknown>> {
  const contentType = resp.headers.get('content-type') || '';
  const text = await resp.text();

  // 尝试直接解析 JSON
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // 不是纯 JSON，尝试 SSE 解析
  }

  // SSE 格式解析
  if (contentType.includes('text/event-stream') || text.trim().startsWith('data: ')) {
    return parseSSETextToJSON(text);
  }

  // 无法解析
  throw new Error(`无法解析 API 响应: ${text.slice(0, 200)}`);
}

async function parseSSEToJSON(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  return parseSSETextToJSON(text);
}

/**
 * 从 SSE 文本中解析出完整的 JSON 对象
 * 处理两种情况：
 * 1. 单个完整 JSON 响应（某些代理以 SSE 格式返回完整响应）
 * 2. 标准 SSE delta 流（需要合并 deltas）
 */
function parseSSETextToJSON(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  let fullContent = '';
  const toolCalls: Array<{ id?: string; type?: string; function: { name: string; arguments: string } }> = [];
  let lastFinishReason = '';
  let model = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) continue;

    const dataStr = trimmed.slice(6); // 去掉 "data: "

    if (dataStr === '[DONE]') break;

    try {
      const event = JSON.parse(dataStr) as Record<string, unknown>;
      model = String(event.model || model);

      const choices = event.choices as Array<Record<string, unknown>> | undefined;
      if (!choices || choices.length === 0) continue;

      const choice = choices[0];
      const delta = choice.delta as Record<string, unknown> | undefined;

      if (delta) {
        // 合并 content
        if (typeof delta.content === 'string') {
          fullContent += delta.content;
        }

        // 合并 tool_calls
        const deltaToolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (deltaToolCalls) {
          for (const dtc of deltaToolCalls) {
            const idx = Number(dtc.index ?? toolCalls.length);
            while (toolCalls.length <= idx) {
              toolCalls.push({ function: { name: '', arguments: '' } });
            }
            const fn = dtc.function as Record<string, unknown> | undefined;
            if (fn) {
              if (fn.name) toolCalls[idx].function.name += String(fn.name);
              if (fn.arguments) toolCalls[idx].function.arguments += String(fn.arguments);
            }
            if (dtc.id) toolCalls[idx].id = String(dtc.id);
            if (dtc.type) toolCalls[idx].type = String(dtc.type);
          }
        }
      }

      // 记录 finish_reason
      if (choice.finish_reason) {
        lastFinishReason = String(choice.finish_reason);
      }
    } catch {
      // 跳过无法解析的行
      continue;
    }
  }

  // 构造与标准 JSON 响应相同格式的对象
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: fullContent || null,
  };

  // 只有有 tool_calls 时才添加
  const validToolCalls = toolCalls.filter(tc => tc.function.name || tc.function.arguments);
  if (validToolCalls.length > 0) {
    message.tool_calls = validToolCalls;
  }

  return {
    id: `sse-${Date.now()}`,
    object: 'chat.completion',
    model,
    choices: [{
      index: 0,
      message,
      finish_reason: lastFinishReason || (validToolCalls.length > 0 ? 'tool_calls' : 'stop'),
    }],
  };
}
