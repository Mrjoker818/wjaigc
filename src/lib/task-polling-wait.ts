export interface TaskPollingEvent {
  taskId: string;
  type: string;
}

export interface TaskPollingWaitOptions {
  taskId: string;
  intervalMs: number;
  isConnected: () => boolean;
  onTaskEvent: (callback: (event: TaskPollingEvent) => void) => () => void;
}

/**
 * Wait for a normal polling interval, unless the matching task reaches a
 * terminal SSE state first. Disconnected SSE must never turn into a busy loop.
 */
export function waitForTaskPollInterval(options: TaskPollingWaitOptions): Promise<'timer' | 'event'> {
  if (!options.isConnected()) {
    return new Promise(resolve => setTimeout(() => resolve('timer'), options.intervalMs));
  }

  return new Promise(resolve => {
    let settled = false;
    let unsubscribe: () => void = () => {};
    const finish = (reason: 'timer' | 'event') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(reason);
    };
    const timer = setTimeout(() => finish('timer'), options.intervalMs);
    unsubscribe = options.onTaskEvent(event => {
      if (
        event.taskId === options.taskId
        && ['completed', 'failed', 'cancelled'].includes(event.type)
      ) {
        finish('event');
      }
    });
  });
}
