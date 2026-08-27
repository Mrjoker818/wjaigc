import { randomUUID } from 'node:crypto';

import {
  completeCloudTask,
  getCloudTaskForUser,
  type CloudTask,
} from '@/lib/cloud-task-storage';
import { getOtherOperationCredits, InsufficientCreditsError } from '@/lib/credits';
import {
  createPsdAnalysisRequestDigest,
  parsePsdAnalysisOutput,
  PsdAnalysisError,
  type PsdAnalysisRequest,
  type PsdAnalysisResult,
} from '@/lib/psd-analysis/contracts';
import {
  resolvePsdAnalysisMedia,
  type ResolvedPsdAnalysisMedia,
} from '@/lib/psd-analysis/media';
import {
  buildPsdVisionCandidates,
  invokePsdVisionCandidates,
  type BuildPsdVisionCandidatesInput,
  type InvokePsdVisionCandidatesInput,
  type PsdVisionCandidate,
  type PsdVisionInvocationResult,
} from '@/lib/psd-analysis/model-router';
import {
  createBillableTask,
  settleFailedTask,
  type CreateBillableTaskInput,
  type CreateBillableTaskResult,
  type SettleFailedTaskInput,
  type SettleFailedTaskResult,
} from '@/lib/task-core/billing-service';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

const PSD_ANALYSIS_DEADLINE_MS = 45_000;
const PSD_ANALYSIS_REUSE_POLL_MS = 150;

const PSD_ANALYSIS_PROMPT = `Analyze this image for editable PSD decomposition. Return only one JSON object with:
- backgroundColor: [r,g,b]
- backgroundMode: white | corner | color | white-preserve | none
- layers: 1-8 entries ordered back-to-front, with the background first
Each layer must contain name, role (bg | subject | text | deco | fx), and description.`;

type TaskStatus = CloudTask['status'] | 'created' | 'submitting' | 'uploading';

export interface PsdAnalysisTaskRecord {
  id: string;
  userId: string;
  type: string;
  status: TaskStatus;
  progress: number;
  result?: Record<string, unknown>;
  error?: string;
  creditStatus: 'pending' | 'charged' | 'refunded' | 'not-applicable';
  creditCost?: number;
  createdAt: number;
  updatedAt: number;
  revision?: number;
  idempotencyKey?: string;
  requestDigest?: string;
  providerId?: string;
  model?: string;
}

export interface PsdAnalysisExecutionResult {
  taskId: string;
  requestId: string;
  providerId: string;
  model: string;
  fallbackReason?: string;
  analysis: PsdAnalysisResult;
}

export interface PsdAnalysisServiceDependencies {
  resolveMedia: (input: {
    request: PsdAnalysisRequest;
    actorUserId: string;
    signal?: AbortSignal;
  }) => Promise<ResolvedPsdAnalysisMedia>;
  loadProviders: () => Promise<ApiProvider[]>;
  buildCandidates: (input: BuildPsdVisionCandidatesInput) => PsdVisionCandidate[];
  invokeVision: (input: InvokePsdVisionCandidatesInput) => Promise<PsdVisionInvocationResult>;
  createTask: (input: CreateBillableTaskInput) => Promise<CreateBillableTaskResult>;
  getTask: (taskId: string, userId: string) => Promise<PsdAnalysisTaskRecord | null>;
  completeTask: (taskId: string, result: Record<string, unknown>) => Promise<boolean>;
  settleFailed: (input: SettleFailedTaskInput) => Promise<SettleFailedTaskResult>;
  creditCost: number;
  createTaskId: () => string;
  now: () => number;
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  platformModel?: string;
}

export interface ExecutePsdAnalysisInput {
  request: PsdAnalysisRequest;
  user: User;
  requestId: string;
  requestSignal?: AbortSignal;
  dependencies?: Partial<PsdAnalysisServiceDependencies>;
}

interface PersistedPsdAnalysisResult extends Record<string, unknown> {
  schema: 'psd-analysis-result.v1';
  requestId: string;
  imageSha256: string;
  providerId: string;
  model: string;
  fallbackReason?: string;
  analysis: PsdAnalysisResult;
}

function waitWithAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      reject(signal.reason);
    }
    signal.addEventListener('abort', aborted, { once: true });
  });
}

function defaultDependencies(): PsdAnalysisServiceDependencies {
  return {
    resolveMedia: resolvePsdAnalysisMedia,
    loadProviders: async () => (await import('@/lib/server-api-config')).getApiProviders(),
    buildCandidates: buildPsdVisionCandidates,
    invokeVision: invokePsdVisionCandidates,
    createTask: createBillableTask,
    getTask: getCloudTaskForUser,
    completeTask: completeCloudTask,
    settleFailed: settleFailedTask,
    creditCost: getOtherOperationCredits('segment'),
    createTaskId: () => `psd_analysis_${randomUUID()}`,
    now: Date.now,
    wait: waitWithAbort,
    platformModel: process.env.PSD_ANALYSIS_PLATFORM_MODEL?.trim() || undefined,
  };
}

function createLinkedDeadline(source?: AbortSignal): {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const linked = new AbortController();
  let deadlineExpired = false;
  const timer = setTimeout(() => {
    deadlineExpired = true;
    linked.abort(new Error('PSD_ANALYSIS_DEADLINE'));
  }, PSD_ANALYSIS_DEADLINE_MS);
  const onSourceAbort = () => linked.abort(source?.reason);
  source?.addEventListener('abort', onSourceAbort, { once: true });
  if (source?.aborted) onSourceAbort();
  return {
    signal: linked.signal,
    timedOut: () => deadlineExpired,
    dispose: () => {
      clearTimeout(timer);
      source?.removeEventListener('abort', onSourceAbort);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function terminalError(task: PsdAnalysisTaskRecord): PsdAnalysisError {
  const result = isRecord(task.result) ? task.result : {};
  const code = typeof result.errorCode === 'string'
    ? result.errorCode
    : task.status === 'timeout'
      ? 'PSD_ANALYSIS_TIMEOUT'
      : task.status === 'cancelled'
        ? 'PSD_ANALYSIS_CANCELLED'
        : 'PSD_ANALYSIS_FAILED';
  const status = typeof result.errorStatus === 'number'
    ? result.errorStatus
    : task.status === 'timeout'
      ? 504
      : task.status === 'cancelled'
        ? 499
        : 502;
  return new PsdAnalysisError(
    code,
    task.error || 'PSD 分析任务失败',
    status,
    result.errorRetryable === true,
  );
}

function replayCompletedTask(task: PsdAnalysisTaskRecord): PsdAnalysisExecutionResult {
  if (!isRecord(task.result) || task.result.schema !== 'psd-analysis-result.v1') {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_TASK_RESULT_INVALID',
      'PSD 分析任务结果损坏或不完整',
      502,
      false,
    );
  }
  const providerId = typeof task.result.providerId === 'string' ? task.result.providerId : '';
  const model = typeof task.result.model === 'string' ? task.result.model : '';
  const requestId = typeof task.result.requestId === 'string' ? task.result.requestId : '';
  if (!providerId || !model || !requestId) {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_TASK_RESULT_INVALID',
      'PSD 分析任务缺少执行身份',
      502,
      false,
    );
  }
  const analysis = parsePsdAnalysisOutput(JSON.stringify(task.result.analysis));
  const fallbackReason = typeof task.result.fallbackReason === 'string'
    ? task.result.fallbackReason
    : undefined;
  return {
    taskId: task.id,
    requestId,
    providerId,
    model,
    ...(fallbackReason ? { fallbackReason } : {}),
    analysis,
  };
}

function replayTerminalTask(task: PsdAnalysisTaskRecord): PsdAnalysisExecutionResult {
  if (task.status === 'completed') return replayCompletedTask(task);
  if (task.status === 'failed' || task.status === 'timeout' || task.status === 'cancelled') {
    throw terminalError(task);
  }
  throw new PsdAnalysisError(
    'PSD_ANALYSIS_TASK_STATE_INVALID',
    `PSD 分析任务处于不可重放状态：${task.status}`,
    409,
    true,
  );
}

function abortError(timedOut: boolean, cause?: unknown): PsdAnalysisError {
  return timedOut
    ? new PsdAnalysisError(
        'PSD_ANALYSIS_TIMEOUT',
        'PSD 分析超过 45 秒总截止时间',
        504,
        true,
        { cause },
      )
    : new PsdAnalysisError(
        'PSD_ANALYSIS_CANCELLED',
        'PSD 分析请求已取消',
        499,
        false,
        { cause },
      );
}

function normalizeExecutionError(
  error: unknown,
  signal: AbortSignal,
  timedOut: boolean,
): PsdAnalysisError {
  if (signal.aborted) return abortError(timedOut, error);
  if (error instanceof PsdAnalysisError) return error;
  return new PsdAnalysisError(
    'PSD_ANALYSIS_FAILED',
    error instanceof Error ? error.message : 'PSD 分析执行失败',
    500,
    false,
    { cause: error },
  );
}

async function waitForTerminalTask(
  task: PsdAnalysisTaskRecord,
  userId: string,
  signal: AbortSignal,
  timedOut: () => boolean,
  dependencies: PsdAnalysisServiceDependencies,
): Promise<PsdAnalysisExecutionResult> {
  let current = task;
  while (
    current.status === 'created'
    || current.status === 'queued'
    || current.status === 'pending'
    || current.status === 'submitting'
    || current.status === 'processing'
    || current.status === 'uploading'
  ) {
    if (signal.aborted) throw abortError(timedOut(), signal.reason);
    await dependencies.wait(PSD_ANALYSIS_REUSE_POLL_MS, signal);
    const refreshed = await dependencies.getTask(current.id, userId);
    if (!refreshed) {
      throw new PsdAnalysisError(
        'PSD_ANALYSIS_TASK_NOT_FOUND',
        'PSD 分析持久任务不存在',
        404,
        false,
      );
    }
    current = refreshed;
  }
  return replayTerminalTask(current);
}

function failureStatus(error: PsdAnalysisError): 'failed' | 'timeout' | 'cancelled' {
  if (error.code === 'PSD_ANALYSIS_TIMEOUT') return 'timeout';
  if (error.code === 'PSD_ANALYSIS_CANCELLED') return 'cancelled';
  return 'failed';
}

export async function executePsdAnalysis(
  input: ExecutePsdAnalysisInput,
): Promise<PsdAnalysisExecutionResult> {
  const defaults = defaultDependencies();
  const dependencies: PsdAnalysisServiceDependencies = {
    ...defaults,
    ...input.dependencies,
  };
  const deadline = createLinkedDeadline(input.requestSignal);
  let ownerTask: PsdAnalysisTaskRecord | null = null;
  let requestDigest = '';

  try {
    const media = await dependencies.resolveMedia({
      request: input.request,
      actorUserId: input.user.id,
      signal: deadline.signal,
    });
    const providers = await dependencies.loadProviders();
    const candidates = dependencies.buildCandidates({
      user: input.user,
      providers,
      providerId: input.request.providerId,
      model: input.request.model,
      platformModel: dependencies.platformModel,
    });
    requestDigest = createPsdAnalysisRequestDigest({
      imageSha256: media.sha256,
      sourceVersionId: media.sourceVersionId,
      providerId: input.request.providerId,
      model: input.request.model,
    });
    const now = dependencies.now();
    const claim = await dependencies.createTask({
      userId: input.user.id,
      idempotencyKey: input.request.idempotencyKey,
      requestDigest,
      creditCost: dependencies.creditCost,
      task: {
        id: dependencies.createTaskId(),
        type: 'psd-analysis',
        status: 'processing',
        progress: 5,
        providerId: candidates[0]?.providerId,
        model: candidates[0]?.model,
        result: {
          schema: 'psd-analysis-task.v1',
          imageSha256: media.sha256,
          requestId: input.requestId,
        },
        createdAt: now,
        updatedAt: now,
      },
    });

    if (claim.reused) {
      return await waitForTerminalTask(
        claim.task,
        input.user.id,
        deadline.signal,
        deadline.timedOut,
        dependencies,
      );
    }

    ownerTask = claim.task;
    const invocation = await dependencies.invokeVision({
      candidates,
      exactSelection: Boolean(input.request.providerId && input.request.model),
      dataUrl: media.dataUrl,
      prompt: PSD_ANALYSIS_PROMPT,
      signal: deadline.signal,
      deadlineMs: PSD_ANALYSIS_DEADLINE_MS,
    });
    const parsed = parsePsdAnalysisOutput(invocation.content);
    const persisted: PersistedPsdAnalysisResult = {
      schema: 'psd-analysis-result.v1',
      requestId: input.requestId,
      imageSha256: media.sha256,
      providerId: invocation.providerId,
      model: invocation.model,
      ...(invocation.fallbackReason ? { fallbackReason: invocation.fallbackReason } : {}),
      analysis: parsed,
    };
    const committed = await dependencies.completeTask(ownerTask.id, persisted);
    if (!committed) {
      const winner = await dependencies.getTask(ownerTask.id, input.user.id);
      if (!winner) {
        throw new PsdAnalysisError(
          'PSD_ANALYSIS_TASK_NOT_FOUND',
          'PSD 分析任务完成时持久记录不存在',
          500,
          false,
        );
      }
      return replayTerminalTask(winner);
    }
    return {
      taskId: ownerTask.id,
      requestId: input.requestId,
      providerId: invocation.providerId,
      model: invocation.model,
      ...(invocation.fallbackReason ? { fallbackReason: invocation.fallbackReason } : {}),
      analysis: parsed,
    };
  } catch (error) {
    if (
      !ownerTask
      && (error instanceof InsufficientCreditsError || error instanceof IdempotencyConflictError)
    ) {
      throw error;
    }
    const normalized = normalizeExecutionError(
      error,
      deadline.signal,
      deadline.timedOut(),
    );
    if (ownerTask) {
      const status = failureStatus(normalized);
      await dependencies.settleFailed({
        taskId: ownerTask.id,
        status,
        error: {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable,
        },
        result: {
          requestId: input.requestId,
          errorCode: normalized.code,
          errorStatus: normalized.status,
          errorRetryable: normalized.retryable,
        },
        terminalIdentity: {
          eventId: `${ownerTask.id}:${status}:${requestDigest.slice(0, 16)}`,
          requestDigest,
          eventType: `psd-analysis.${status}`,
        },
      });
    }
    throw normalized;
  } finally {
    deadline.dispose();
  }
}
