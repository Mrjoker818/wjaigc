import { randomUUID } from 'node:crypto';

import {
  chargeCloudTaskCredits,
  claimCloudTaskLease,
  completeCloudTask,
  getCloudTaskForUser,
  releaseCloudTaskLease,
  renewCloudTaskLease,
  terminateCloudTaskAndRefund,
  transitionCloudTaskToLocalFallbackAndRefund,
  updateCloudTask,
  type CloudTask,
} from '@/lib/cloud-task-storage';
import { calculateConfiguredCreditCost } from '@/lib/credits';
import {
  claimLayerTask,
  createLayerRequestHash,
  LayerIdempotencyConflictError,
} from '@/lib/layer-decomposition/idempotency';
import { runLocalLayerPipeline } from '@/lib/layer-decomposition/local-pipeline';
import { withLayerPsdMemorySlot } from '@/lib/layer-decomposition/memory-gate';
import {
  PearProtocolError,
  PearSubmissionIndeterminateError,
  pollPearLayerTask,
  submitPearLayerTask,
} from '@/lib/layer-decomposition/pear-adapter';
import { refineLayerAssets } from '@/lib/layer-decomposition/post-process';
import { extractEditableLayersFromPsd } from '@/lib/layer-decomposition/psd-extractor';
import { resolveLayerProvider, LayerProviderError } from '@/lib/layer-decomposition/provider';
import { evaluateLayerQuality } from '@/lib/layer-decomposition/quality-gate';
import {
  downloadPearPsd,
  resolveLayerSourceImage,
} from '@/lib/layer-decomposition/source-image';
import type {
  LayerDecompositionRequest,
  LayerDecompositionResult,
  LayerTaskPhase,
  LayerTaskResponse,
} from '@/lib/layer-decomposition/types';
import { deleteImageFile, saveImageFile } from '@/lib/server-data-root';

const TASK_LEASE_MS = 5 * 60_000;
const activeControllers = new Map<string, AbortController>();

function registerActiveController(taskId: string, controller: AbortController): void {
  activeControllers.set(taskId, controller);
}

function unregisterActiveController(taskId: string, controller: AbortController): void {
  if (activeControllers.get(taskId) === controller) activeControllers.delete(taskId);
}

function startLeaseHeartbeat(
  taskId: string,
  owner: string,
  controller: AbortController,
): () => void {
  let stopped = false;
  let renewing = false;
  const renew = async (): Promise<void> => {
    if (stopped || renewing) return;
    renewing = true;
    try {
      const renewed = await renewCloudTaskLease(taskId, owner, TASK_LEASE_MS);
      if (!stopped && !renewed && !controller.signal.aborted) {
        controller.abort(new LayerServiceError(
          'LAYER_TASK_LEASE_LOST',
          'Layer task worker lost its lease',
          { status: 409, retryable: true },
        ));
      }
    } catch (error) {
      if (!stopped && !controller.signal.aborted) {
        controller.abort(new LayerServiceError(
          'LAYER_TASK_LEASE_RENEW_FAILED',
          'Layer task lease could not be renewed',
          { status: 503, retryable: true, cause: error },
        ));
      }
    } finally {
      renewing = false;
    }
  };
  const timer = setInterval(() => {
    void renew();
  }, Math.floor(TASK_LEASE_MS / 3));
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export class LayerServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'LayerServiceError';
    this.code = code;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
  }
}

export interface SubmitLayerInput {
  userId: string;
  userRole: string;
  idempotencyKey: string;
  request: LayerDecompositionRequest;
}

export interface LayerTaskIdentity {
  taskId: string;
  userId: string;
  userRole: string;
}

function resultObject(task: CloudTask): Record<string, unknown> {
  return task.result || {};
}

function requestFromTask(task: CloudTask): LayerDecompositionRequest {
  const request = resultObject(task).request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new LayerServiceError('LAYER_TASK_CORRUPT', 'Layer task request state is missing');
  }
  return request as unknown as LayerDecompositionRequest;
}

function phaseFromTask(task: CloudTask): LayerTaskPhase | undefined {
  const phase = resultObject(task).phase;
  return typeof phase === 'string' ? phase as LayerTaskPhase : undefined;
}

function parseTaskError(task: CloudTask): LayerTaskResponse['error'] | undefined {
  if (!task.error) return undefined;
  const separator = task.error.indexOf(':');
  const code = separator > 0 ? task.error.slice(0, separator) : 'LAYER_TASK_FAILED';
  const message = separator > 0 ? task.error.slice(separator + 1).trim() : task.error;
  return { code, message, retryable: false };
}

function toTaskResponse(task: CloudTask): LayerTaskResponse {
  const result = resultObject(task).decomposition as LayerDecompositionResult | undefined;
  return {
    success: task.status !== 'failed',
    taskId: task.id,
    status: task.status === 'queued' ? 'pending' : task.status,
    phase: phaseFromTask(task),
    progress: task.progress,
    ...(result ? { result } : {}),
    ...(parseTaskError(task) ? { error: parseTaskError(task) } : {}),
  };
}

async function freshTask(taskId: string, userId: string): Promise<CloudTask> {
  const task = await getCloudTaskForUser(taskId, userId);
  if (!task) throw new LayerServiceError('LAYER_TASK_NOT_FOUND', 'Layer task was not found', { status: 404 });
  return task;
}

async function assertTaskActive(
  taskId: string,
  userId: string,
  signal: AbortSignal,
  leaseOwner?: string,
): Promise<CloudTask> {
  signal.throwIfAborted();
  const task = await freshTask(taskId, userId);
  if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) {
    throw new LayerServiceError(
      'LAYER_TASK_TERMINATED',
      `Layer task is already ${task.status}`,
      { status: 409 },
    );
  }
  if (leaseOwner && task.leaseOwner !== leaseOwner) {
    throw new LayerServiceError(
      'LAYER_TASK_LEASE_LOST',
      'Layer task worker no longer owns the lease',
      { status: 409, retryable: true },
    );
  }
  return task;
}

async function updateTaskState(
  task: CloudTask,
  input: {
    status?: 'pending' | 'processing';
    phase?: LayerTaskPhase;
    progress?: number;
    remoteTaskId?: string;
    patch?: Record<string, unknown>;
    leaseOwner?: string;
  },
): Promise<void> {
  const updated = await updateCloudTask(task.id, {
    ...(input.status ? { status: input.status } : {}),
    ...(input.progress !== undefined ? { progress: input.progress } : {}),
    ...(input.remoteTaskId ? { remoteTaskId: input.remoteTaskId } : {}),
    result: {
      ...resultObject(task),
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.patch || {}),
    },
    expectedStatuses: ['queued', 'pending', 'processing'],
    ...(input.leaseOwner ? { leaseOwner: input.leaseOwner } : {}),
  });
  if (!updated) {
    throw new LayerServiceError(
      input.leaseOwner ? 'LAYER_TASK_LEASE_LOST' : 'LAYER_TASK_STATE_CONFLICT',
      input.leaseOwner
        ? 'Layer task worker no longer owns the lease'
        : 'Layer task state changed before the update was committed',
      { status: 409, retryable: true },
    );
  }
}

async function failTask(
  taskId: string,
  code: string,
  message: string,
  status: 'failed' | 'timeout' | 'cancelled' = 'failed',
  leaseOwner?: string,
): Promise<void> {
  await terminateCloudTaskAndRefund(
    taskId,
    status,
    `${code}: ${message}`,
    leaseOwner,
  );
}

function normalizeServiceError(error: unknown): LayerServiceError {
  if (error instanceof LayerServiceError) return error;
  if (error instanceof LayerIdempotencyConflictError) {
    return new LayerServiceError(error.code, error.message, { status: 409, cause: error });
  }
  if (error instanceof LayerProviderError) {
    const status = error.code === 'LAYER_MODEL_FORBIDDEN' ? 403 : 400;
    return new LayerServiceError(error.code, error.message, { status, cause: error });
  }
  if (error instanceof PearProtocolError) {
    return new LayerServiceError(error.code, error.message, {
      status: error.status && error.status < 500 ? 502 : 502,
      retryable: error.retryable,
      cause: error,
    });
  }
  const codedError = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
  if (/^[A-Z][A-Z0-9_]{2,63}$/.test(codedError)) {
    return new LayerServiceError(
      codedError,
      error instanceof Error ? error.message : 'Layer task failed',
      { cause: error },
    );
  }
  return new LayerServiceError(
    'LAYER_TASK_ERROR',
    error instanceof Error ? error.message : 'Layer task failed',
    { cause: error },
  );
}

function isSmartPearFallbackPhase(phase: LayerTaskPhase | undefined): boolean {
  return phase === 'waiting-for-pear'
    || phase === 'downloading-psd'
    || phase === 'extracting-psd'
    || phase === 'refining-layers'
    || phase === 'checking-quality';
}

function isLeaseFailure(code: string): boolean {
  return code === 'LAYER_TASK_LEASE_LOST'
    || code === 'LAYER_TASK_LEASE_RENEW_FAILED';
}

export async function submitLayerDecomposition(
  input: SubmitLayerInput,
): Promise<LayerTaskResponse> {
  const requestHash = createLayerRequestHash(input.request);
  const cloudRequested = input.request.engine !== 'local'
    && Boolean(input.request.providerId && input.request.modelId);
  const submissionLeaseOwner = cloudRequested
    ? `layer-submit-${randomUUID()}`
    : undefined;
  let claim;
  let controller: AbortController | undefined;
  let stopLeaseHeartbeat: (() => void) | undefined;
  try {
    claim = await claimLayerTask({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      ...(submissionLeaseOwner ? {
        initialLease: {
          owner: submissionLeaseOwner,
          expiresAt: Date.now() + TASK_LEASE_MS,
        },
      } : {}),
      providerId: input.request.providerId,
      modelId: input.request.modelId,
      request: input.request,
    });
  } catch (error) {
    throw normalizeServiceError(error);
  }
  if (!claim.owner) return toTaskResponse(await freshTask(claim.taskId, input.userId));

  let task = await freshTask(claim.taskId, input.userId);
  if (!cloudRequested) {
    await updateTaskState(task, {
      status: 'processing',
      phase: 'running-local-fallback',
      progress: 5,
      patch: input.request.engine === 'smart'
        ? { fallbackReason: 'No exact Pear provider/model was selected' }
        : undefined,
    });
    return toTaskResponse(await freshTask(task.id, input.userId));
  }

  try {
    controller = new AbortController();
    registerActiveController(task.id, controller);
    stopLeaseHeartbeat = startLeaseHeartbeat(
      task.id,
      submissionLeaseOwner!,
      controller,
    );
    const resolved = await resolveLayerProvider({
      userId: input.userId,
      userRole: input.userRole,
      providerId: input.request.providerId,
      modelId: input.request.modelId,
    });
    const creditCost = await calculateConfiguredCreditCost(
      'segment',
      resolved.configuredModelId,
      { providerId: resolved.provider.id },
    );
    const charged = await chargeCloudTaskCredits(
      task.id,
      input.userId,
      creditCost,
      `Pear 图片分层 [${resolved.configuredModelId}]`,
      submissionLeaseOwner,
    );
    if (!charged.charged) {
      if (creditCost <= 0) {
        const latest = await freshTask(task.id, input.userId);
        if (latest.leaseOwner !== submissionLeaseOwner) {
          throw new LayerServiceError(
            'LAYER_TASK_LEASE_LOST',
            'Layer task submission worker no longer owns the lease',
            { status: 409, retryable: true },
          );
        }
        if (['completed', 'failed', 'cancelled', 'timeout'].includes(latest.status)) {
          throw new LayerServiceError(
            'LAYER_TASK_TERMINATED',
            `Layer task is already ${latest.status}`,
            { status: 409 },
          );
        }
        throw new LayerServiceError(
          'LAYER_TASK_STATE_CONFLICT',
          'Layer task state changed before the zero-cost charge was committed',
          { status: 409, retryable: true },
        );
      }
      await failTask(
        task.id,
        'LAYER_CREDITS_INSUFFICIENT',
        '积分不足或积分结算失败',
        'failed',
        submissionLeaseOwner,
      );
      throw new LayerServiceError('LAYER_CREDITS_INSUFFICIENT', '积分不足或积分结算失败', { status: 402 });
    }
    task = await freshTask(task.id, input.userId);
    await updateTaskState(task, {
      status: 'processing',
      phase: 'reading-source',
      progress: 5,
      leaseOwner: submissionLeaseOwner,
    });
    const source = await resolveLayerSourceImage(input.request.imageUrl, {
      signal: controller.signal,
    });
    task = await freshTask(task.id, input.userId);
    await updateTaskState(task, {
      phase: 'submitting-pear',
      progress: 10,
      leaseOwner: submissionLeaseOwner,
    });
    const submission = await submitPearLayerTask({
      baseUrl: resolved.provider.baseUrl,
      apiKey: resolved.provider.apiKey,
      image: `data:${source.mimeType};base64,${source.buffer.toString('base64')}`,
      applicationTaskId: task.id,
      requestId: `req_${randomUUID()}`,
      signal: controller.signal,
    });
    task = await freshTask(task.id, input.userId);
    if (submission.kind === 'async') {
      await updateTaskState(task, {
        phase: 'waiting-for-pear',
        progress: 15,
        remoteTaskId: submission.remoteTaskId,
        patch: { pearEndpoint: submission.endpoint },
        leaseOwner: submissionLeaseOwner,
      });
    } else {
      await updateTaskState(task, {
        phase: 'downloading-psd',
        progress: 55,
        patch: {
          pearEndpoint: submission.endpoint,
          remoteArtifactUrl: submission.artifactUrl,
        },
        leaseOwner: submissionLeaseOwner,
      });
    }
    return toTaskResponse(await freshTask(task.id, input.userId));
  } catch (error) {
    const normalized = normalizeServiceError(error);
    const code = error instanceof PearSubmissionIndeterminateError
      ? 'LAYER_SUBMISSION_INDETERMINATE'
      : normalized.code;
    const latest = await getCloudTaskForUser(task.id, input.userId);
    if (
      !isLeaseFailure(normalized.code)
      && latest
      && !['failed', 'cancelled', 'timeout', 'completed'].includes(latest.status)
    ) {
      await failTask(
        task.id,
        code,
        normalized.message,
        'failed',
        submissionLeaseOwner,
      );
    }
    throw new LayerServiceError(code, normalized.message, {
      status: normalized.status,
      retryable: normalized.retryable,
      cause: error,
    });
  } finally {
    stopLeaseHeartbeat?.();
    if (controller) unregisterActiveController(task.id, controller);
    if (submissionLeaseOwner) {
      await releaseCloudTaskLease(task.id, submissionLeaseOwner);
    }
  }
}

async function runLocalAndComplete(
  task: CloudTask,
  request: LayerDecompositionRequest,
  signal: AbortSignal,
  leaseOwner: string,
): Promise<void> {
  return withLayerPsdMemorySlot(signal, async () => {
    const persistedFiles: string[] = [];
    let committed = false;
    const artifactPrefix = `${task.id}_${randomUUID()}`
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 160);
    const persistLayer = async (buffer: Buffer, filename: string): Promise<string> => {
      await assertTaskActive(task.id, task.userId, signal, leaseOwner);
      const imageUrl = saveImageFile(buffer, filename, 'layer-decomposition');
      persistedFiles.push(filename);
      await assertTaskActive(task.id, task.userId, signal, leaseOwner);
      return imageUrl;
    };

    try {
      const source = await resolveLayerSourceImage(request.imageUrl, { signal });
      await assertTaskActive(task.id, task.userId, signal, leaseOwner);
      const local = await runLocalLayerPipeline(source.buffer, {
        taskId: artifactPrefix,
        persistLayer,
      });
      await assertTaskActive(task.id, task.userId, signal, leaseOwner);
      if (local.quality.status === 'fail') {
        await failTask(
          task.id,
          'LAYER_LOCAL_QUALITY_FAILED',
          '本地分层结果未通过重建质量门禁',
          'failed',
          leaseOwner,
        );
        return;
      }
      const decomposition: LayerDecompositionResult = {
        width: local.width,
        height: local.height,
        layers: local.layers,
        engine: 'local',
        quality: {
          status: local.quality.status,
          score: local.quality.score,
          warnings: local.quality.warnings,
        },
      };
      committed = await completeCloudTask(task.id, {
        phase: 'ready',
        decomposition,
      }, leaseOwner);
      if (!committed) {
        throw new LayerServiceError(
          'LAYER_TASK_TERMINATED',
          'Layer task reached a terminal state before its local result was committed',
          { status: 409 },
        );
      }
    } finally {
      if (!committed) {
        for (const filename of persistedFiles.reverse()) {
          deleteImageFile(filename, 'layer-decomposition');
        }
      }
    }
  });
}

async function fallbackToLocal(
  task: CloudTask,
  request: LayerDecompositionRequest,
  reason: string,
  signal: AbortSignal,
  leaseOwner: string,
): Promise<void> {
  const latest = await assertTaskActive(task.id, task.userId, signal, leaseOwner);
  const transitioned = await transitionCloudTaskToLocalFallbackAndRefund(
    task.id,
    {
      ...resultObject(latest),
      phase: 'running-local-fallback',
      fallbackReason: reason,
    },
    `Pear 图片分层失败退款: ${reason}`,
    leaseOwner,
  );
  if (!transitioned.transitioned) {
    throw new LayerServiceError(
      'LAYER_TASK_LEASE_LOST',
      'Layer task worker could not atomically enter local fallback',
      { status: 409, retryable: true },
    );
  }
  await runLocalAndComplete(
    await assertTaskActive(task.id, task.userId, signal, leaseOwner),
    request,
    signal,
    leaseOwner,
  );
}

async function processPearArtifact(
  task: CloudTask,
  request: LayerDecompositionRequest,
  artifactUrl: string,
  signal: AbortSignal,
  attemptId: string,
): Promise<void> {
  return withLayerPsdMemorySlot(signal, async () => {
    const persistedFiles: string[] = [];
    let committed = false;
    const artifactPrefix = `${task.id}_${attemptId}`
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 160);
    const persistTaskFile = async (buffer: Buffer, filename: string): Promise<string> => {
      await assertTaskActive(task.id, task.userId, signal, attemptId);
      const imageUrl = saveImageFile(buffer, filename, 'layer-decomposition');
      persistedFiles.push(filename);
      await assertTaskActive(task.id, task.userId, signal, attemptId);
      return imageUrl;
    };

    try {
      const downloaded = await downloadPearPsd(artifactUrl, { signal });
      await assertTaskActive(task.id, task.userId, signal, attemptId);
      const storedPsdUrl = await persistTaskFile(
        downloaded.buffer,
        `${artifactPrefix}.psd`,
      );
      await updateTaskState(await assertTaskActive(
        task.id,
        task.userId,
        signal,
        attemptId,
      ), {
        phase: 'extracting-psd',
        progress: 62,
        leaseOwner: attemptId,
      });
      const extracted = await extractEditableLayersFromPsd(downloaded.buffer, {
        taskId: artifactPrefix,
        signal,
        persistLayer: persistTaskFile,
      });
      await updateTaskState(await assertTaskActive(
        task.id,
        task.userId,
        signal,
        attemptId,
      ), {
        phase: 'refining-layers',
        progress: 75,
        leaseOwner: attemptId,
      });
      const refined = await refineLayerAssets(extracted.layers, {
        loadLayer: async (layer) => {
          await assertTaskActive(task.id, task.userId, signal, attemptId);
          return (
            await resolveLayerSourceImage(layer.imageUrl, { signal })
          ).buffer;
        },
        persistLayer: async (buffer, filename) => persistTaskFile(
          buffer,
          `${artifactPrefix}_${filename}`,
        ),
      });
      await updateTaskState(await assertTaskActive(
        task.id,
        task.userId,
        signal,
        attemptId,
      ), {
        phase: 'checking-quality',
        progress: 86,
        leaseOwner: attemptId,
      });
      const source = await resolveLayerSourceImage(request.imageUrl, { signal });
      await assertTaskActive(task.id, task.userId, signal, attemptId);
      const quality = await evaluateLayerQuality(source.buffer, refined.layers, {
        loadLayer: async (layer) => refined.buffers.get(layer.id)!,
        edgeContamination: refined.metrics.edgeContamination,
      });
      await assertTaskActive(task.id, task.userId, signal, attemptId);
      if (quality.status === 'fail') {
        if (request.engine === 'smart') {
          await fallbackToLocal(
            task,
            request,
            quality.warnings.join(', '),
            signal,
            attemptId,
          );
        } else {
          await failTask(
            task.id,
            'LAYER_QUALITY_FAILED',
            'Pear 分层结果未通过重建质量门禁',
            'failed',
            attemptId,
          );
        }
        return;
      }

      const decomposition: LayerDecompositionResult = {
        width: extracted.width,
        height: extracted.height,
        layers: refined.layers,
        psdUrl: storedPsdUrl,
        engine: 'pear',
        quality: {
          status: quality.status,
          score: quality.score,
          warnings: [...extracted.warnings, ...quality.warnings],
        },
      };
      committed = await completeCloudTask(
        task.id,
        { phase: 'ready', decomposition },
        attemptId,
      );
      if (!committed) {
        throw new LayerServiceError(
          'LAYER_TASK_TERMINATED',
          'Layer task reached a terminal state before its result was committed',
          { status: 409 },
        );
      }
    } finally {
      if (!committed) {
        for (const filename of persistedFiles.reverse()) {
          deleteImageFile(filename, 'layer-decomposition');
        }
      }
    }
  });
}

async function advanceLiveTask(
  task: CloudTask,
  identity: LayerTaskIdentity,
  signal: AbortSignal,
  attemptId: string,
): Promise<void> {
  task = await assertTaskActive(task.id, task.userId, signal, attemptId);
  const request = requestFromTask(task);
  const phase = phaseFromTask(task);
  if (phase === 'running-local-fallback' || request.engine === 'local') {
    await runLocalAndComplete(task, request, signal, attemptId);
    return;
  }
  const remoteArtifactUrl = resultObject(task).remoteArtifactUrl || resultObject(task).remotePsdUrl;
  if (typeof remoteArtifactUrl === 'string' && remoteArtifactUrl) {
    await processPearArtifact(task, request, remoteArtifactUrl, signal, attemptId);
    return;
  }
  if (!task.remoteTaskId) {
    await failTask(
      task.id,
      'LAYER_SUBMISSION_INDETERMINATE',
      'Pear submission ended without a recoverable remote task ID',
      'failed',
      attemptId,
    );
    return;
  }

  const resolved = await resolveLayerProvider({
    userId: identity.userId,
    userRole: identity.userRole,
    providerId: task.providerId,
    modelId: task.model,
  });
  const polled = await pollPearLayerTask({
    baseUrl: resolved.provider.baseUrl,
    apiKey: resolved.provider.apiKey,
    applicationTaskId: task.id,
    requestId: `req_${randomUUID()}`,
    remoteTaskId: task.remoteTaskId,
    signal,
  });
  task = await assertTaskActive(task.id, task.userId, signal, attemptId);
  if (polled.status === 'queued' || polled.status === 'running') {
    await updateTaskState(task, {
      phase: 'waiting-for-pear',
      progress: Math.max(15, Math.min(54, 15 + Math.round(polled.progress * 0.39))),
      leaseOwner: attemptId,
    });
    return;
  }
  if (polled.status === 'completed') {
    const latest = await assertTaskActive(task.id, task.userId, signal, attemptId);
    await updateTaskState(latest, {
      phase: 'downloading-psd',
      progress: 55,
      patch: { remoteArtifactUrl: polled.artifactUrl },
      leaseOwner: attemptId,
    });
    await processPearArtifact(
      await assertTaskActive(task.id, task.userId, signal, attemptId),
      request,
      polled.artifactUrl,
      signal,
      attemptId,
    );
    return;
  }
  const terminalError = 'error' in polled ? polled.error : 'Pear task ended unexpectedly';
  if (request.engine === 'smart') {
    await fallbackToLocal(task, request, terminalError, signal, attemptId);
  } else {
    await failTask(
      task.id,
      `PEAR_TASK_${polled.status.toUpperCase()}`,
      terminalError,
      polled.status,
      attemptId,
    );
  }
}

export async function getLayerTaskStatus(
  identity: LayerTaskIdentity,
): Promise<LayerTaskResponse> {
  let task = await freshTask(identity.taskId, identity.userId);
  if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) return toTaskResponse(task);
  const lease = await claimCloudTaskLease(task.id, `layer-worker-${randomUUID()}`, TASK_LEASE_MS);
  if (!lease) return toTaskResponse(task);

  const controller = new AbortController();
  registerActiveController(task.id, controller);
  const stopLeaseHeartbeat = startLeaseHeartbeat(task.id, lease.owner, controller);
  try {
    await advanceLiveTask(task, identity, controller.signal, lease.owner);
  } catch (error) {
    const normalized = normalizeServiceError(error);
    task = await freshTask(task.id, identity.userId);
    if (
      !isLeaseFailure(normalized.code)
      && !['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)
    ) {
      const request = requestFromTask(task);
      if (request.engine === 'smart' && isSmartPearFallbackPhase(phaseFromTask(task))) {
        await fallbackToLocal(
          task,
          request,
          normalized.message,
          controller.signal,
          lease.owner,
        );
      } else {
        await failTask(
          task.id,
          normalized.code,
          normalized.message,
          'failed',
          lease.owner,
        );
      }
    }
  } finally {
    stopLeaseHeartbeat();
    unregisterActiveController(task.id, controller);
    await releaseCloudTaskLease(task.id, lease.owner);
  }
  return toTaskResponse(await freshTask(identity.taskId, identity.userId));
}

export async function cancelLayerTask(
  identity: LayerTaskIdentity,
): Promise<LayerTaskResponse> {
  const task = await freshTask(identity.taskId, identity.userId);
  if (!['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) {
    activeControllers.get(task.id)?.abort(new Error('Layer task cancelled by user'));
    await failTask(task.id, 'LAYER_TASK_CANCELLED', '用户已取消图片分层任务', 'cancelled');
  }
  return toTaskResponse(await freshTask(identity.taskId, identity.userId));
}
