export interface AsyncGenerateTaskSnapshot {
  taskId?: string;
  type?: string;
  status?: string;
  result?: unknown;
}

function getRemoteTaskId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const remoteTaskId = (result as Record<string, unknown>).remoteTaskId;
  return typeof remoteTaskId === 'string' && remoteTaskId.trim() ? remoteTaskId : undefined;
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
