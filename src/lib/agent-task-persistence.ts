import { createCloudTask, updateCloudTask, type CloudTaskStatus } from '@/lib/cloud-task-storage';

interface AgentTaskSubmission {
  taskId: string;
  userId: string;
  providerId?: string;
  model?: string;
  label?: string;
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
    createdAt: now,
    updatedAt: now,
  });
}

export async function recordAgentTaskProgress(taskId: string, progress: number, label: string): Promise<void> {
  await updateCloudTask(taskId, { progress: Math.min(Math.max(Math.round(progress), 0), 99), label });
}

export async function recordAgentTaskTerminal(taskId: string, input: AgentTaskTerminal): Promise<void> {
  await updateCloudTask(taskId, {
    status: input.status,
    progress: input.status === 'completed' ? 100 : 0,
    error: input.error,
    creditStatus: 'not-applicable',
    result: {
      imageUrl: input.imageUrl || '',
      steps: input.steps || [],
      finalResponse: input.finalResponse || '',
    },
  });
}
