import { reduceAgentEvents } from '@/lib/agent-runtime/event-reducer';
import type { AgentEvent, AgentPlanStep, AgentRunProjection } from '@/lib/agent-runtime/types';

function frozenPlan(value: unknown): AgentPlanStep[] | undefined {
  if (!value || typeof value !== 'object' || !('steps' in value) || !Array.isArray(value.steps)) return;
  const ids = new Set<string>();
  const plan: AgentPlanStep[] = [];
  for (const step of value.steps) {
    if (!step || typeof step !== 'object' || typeof step.id !== 'string' || !step.id
      || typeof step.label !== 'string' || ids.has(step.id)) return;
    ids.add(step.id);
    plan.push({ id: step.id, label: step.label, status: 'pending' });
  }
  return plan;
}

/** Display only: execution and billing continue to use the server projection. */
export function reduceSkillEvents(events: readonly AgentEvent[]): AgentRunProjection {
  const projection = reduceAgentEvents(events);
  const seen = new Set<string>();
  const unique = events.filter(event => {
    if (seen.has(event.eventId)) return false;
    seen.add(event.eventId);
    return true;
  });
  // Deduplicate before consulting ignored IDs so a repeated ID cannot hide its first event.
  const ignored = new Set(reduceAgentEvents(unique).ignoredEventIds);
  const accepted = unique.filter(event => event.runId === projection.runId && !ignored.has(event.eventId))
    .sort((a, b) => a.sequence - b.sequence);
  const plan = frozenPlan(accepted.find(event => event.type === 'run.created')?.payload.skillSnapshot);
  if (!plan) return projection;
  let pauseError: AgentRunProjection['error'];
  for (const event of accepted) {
    const stepId = event.payload.stepId ?? event.payload.nextStepId;
    const step = plan.find(item => item.id === stepId);
    switch (event.type) {
      case 'tool.started':
      case 'tool.progress':
      case 'step.retrying':
        if (step) step.status = 'processing';
        break;
      case 'tool.completed':
        if (step) step.status = 'completed';
        break;
      case 'quality.checked':
        if (step && event.payload.passed === false) step.status = 'failed';
        break;
      case 'run.paused':
        if (event.payload.pauseReason === 'execution-error') {
          const error = event.payload.error;
          if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            && 'message' in error && typeof error.message === 'string'
            && 'retryable' in error && typeof error.retryable === 'boolean') {
            pauseError = { code: error.code, message: error.message, retryable: error.retryable };
          }
        }
        for (const item of plan) if (item.status === 'processing') item.status = 'paused';
        if (step && event.payload.pauseReason === 'execution-error') step.status = 'failed';
        break;
      case 'run.resumed':
        pauseError = undefined;
        if (step && step.status !== 'completed') step.status = 'pending';
        break;
      case 'run.completed':
      case 'run.failed':
      case 'run.cancelled':
      case 'run.timeout':
        for (const item of plan) {
          if (item.status === 'processing' || item.status === 'paused') {
            item.status = event.type.slice(4);
          }
        }
        if (step && event.type === 'run.failed' && step.status !== 'completed') step.status = 'failed';
        break;
    }
  }
  return { ...projection, plan, ...(projection.status === 'paused' && pauseError ? { error: pauseError } : {}) };
}
