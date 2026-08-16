import { appendAgentEvent } from './event-storage';
import type { AgentMode, AgentWorkspace } from './types';

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
  appendEvent: (input: Parameters<typeof appendAgentEvent>[0]) => Promise<unknown>;
  recordDiagnostic?: (diagnostic: {
    code: string;
    message: string;
    runId: string;
  }) => void;
}

const observedRunIds = new Set<string>();

function redactObservationError(error: unknown): string {
  if (error instanceof Error && /^(TypeError|RangeError)$/.test(error.name)) {
    return 'Legacy Agent observation rejected';
  }
  return 'Legacy Agent observation failed';
}

export async function observeLegacyAgentRun(
  input: LegacyAgentObservationInput,
  dependencies: LegacyAgentObserverDependencies = { appendEvent: appendAgentEvent },
): Promise<void> {
  if (observedRunIds.has(input.runId)) return;
  observedRunIds.add(input.runId);

  try {
    await dependencies.appendEvent({
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
    });
    await dependencies.appendEvent({
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
    });
  } catch (error) {
    dependencies.recordDiagnostic?.({
      code: 'AGENT_SHADOW_OBSERVATION_FAILED',
      message: redactObservationError(error),
      runId: input.runId,
    });
  }
}
