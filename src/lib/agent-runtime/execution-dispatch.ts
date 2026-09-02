import { getInternalRequestHeaders } from '@/lib/api-auth';
import { getInternalApiUrl } from '@/lib/api-helpers';
import {
  appendAdoptedAgentEvent,
  claimResumedAgentExecutionDispatch,
} from './event-storage';
import type { AgentRunExecutionDispatchInput } from './service';

export interface AgentExecutionDispatchStart {
  started: boolean;
  completion?: Promise<void>;
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(100, Math.min(delayMs, 5_000)));
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Agent execution resume aborted'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export async function dispatchResumedAgentExecution(
  input: AgentRunExecutionDispatchInput,
): Promise<AgentExecutionDispatchStart> {
  const claimed = await claimResumedAgentExecutionDispatch(input);
  if (!claimed) return { started: false };

  await appendAdoptedAgentEvent({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    runId: input.runId,
    workspace: input.workspace,
    eventId: `agent:${input.runId}:resumed:${input.generation}:tool:${input.nextStepId}:started`,
    type: 'tool.started',
    payload: {
      toolId: input.nextStepId,
      stepId: input.nextStepId,
      generation: input.generation,
    },
  });

  const completion = (async (): Promise<void> => {
    const headers = {
      'Content-Type': 'application/json',
      ...(await getInternalRequestHeaders(input.actorUserId)),
      'x-wujie-agent-resume-execution': 'true',
      'x-wujie-agent-run-id': input.runId,
      'x-wujie-agent-lease-owner': input.leaseOwner,
      'x-wujie-agent-generation': String(input.generation),
    };
    for (;;) {
      const response = await fetch(getInternalApiUrl('/api/poll-task'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ taskId: input.runId }),
        signal: input.signal,
      });
      if (!response.ok) {
        throw new Error(`Agent execution resume failed (${response.status})`);
      }
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (payload.recoveryPending !== true) return;
      await waitForRetry(
        typeof payload.retryAfterMs === 'number' ? payload.retryAfterMs : 1_000,
        input.signal,
      );
    }
  })();
  return { started: true, completion };
}
