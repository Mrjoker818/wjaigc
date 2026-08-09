import {
  createCloudTask,
  getCloudTaskById,
  updateCloudTask,
  type CloudTaskCreditStatus,
  type CloudTaskStatus,
} from '@/lib/cloud-task-storage';
import type { TaskEntryAudit } from '@/lib/task-core/entry-migration';
import { settleFailedTask } from '@/lib/task-core/billing-service';
import { normalizeTaskError } from '@/lib/task-core/task-error';
import { transitionTask } from '@/lib/task-core/task-service';

interface AgentTaskSubmission {
  taskId: string;
  userId: string;
  providerId?: string;
  model?: string;
  label?: string;
  creditCost?: number;
  creditStatus?: CloudTaskCreditStatus;
  taskEntryAudit?: TaskEntryAudit;
}

interface AgentTaskTerminal {
  status: Extract<CloudTaskStatus, 'completed' | 'failed' | 'cancelled' | 'timeout'>;
  imageUrl?: string;
  steps?: unknown[];
  finalResponse?: string;
  error?: string;
}

export async function recordAgentTaskSubmitted(input: AgentTaskSubmission): Promise<boolean> {
  const now = Date.now();
  return createCloudTask({
    id: input.taskId,
    userId: input.userId,
    type: 'agent-edit',
    status: 'processing',
    providerId: input.providerId,
    model: input.model,
    remoteTaskId: input.taskId,
    progress: 5,
    label: input.label || 'Agent processing',
    result: input.taskEntryAudit ? { taskEntryAudit: input.taskEntryAudit } : undefined,
    creditCost: input.creditCost,
    creditStatus: input.creditStatus,
    createdAt: now,
    updatedAt: now,
  });
}

export async function recordAgentTaskProgress(taskId: string, progress: number, label: string): Promise<void> {
  await updateCloudTask(taskId, { progress: Math.min(Math.max(Math.round(progress), 0), 99), label });
}

export async function recordAgentTaskTerminal(taskId: string, input: AgentTaskTerminal): Promise<void> {
  const current = await getCloudTaskById(taskId);
  if (!current) return;
  if (input.status !== 'completed') {
    if (input.imageUrl || input.steps?.length || input.finalResponse) {
      await updateCloudTask(taskId, {
        result: {
          ...(current.result || {}),
          imageUrl: input.imageUrl || '',
          steps: input.steps || [],
          finalResponse: input.finalResponse || '',
        },
        expectedStatuses: ['processing'],
      });
    }
    const terminal = await settleFailedTask({
      taskId,
      status: input.status,
      error: normalizeTaskError(
        { code: 'AGENT_TASK_ERROR', message: input.error || `Agent task ${input.status}` },
        {
          code: 'AGENT_TASK_ERROR',
          message: input.error || `Agent task ${input.status}`,
          source: 'wujie',
          retryable: input.status === 'timeout',
        },
      ),
    });
    if (!terminal.transitioned) {
      throw new Error('Agent task terminal transition conflict');
    }
    return;
  }
  const terminal = await transitionTask({
    taskId,
    from: ['processing'],
    to: 'completed',
    creditStatus: 'charged',
    result: {
      ...(current.result || {}),
      imageUrl: input.imageUrl || '',
      steps: input.steps || [],
      finalResponse: input.finalResponse || '',
    },
  });
  if (!terminal.transitioned) {
    throw new Error('Agent task terminal transition conflict');
  }
}
