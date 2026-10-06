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
import {
  recordTaskLateResultAudit,
} from '@/lib/asset-core/task-projector';
import { projectPersistedCompletedTask } from '@/lib/cloud-task-persistence';

interface AgentTaskSubmission {
  taskId: string;
  userId: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  providerId?: string;
  model?: string;
  label?: string;
  creditCost?: number;
  creditStatus?: CloudTaskCreditStatus;
  taskEntryAudit?: TaskEntryAudit;
  submissionPayload?: Record<string, unknown>;
}

interface AgentTaskTerminal {
  status: Extract<CloudTaskStatus, 'completed' | 'failed' | 'cancelled' | 'timeout'>;
  imageUrl?: string;
  steps?: unknown[];
  finalResponse?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
}

export async function recordAgentTaskSubmitted(input: AgentTaskSubmission): Promise<boolean> {
  const now = Date.now();
  return createCloudTask({
    id: input.taskId,
    userId: input.userId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    type: 'agent-edit',
    status: 'processing',
    providerId: input.providerId,
    model: input.model,
    remoteTaskId: input.taskId,
    progress: 5,
    label: input.label || 'Agent processing',
    result: input.taskEntryAudit || input.submissionPayload ? {
      ...(input.taskEntryAudit ? { taskEntryAudit: input.taskEntryAudit } : {}),
      ...(input.submissionPayload ? { submissionPayload: input.submissionPayload } : {}),
    } : undefined,
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
  if (input.status !== 'completed') {
    const normalizedError = normalizeTaskError(
      { code: input.code || 'AGENT_TASK_ERROR', message: input.error || `Agent task ${input.status}` },
      {
        code: input.code || 'AGENT_TASK_ERROR',
        message: input.error || `Agent task ${input.status}`,
        source: 'wujie',
        retryable: input.retryable ?? input.status === 'timeout',
      },
    );
    const terminalResult = input.imageUrl || input.steps?.length || input.finalResponse
      ? {
          imageUrl: input.imageUrl || '',
          steps: input.steps || [],
          finalResponse: input.finalResponse || '',
        }
      : undefined;
    await settleFailedTask({
      taskId,
      status: input.status,
      error: normalizedError,
      ...(terminalResult ? { result: terminalResult } : {}),
    });
    return;
  }
  const current = await getCloudTaskById(taskId);
  if (!current) return;
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
  if (!terminal.transitioned && terminal.task.status !== 'completed') {
    if (
      input.imageUrl
      && ['failed', 'cancelled', 'timeout'].includes(terminal.task.status)
    ) {
      try {
        await recordTaskLateResultAudit({
          actorUserId: terminal.task.userId,
          taskId: terminal.task.id,
          terminalStatus: terminal.task.status as 'failed' | 'cancelled' | 'timeout',
          urls: [input.imageUrl],
        });
      } catch (auditError) {
        console.error('[agent-task] Unable to persist late-result audit', auditError);
      }
      return;
    }
    throw new Error('Agent task terminal transition conflict');
  }
  await projectPersistedCompletedTask(taskId, terminal.task.userId);
}
