import { randomUUID } from 'node:crypto';

import {
  chargeCloudTaskCredits,
  claimCloudTaskLease,
  completeCloudTask,
  getCloudTaskForUser,
  refundCloudTaskCredits,
  releaseCloudTaskLease,
  terminateCloudTaskAndRefund,
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
import { saveImageFile } from '@/lib/server-data-root';

const TASK_LEASE_MS = 5 * 60_000;
const activeControllers = new Map<string, AbortController>();

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

async function updateTaskState(
  task: CloudTask,
  input: {
    status?: 'pending' | 'processing';
    phase?: LayerTaskPhase;
    progress?: number;
    remoteTaskId?: string;
    patch?: Record<string, unknown>;
  },
): Promise<void> {
  await updateCloudTask(task.id, {
    ...(input.status ? { status: input.status } : {}),
    ...(input.progress !== undefined ? { progress: input.progress } : {}),
    ...(input.remoteTaskId ? { remoteTaskId: input.remoteTaskId } : {}),
    result: {
      ...resultObject(task),
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.patch || {}),
    },
  });
}

async function failTask(
  taskId: string,
  code: string,
  message: string,
  status: 'failed' | 'timeout' | 'cancelled' = 'failed',
): Promise<void> {
  await terminateCloudTaskAndRefund(taskId, status, `${code}: ${message}`);
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

export async function submitLayerDecomposition(
  input: SubmitLayerInput,
): Promise<LayerTaskResponse> {
  const requestHash = createLayerRequestHash(input.request);
  let claim;
  try {
    claim = await claimLayerTask({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      providerId: input.request.providerId,
      modelId: input.request.modelId,
      request: input.request,
    });
  } catch (error) {
    throw normalizeServiceError(error);
  }
  if (!claim.owner) return toTaskResponse(await freshTask(claim.taskId, input.userId));

  let task = await freshTask(claim.taskId, input.userId);
  const cloudRequested = input.request.engine !== 'local'
    && Boolean(input.request.providerId && input.request.modelId);
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
    );
    if (!charged.charged) {
      await failTask(task.id, 'LAYER_CREDITS_INSUFFICIENT', '积分不足或积分结算失败');
      throw new LayerServiceError('LAYER_CREDITS_INSUFFICIENT', '积分不足或积分结算失败', { status: 402 });
    }
    task = await freshTask(task.id, input.userId);
    await updateTaskState(task, {
      status: 'processing',
      phase: 'reading-source',
      progress: 5,
    });
    const controller = new AbortController();
    activeControllers.set(task.id, controller);
    const source = await resolveLayerSourceImage(input.request.imageUrl, {
      signal: controller.signal,
    });
    task = await freshTask(task.id, input.userId);
    await updateTaskState(task, {
      phase: 'submitting-pear',
      progress: 10,
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
      });
    } else {
      await updateTaskState(task, {
        phase: 'downloading-psd',
        progress: 55,
        patch: {
          pearEndpoint: submission.endpoint,
          remotePsdUrl: submission.psdUrl,
        },
      });
    }
    return toTaskResponse(await freshTask(task.id, input.userId));
  } catch (error) {
    const normalized = normalizeServiceError(error);
    const code = error instanceof PearSubmissionIndeterminateError
      ? 'LAYER_SUBMISSION_INDETERMINATE'
      : normalized.code;
    const latest = await getCloudTaskForUser(task.id, input.userId);
    if (latest && !['failed', 'cancelled', 'timeout', 'completed'].includes(latest.status)) {
      await failTask(task.id, code, normalized.message);
    }
    throw new LayerServiceError(code, normalized.message, {
      status: normalized.status,
      retryable: normalized.retryable,
      cause: error,
    });
  } finally {
    activeControllers.delete(task.id);
  }
}

async function runLocalAndComplete(
  task: CloudTask,
  request: LayerDecompositionRequest,
  signal: AbortSignal,
): Promise<void> {
  const source = await resolveLayerSourceImage(request.imageUrl, { signal });
  const local = await runLocalLayerPipeline(source.buffer, { taskId: task.id });
  if (local.quality.status === 'fail') {
    await failTask(task.id, 'LAYER_LOCAL_QUALITY_FAILED', '本地分层结果未通过重建质量门禁');
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
  await completeCloudTask(task.id, {
    phase: 'ready',
    decomposition,
  });
}

async function fallbackToLocal(
  task: CloudTask,
  request: LayerDecompositionRequest,
  reason: string,
  signal: AbortSignal,
): Promise<void> {
  await refundCloudTaskCredits(task.id, `Pear 图片分层失败退款: ${reason}`);
  const latest = await freshTask(task.id, task.userId);
  await updateTaskState(latest, {
    phase: 'running-local-fallback',
    progress: 65,
    patch: { fallbackReason: reason },
  });
  await runLocalAndComplete(await freshTask(task.id, task.userId), request, signal);
}

async function processPearArtifact(
  task: CloudTask,
  request: LayerDecompositionRequest,
  psdUrl: string,
  signal: AbortSignal,
): Promise<void> {
  const downloaded = await downloadPearPsd(psdUrl, { signal });
  const storedPsdUrl = saveImageFile(
    downloaded.buffer,
    `${task.id.replace(/[^A-Za-z0-9_-]/g, '_')}.psd`,
    'layer-decomposition',
  );
  await updateTaskState(await freshTask(task.id, task.userId), {
    phase: 'extracting-psd',
    progress: 62,
  });
  const extracted = await extractEditableLayersFromPsd(downloaded.buffer, {
    taskId: task.id,
  });
  const latest = await freshTask(task.id, task.userId);
  await updateTaskState(latest, {
    phase: 'refining-layers',
    progress: 75,
  });
  const refined = await refineLayerAssets(extracted.layers, {
    loadLayer: async (layer) => (
      await resolveLayerSourceImage(layer.imageUrl, { signal })
    ).buffer,
    persistLayer: (buffer, filename) => saveImageFile(
      buffer,
      `${task.id.replace(/[^A-Za-z0-9_-]/g, '_')}_${filename}`,
      'layer-decomposition',
    ),
  });
  await updateTaskState(await freshTask(task.id, task.userId), {
    phase: 'checking-quality',
    progress: 86,
  });
  const source = await resolveLayerSourceImage(request.imageUrl, { signal });
  const quality = await evaluateLayerQuality(source.buffer, refined.layers, {
    loadLayer: async (layer) => refined.buffers.get(layer.id)!,
    edgeContamination: refined.metrics.edgeContamination,
  });
  if (quality.status === 'fail') {
    if (request.engine === 'smart') {
      await fallbackToLocal(task, request, quality.warnings.join(', '), signal);
    } else {
      await failTask(task.id, 'LAYER_QUALITY_FAILED', 'Pear 分层结果未通过重建质量门禁');
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
  await completeCloudTask(task.id, { phase: 'ready', decomposition });
}

async function advanceLiveTask(
  task: CloudTask,
  identity: LayerTaskIdentity,
  signal: AbortSignal,
): Promise<void> {
  const request = requestFromTask(task);
  const phase = phaseFromTask(task);
  if (phase === 'running-local-fallback' || request.engine === 'local') {
    await runLocalAndComplete(task, request, signal);
    return;
  }
  const remotePsdUrl = resultObject(task).remotePsdUrl;
  if (typeof remotePsdUrl === 'string' && remotePsdUrl) {
    await processPearArtifact(task, request, remotePsdUrl, signal);
    return;
  }
  if (!task.remoteTaskId) {
    await failTask(
      task.id,
      'LAYER_SUBMISSION_INDETERMINATE',
      'Pear submission ended without a recoverable remote task ID',
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
  if (polled.status === 'queued' || polled.status === 'running') {
    await updateTaskState(task, {
      phase: 'waiting-for-pear',
      progress: Math.max(15, Math.min(54, 15 + Math.round(polled.progress * 0.39))),
    });
    return;
  }
  if (polled.status === 'completed') {
    const latest = await freshTask(task.id, task.userId);
    await updateTaskState(latest, {
      phase: 'downloading-psd',
      progress: 55,
      patch: { remotePsdUrl: polled.psdUrl },
    });
    await processPearArtifact(await freshTask(task.id, task.userId), request, polled.psdUrl, signal);
    return;
  }
  const terminalError = 'error' in polled ? polled.error : 'Pear task ended unexpectedly';
  if (request.engine === 'smart') {
    await fallbackToLocal(task, request, terminalError, signal);
  } else {
    await failTask(task.id, `PEAR_TASK_${polled.status.toUpperCase()}`, terminalError, polled.status);
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
  activeControllers.set(task.id, controller);
  try {
    await advanceLiveTask(task, identity, controller.signal);
  } catch (error) {
    const normalized = normalizeServiceError(error);
    task = await freshTask(task.id, identity.userId);
    if (!['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) {
      const request = requestFromTask(task);
      if (request.engine === 'smart' && isSmartPearFallbackPhase(phaseFromTask(task))) {
        await fallbackToLocal(task, request, normalized.message, controller.signal);
      } else {
        await failTask(task.id, normalized.code, normalized.message);
      }
    }
  } finally {
    activeControllers.delete(task.id);
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
