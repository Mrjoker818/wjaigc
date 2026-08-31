import { createHash } from 'node:crypto';
import { calculateConfiguredCreditCost } from '@/lib/credits';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { recordImageTaskTerminal } from '@/lib/cloud-task-persistence';
import { getCloudTaskById, terminateCloudTaskAndRefund, updateCloudTask, type CloudTask, type CloudTaskFailureStatus, type PersistedCloudTask } from '@/lib/cloud-task-storage';
import { getTaskInfo, updateTaskProgress } from '@/lib/task-registry';

export async function createRefineTask(input: {
  taskId: string; userId: string; label: string; providerId: string;
  model: string; pricingModel: string; pricingProviderId?: string;
}): Promise<number> {
  const creditCost = await calculateConfiguredCreditCost('image_retouch', input.pricingModel, { providerId: input.pricingProviderId });
  const now = Date.now();
  await createBillableTask({
    userId: input.userId, idempotencyKey: input.taskId,
    requestDigest: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    creditCost,
    task: {
      id: input.taskId, type: 'refine-engine', status: 'processing', progress: 0,
      providerId: input.providerId, model: input.model, label: input.label,
      result: { providerId: input.providerId, usedModel: input.model },
      createdAt: now, updatedAt: now,
    },
  });
  return creditCost;
}

export async function reconcileRefineTask(taskId: string): Promise<PersistedCloudTask> {
  let task = await getCloudTaskById(taskId);
  if (!task || task.type !== 'refine-engine') throw new Error('精修持久化任务不存在');
  if (task.status !== 'processing') return task;
  const candidate = getTaskInfo(taskId)?.result as Record<string, unknown> | undefined;
  if (typeof candidate?.refineSubmissionError === 'string') {
    return settleRefineTask(taskId, 'failed', candidate.refineSubmissionError);
  }
  const directImageUrls = Array.isArray(candidate?.directImageUrls)
    ? candidate.directImageUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
    : [];
  if (directImageUrls.length > 0) {
    const terminal = await recordImageTaskTerminal(taskId, {
      status: 'completed', imageUrl: directImageUrls[0], imageUrls: directImageUrls,
      creditStatus: (task.creditCost || 0) > 0 ? 'charged' : 'not-applicable',
      usedModel: task.model, providerId: task.providerId,
    });
    if (!terminal) throw new Error('精修结果尚未持久化');
    return terminal.task;
  }
  const remoteTaskId = typeof candidate?.remoteTaskId === 'string' ? candidate.remoteTaskId : '';
  if (remoteTaskId && !task.remoteTaskId) {
    const updated = await updateCloudTask(taskId, {
      remoteTaskId, progress: 30, label: '已提交到API，等待结果...',
      result: { remoteTaskId }, mergeResult: true, expectedStatuses: ['processing'],
    });
    task = await getCloudTaskById(taskId);
    if (!task || (!updated && task.status === 'processing' && !task.remoteTaskId)) {
      throw new Error('精修远端任务关联尚未持久化');
    }
  }
  return task;
}

export async function settleRefineTask(taskId: string, status: CloudTaskFailureStatus, error: string): Promise<PersistedCloudTask> {
  await terminateCloudTaskAndRefund(taskId, status, error);
  const task = await getCloudTaskById(taskId);
  if (!task) throw new Error('精修结算任务不存在');
  if (!['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) throw new Error('精修终态结算尚未完成');
  if (['failed', 'cancelled', 'timeout'].includes(task.status)) {
    updateTaskProgress(taskId, { status: task.status as CloudTaskFailureStatus, error: task.error });
  }
  return task;
}

export function refineTaskResponse(task: CloudTask | PersistedCloudTask): Record<string, unknown> {
  const completed = task.status === 'completed';
  const failed = ['failed', 'cancelled', 'timeout'].includes(task.status);
  return {
    taskId: task.id, success: !failed, status: task.status === 'timeout' ? 'failed' : task.status,
    ...(task.status === 'timeout' ? { terminalStatus: 'timeout' } : {}),
    progress: completed ? 100 : task.progress, label: task.label,
    ...(completed ? {
      imageUrl: task.result?.imageUrl, imageUrls: task.result?.imageUrls,
      result: { imageUrl: task.result?.imageUrl, imageUrls: task.result?.imageUrls },
      usedModel: task.model, providerId: task.providerId, assetProjection: task.result?.assetProjection,
    } : {}),
    ...(failed ? { error: task.error, retryable: task.status === 'failed' } : {}),
  };
}
