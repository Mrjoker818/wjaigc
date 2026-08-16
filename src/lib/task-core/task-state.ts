export type {
  TaskErrorInput,
  UnifiedTaskError,
} from '@/lib/task-core/task-error';

export const DURABLE_TASK_STATUSES = [
  'created',
  'queued',
  'submitting',
  'processing',
  'uploading',
  'completed',
  'failed',
  'cancelled',
  'timeout',
] as const;

export type DurableTaskStatus = (typeof DURABLE_TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'timeout',
] as const satisfies readonly DurableTaskStatus[];

export type TerminalTaskStatus = (typeof TERMINAL_TASK_STATUSES)[number];

export interface DurableTask {
  id: string;
  userId: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  type: string;
  status: DurableTaskStatus;
  legacyStatus?: 'pending';
  providerId?: string;
  model?: string;
  remoteTaskId?: string;
  progress: number;
  label?: string;
  result?: Record<string, unknown>;
  error?: string;
  creditStatus: 'pending' | 'charged' | 'refunded' | 'not-applicable';
  creditCost?: number;
  createdAt: number;
  updatedAt: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  attemptCount?: number;
  idempotencyKey?: string;
  terminalEventId?: string;
  terminalEventDigest?: string;
  terminalEventType?: string;
  revision: number;
}

const durableStatusSet = new Set<string>(DURABLE_TASK_STATUSES);
const terminalStatusSet = new Set<DurableTaskStatus>(TERMINAL_TASK_STATUSES);

export const TASK_STATUS_TRANSITIONS: Readonly<
  Record<DurableTaskStatus, readonly DurableTaskStatus[]>
> = {
  created: ['queued', 'failed', 'cancelled', 'timeout'],
  queued: ['submitting', 'processing', 'failed', 'cancelled', 'timeout'],
  submitting: ['processing', 'failed', 'cancelled', 'timeout'],
  processing: ['uploading', 'completed', 'failed', 'cancelled', 'timeout'],
  uploading: ['processing', 'failed', 'cancelled', 'timeout'],
  completed: [],
  failed: [],
  cancelled: [],
  timeout: [],
};

export function isDurableTaskStatus(status: string): status is DurableTaskStatus {
  return durableStatusSet.has(status);
}

export function normalizeDurableTaskStatus(status: string): DurableTaskStatus {
  if (status === 'pending') return 'submitting';
  if (isDurableTaskStatus(status)) return status;
  throw new Error(`Unsupported durable task status: ${status}`);
}

export function isTerminalTaskStatus(
  status: DurableTaskStatus,
): status is TerminalTaskStatus {
  return terminalStatusSet.has(status);
}

export function canTransitionTaskStatus(
  from: DurableTaskStatus,
  to: DurableTaskStatus,
): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}
