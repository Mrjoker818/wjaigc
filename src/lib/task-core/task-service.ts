import {
  getCloudTaskById,
  transitionCloudTaskStatus,
  type CloudTaskCreditStatus,
  type PersistedCloudTask,
} from '@/lib/cloud-task-storage';
import { updateTaskProgress } from '@/lib/task-registry';
import {
  canTransitionTaskStatus,
  normalizeDurableTaskStatus,
  type DurableTask,
  type DurableTaskStatus,
  type UnifiedTaskError,
} from '@/lib/task-core/task-state';

export interface TransitionTaskInput {
  taskId: string;
  from: DurableTaskStatus[];
  to: DurableTaskStatus;
  revision?: number;
  result?: Record<string, unknown>;
  error?: UnifiedTaskError;
  creditStatus?: CloudTaskCreditStatus;
}

export interface TransitionTaskResult {
  transitioned: boolean;
  task: DurableTask;
}

export class TaskNotFoundError extends Error {
  readonly code = 'TASK_NOT_FOUND';

  constructor(readonly taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
  }
}

export async function transitionTask(
  input: TransitionTaskInput,
): Promise<TransitionTaskResult> {
  if (input.from.length === 0) {
    throw new Error('Task transition requires at least one source status');
  }

  const current = await getCloudTaskById(input.taskId);
  if (!current) {
    throw new TaskNotFoundError(input.taskId);
  }

  const durableCurrent = toDurableTask(current);
  if (
    !input.from.includes(durableCurrent.status)
    || !canTransitionTaskStatus(durableCurrent.status, input.to)
    || (
      input.revision !== undefined
      && input.revision !== durableCurrent.revision
    )
  ) {
    return { transitioned: false, task: durableCurrent };
  }

  const outcome = await transitionCloudTaskStatus({
    taskId: input.taskId,
    from: input.from,
    to: input.to,
    revision: input.revision ?? durableCurrent.revision,
    result: input.result,
    error: input.error,
    creditStatus: input.creditStatus,
  });
  if (!outcome.task) {
    throw new TaskNotFoundError(input.taskId);
  }

  const task = toDurableTask(outcome.task);
  if (outcome.transitioned) {
    updateTaskProgress(task.id, {
      status: toProjectionStatus(task.status),
      progress: task.progress,
      result: task.result,
      error: task.error,
    });
  }

  return { transitioned: outcome.transitioned, task };
}

function toDurableTask(task: PersistedCloudTask): DurableTask {
  return {
    ...task,
    status: normalizeDurableTaskStatus(task.status),
    legacyStatus: task.status === 'pending' ? 'pending' : undefined,
    revision: task.revision ?? 0,
  };
}

function toProjectionStatus(
  status: DurableTaskStatus,
): 'queued' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' {
  switch (status) {
    case 'created':
    case 'queued':
      return 'queued';
    case 'submitting':
      return 'pending';
    case 'processing':
    case 'uploading':
      return 'processing';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
    case 'timeout':
      return 'failed';
  }
}
