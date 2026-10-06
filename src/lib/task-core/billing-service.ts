import {
  createBillableCloudTask,
  settleFailedCloudTask,
  type CloudTaskFailureStatus,
  type PersistedCloudTask,
  type TaskTerminalIdentity,
  type CreateBillableCloudTaskInput,
} from '@/lib/cloud-task-storage';
import { markTaskDurable, updateTaskProgress } from '@/lib/task-registry';
import {
  normalizeDurableTaskStatus,
  type DurableTask,
  type TaskErrorInput,
} from '@/lib/task-core/task-state';
import { validateIdempotencyIdentity } from '@/lib/task-core/idempotency';
import type { CanvasTaskPublicationInput } from '@/lib/collaboration/task-publication';
import type { WorkflowEditPublicationInput } from '@/lib/collaboration/workflow-edit-publication';

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
  agentExecutionDescriptor?: CreateBillableCloudTaskInput['agentExecutionDescriptor'];
  canvasPublication?: CanvasTaskPublicationInput;
  workflowPublication?: WorkflowEditPublicationInput;
  activeImageEditInputDigest?: string;
  beforeCharge?: CreateBillableCloudTaskInput['beforeCharge'];
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
  result?: Record<string, unknown>;
  refundCreditCost?: number;
  expectedRevision?: number;
  terminalIdentity?: TaskTerminalIdentity;
  leaseOwner?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  allowPausedAgentSettlement?: boolean;
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
    ...(input.agentExecutionDescriptor !== undefined ? { agentExecutionDescriptor: input.agentExecutionDescriptor } : {}),
    ...(input.canvasPublication !== undefined ? { canvasPublication: input.canvasPublication } : {}),
    ...(input.workflowPublication !== undefined ? { workflowPublication: input.workflowPublication } : {}),
    ...(input.activeImageEditInputDigest !== undefined
      ? { activeImageEditInputDigest: input.activeImageEditInputDigest } : {}),
    ...(input.beforeCharge !== undefined ? { beforeCharge: input.beforeCharge } : {}),
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
