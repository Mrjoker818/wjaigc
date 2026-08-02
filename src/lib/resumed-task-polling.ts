export interface ResumedTaskPollingOutcome {
  status: 'failed';
  label: string;
}

export interface ResumedTaskPollingState {
  taskId?: string;
  status?: string;
  wasStarted: boolean;
  isResumed: boolean;
}

export const RESUMED_TASK_MAX_POLL_ATTEMPTS = 400;

export function shouldStartResumedTaskPolling(state: ResumedTaskPollingState): boolean {
  return state.isResumed
    && Boolean(state.taskId)
    && state.status === 'processing'
    && !state.wasStarted;
}

export function getResumedTaskPollingOutcome(
  attempts: number,
  isStillProcessing: boolean,
): ResumedTaskPollingOutcome | null {
  if (isStillProcessing && attempts >= RESUMED_TASK_MAX_POLL_ATTEMPTS) {
    return {
      status: 'failed',
      label: '任务恢复超时，请在任务中心确认供应商结果后重试',
    };
  }

  return null;
}
