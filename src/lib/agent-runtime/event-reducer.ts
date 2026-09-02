import type {
  AgentEvent,
  AgentPlanStep,
  AgentRunError,
  AgentRunProjection,
  AgentRunStatus,
} from './types';

const TERMINAL_EVENT_STATUSES = new Map<AgentEvent['type'], AgentRunStatus>([
  ['run.completed', 'completed'],
  ['run.failed', 'failed'],
  ['run.cancelled', 'cancelled'],
  ['run.timeout', 'timeout'],
]);

const EVENT_TYPE_PRIORITY: readonly AgentEvent['type'][] = [
  'run.created', 'plan.updated', 'tool.started', 'tool.progress',
  'tool.completed', 'asset.created', 'run.paused', 'run.resumed',
  'step.retrying', 'quality.checked', 'run.completed', 'run.failed',
  'run.cancelled', 'run.timeout',
];
const EVENT_TYPE_ORDER = new Map<AgentEvent['type'], number>(
  EVENT_TYPE_PRIORITY.map((type, index) => [type, index]),
);

const SENSITIVE_KEY_PARTS = [
  'apikey',
  'authorization',
  'bearer',
  'clientsecret',
  'cookie',
  'credential',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'sessiontoken',
  'token',
] as const;

const SENSITIVE_VALUE_PATTERNS = [
  /https?:\/\/\S+/i,
  /\bBearer\s+\S{12,}/i,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  /\b(?:x[ _-]?api[ _-]?key|api[ _-]?key|access[ _-]?token|client[ _-]?secret|authorization|password)\s*[:=]\s*\S{4,}/i,
  /(?:^|[^\p{L}\p{N}_])token\s*[:=：＝]\s*\S{4,}/iu,
] as const;

const GENERATION_OWNED_EVENT_TYPES = new Set<AgentEvent['type']>([
  'tool.started',
  'tool.progress',
  'tool.completed',
  'asset.created',
  'step.retrying',
  'quality.checked',
]);

export class AgentEventPayloadError extends Error {
  readonly code = 'AGENT_EVENT_PAYLOAD_REJECTED';
  readonly status = 400;

  constructor() {
    super('Agent event payload contains sensitive data');
    this.name = 'AgentEventPayloadError';
  }
}

function rejectSensitivePayload(): never {
  throw new AgentEventPayloadError();
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PARTS.some(part => normalized.includes(part));
}

function assertSafeJsonValue(
  value: unknown,
  seen: WeakSet<object>,
): void {
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value.trim()))) {
      rejectSensitivePayload();
    }
    return;
  }
  if (value === null || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) rejectSensitivePayload();
    return;
  }
  if (typeof value !== 'object') rejectSensitivePayload();
  if (seen.has(value)) rejectSensitivePayload();
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) assertSafeJsonValue(item, seen);
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    rejectSensitivePayload();
  }
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) rejectSensitivePayload();
    assertSafeJsonValue(item, seen);
  }
  seen.delete(value);
}

export function assertAgentEventPayloadSafe(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  assertSafeJsonValue(payload, new WeakSet<object>());
  return payload;
}

function readPlan(payload: Record<string, unknown>): AgentPlanStep[] | null {
  if (!Array.isArray(payload.plan)) return null;
  const plan = payload.plan.filter((step): step is AgentPlanStep => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
    const candidate = step as Record<string, unknown>;
    return typeof candidate.id === 'string'
      && typeof candidate.label === 'string'
      && typeof candidate.status === 'string';
  });
  return plan.length === payload.plan.length ? plan : null;
}

function readError(payload: Record<string, unknown>): AgentRunError | undefined {
  const value = payload.error;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const error = value as Record<string, unknown>;
  if (
    typeof error.code !== 'string'
    || typeof error.message !== 'string'
    || typeof error.retryable !== 'boolean'
  ) {
    return undefined;
  }
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  };
}

function readResult(
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const result = payload.result;
  return result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : undefined;
}

function readPayloadString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readProgress(payload: Record<string, unknown>): number | undefined {
  const value = payload.progress;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : undefined;
}

export function reduceAgentEvents(events: readonly AgentEvent[]): AgentRunProjection {
  const ordered = [...events].sort((left, right) => {
    const sequenceOrder = left.sequence - right.sequence;
    if (sequenceOrder !== 0) return sequenceOrder;
    const typeOrder = (EVENT_TYPE_ORDER.get(left.type) ?? Number.MAX_SAFE_INTEGER)
      - (EVENT_TYPE_ORDER.get(right.type) ?? Number.MAX_SAFE_INTEGER);
    if (typeOrder !== 0) return typeOrder;
    if (left.eventId === right.eventId) return 0;
    return left.eventId > right.eventId ? -1 : 1;
  });
  const projection: AgentRunProjection = {
    runId: ordered[0]?.runId || '',
    status: 'created',
    lastSequence: 0,
    plan: [],
    assetVersionIds: [],
    ignoredEventIds: [],
    missingSequences: [],
    qualityChecks: [],
  };
  const eventIds = new Set<string>();
  const sequences = new Set<number>();
  let terminal = false;
  let activeGeneration: number | undefined;

  for (const current of ordered) {
    const duplicateEventId = eventIds.has(current.eventId);
    if (!duplicateEventId) eventIds.add(current.eventId);
    if (
      current.runId !== projection.runId
      || duplicateEventId
      || sequences.has(current.sequence)
      || terminal
      || (
        projection.status === 'paused'
        && current.type !== 'run.resumed'
        && current.type !== 'run.cancelled'
      )
    ) {
      projection.ignoredEventIds.push(current.eventId);
      continue;
    }

    if (activeGeneration !== undefined && GENERATION_OWNED_EVENT_TYPES.has(current.type)) {
      const eventGeneration = current.payload.generation;
      if (eventGeneration !== activeGeneration) {
        projection.ignoredEventIds.push(current.eventId);
        continue;
      }
    }

    sequences.add(current.sequence);
    projection.lastSequence = current.sequence;

    const terminalStatus = TERMINAL_EVENT_STATUSES.get(current.type);
    if (terminalStatus) {
      projection.status = terminalStatus;
      projection.error = readError(current.payload);
      if (current.type === 'run.completed') {
        projection.result = readResult(current.payload);
      }
      terminal = true;
      continue;
    }

    switch (current.type) {
      case 'run.created':
        projection.status = 'created';
        break;
      case 'plan.updated': {
        projection.status = 'planning';
        const plan = readPlan(current.payload);
        if (plan) projection.plan = plan;
        break;
      }
      case 'tool.started':
      case 'tool.progress':
      case 'tool.completed': {
        projection.status = 'executing';
        const stepId = readPayloadString(current.payload, 'stepId');
        const progress = readProgress(current.payload);
        if (stepId) projection.currentStepId = stepId;
        if (progress !== undefined) projection.progress = progress;
        break;
      }
      case 'asset.created': {
        projection.status = 'uploading';
        const versionId = current.payload.assetVersionId;
        if (
          typeof versionId === 'string'
          && !projection.assetVersionIds.includes(versionId)
        ) {
          projection.assetVersionIds.push(versionId);
        }
        break;
      }
      case 'run.paused': {
        projection.status = 'paused';
        const nextStepId = readPayloadString(current.payload, 'nextStepId');
        if (nextStepId) projection.resumeFromStepId = nextStepId;
        break;
      }
      case 'run.resumed': {
        projection.status = 'queued';
        const nextStepId = readPayloadString(current.payload, 'nextStepId');
        if (nextStepId) projection.resumeFromStepId = nextStepId;
        const generation = current.payload.generation;
        if (Number.isSafeInteger(generation) && Number(generation) > 0) {
          activeGeneration = Number(generation);
        }
        break;
      }
      case 'step.retrying': {
        projection.status = 'executing';
        const stepId = readPayloadString(current.payload, 'stepId');
        const progress = readProgress(current.payload);
        if (stepId) projection.currentStepId = stepId;
        if (progress !== undefined) projection.progress = progress;
        break;
      }
      case 'quality.checked': {
        const stepId = readPayloadString(current.payload, 'stepId');
        const gateId = readPayloadString(current.payload, 'gateId');
        const passed = current.payload.passed;
        if (stepId && gateId && typeof passed === 'boolean') {
          const existing = projection.qualityChecks.findIndex(check => (
            check.stepId === stepId && check.gateId === gateId
          ));
          const check = { stepId, gateId, passed };
          if (existing === -1) projection.qualityChecks.push(check);
          else projection.qualityChecks[existing] = check;
        }
        break;
      }
    }
  }

  for (let sequence = 1; sequence <= projection.lastSequence; sequence += 1) {
    if (!sequences.has(sequence)) projection.missingSequences.push(sequence);
  }
  return projection;
}
