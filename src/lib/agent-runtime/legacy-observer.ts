import { appendShadowAgentEvent } from './event-storage';
import type { AgentMode, AgentWorkspace } from './types';
import type { AppendAgentEventInput } from './event-storage';

export interface LegacyAgentObservationInput {
  runId: string;
  actorUserId: string;
  projectId: string;
  workspace: AgentWorkspace;
  providerId: string;
  modelId: string;
  mode: AgentMode;
  prompt: string;
  sourceVersionIds: string[];
  allowedToolIds: string[];
}

export interface LegacyAgentObserverDependencies {
  appendEvent: (input: Parameters<typeof appendShadowAgentEvent>[0]) => Promise<unknown>;
  recordDiagnostic?: (diagnostic: {
    code: string;
    message: string;
    runId: string;
  }) => void;
}

const observedEventIds = new Set<string>();

function redactObservationError(error: unknown): string {
  if (error instanceof Error && /^(TypeError|RangeError)$/.test(error.name)) {
    return 'Legacy Agent observation rejected';
  }
  return 'Legacy Agent observation failed';
}

export async function observeLegacyAgentRun(
  input: LegacyAgentObservationInput,
  dependencies: LegacyAgentObserverDependencies = {
    appendEvent: appendShadowAgentEvent,
    recordDiagnostic: diagnostic => console.warn('[agent-shadow]', diagnostic),
  },
): Promise<void> {
  const events: AppendAgentEventInput[] = [{
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      runId: input.runId,
      eventId: `legacy-observer:${input.runId}:created`,
      workspace: input.workspace,
      type: 'run.created',
      payload: {
        observed: true,
        providerId: input.providerId,
        modelId: input.modelId,
        mode: input.mode,
        prompt: input.prompt,
        sourceVersionIds: input.sourceVersionIds,
        allowedToolIds: input.allowedToolIds,
      },
    }, {
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      runId: input.runId,
      eventId: `legacy-observer:${input.runId}:plan`,
      workspace: input.workspace,
      type: 'plan.updated',
      payload: {
        observed: true,
        plan: [{ id: 'legacy-observation', label: 'Observed legacy task', status: 'completed' }],
      },
    }];
  for (const event of events) {
    if (observedEventIds.has(event.eventId)) continue;
    try {
      await dependencies.appendEvent(event);
      observedEventIds.add(event.eventId);
    } catch (error) {
      dependencies.recordDiagnostic?.({
        code: 'AGENT_SHADOW_OBSERVATION_FAILED',
        message: redactObservationError(error),
        runId: input.runId,
      });
      return;
    }
  }
}
