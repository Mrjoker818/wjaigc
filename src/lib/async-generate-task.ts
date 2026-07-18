export interface AsyncGenerateTaskSnapshot {
  taskId?: string;
  type?: string;
  status?: string;
  remoteTaskId?: string;
  result?: unknown;
}

function getRemoteTaskId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const remoteTaskId = (result as Record<string, unknown>).remoteTaskId;
  return typeof remoteTaskId === 'string' && remoteTaskId.trim() ? remoteTaskId : undefined;
}

function hasSubmissionPayload(result: unknown): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const payload = (result as Record<string, unknown>).submissionPayload;
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload));
}

/**
 * Legacy submitOnly tasks can have the historical `generate` type, but the
 * durable payload still proves they are local wrappers awaiting submission.
 */
export function isRecoverableSubmitOnlySubmission(task: AsyncGenerateTaskSnapshot): boolean {
  if (!['queued', 'pending', 'processing'].includes(task.status || '') || !hasSubmissionPayload(task.result)) {
    return false;
  }

  const remoteTaskId = task.remoteTaskId || getRemoteTaskId(task.result);
  return !remoteTaskId || remoteTaskId === task.taskId;
}

/**
 * submitOnly creates a local wrapper task while its server-side worker polls
 * the provider's real task ID. The wrapper must never be sent to a provider.
 */
export function isPendingLocalAsyncGenerateTask(task: AsyncGenerateTaskSnapshot): boolean {
  if (task.type !== 'generate-async' || !['queued', 'pending', 'processing'].includes(task.status || '')) {
    return false;
  }

  const remoteTaskId = getRemoteTaskId(task.result);
  return !remoteTaskId || remoteTaskId === task.taskId;
}
