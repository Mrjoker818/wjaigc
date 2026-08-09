import {
  createBillableCloudTask,
  settleFailedCloudTask,
  type CloudTaskFailureStatus,
  type PersistedCloudTask,
} from '@/lib/cloud-task-storage';
import { markTaskDurable, updateTaskProgress } from '@/lib/task-registry';
import {
  normalizeDurableTaskStatus,
  type DurableTask,
  type TaskErrorInput,
} from '@/lib/task-core/task-state';
import { validateIdempotencyIdentity } from '@/lib/task-core/idempotency';

export type CreateDurableTaskInput = Omit<
  DurableTask,
  | 'userId'
  | 'creditStatus'
  | 'creditCost'
  | 'idempotencyKey'
  | 'revision'
> & {
  revision?: number;
};

export interface CreateBillableTaskInput {
  userId: string;
  idempotencyKey: string;
  requestDigest: string;
  creditCost: number;
  task: CreateDurableTaskInput;
}

export interface CreateBillableTaskResult {
  task: DurableTask;
  reused: boolean;
  charged: boolean;
}

export interface SettleFailedTaskInput {
  taskId: string;
  status: CloudTaskFailureStatus;
  error: TaskErrorInput;
}

export interface SettleFailedTaskResult {
  transitioned: boolean;
  refunded: boolean;
}

export async function createBillableTask(
  input: CreateBillableTaskInput,
): Promise<CreateBillableTaskResult> {
  const identity = validateIdempotencyIdentity(input);
  const outcome = await createBillableCloudTask({
    ...identity,
    creditCost: input.creditCost,
    task: {
      ...input.task,
      userId: identity.userId,
      idempotencyKey: identity.idempotencyKey,
      requestDigest: identity.requestDigest,
    },
  });

  markTaskDurable(outcome.task.id);
  return {
    task: toDurableTask(outcome.task),
    reused: outcome.reused,
    charged: outcome.charged,
  };
}

export async function settleFailedTask(
  input: SettleFailedTaskInput,
): Promise<SettleFailedTaskResult> {
  const outcome = await settleFailedCloudTask(input);
  if (outcome.transitioned) {
    const projectionStatus = outcome.task.status === 'cancelled'
      ? 'cancelled'
      : outcome.task.status === 'timeout'
        ? 'timeout'
        : 'failed';
    updateTaskProgress(outcome.task.id, {
      status: projectionStatus,
      progress: 0,
      error: outcome.task.error,
    });
  }
  return {
    transitioned: outcome.transitioned,
    refunded: outcome.refunded,
  };
}

function toDurableTask(task: PersistedCloudTask): DurableTask {
  return {
    ...task,
    status: normalizeDurableTaskStatus(task.status),
    legacyStatus: task.status === 'pending' ? 'pending' : undefined,
    revision: task.revision ?? 0,
  };
}
