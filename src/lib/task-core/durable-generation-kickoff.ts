import 'server-only';

import { getInternalRequestHeaders } from '@/lib/api-auth';
import { getInternalApiUrl } from '@/lib/api-helpers';

interface DurableGenerationKickoffInput {
  taskIds: readonly string[];
  userId: string;
  userRole: 'user' | 'admin';
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface DurableGenerationKickoffFailure {
  taskId: string;
  error: string;
}

export interface DurableGenerationKickoffResult {
  attempted: number;
  accepted: number;
  failed: DurableGenerationKickoffFailure[];
}

function normalizeTaskIds(taskIds: readonly string[]): string[] {
  return [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timeout']);
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 3_000;
const MAX_MONITORING_MS = 25 * 60_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function nextPollDelay(data: Record<string, unknown>): number {
  const retryAfterMs = typeof data.retryAfterMs === 'number' && Number.isFinite(data.retryAfterMs)
    ? data.retryAfterMs
    : DEFAULT_POLL_INTERVAL_MS;
  return Math.max(250, Math.min(retryAfterMs, MAX_POLL_INTERVAL_MS));
}

/**
 * Start durable generation slots from the server. The poll route owns the
 * database lease and provider submission, so a simultaneous browser poll is
 * harmless and cannot create a second provider task.
 */
export async function kickoffDurableGenerationTasks(
  input: DurableGenerationKickoffInput,
): Promise<DurableGenerationKickoffResult> {
  const taskIds = normalizeTaskIds(input.taskIds);
  if (taskIds.length === 0) return { attempted: 0, accepted: 0, failed: [] };

  const internalHeaders = await getInternalRequestHeaders(input.userId, input.userRole);
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollUrl = getInternalApiUrl('/api/poll-task');
  const results = await Promise.all(taskIds.map(async (taskId) => {
    const deadline = Date.now() + MAX_MONITORING_MS;
    try {
      while (Date.now() < deadline) {
        const response = await fetchImpl(pollUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...internalHeaders,
          },
          body: JSON.stringify({ taskId }),
          cache: 'no-store',
          signal: input.signal ?? AbortSignal.timeout(15_000),
        });
        const data = await response.json().catch(() => null) as Record<string, unknown> | null;
        if (!response.ok || data?.status === 'error') {
          throw new Error(
            typeof data?.error === 'string'
              ? data.error
              : `Durable task kickoff failed (${response.status})`,
          );
        }

        const status = typeof data?.status === 'string' ? data.status.toLowerCase() : '';
        if (!status || TERMINAL_STATUSES.has(status)) return null;
        await sleep(nextPollDelay(data || {}), input.signal);
      }
      throw new Error('Durable task monitoring timed out before reaching a terminal state');
    } catch (error) {
      return { taskId, error: failureMessage(error) };
    }
  }));
  const failed = results.filter(
    (result): result is DurableGenerationKickoffFailure => result !== null,
  );

  return {
    attempted: taskIds.length,
    accepted: taskIds.length - failed.length,
    failed,
  };
}
