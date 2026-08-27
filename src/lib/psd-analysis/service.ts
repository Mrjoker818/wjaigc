import { randomUUID } from 'node:crypto';

import {
  claimCloudTaskLease,
  completeCloudTask,
  getCloudTaskForUser,
  type CloudTask,
  type CloudTaskLease,
  type CompleteCloudTaskOptions,
} from '@/lib/cloud-task-storage';
import { getOtherOperationCredits, InsufficientCreditsError } from '@/lib/credits';
import {
  createPsdAnalysisRequestDigest,
  parsePsdAnalysisOutput,
  PSD_ANALYSIS_DEADLINE_MS,
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

const PSD_ANALYSIS_REUSE_POLL_MS = 150;
const PSD_ANALYSIS_SETTLEMENT_BUDGET_MS = 1_000;
const PSD_ANALYSIS_SETTLEMENT_ATTEMPT_TIMEOUT_MS = 900;
const PSD_ANALYSIS_SETTLEMENT_RETRY_DELAYS_MS = [0, 100, 500] as const;

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
  leaseOwner?: string;
  leaseExpiresAt?: number;
  attemptCount?: number;
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
  completeTask: (
    taskId: string,
    result: Record<string, unknown>,
    options?: CompleteCloudTaskOptions,
  ) => Promise<boolean>;
  claimLease: (
    taskId: string,
    owner: string,
    ttlMs: number,
    now?: number,
  ) => Promise<CloudTaskLease | null>;
  settleFailed: (input: SettleFailedTaskInput) => Promise<SettleFailedTaskResult>;
  creditCost: number;
  createTaskId: () => string;
  createLeaseOwner: () => string;
  now: () => number;
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  platformModel?: string;
}

export interface ExecutePsdAnalysisInput {
  request: PsdAnalysisRequest;
  user: User;
  requestId: string;
  scheduleBackground: (work: () => Promise<void>) => void;
  requestSignal?: AbortSignal;
  deadlineAt?: number;
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
    claimLease: claimCloudTaskLease,
    settleFailed: settleFailedTask,
    creditCost: getOtherOperationCredits('segment'),
    createTaskId: () => `psd_analysis_${randomUUID()}`,
    createLeaseOwner: () => `psd-analysis-worker-${randomUUID()}`,
    now: Date.now,
    wait: waitWithAbort,
  };
}

function createLinkedDeadline(source?: AbortSignal, requestedDeadlineAt?: number): {
  workSignal: AbortSignal;
  totalSignal: AbortSignal;
  timedOut: () => boolean;
  workDeadlineAt: number;
  totalDeadlineAt: number;
  dispose: () => void;
} {
  const total = new AbortController();
  const work = new AbortController();
  let workDeadlineExpired = false;
  const totalDeadlineAt = requestedDeadlineAt ?? Date.now() + PSD_ANALYSIS_DEADLINE_MS;
  const workDeadlineAt = Math.max(
    Date.now(),
    totalDeadlineAt - PSD_ANALYSIS_SETTLEMENT_BUDGET_MS,
  );
  const totalTimer = setTimeout(() => {
    total.abort(new PsdAnalysisError(
      'PSD_ANALYSIS_TIMEOUT',
      'PSD 分析超过 45 秒总截止时间',
      504,
      true,
    ));
  }, Math.max(0, totalDeadlineAt - Date.now()));
  const workTimer = setTimeout(() => {
    workDeadlineExpired = true;
    work.abort(new Error('PSD_ANALYSIS_WORK_DEADLINE'));
  }, Math.max(0, workDeadlineAt - Date.now()));
  const onTotalAbort = () => {
    if (!work.signal.aborted) work.abort(total.signal.reason);
  };
  const onSourceAbort = () => {
    if (!total.signal.aborted) total.abort(source?.reason);
  };
  total.signal.addEventListener('abort', onTotalAbort, { once: true });
  source?.addEventListener('abort', onSourceAbort, { once: true });
  if (source?.aborted) onSourceAbort();
  return {
    workSignal: work.signal,
    totalSignal: total.signal,
    timedOut: () => workDeadlineExpired || (
      total.signal.reason instanceof PsdAnalysisError
      && total.signal.reason.code === 'PSD_ANALYSIS_TIMEOUT'
    ),
    workDeadlineAt,
    totalDeadlineAt,
    dispose: () => {
      clearTimeout(workTimer);
      clearTimeout(totalTimer);
      total.signal.removeEventListener('abort', onTotalAbort);
      source?.removeEventListener('abort', onSourceAbort);
    },
  };
}

function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', aborted);
    });
  });
}

function awaitWithTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('PSD_ANALYSIS_SETTLEMENT_ATTEMPT_TIMEOUT'));
    }, timeoutMs);
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
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
    task.status === 'timeout'
      ? 'PSD 分析超过 45 秒总截止时间'
      : task.status === 'cancelled'
        ? 'PSD 分析请求已取消'
        : 'PSD 分析任务失败',
    status,
    result.errorRetryable === true,
    { taskId: task.id },
  );
}

function replayCompletedTask(task: PsdAnalysisTaskRecord): PsdAnalysisExecutionResult {
  if (!isRecord(task.result) || task.result.schema !== 'psd-analysis-result.v1') {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_TASK_RESULT_INVALID',
      'PSD 分析任务结果损坏或不完整',
      502,
      false,
      { taskId: task.id },
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
      { taskId: task.id },
    );
  }
  let analysis: PsdAnalysisResult;
  try {
    analysis = parsePsdAnalysisOutput(JSON.stringify(task.result.analysis));
  } catch (error) {
    const normalized = error instanceof PsdAnalysisError
      ? error
      : new PsdAnalysisError(
          'PSD_ANALYSIS_TASK_RESULT_INVALID',
          'PSD 分析任务结果无法解析',
          502,
          false,
          { cause: error },
        );
    throw withTaskId(normalized, task.id);
  }
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
    { taskId: task.id },
  );
}

function abortError(timedOut: boolean, cause?: unknown): PsdAnalysisError {
  if (
    cause instanceof PsdAnalysisError
    && (cause.code === 'PSD_ANALYSIS_TIMEOUT' || cause.code === 'PSD_ANALYSIS_CANCELLED')
  ) {
    return cause;
  }
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
    'PSD 分析执行失败',
    500,
    true,
    { cause: error },
  );
}

function withTaskId(error: PsdAnalysisError, taskId: string): PsdAnalysisError {
  if (error.taskId === taskId) return error;
  return new PsdAnalysisError(
    error.code,
    error.message,
    error.status,
    error.retryable,
    { cause: error, taskId },
  );
}

type ReusedTaskResolution =
  | { kind: 'terminal'; result: PsdAnalysisExecutionResult }
  | { kind: 'owner'; task: PsdAnalysisTaskRecord; lease: CloudTaskLease };

function isActiveTask(task: PsdAnalysisTaskRecord): boolean {
  return task.status === 'created'
    || task.status === 'queued'
    || task.status === 'pending'
    || task.status === 'submitting'
    || task.status === 'processing'
    || task.status === 'uploading';
}

async function resolveReusedTask(
  task: PsdAnalysisTaskRecord,
  userId: string,
  leaseOwner: string,
  workDeadlineAt: number,
  requestId: string,
  requestDigest: string,
  scheduleBackground: ExecutePsdAnalysisInput['scheduleBackground'],
  signal: AbortSignal,
  timedOut: () => boolean,
  dependencies: PsdAnalysisServiceDependencies,
): Promise<ReusedTaskResolution> {
  let current = task;
  while (isActiveTask(current)) {
    if (signal.aborted) throw withTaskId(abortError(timedOut(), signal.reason), current.id);
    const leaseOperation = dependencies.claimLease(
      current.id,
      leaseOwner,
      Math.max(1_000, workDeadlineAt - Date.now()),
    );
    let lease: CloudTaskLease | null;
    try {
      lease = await awaitWithSignal(
        leaseOperation,
        signal,
      );
    } catch (error) {
      const interrupted = withTaskId(
        normalizeExecutionError(error, signal, timedOut()),
        current.id,
      );
      if (signal.aborted) {
        const delayedTaskId = current.id;
        scheduleBackground(async () => {
          try {
            const delayedLease = await leaseOperation;
            if (!delayedLease) return;
            await retryFailedSettlement(
              dependencies,
              buildFailureSettlementInput({
                taskId: delayedTaskId,
                leaseOwner: delayedLease.owner,
                error: interrupted,
                requestId,
                requestDigest,
              }),
            );
          } catch (cleanupError) {
            console.error('[psd-analysis] delayed lease cleanup failed', {
              taskId: delayedTaskId,
              error: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
            });
          }
        });
      }
      throw interrupted;
    }
    if (lease) {
      return {
        kind: 'owner',
        task: {
          ...current,
          leaseOwner: lease.owner,
          leaseExpiresAt: lease.expiresAt,
          attemptCount: lease.attemptCount,
        },
        lease,
      };
    }
    try {
      await dependencies.wait(PSD_ANALYSIS_REUSE_POLL_MS, signal);
    } catch (error) {
      throw withTaskId(
        normalizeExecutionError(error, signal, timedOut()),
        current.id,
      );
    }
    let refreshed: PsdAnalysisTaskRecord | null;
    try {
      refreshed = await awaitWithSignal(dependencies.getTask(current.id, userId), signal);
    } catch (error) {
      const normalized = normalizeExecutionError(error, signal, timedOut());
      throw withTaskId(normalized, current.id);
    }
    if (!refreshed) {
      throw new PsdAnalysisError(
        'PSD_ANALYSIS_TASK_NOT_FOUND',
        'PSD 分析持久任务不存在',
        404,
        false,
        { taskId: current.id },
      );
    }
    current = refreshed;
  }
  return { kind: 'terminal', result: replayTerminalTask(current) };
}

function failureStatus(error: PsdAnalysisError): 'failed' | 'timeout' | 'cancelled' {
  if (error.code === 'PSD_ANALYSIS_TIMEOUT') return 'timeout';
  if (error.code === 'PSD_ANALYSIS_CANCELLED') return 'cancelled';
  return 'failed';
}

function buildFailureSettlementInput(input: {
  taskId: string;
  leaseOwner: string;
  error: PsdAnalysisError;
  requestId: string;
  requestDigest: string;
}): SettleFailedTaskInput {
  const status = failureStatus(input.error);
  return {
    taskId: input.taskId,
    status,
    leaseOwner: input.leaseOwner,
    lockTimeoutMs: 750,
    statementTimeoutMs: PSD_ANALYSIS_SETTLEMENT_ATTEMPT_TIMEOUT_MS,
    error: {
      code: input.error.code,
      message: input.error.message,
      retryable: input.error.retryable,
    },
    result: {
      requestId: input.requestId,
      errorCode: input.error.code,
      errorStatus: input.error.status,
      errorRetryable: input.error.retryable,
    },
    terminalIdentity: {
      eventId: `${input.taskId}:${status}:${input.requestDigest.slice(0, 16)}`,
      requestDigest: input.requestDigest,
      eventType: `psd-analysis.${status}`,
    },
  };
}

async function retryFailedSettlement(
  dependencies: PsdAnalysisServiceDependencies,
  input: SettleFailedTaskInput,
): Promise<SettleFailedTaskResult> {
  let lastError: unknown;
  for (const delayMs of PSD_ANALYSIS_SETTLEMENT_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    try {
      return await awaitWithTimeout(
        dependencies.settleFailed(input),
        PSD_ANALYSIS_SETTLEMENT_ATTEMPT_TIMEOUT_MS,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function executePsdAnalysis(
  input: ExecutePsdAnalysisInput,
): Promise<PsdAnalysisExecutionResult> {
  const defaults = defaultDependencies();
  const dependencies: PsdAnalysisServiceDependencies = {
    ...defaults,
    ...input.dependencies,
  };
  const deadline = createLinkedDeadline(input.requestSignal, input.deadlineAt);
  let ownerTask: PsdAnalysisTaskRecord | null = null;
  let ownerLease = '';
  let requestDigest = '';

  try {
    const media = await awaitWithSignal(dependencies.resolveMedia({
        request: input.request,
        actorUserId: input.user.id,
        signal: deadline.workSignal,
      }), deadline.workSignal);
    requestDigest = createPsdAnalysisRequestDigest({
      imageSha256: media.sha256,
      sourceVersionId: media.sourceVersionId,
      providerId: input.request.providerId,
      model: input.request.model,
    });
    const now = dependencies.now();
    const taskId = dependencies.createTaskId();
    const initialLeaseOwner = dependencies.createLeaseOwner();
    const createOperation = dependencies.createTask({
      userId: input.user.id,
      idempotencyKey: input.request.idempotencyKey,
      requestDigest,
      creditCost: dependencies.creditCost,
      task: {
        id: taskId,
        type: 'psd-analysis',
        status: 'processing',
        progress: 5,
        providerId: input.request.providerId,
        model: input.request.model,
        leaseOwner: initialLeaseOwner,
        leaseExpiresAt: deadline.workDeadlineAt,
        attemptCount: 1,
        result: {
          schema: 'psd-analysis-task.v1',
          imageSha256: media.sha256,
          requestId: input.requestId,
        },
        createdAt: now,
        updatedAt: now,
      },
    });
    let claim: CreateBillableTaskResult;
    try {
      claim = await awaitWithSignal(createOperation, deadline.workSignal);
    } catch (error) {
      if (deadline.workSignal.aborted) {
        const interrupted = normalizeExecutionError(
          error,
          deadline.workSignal,
          deadline.timedOut(),
        );
        input.scheduleBackground(async () => {
          try {
            const outcome = await createOperation;
            if (outcome.reused) return;
            await retryFailedSettlement(
              dependencies,
              buildFailureSettlementInput({
                taskId: outcome.task.id,
                leaseOwner: initialLeaseOwner,
                error: interrupted,
                requestId: input.requestId,
                requestDigest,
              }),
            );
          } catch (cleanupError) {
            console.error('[psd-analysis] delayed admission cleanup failed', {
              taskId,
              error: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
            });
          }
        });
        throw interrupted;
      }
      throw error;
    }

    if (claim.reused) {
      if (
        claim.task.status === 'completed'
        || claim.task.status === 'failed'
        || claim.task.status === 'timeout'
        || claim.task.status === 'cancelled'
      ) {
        return replayTerminalTask(claim.task);
      }
      const reused = await resolveReusedTask(
        claim.task,
        input.user.id,
        initialLeaseOwner,
        deadline.workDeadlineAt,
        input.requestId,
        requestDigest,
        input.scheduleBackground,
        deadline.workSignal,
        deadline.timedOut,
        dependencies,
      );
      if (reused.kind === 'terminal') {
        return reused.result;
      }
      ownerLease = reused.lease.owner;
      ownerTask = reused.task;
    } else {
      ownerTask = claim.task;
      ownerLease = initialLeaseOwner;
    }

    const providers = await awaitWithSignal(dependencies.loadProviders(), deadline.workSignal);
    const candidates = dependencies.buildCandidates({
      user: input.user,
      providers,
      providerId: input.request.providerId,
      model: input.request.model,
      platformModel: dependencies.platformModel,
    });
    const invocation = await awaitWithSignal(dependencies.invokeVision({
      candidates,
      exactSelection: Boolean(input.request.providerId && input.request.model),
      dataUrl: media.dataUrl,
      prompt: PSD_ANALYSIS_PROMPT,
      signal: deadline.workSignal,
      deadlineMs: Math.max(1, deadline.workDeadlineAt - Date.now()),
    }), deadline.workSignal);
    if (deadline.workSignal.aborted) {
      throw abortError(deadline.timedOut(), deadline.workSignal.reason);
    }
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
    const committed = await awaitWithSignal(dependencies.completeTask(ownerTask.id, persisted, {
      leaseOwner: ownerLease,
      deadlineAt: deadline.workDeadlineAt,
    }), deadline.workSignal);
    if (!committed) {
      const winner = await awaitWithSignal(
        dependencies.getTask(ownerTask.id, input.user.id),
        deadline.workSignal,
      );
      if (!winner) {
        throw new PsdAnalysisError(
          'PSD_ANALYSIS_TASK_NOT_FOUND',
          'PSD 分析任务完成时持久记录不存在',
          500,
          false,
          { taskId: ownerTask.id },
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
    let normalized = normalizeExecutionError(
      error,
      deadline.workSignal,
      deadline.timedOut(),
    );
    if (ownerTask) {
      normalized = withTaskId(normalized, ownerTask.id);
      const settlementInput = buildFailureSettlementInput({
        taskId: ownerTask.id,
        leaseOwner: ownerLease,
        error: normalized,
        requestId: input.requestId,
        requestDigest,
      });
      const settlementOperation = dependencies.settleFailed(settlementInput);
      let settlement: SettleFailedTaskResult | null = null;
      try {
        settlement = await awaitWithSignal(settlementOperation, deadline.totalSignal);
      } catch (settlementError) {
        if (deadline.totalSignal.aborted) {
          input.scheduleBackground(async () => {
            try {
              await awaitWithTimeout(
                settlementOperation,
                PSD_ANALYSIS_SETTLEMENT_ATTEMPT_TIMEOUT_MS,
              );
            } catch {
              try {
                await retryFailedSettlement(dependencies, settlementInput);
              } catch (retryError) {
                console.error('[psd-analysis] background settlement failed', {
                  taskId: ownerTask?.id,
                  error: retryError instanceof Error ? retryError.name : 'UnknownError',
                });
              }
            }
          });
          throw normalized;
        }
        input.scheduleBackground(async () => {
          try {
            await retryFailedSettlement(dependencies, settlementInput);
          } catch (retryError) {
            console.error('[psd-analysis] settlement retry failed', {
              taskId: ownerTask?.id,
              error: retryError instanceof Error ? retryError.name : 'UnknownError',
            });
          }
        });
        throw new PsdAnalysisError(
          'PSD_ANALYSIS_SETTLEMENT_FAILED',
          'PSD 分析任务结算失败，请使用任务编号重试查询',
          503,
          true,
          { cause: settlementError, taskId: ownerTask.id },
        );
      }
      if (settlement && !settlement.transitioned) {
        let winner: PsdAnalysisTaskRecord | null;
        try {
          winner = await awaitWithSignal(
            dependencies.getTask(ownerTask.id, input.user.id),
            deadline.totalSignal,
          );
        } catch (winnerError) {
          throw withTaskId(
            normalizeExecutionError(
              winnerError,
              deadline.totalSignal,
              deadline.timedOut(),
            ),
            ownerTask.id,
          );
        }
        if (winner && (
          winner.status === 'completed'
          || winner.status === 'failed'
          || winner.status === 'timeout'
          || winner.status === 'cancelled'
        )) {
          return replayTerminalTask(winner);
        }
      }
    }
    throw normalized;
  } finally {
    deadline.dispose();
  }
}
