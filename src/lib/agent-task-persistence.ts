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
  projectCompletedTaskToAssets,
  recordTaskLateResultAudit,
  recordTaskProjectionCompleted,
  recordTaskProjectionPending,
} from '@/lib/asset-core/task-projector';

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
  if (terminal.transitioned) {
    if (current.projectId) {
      const submission = current.result?.submissionPayload as Record<string, unknown> | undefined;
      const workspace = current.sessionId?.startsWith('workflow:')
        ? 'workflow' as const
        : current.sessionId?.startsWith('standalone-chat:')
          ? 'chat' as const
          : 'canvas' as const;
      const parentVersionIds = Array.isArray(submission?.assetParentVersionIds)
        ? submission.assetParentVersionIds.filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          )
        : [];
      const projectionMode = submission?.assetProjectionMode === 'revision'
        ? 'revision' as const
        : undefined;
      try {
        const projected = await projectCompletedTaskToAssets({
          actorUserId: current.userId,
          taskId,
          targetProjectId: current.projectId,
          workspace,
          ...(current.sessionId ? { workspaceId: current.sessionId } : {}),
          sourceEntityId: current.messageId || taskId,
          parentVersionIds,
          ...(projectionMode ? { projectionMode } : {}),
        });
        await recordTaskProjectionCompleted({
          actorUserId: current.userId,
          taskId,
          versionIds: projected.versions.map((version) => version.id),
        });
      } catch (error) {
        try {
          await recordTaskProjectionPending({
            actorUserId: current.userId,
            taskId,
            reason: error instanceof Error ? error.message : String(error),
            retry: {
              targetProjectId: current.projectId,
              workspace,
              ...(current.sessionId ? { workspaceId: current.sessionId } : {}),
              sourceEntityId: current.messageId || taskId,
              parentVersionIds,
              projectionMode: projectionMode ?? 'derived',
            },
          });
        } catch (pendingError) {
          console.error('[agent-task] Unable to persist projection_pending audit', pendingError);
        }
      }
    }
  }
}
