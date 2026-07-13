export interface AsyncGenerateTaskSnapshot {
  type?: string;
  status?: string;
}

/**
 * submitOnly creates a local wrapper task while its server-side worker polls
 * the provider's real task ID. The wrapper must never be sent to a provider.
 */
export function isPendingLocalAsyncGenerateTask(task: AsyncGenerateTaskSnapshot): boolean {
  return task.type === 'generate-async'
    && ['queued', 'pending', 'processing'].includes(task.status || '');
}
