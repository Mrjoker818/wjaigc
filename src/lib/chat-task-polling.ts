/** Cloud providers can take many minutes to finish. */
export const CHAT_TASK_MAX_ATTEMPTS = 600;

export function getChatTaskPollIntervalMs(attempt: number): number {
  if (attempt <= 2) return 800;
  if (attempt <= 5) return 1000;
  if (attempt <= 15) return 1500;
  return 2000;
}

export function getChatTaskPollingDurationMs(): number {
  return Array.from(
    { length: CHAT_TASK_MAX_ATTEMPTS },
    (_, attempt) => getChatTaskPollIntervalMs(attempt),
  ).reduce((total, interval) => total + interval, 0);
}
