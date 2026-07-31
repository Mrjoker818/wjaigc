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
import { executeElementBoardTask } from '@/lib/element-decomposition/board-task';

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
  if (!task.providerId || !task.model || !task.remoteTaskId) {
    throw new Error('Element board task is missing persisted provider execution data');
  }
  const resolved = await resolveElementBoardProvider({
    userId: input.userId,
    userRole: input.userRole,
    providerId: task.providerId,
    modelId: task.model,
  });
  const polled = await pollElementBoardProviderTask({
    provider: resolved.provider,
    modelId: resolved.modelId,
    remoteTaskId: task.remoteTaskId,
  });

  if (polled.status === 'completed' && polled.imageUrl) {
    const result = { ...(task.result || {}), imageUrl: polled.imageUrl, usedModel: resolved.modelId };
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
