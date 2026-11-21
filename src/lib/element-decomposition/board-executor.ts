import 'server-only';

import {
  completeCloudTask,
  getCloudTaskForUser,
  terminateCloudTaskAndRefund,
  updateCloudTask,
  type CloudTask,
  type CloudTaskStatus,
} from '@/lib/cloud-task-storage';
import { calculateConfiguredCreditCost } from '@/lib/credits';
import {
  cancelElementBoardProviderTask,
  pollElementBoardProviderTask,
  submitElementBoardProviderTask,
} from '@/lib/element-decomposition/board-provider-client';
import { resolveElementBoardProvider } from '@/lib/element-decomposition/board-provider';
import { finalizeElementBoardResult } from '@/lib/element-decomposition/board-result';
import { executeElementBoardTask } from '@/lib/element-decomposition/board-task';

/** 供应商异步任务超过该时长仍未完成时判定超时并退款，避免前端无限轮询。 */
export const ELEMENT_BOARD_DEADLINE_MS = 15 * 60 * 1000;

type BoardStatus = Extract<CloudTaskStatus, 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout'>;

export interface ElementBoardTaskResponse {
  taskId: string;
  status: BoardStatus;
  progress: number;
  result?: Record<string, unknown>;
  error?: string;
}

function terminal(status: CloudTaskStatus): boolean {
  return ['completed', 'failed', 'cancelled', 'timeout'].includes(status);
}

function responseFromTask(task: CloudTask): ElementBoardTaskResponse {
  return {
    taskId: task.id,
    status: task.status === 'pending' ? 'queued' : task.status,
    progress: task.progress,
    result: task.result,
    error: task.error,
  };
}

async function requireBoardTask(taskId: string, userId: string): Promise<CloudTask> {
  const task = await getCloudTaskForUser(taskId, userId);
  if (!task || task.type !== 'element-board') throw new Error('Element board task was not found');
  return task;
}

export async function submitElementBoard(input: {
  userId: string;
  userRole: string;
  idempotencyKey: string;
  sourceUrl: string;
  sourceHash: string;
  aspectRatio: string;
  background: 'light-gray' | 'transparent';
  providerId?: string;
  modelId?: string;
}): Promise<ElementBoardTaskResponse> {
  const resolved = await resolveElementBoardProvider(input);
  const creditCost = await calculateConfiguredCreditCost(
    'image_edit',
    resolved.modelId,
    { providerId: resolved.provider.id },
  );
  const request = {
    sourceUrl: input.sourceUrl,
    sourceHash: input.sourceHash,
    aspectRatio: input.aspectRatio,
    background: input.background,
    providerId: resolved.provider.id,
    modelId: resolved.modelId,
  };
  const task = await executeElementBoardTask({
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    request,
    creditCost,
    finalize: resultUrl => finalizeElementBoardResult({
      resultUrl,
      sourceHash: input.sourceHash,
      background: input.background,
      sourceUrl: input.sourceUrl,
      modelId: resolved.modelId,
      providerId: resolved.provider.id,
    }),
    submit: () => submitElementBoardProviderTask({
      provider: resolved.provider,
      modelId: resolved.modelId,
      sourceUrl: input.sourceUrl,
      sourceHash: input.sourceHash,
      aspectRatio: input.aspectRatio,
      background: input.background,
    }),
  });
  return {
    taskId: task.taskId,
    status: task.status === 'pending' ? 'queued' : task.status,
    progress: task.progress,
    result: task.imageUrl ? { imageUrl: task.imageUrl, usedModel: task.usedModel } : undefined,
  };
}

export async function pollElementBoard(input: {
  taskId: string;
  userId: string;
  userRole: string;
}): Promise<ElementBoardTaskResponse> {
  const task = await requireBoardTask(input.taskId, input.userId);
  if (terminal(task.status)) return responseFromTask(task);
  const settleFailure = async (
    status: 'failed' | 'timeout',
    reason: string,
    progress = task.progress,
  ): Promise<ElementBoardTaskResponse> => {
    const settled = await terminateCloudTaskAndRefund(task.id, status, reason);
    if (!settled.transitioned) return responseFromTask(await requireBoardTask(task.id, input.userId));
    return { taskId: task.id, status, progress, error: reason };
  };
  if (Date.now() - task.createdAt > ELEMENT_BOARD_DEADLINE_MS) {
    return settleFailure('timeout', '拆解板生成超时（超过 15 分钟），已退回积分，请重试或换用其他模型');
  }
  if (!task.providerId || !task.model || !task.remoteTaskId) {
    return settleFailure('failed', 'Element board task is missing persisted provider execution data');
  }
  let polled: Awaited<ReturnType<typeof pollElementBoardProviderTask>>;
  let resolved: Awaited<ReturnType<typeof resolveElementBoardProvider>>;
  try {
    resolved = await resolveElementBoardProvider({
      userId: input.userId,
      userRole: input.userRole,
      providerId: task.providerId,
      modelId: task.model,
    });
    polled = await pollElementBoardProviderTask({
      provider: resolved.provider,
      modelId: resolved.modelId,
      remoteTaskId: task.remoteTaskId,
    });
  } catch (error) {
    // 授权变更或供应商不支持轮询属于不可恢复错误；其余（网络/5xx）留给下一次轮询，直到超时。
    const message = error instanceof Error ? error.message : String(error);
    const permanent = (error as { code?: string })?.code?.startsWith('ELEMENT_BOARD_')
      || /does not support task polling/.test(message);
    if (permanent) return settleFailure('failed', message);
    return { ...responseFromTask(task), status: 'processing', error: undefined };
  }

  if (polled.status === 'completed' && polled.imageUrl) {
    const request = (task.result?.request || {}) as { sourceHash?: unknown; sourceUrl?: unknown; background?: unknown };
    let finalized: Awaited<ReturnType<typeof finalizeElementBoardResult>>;
    try {
      finalized = await finalizeElementBoardResult({
        resultUrl: polled.imageUrl,
        sourceHash: typeof request.sourceHash === 'string' ? request.sourceHash : '',
        sourceUrl: typeof request.sourceUrl === 'string' ? request.sourceUrl : undefined,
        background: request.background === 'transparent' ? 'transparent' : 'light-gray',
        modelId: resolved.modelId,
        providerId: resolved.provider.id,
      });
    } catch (error) {
      return settleFailure('failed', error instanceof Error ? error.message : String(error), polled.progress);
    }
    const result = {
      ...(task.result || {}),
      imageUrl: finalized.imageUrl,
      width: finalized.width,
      height: finalized.height,
      qualityReport: finalized.report,
      usedModel: resolved.modelId,
    };
    const committed = await completeCloudTask(task.id, result);
    if (!committed) return responseFromTask(await requireBoardTask(task.id, input.userId));
    return { taskId: task.id, status: 'completed', progress: 100, result };
  }
  if (['failed', 'cancelled', 'timeout'].includes(polled.status)) {
    const status = polled.status as 'failed' | 'cancelled' | 'timeout';
    const reason = polled.error || `Element board provider task ${status}`;
    const settled = await terminateCloudTaskAndRefund(task.id, status, reason);
    if (!settled.transitioned) return responseFromTask(await requireBoardTask(task.id, input.userId));
    return { taskId: task.id, status, progress: polled.progress, error: reason };
  }

  const result = { ...(task.result || {}), remoteTaskId: task.remoteTaskId, usedModel: resolved.modelId };
  const updated = await updateCloudTask(task.id, {
    status: 'processing',
    progress: polled.progress,
    result,
    expectedStatuses: ['pending', 'processing'],
  });
  if (!updated) return responseFromTask(await requireBoardTask(task.id, input.userId));
  return { taskId: task.id, status: polled.status, progress: polled.progress, result };
}

export async function cancelElementBoard(input: {
  taskId: string;
  userId: string;
  userRole: string;
}): Promise<ElementBoardTaskResponse> {
  const task = await requireBoardTask(input.taskId, input.userId);
  if (terminal(task.status)) return responseFromTask(task);
  if (task.remoteTaskId) {
    if (!task.providerId || !task.model) {
      throw new Error('Element board task is missing persisted provider execution data');
    }
    const resolved = await resolveElementBoardProvider({
      userId: input.userId,
      userRole: input.userRole,
      providerId: task.providerId,
      modelId: task.model,
    });
    await cancelElementBoardProviderTask({
      provider: resolved.provider,
      modelId: resolved.modelId,
      remoteTaskId: task.remoteTaskId,
    });
  }
  const settled = await terminateCloudTaskAndRefund(task.id, 'cancelled', 'Element board task cancelled');
  if (!settled.transitioned) return responseFromTask(await requireBoardTask(task.id, input.userId));
  return { taskId: task.id, status: 'cancelled', progress: task.progress, error: 'Element board task cancelled' };
}
