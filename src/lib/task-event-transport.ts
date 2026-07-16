export type TaskEventTransport = 'memory' | 'persistent-polling';

export function getTaskEventTransport(): TaskEventTransport {
  const configured = process.env.TASK_EVENTS_BACKEND?.trim().toLowerCase();
  if (configured === 'memory') return 'memory';
  if (process.env.COZE_PROJECT_ENV?.trim().toUpperCase() === 'PROD' || process.env.NODE_ENV === 'production') {
    return 'persistent-polling';
  }
  return 'memory';
}

export function getTaskEventTransportReadinessIssue(): string | null {
  return getTaskEventTransport() === 'persistent-polling'
    ? 'Shared task event backend is not configured; clients use durable task polling across instances.'
    : null;
}
