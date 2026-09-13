interface ProviderTaskState {
  taskId: string;
  providerId: string | null;
  modelId: string | null;
  remoteTaskId: string | null;
  status: string;
  updatedAt: number;
}

function projectProviderState(task: {
  id: string;
  providerId?: string;
  model?: string;
  remoteTaskId?: string;
  status: string;
  updatedAt: number;
}): ProviderTaskState {
  return {
    taskId: task.id,
    providerId: task.providerId || null,
    modelId: task.model || null,
    remoteTaskId: task.remoteTaskId || null,
    status: task.status,
    updatedAt: task.updatedAt,
  };
}

export async function waitForProviderSubmissionState(
  taskId: string,
  timeoutMs = 90_000,
): Promise<ProviderTaskState> {
  const { getCloudTaskById } = await import('@/lib/cloud-task-storage');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await getCloudTaskById(taskId);
    if (!task) throw new Error(`Task disappeared before cancellation: ${taskId}`);
    if (task.remoteTaskId) return projectProviderState(task);
    if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) {
      throw new Error(`Provider task reached ${task.status} before a remote task id was observed`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Provider submission was not observable before cancellation: ${taskId}`);
}

export async function attemptControlledLateCompletionWriteback(
  taskId: string,
  providerStateBeforeCancel: ProviderTaskState,
) {
  const { completeCloudTask, getCloudTaskById } = await import('@/lib/cloud-task-storage');
  const before = await getCloudTaskById(taskId);
  if (!before || before.status !== 'cancelled') {
    throw new Error(`Late completion probe requires authoritative cancelled state: ${taskId}`);
  }
  const attemptedAt = new Date().toISOString();
  const accepted = await completeCloudTask(taskId, {
    imageUrl: '/controlled-test/late-provider-result.png',
    controlledLateWritebackProbe: true,
    providerRemoteTaskId: providerStateBeforeCancel.remoteTaskId,
  });
  const after = await getCloudTaskById(taskId);
  if (accepted || !after || after.status !== 'cancelled') {
    throw new Error(`Cancelled task accepted a late completion writeback: ${taskId}`);
  }
  return {
    providerStateBeforeCancel,
    providerStateAfterCancel: projectProviderState(after),
    completionWritebackAttempt: {
      attemptedAt,
      providerRemoteTaskId: providerStateBeforeCancel.remoteTaskId,
      accepted: false as const,
    },
    authoritativeDatabaseStatus: {
      beforeWriteback: before.status,
      afterWriteback: after.status,
      revisionBefore: before.revision,
      revisionAfter: after.revision,
    },
  };
}
