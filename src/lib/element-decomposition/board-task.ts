import {
  chargeCloudTaskCredits,
  completeCloudTask,
  getCloudTaskForUser,
  terminateCloudTaskAndRefund,
  updateCloudTask,
  type CloudTaskStatus,
} from '@/lib/cloud-task-storage';
import {
  claimElementBoardTask,
  createElementBoardRequestHash,
} from '@/lib/element-decomposition/board-idempotency';

export interface ElementBoardExecutionRequest extends Record<string, unknown> {
  sourceHash: string;
  sourceUrl: string;
  aspectRatio: string;
  background: string;
  providerId?: string;
  modelId?: string;
}

export interface ElementBoardProviderSubmission {
  remoteTaskId?: string;
  directUrl?: string;
  usedModel?: string;
}

export interface ElementBoardExecutionResult {
  taskId: string;
  remoteTaskId?: string;
  status: CloudTaskStatus;
  progress: number;
  imageUrl?: string;
  usedModel?: string;
}

function responseFromTask(task: NonNullable<Awaited<ReturnType<typeof getCloudTaskForUser>>>): ElementBoardExecutionResult {
  return {
    taskId: task.id,
    remoteTaskId: task.remoteTaskId,
    status: task.status,
    progress: task.progress,
    imageUrl: typeof task.result?.imageUrl === 'string' ? task.result.imageUrl : undefined,
    usedModel: typeof task.result?.usedModel === 'string' ? task.result.usedModel : task.model,
  };
}

export async function executeElementBoardTask(input: {
  userId: string;
  idempotencyKey: string;
  request: ElementBoardExecutionRequest;
  creditCost: number;
  submit: () => Promise<ElementBoardProviderSubmission>;
}): Promise<ElementBoardExecutionResult> {
  const requestHash = createElementBoardRequestHash(input.request);
  const claim = await claimElementBoardTask({
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    providerId: input.request.providerId,
    modelId: input.request.modelId,
    request: input.request,
  });

  if (!claim.owner) {
    const existing = await getCloudTaskForUser(claim.taskId, input.userId);
    if (!existing) throw new Error('Element board task disappeared after idempotency claim');
    return responseFromTask(existing);
  }

  const charged = await chargeCloudTaskCredits(
    claim.taskId,
    input.userId,
    input.creditCost,
    `Element board [${input.request.modelId || 'auto'}]`,
  );
  if (!charged.charged) {
    await terminateCloudTaskAndRefund(
      claim.taskId,
      'failed',
      'Element board credits are insufficient or settlement failed',
    );
    throw new Error('Element board credits are insufficient or settlement failed');
  }

  try {
    const submitted = await input.submit();
    if (submitted.directUrl) {
      const result = {
        imageUrl: submitted.directUrl,
        usedModel: submitted.usedModel || input.request.modelId,
        requestHash,
      };
      const completed = await completeCloudTask(claim.taskId, result);
      if (!completed) throw new Error('Element board task reached a terminal state before completion');
      return {
        taskId: claim.taskId,
        status: 'completed',
        progress: 100,
        imageUrl: submitted.directUrl,
        usedModel: submitted.usedModel || input.request.modelId,
      };
    }

    if (!submitted.remoteTaskId) {
      throw new Error('Element board provider returned neither a task ID nor an image URL');
    }
    const result = {
      requestHash,
      request: input.request,
      remoteTaskId: submitted.remoteTaskId,
      usedModel: submitted.usedModel || input.request.modelId,
    };
    const updated = await updateCloudTask(claim.taskId, {
      status: 'processing',
      progress: 10,
      remoteTaskId: submitted.remoteTaskId,
      result,
      creditCost: charged.creditCost,
      expectedStatuses: ['processing'],
    });
    if (!updated) throw new Error('Element board task reached a terminal state before provider submission was committed');
    return {
      taskId: claim.taskId,
      remoteTaskId: submitted.remoteTaskId,
      status: 'processing',
      progress: 10,
      usedModel: submitted.usedModel || input.request.modelId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await terminateCloudTaskAndRefund(claim.taskId, 'failed', message);
    throw error;
  }
}
