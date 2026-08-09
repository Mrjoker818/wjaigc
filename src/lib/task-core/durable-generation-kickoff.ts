import 'server-only';

import { getInternalRequestHeaders } from '@/lib/api-auth';
import { getInternalApiUrl } from '@/lib/api-helpers';

interface DurableGenerationKickoffInput {
  taskIds: readonly string[];
  userId: string;
  userRole: 'user' | 'admin';
  fetchImpl?: typeof fetch;
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
    try {
      const response = await fetchImpl(pollUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...internalHeaders,
        },
        body: JSON.stringify({ taskId }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || data?.status === 'error') {
        throw new Error(
          typeof data?.error === 'string'
            ? data.error
            : `Durable task kickoff failed (${response.status})`,
        );
      }
      return null;
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
