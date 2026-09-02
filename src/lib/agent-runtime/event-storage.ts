import { createHash, randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { getPool } from '@/lib/db-client';
import { assertAgentEventPayloadSafe, reduceAgentEvents } from './event-reducer';
import type { AgentExecutionFence } from './execution-fence';
import type {
  AgentDownstreamOperation,
  AgentDownstreamOperationIdentity,
  AcceptAgentDownstreamOperationInput,
  CompleteAgentDownstreamOperationInput,
  MarkAgentDownstreamSubmissionUnknownInput,
} from './downstream-operations';
import type {
  AgentEvent,
  AgentEventType,
  AgentWorkspace,
} from './types';

const AGENT_EVENT_TYPES = new Set<AgentEventType>([
  'run.created',
  'plan.updated',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'asset.created',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.timeout',
  'run.paused',
  'run.resumed',
  'step.retrying',
  'quality.checked',
]);

const EXECUTION_OWNED_EVENT_TYPES = new Set<AgentEventType>([
  'tool.started',
  'tool.progress',
  'tool.completed',
  'asset.created',
  'step.retrying',
  'quality.checked',
]);

const AGENT_WORKSPACES = new Set<AgentWorkspace>([
  'canvas',
  'workflow',
  'chat',
]);

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_PAYLOAD_BYTES = 256 * 1024;

export interface AppendAgentEventInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  eventId: string;
  workspace: AgentWorkspace;
  type: AgentEventType;
  payload: Record<string, unknown>;
  executionFence?: AgentExecutionFence;
}

export interface ValidatedAgentEventInput extends AppendAgentEventInput {
  requestDigest: string;
  serializedPayload: string;
}

export interface AppendAdoptedAgentEventResult {
  event: AgentEvent;
  inserted: boolean;
}

export interface TransitionAgentRunControlInput extends AppendAgentEventInput {
  type: Extract<AgentEventType, 'run.paused' | 'run.resumed'>;
  expectedRevision: number;
  leaseOwner?: string;
  leaseDurationMs?: number;
  now?: number;
}

export interface TransitionAgentRunControlResult {
  accepted: boolean;
  event: AgentEvent;
  events: AgentEvent[];
  leaseOwner: string;
}

export interface ObserveAdoptedAgentTaskTerminalInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  workspace: AgentWorkspace;
  toolId: string;
  leaseOwner?: string;
  generation?: number;
}

export interface AgentExecutionLeaseInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  toolId: string;
  leaseOwner?: string;
  now?: number;
  leaseDurationMs?: number;
  expectedGeneration?: number;
}

export interface AgentExecutionLeaseClaim {
  claimed: boolean;
  leaseOwner: string;
  generation?: number;
}

export interface AgentExecutionDispatchClaim {
  claimed: boolean;
  dispatchLeaseOwner: string;
  attempt: number;
}

export async function claimResumedAgentExecutionDispatch(input: {
  actorUserId: string;
  projectId: string;
  runId: string;
  leaseOwner: string;
  generation: number;
  now?: number;
  dispatchLeaseDurationMs?: number;
}): Promise<AgentExecutionDispatchClaim> {
  const now = input.now ?? Date.now();
  const dispatchLeaseOwner = randomUUID();
  const dispatchLeaseExpiresAt = now + (input.dispatchLeaseDurationMs ?? 60_000);
  const result = await getPool().query(
    `UPDATE wujie_agent_execution_leases
     SET dispatch_started_at = $6,
         dispatch_lease_owner = $7,
         dispatch_lease_expires_at = $8,
         dispatch_attempt_count = dispatch_attempt_count + 1,
         dispatch_error = '',
         updated_at = $6
     WHERE task_id = $1 AND owner_id = $2 AND project_id = $3
       AND lease_owner = $4 AND generation = $5
       AND paused_at = 0 AND completed_at = 0
       AND (dispatch_lease_owner = '' OR dispatch_lease_expires_at <= $6)
     RETURNING dispatch_attempt_count`,
    [input.runId, input.actorUserId, input.projectId, input.leaseOwner,
      input.generation, now, dispatchLeaseOwner, dispatchLeaseExpiresAt],
  );
  const claimed = (result.rowCount ?? 0) === 1;
  return {
    claimed,
    dispatchLeaseOwner: claimed ? dispatchLeaseOwner : '',
    attempt: claimed ? Number(result.rows[0]?.dispatch_attempt_count || 0) : 0,
  };
}

export async function releaseResumedAgentExecutionDispatch(input: {
  actorUserId: string;
  projectId: string;
  runId: string;
  leaseOwner: string;
  generation: number;
  dispatchLeaseOwner: string;
  error: string;
  now?: number;
}): Promise<boolean> {
  const now = input.now ?? Date.now();
  const result = await getPool().query(
    `UPDATE wujie_agent_execution_leases
     SET dispatch_lease_owner = '', dispatch_lease_expires_at = 0,
         dispatch_error = $7, updated_at = $8
     WHERE task_id = $1 AND owner_id = $2 AND project_id = $3
       AND lease_owner = $4 AND generation = $5
       AND dispatch_lease_owner = $6 AND completed_at = 0
     RETURNING task_id`,
    [input.runId, input.actorUserId, input.projectId, input.leaseOwner,
      input.generation, input.dispatchLeaseOwner, input.error, now],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function failResumedAgentExecutionDispatch(input: {
  actorUserId: string;
  projectId: string;
  runId: string;
  leaseOwner: string;
  generation: number;
  dispatchLeaseOwner: string;
  workspace: AgentWorkspace;
  nextStepId: string;
  error: string;
  now?: number;
}): Promise<boolean> {
  const now = input.now ?? Date.now();
  const eventInput = validateAgentEventAppendInput({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    runId: input.runId,
    workspace: input.workspace,
    eventId: `agent:${input.runId}:resumed:${input.generation}:step:${input.nextStepId}:retrying:${input.dispatchLeaseOwner}`,
    type: 'step.retrying',
    payload: {
      stepId: input.nextStepId,
      generation: input.generation,
      error: {
        code: 'AGENT_RESUME_DISPATCH_FAILED',
        message: input.error,
        retryable: true,
      },
    },
  });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const released = await client.query(
      `UPDATE wujie_agent_execution_leases
       SET dispatch_lease_owner = '', dispatch_lease_expires_at = 0,
           dispatch_error = $7, updated_at = $8
       WHERE task_id = $1 AND owner_id = $2 AND project_id = $3
         AND lease_owner = $4 AND generation = $5
         AND dispatch_lease_owner = $6 AND completed_at = 0
       RETURNING task_id`,
      [input.runId, input.actorUserId, input.projectId, input.leaseOwner,
        input.generation, input.dispatchLeaseOwner, input.error, now],
    );
    if ((released.rowCount ?? 0) !== 1) {
      await client.query('COMMIT');
      return false;
    }
    const appended = await insertValidatedEvent(client, eventInput);
    if (appended.inserted) {
      await client.query(
        `UPDATE cloud_tasks SET revision = revision + 1, updated_at = GREATEST(updated_at, $2)
         WHERE id = $1`,
        [input.runId, now],
      );
    }
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

interface AgentDownstreamOperationRow {
  operation_key: string;
  owner_id: string;
  project_id: string;
  task_id: string;
  tool_id: string;
  step_id: string;
  request_digest: string;
  idempotency_key: string;
  status: 'prepared' | 'submitted' | 'accepted' | 'submission_unknown' | 'completed';
  response: unknown;
  provider_task_id: string | null;
  submission_error: string | null;
  lease_owner: string;
  attempt_count: number;
}

function mapDownstreamOperation(
  row: AgentDownstreamOperationRow,
  executionFence: AgentDownstreamOperationIdentity['executionFence'],
  claimed?: boolean,
): AgentDownstreamOperation {
  return {
    actorUserId: row.owner_id,
    projectId: row.project_id,
    runId: row.task_id,
    toolId: row.tool_id,
    stepId: row.step_id,
    requestDigest: row.request_digest,
    operationKey: row.operation_key,
    idempotencyKey: row.idempotency_key,
    leaseOwner: row.lease_owner,
    executionFence,
    status: row.status,
    attempts: Number(row.attempt_count || 0),
    ...(claimed === undefined ? {} : { claimed }),
    ...(row.response === null || row.response === undefined ? {} : { response: row.response }),
    ...(row.provider_task_id ? { providerTaskId: row.provider_task_id } : {}),
    ...(row.submission_error ? { submissionError: row.submission_error } : {}),
  };
}

export interface ListAgentEventsInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  afterSequence?: number;
}

export interface ListAgentEventStreamsInput {
  actorUserId: string;
  limit?: number;
}

interface AgentEventRow {
  event_id: string;
  task_id: string;
  sequence: number;
  event_type: AgentEventType;
  request_digest: string;
  payload: Record<string, unknown> | null;
  created_at: string | number;
}

export class AgentEventNotFoundError extends Error {
  readonly code = 'AGENT_RUN_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Agent run not found');
    this.name = 'AgentEventNotFoundError';
  }
}

export class AgentEventConflictError extends Error {
  readonly code = 'AGENT_EVENT_CONFLICT';
  readonly status = 409;

  constructor() {
    super('Agent event ID is already bound to a different request');
    this.name = 'AgentEventConflictError';
  }
}

function validateIdentifier(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must not be empty`);
  if (normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw new RangeError(`${name} must not exceed ${MAX_IDENTIFIER_LENGTH} characters`);
  }
  return normalized;
}

function validateEventExecutionFence(
  rawFence: AgentExecutionFence | undefined,
  runId: string,
): AgentExecutionFence | undefined {
  if (!rawFence) return undefined;
  const fence = {
    runId: validateIdentifier('executionFence.runId', rawFence.runId),
    leaseOwner: validateIdentifier('executionFence.leaseOwner', rawFence.leaseOwner),
    generation: rawFence.generation,
  };
  if (
    fence.runId !== runId
    || !Number.isSafeInteger(fence.generation)
    || fence.generation < 0
  ) {
    throw new TypeError('Agent event execution fence is invalid');
  }
  return fence;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map(key => [key, canonicalize(object[key])]),
    );
  }
  return value;
}

export function createAgentEventRequestDigest(input: {
  projectId: string;
  runId: string;
  workspace: AgentWorkspace;
  type: AgentEventType;
  payload: Record<string, unknown>;
}): string {
  const canonicalRequest = {
    projectId: input.projectId,
    runId: input.runId,
    workspace: input.workspace,
    type: input.type,
    payload: input.payload,
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(canonicalRequest)))
    .digest('hex');
}

export function validateAgentEventAppendInput(
  rawInput: AppendAgentEventInput,
): ValidatedAgentEventInput {
  const input = {
    ...rawInput,
    actorUserId: validateIdentifier('actorUserId', rawInput.actorUserId),
    projectId: validateIdentifier('projectId', rawInput.projectId),
    runId: validateIdentifier('runId', rawInput.runId),
    eventId: validateIdentifier('eventId', rawInput.eventId),
  };
  input.executionFence = validateEventExecutionFence(rawInput.executionFence, input.runId);
  if (!AGENT_WORKSPACES.has(input.workspace)) {
    throw new TypeError('Unsupported Agent workspace');
  }
  if (!AGENT_EVENT_TYPES.has(input.type)) {
    throw new TypeError('Unsupported Agent event type');
  }
  assertAgentEventPayloadSafe(input.payload);
  const serializedPayload = JSON.stringify(input.payload);
  if (Buffer.byteLength(serializedPayload, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new RangeError(`Agent event payload must not exceed ${MAX_PAYLOAD_BYTES} bytes`);
  }
  const payload = JSON.parse(serializedPayload) as Record<string, unknown>;
  const validated = { ...input, payload };
  return {
    ...validated,
    requestDigest: createAgentEventRequestDigest(validated),
    serializedPayload,
  };
}

function mapEvent(row: AgentEventRow): AgentEvent {
  return {
    eventId: row.event_id,
    runId: row.task_id,
    sequence: Number(row.sequence),
    type: row.event_type,
    timestamp: new Date(Number(row.created_at)).toISOString(),
    payload: row.payload || {},
  };
}

async function readEventStream(
  client: PoolClient,
  input: Pick<AppendAgentEventInput, 'actorUserId' | 'projectId' | 'runId'>,
): Promise<AgentEvent[]> {
  const result = await client.query<AgentEventRow>(
    `SELECT event_id, task_id, sequence, event_type, request_digest, payload, created_at
     FROM wujie_agent_events
     WHERE task_id = $1 AND owner_id = $2 AND project_id = $3
     ORDER BY sequence`,
    [input.runId, input.actorUserId, input.projectId],
  );
  return result.rows.map(mapEvent);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === '23505',
  );
}

async function findExistingEvent(
  client: PoolClient,
  input: {
    actorUserId: string;
    projectId: string;
    runId: string;
    eventId: string;
  },
): Promise<AgentEventRow | null> {
  const existing = await client.query<AgentEventRow>(
    `SELECT event_id, task_id, sequence, event_type, request_digest, payload, created_at
     FROM wujie_agent_events
     WHERE event_id = $1 AND task_id = $2 AND owner_id = $3 AND project_id = $4`,
    [input.eventId, input.runId, input.actorUserId, input.projectId],
  );
  return existing.rows[0] || null;
}

async function insertValidatedEvent(
  client: PoolClient,
  input: ValidatedAgentEventInput,
): Promise<AppendAdoptedAgentEventResult> {
  const existing = await findExistingEvent(client, input);
  if (existing) {
    if (existing.request_digest !== input.requestDigest) {
      throw new AgentEventConflictError();
    }
    return { event: mapEvent(existing), inserted: false };
  }

  const sequenceResult = await client.query<{ sequence: number }>(
    `SELECT COALESCE(MAX(sequence), 0)::integer + 1 AS sequence
     FROM wujie_agent_events
     WHERE task_id = $1`,
    [input.runId],
  );
  const sequence = Number(sequenceResult.rows[0]?.sequence || 1);
  const createdAt = Date.now();
  let inserted;
  try {
    inserted = await client.query<AgentEventRow>(
      `INSERT INTO wujie_agent_events(
        event_id, task_id, owner_id, project_id, workspace, sequence,
        event_type, request_digest, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      RETURNING event_id, task_id, sequence, event_type, request_digest, payload, created_at`,
      [
        input.eventId,
        input.runId,
        input.actorUserId,
        input.projectId,
        input.workspace,
        sequence,
        input.type,
        input.requestDigest,
        input.serializedPayload,
        createdAt,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new AgentEventConflictError();
    throw error;
  }
  return { event: mapEvent(inserted.rows[0]), inserted: true };
}

export async function appendAgentEvent(
  rawInput: AppendAgentEventInput,
): Promise<AgentEvent> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const input = validateAgentEventAppendInput(rawInput);
    const { requestDigest } = input;
    const task = await client.query<{
      id: string;
      status: string;
      terminal_event_id: string;
      terminal_event_digest: string;
      terminal_event_type: string;
    }>(
      `SELECT id, status, terminal_event_id, terminal_event_digest, terminal_event_type
       FROM cloud_tasks
       WHERE id = $1 AND user_id = $2 AND project_id = $3
       FOR UPDATE`,
      [input.runId, input.actorUserId, input.projectId],
    );
    if ((task.rowCount ?? 0) !== 1) throw new AgentEventNotFoundError();
    const taskRow = task.rows[0];

    const existing = await findExistingEvent(client, input);
    if (existing) {
      if (existing.request_digest !== requestDigest) {
        throw new AgentEventConflictError();
      }
      await client.query('COMMIT');
      return mapEvent(existing);
    }

    if (input.type.startsWith('run.') && input.type !== 'run.created') {
      if (
        taskRow.terminal_event_id !== input.eventId
        || taskRow.terminal_event_digest !== requestDigest
        || taskRow.terminal_event_type !== input.type
      ) {
        throw new AgentEventConflictError();
      }
    } else if (
      ['completed', 'failed', 'cancelled', 'timeout'].includes(taskRow.status)
    ) {
      throw new AgentEventConflictError();
    }

    const appended = await insertValidatedEvent(client, input);
    if (!appended.inserted) throw new AgentEventConflictError();
    await client.query(
      `UPDATE cloud_tasks
       SET revision = revision + 1,
           updated_at = GREATEST(updated_at, $2)
       WHERE id = $1`,
      [input.runId, Date.now()],
    );
    await client.query('COMMIT');
    return appended.event;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function transitionAgentRunControl(
  rawInput: TransitionAgentRunControlInput,
): Promise<TransitionAgentRunControlResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const initialInput = validateAgentEventAppendInput(rawInput);
    const expectedRevision = rawInput.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError('expectedRevision must be a non-negative integer');
    }
    const now = rawInput.now ?? Date.now();
    const leaseDurationMs = rawInput.leaseDurationMs ?? 10 * 60_000;
    const requestedLeaseOwner = rawInput.type === 'run.resumed'
      ? validateIdentifier('leaseOwner', rawInput.leaseOwner || randomUUID())
      : '';
    const task = await client.query<{ status: string; revision: number }>(
      `SELECT status, revision FROM cloud_tasks
       WHERE id = $1 AND user_id = $2 AND project_id = $3 FOR UPDATE`,
      [initialInput.runId, initialInput.actorUserId, initialInput.projectId],
    );
    if ((task.rowCount ?? 0) !== 1) throw new AgentEventNotFoundError();

    const existing = await findExistingEvent(client, initialInput);
    if (existing) {
      if (existing.request_digest !== initialInput.requestDigest) {
        throw new AgentEventConflictError();
      }
      const events = await readEventStream(client, initialInput);
      let existingLeaseOwner = '';
      if (initialInput.type === 'run.resumed') {
        const lease = await client.query<{ lease_owner: string }>(
          `SELECT lease_owner FROM wujie_agent_execution_leases
           WHERE task_id = $1 AND owner_id = $2 AND project_id = $3`,
          [initialInput.runId, initialInput.actorUserId, initialInput.projectId],
        );
        existingLeaseOwner = lease.rows[0]?.lease_owner || '';
      }
      await client.query('COMMIT');
      return {
        accepted: true,
        event: mapEvent(existing),
        events,
        leaseOwner: existingLeaseOwner,
      };
    }

    const events = await readEventStream(client, initialInput);
    const projection = reduceAgentEvents(events);
    const controlAlreadyApplied = initialInput.type === 'run.paused'
      ? projection.status === 'paused'
      : projection.status !== 'paused';
    const taskRow = task.rows[0];
    if (
      ['completed', 'failed', 'cancelled', 'timeout'].includes(taskRow.status)
      || controlAlreadyApplied
      || Number(taskRow.revision) !== expectedRevision
    ) {
      const fallback = [...events].reverse().find(event => (
        event.type === initialInput.type
      )) || events[events.length - 1];
      if (!fallback) throw new AgentEventConflictError();
      await client.query('COMMIT');
      return { accepted: false, event: fallback, events, leaseOwner: '' };
    }

    const input = initialInput;
    const appended = await insertValidatedEvent(client, input);
    const revisionUpdate = await client.query(
      `UPDATE cloud_tasks
       SET revision = revision + 1, updated_at = GREATEST(updated_at, $5)
       WHERE id = $1 AND user_id = $2 AND project_id = $3 AND revision = $4`,
      [input.runId, input.actorUserId, input.projectId, expectedRevision, now],
    );
    if ((revisionUpdate.rowCount ?? 0) !== 1) throw new AgentEventConflictError();

    if (input.type === 'run.paused') {
      const nextStepId = input.payload.nextStepId;
      if (typeof nextStepId !== 'string' || !nextStepId) {
        throw new TypeError('nextStepId must not be empty');
      }
      await client.query(
        `UPDATE wujie_agent_execution_leases
         SET lease_owner = '', lease_expires_at = 0, paused_at = $4,
             next_step_id = $5, dispatch_started_at = 0,
             dispatch_lease_owner = '', dispatch_lease_expires_at = 0,
             dispatch_error = '', updated_at = $4
         WHERE task_id = $1 AND owner_id = $2 AND project_id = $3 AND completed_at = 0`,
        [input.runId, input.actorUserId, input.projectId, now, nextStepId],
      );
      await client.query(
        `UPDATE cloud_tasks
         SET lease_owner = '', lease_expires_at = 0
         WHERE id = $1 AND user_id = $2 AND project_id = $3`,
        [input.runId, input.actorUserId, input.projectId],
      );
    } else {
      const nextStepId = input.payload.nextStepId;
      if (typeof nextStepId !== 'string' || !nextStepId) {
        throw new TypeError('nextStepId must not be empty');
      }
      const generation = input.payload.generation;
      if (!Number.isSafeInteger(generation) || Number(generation) < 1) {
        throw new TypeError('generation must be a positive integer');
      }
      await client.query(
        `INSERT INTO wujie_agent_execution_leases(
           task_id, owner_id, project_id, tool_id, lease_owner,
           lease_expires_at, attempt_count, completed_at, updated_at,
           generation, paused_at, next_step_id, dispatch_started_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 1, 0, $7, $8, 0, $4, 0)
         ON CONFLICT (task_id) DO UPDATE
         SET tool_id = EXCLUDED.tool_id,
             lease_owner = EXCLUDED.lease_owner,
             lease_expires_at = EXCLUDED.lease_expires_at,
             generation = wujie_agent_execution_leases.generation + 1,
             paused_at = 0,
             next_step_id = EXCLUDED.tool_id,
             dispatch_started_at = 0,
             dispatch_lease_owner = '',
             dispatch_lease_expires_at = 0,
             dispatch_error = '',
             attempt_count = wujie_agent_execution_leases.attempt_count + 1,
             completed_at = 0,
             updated_at = EXCLUDED.updated_at`,
        [input.runId, input.actorUserId, input.projectId, nextStepId,
          requestedLeaseOwner, now + leaseDurationMs, now, Number(generation)],
      );
    }

    const nextEvents = [...events, appended.event];
    await client.query('COMMIT');
    return {
      accepted: appended.inserted,
      event: appended.event,
      events: nextEvents,
      leaseOwner: requestedLeaseOwner,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendAdoptedAgentEvent(
  rawInput: AppendAgentEventInput,
): Promise<AppendAdoptedAgentEventResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const input = validateAgentEventAppendInput(rawInput);
    const executionFence = input.executionFence;
    if (EXECUTION_OWNED_EVENT_TYPES.has(input.type)) {
      if (!executionFence || input.payload.generation !== executionFence.generation) {
        throw new TypeError('Execution-owned Agent event requires the active generation fence');
      }
    }
    const task = await client.query<{ status: string }>(
      `SELECT status
       FROM cloud_tasks
       WHERE id = $1 AND user_id = $2 AND project_id = $3
         ${executionFence ? `AND EXISTS (
           SELECT 1 FROM wujie_agent_execution_leases agent_lease
           WHERE agent_lease.task_id = $1
             AND agent_lease.owner_id = $2
             AND agent_lease.project_id = $3
             AND agent_lease.lease_owner = $4
             AND agent_lease.generation = $5
             AND agent_lease.paused_at = 0
             AND agent_lease.completed_at = 0
         )` : ''}
       FOR UPDATE`,
      [input.runId, input.actorUserId, input.projectId,
        ...(executionFence ? [executionFence.leaseOwner, executionFence.generation] : [])],
    );
    if ((task.rowCount ?? 0) !== 1) throw new AgentEventNotFoundError();

    const existing = await findExistingEvent(client, input);
    if (existing) {
      if (existing.request_digest !== input.requestDigest) {
        throw new AgentEventConflictError();
      }
      await client.query('COMMIT');
      return { event: mapEvent(existing), inserted: false };
    }
    if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.rows[0].status)) {
      throw new AgentEventConflictError();
    }

    const appended = await insertValidatedEvent(client, input);
    if (appended.inserted) {
      await client.query(
        `UPDATE cloud_tasks
         SET revision = revision + 1,
             updated_at = GREATEST(updated_at, $2)
         WHERE id = $1`,
        [input.runId, Date.now()],
      );
    }
    await client.query('COMMIT');
    return appended;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendShadowAgentEvent(
  rawInput: AppendAgentEventInput,
): Promise<AppendAdoptedAgentEventResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const input = validateAgentEventAppendInput(rawInput);
    const task = await client.query<{ status: string }>(
      `SELECT status FROM cloud_tasks
       WHERE id = $1 AND user_id = $2 AND project_id = $3 FOR UPDATE`,
      [input.runId, input.actorUserId, input.projectId],
    );
    if ((task.rowCount ?? 0) !== 1) throw new AgentEventNotFoundError();
    const existing = await findExistingEvent(client, input);
    if (existing) {
      if (existing.request_digest !== input.requestDigest) throw new AgentEventConflictError();
      await client.query('COMMIT');
      return { event: mapEvent(existing), inserted: false };
    }
    if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.rows[0].status)) {
      throw new AgentEventConflictError();
    }
    const appended = await insertValidatedEvent(client, input);
    await client.query('COMMIT');
    return appended;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function claimAdoptedAgentExecution(
  rawInput: AgentExecutionLeaseInput,
): Promise<AgentExecutionLeaseClaim> {
  const { randomUUID } = await import('node:crypto');
  const input = {
    actorUserId: validateIdentifier('actorUserId', rawInput.actorUserId),
    projectId: validateIdentifier('projectId', rawInput.projectId),
    runId: validateIdentifier('runId', rawInput.runId),
    toolId: validateIdentifier('toolId', rawInput.toolId),
    leaseOwner: rawInput.leaseOwner || randomUUID(),
    now: rawInput.now ?? Date.now(),
    leaseDurationMs: rawInput.leaseDurationMs ?? 10 * 60_000,
    expectedGeneration: rawInput.expectedGeneration,
  };
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const task = await client.query<{ status: string }>(
      `SELECT status FROM cloud_tasks
       WHERE id = $1 AND user_id = $2 AND project_id = $3 FOR UPDATE`,
      [input.runId, input.actorUserId, input.projectId],
    );
    if ((task.rowCount ?? 0) !== 1) throw new AgentEventNotFoundError();
    if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.rows[0].status)) {
      await client.query('COMMIT');
      return { claimed: false, leaseOwner: '' };
    }
    await client.query(
      `INSERT INTO wujie_agent_execution_leases(
         task_id, owner_id, project_id, tool_id, updated_at
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (task_id) DO NOTHING`,
      [input.runId, input.actorUserId, input.projectId, input.toolId, input.now],
    );
    const claimed = await client.query(
      `UPDATE wujie_agent_execution_leases
       SET lease_owner = $5,
           lease_expires_at = $6,
           attempt_count = attempt_count + CASE
             WHEN lease_owner = $5 AND generation = $8 THEN 0 ELSE 1 END,
           paused_at = 0,
           updated_at = $7
       WHERE task_id = $1 AND owner_id = $2 AND project_id = $3 AND tool_id = $4
         AND completed_at = 0 AND paused_at = 0
         AND ($8::integer IS NULL OR generation = $8)
         AND (lease_expires_at <= $7 OR (lease_owner = $5 AND generation = $8))
       RETURNING generation`,
      [input.runId, input.actorUserId, input.projectId, input.toolId,
        input.leaseOwner, input.now + input.leaseDurationMs, input.now,
        input.expectedGeneration ?? null],
    );
    await client.query('COMMIT');
    return {
      claimed: (claimed.rowCount ?? 0) === 1,
      leaseOwner: (claimed.rowCount ?? 0) === 1 ? input.leaseOwner : '',
      generation: (claimed.rowCount ?? 0) === 1
        ? Number((claimed.rows[0] as { generation?: number } | undefined)?.generation ?? 0)
        : undefined,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function settleAgentExecutionLease(
  rawInput: AgentExecutionLeaseInput,
  completed: boolean,
): Promise<boolean> {
  const input = {
    actorUserId: validateIdentifier('actorUserId', rawInput.actorUserId),
    projectId: validateIdentifier('projectId', rawInput.projectId),
    runId: validateIdentifier('runId', rawInput.runId),
    toolId: validateIdentifier('toolId', rawInput.toolId),
    leaseOwner: validateIdentifier('leaseOwner', rawInput.leaseOwner || ''),
    now: rawInput.now ?? Date.now(),
  };
  const result = await getPool().query(
    `UPDATE wujie_agent_execution_leases
     SET lease_owner = '', lease_expires_at = 0,
         completed_at = CASE WHEN $6 THEN $7 ELSE completed_at END,
         updated_at = $7
     WHERE task_id = $1 AND owner_id = $2 AND project_id = $3 AND tool_id = $4
       AND lease_owner = $5 AND completed_at = 0`,
    [input.runId, input.actorUserId, input.projectId, input.toolId,
      input.leaseOwner, completed, input.now],
  );
  return (result.rowCount ?? 0) === 1;
}

export function completeAdoptedAgentExecution(input: AgentExecutionLeaseInput): Promise<boolean> {
  return settleAgentExecutionLease(input, true);
}

export function releaseAdoptedAgentExecution(input: AgentExecutionLeaseInput): Promise<boolean> {
  return settleAgentExecutionLease(input, false);
}

function validateDownstreamIdentity(
  input: AgentDownstreamOperationIdentity,
): AgentDownstreamOperationIdentity {
  const executionFence = input.executionFence;
  if (
    !executionFence
    || executionFence.runId !== input.runId
    || !Number.isSafeInteger(executionFence.generation)
    || executionFence.generation < 0
  ) {
    throw new TypeError('Agent execution fence is required');
  }
  return {
    ...input,
    actorUserId: validateIdentifier('actorUserId', input.actorUserId),
    projectId: validateIdentifier('projectId', input.projectId),
    runId: validateIdentifier('runId', input.runId),
    toolId: validateIdentifier('toolId', input.toolId),
    stepId: validateIdentifier('stepId', input.stepId),
    requestDigest: validateIdentifier('requestDigest', input.requestDigest),
    operationKey: validateIdentifier('operationKey', input.operationKey),
    idempotencyKey: validateIdentifier('idempotencyKey', input.idempotencyKey),
    leaseOwner: validateIdentifier('leaseOwner', input.leaseOwner),
    executionFence: {
      runId: validateIdentifier('executionFence.runId', executionFence.runId),
      leaseOwner: validateIdentifier('executionFence.leaseOwner', executionFence.leaseOwner),
      generation: executionFence.generation,
    },
  };
}

function downstreamFenceSql(
  alias: string,
  runIdIndex: number,
  leaseOwnerIndex: number,
  generationIndex: number,
): string {
  return `EXISTS (
    SELECT 1 FROM wujie_agent_execution_leases agent_lease
    WHERE agent_lease.task_id = ${alias}.task_id
      AND agent_lease.task_id = $${runIdIndex}
      AND agent_lease.owner_id = ${alias}.owner_id
      AND agent_lease.project_id = ${alias}.project_id
      AND agent_lease.lease_owner = $${leaseOwnerIndex}
      AND agent_lease.generation = $${generationIndex}
      AND agent_lease.paused_at = 0
      AND agent_lease.completed_at = 0
  )`;
}

export async function prepareAgentDownstreamOperation(
  rawInput: AgentDownstreamOperationIdentity,
): Promise<AgentDownstreamOperation> {
  const input = validateDownstreamIdentity(rawInput);
  const now = input.now ?? Date.now();
  const leaseDurationMs = input.leaseDurationMs ?? 10 * 60_000;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const task = await client.query(
      `SELECT task.id FROM cloud_tasks task
       WHERE task.id = $1 AND task.user_id = $2 AND task.project_id = $3
         AND EXISTS (
           SELECT 1 FROM wujie_agent_execution_leases agent_lease
           WHERE agent_lease.task_id = task.id
             AND agent_lease.owner_id = task.user_id
             AND agent_lease.project_id = task.project_id
             AND agent_lease.lease_owner = $4
             AND agent_lease.generation = $5
             AND agent_lease.paused_at = 0
             AND agent_lease.completed_at = 0
         )
       FOR UPDATE`,
      [input.runId, input.actorUserId, input.projectId,
        input.executionFence.leaseOwner, input.executionFence.generation],
    );
    if ((task.rowCount ?? 0) !== 1) throw new AgentEventNotFoundError();
    await client.query(
       `INSERT INTO wujie_agent_downstream_operations(
         operation_key, owner_id, project_id, task_id, tool_id, step_id, request_digest,
         idempotency_key, created_at, updated_at
        ) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $9
        WHERE EXISTS (
          SELECT 1 FROM wujie_agent_execution_leases agent_lease
          WHERE agent_lease.task_id = $4
            AND agent_lease.owner_id = $2
            AND agent_lease.project_id = $3
            AND agent_lease.lease_owner = $10
            AND agent_lease.generation = $11
            AND agent_lease.paused_at = 0
            AND agent_lease.completed_at = 0
        )
        ON CONFLICT (operation_key) DO NOTHING`,
      [input.operationKey, input.actorUserId, input.projectId, input.runId,
        input.toolId, input.stepId, input.requestDigest, input.idempotencyKey, now,
        input.executionFence.leaseOwner, input.executionFence.generation],
    );
    const existing = await client.query<AgentDownstreamOperationRow>(
      `SELECT operation_key, owner_id, project_id, task_id, tool_id, step_id, request_digest,
              idempotency_key, status, response, provider_task_id, submission_error,
              lease_owner, attempt_count
       FROM wujie_agent_downstream_operations
       WHERE operation_key = $1 AND owner_id = $2 AND project_id = $3 AND task_id = $4
         AND ${downstreamFenceSql('wujie_agent_downstream_operations', 5, 6, 7)}
       FOR UPDATE`,
      [input.operationKey, input.actorUserId, input.projectId, input.runId,
        input.executionFence.runId, input.executionFence.leaseOwner,
        input.executionFence.generation],
    );
    if ((existing.rowCount ?? 0) !== 1) throw new AgentEventNotFoundError();
    const current = existing.rows[0];
    if (current.request_digest !== input.requestDigest || current.idempotency_key !== input.idempotencyKey) {
      throw new Error('Agent downstream operation identity conflict');
    }
    if (current.status === 'completed' || current.status === 'submission_unknown') {
      await client.query('COMMIT');
      return mapDownstreamOperation(current, input.executionFence, false);
    }
    const claimed = await client.query<AgentDownstreamOperationRow>(
      `UPDATE wujie_agent_downstream_operations operation
       SET lease_owner = $2, lease_expires_at = $3,
           attempt_count = attempt_count + 1, updated_at = $4
       WHERE operation_key = $1
          AND status IN ('prepared', 'submitted', 'accepted')
          AND lease_expires_at <= $4
          AND ${downstreamFenceSql('operation', 5, 6, 7)}
       RETURNING operation_key, owner_id, project_id, task_id, tool_id, step_id, request_digest,
                 idempotency_key, status, response, provider_task_id, submission_error,
                 lease_owner, attempt_count`,
      [input.operationKey, input.leaseOwner, now + leaseDurationMs, now,
        input.executionFence.runId, input.executionFence.leaseOwner,
        input.executionFence.generation],
    );
    await client.query('COMMIT');
    return claimed.rows[0]
      ? mapDownstreamOperation(claimed.rows[0], input.executionFence, true)
      : mapDownstreamOperation(current, input.executionFence, false);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getAgentDownstreamOperation(
  rawInput: AgentDownstreamOperationIdentity,
): Promise<AgentDownstreamOperation | null> {
  const input = validateDownstreamIdentity(rawInput);
  const result = await getPool().query<AgentDownstreamOperationRow>(
    `SELECT operation_key, owner_id, project_id, task_id, tool_id, step_id, request_digest,
            idempotency_key, status, response, provider_task_id, submission_error,
            lease_owner, attempt_count
     FROM wujie_agent_downstream_operations
     WHERE operation_key = $1 AND owner_id = $2 AND project_id = $3 AND task_id = $4
       AND ${downstreamFenceSql('wujie_agent_downstream_operations', 5, 6, 7)}`,
    [input.operationKey, input.actorUserId, input.projectId, input.runId,
      input.executionFence.runId, input.executionFence.leaseOwner,
      input.executionFence.generation],
  );
  return result.rows[0] ? mapDownstreamOperation(result.rows[0], input.executionFence) : null;
}

export async function completeAgentDownstreamOperation(
  rawInput: CompleteAgentDownstreamOperationInput,
): Promise<AgentDownstreamOperation> {
  const input = validateDownstreamIdentity(rawInput);
  const now = input.now ?? Date.now();
  const serialized = JSON.stringify(rawInput.response ?? null);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new RangeError('Agent downstream operation response exceeds its limit');
  }
  const result = await getPool().query<AgentDownstreamOperationRow>(
    `UPDATE wujie_agent_downstream_operations operation
     SET status = 'completed', response = $3::jsonb, lease_owner = '',
         lease_expires_at = 0, completed_at = $4, updated_at = $4
     WHERE operation_key = $1 AND lease_owner = $2
       AND status IN ('prepared', 'submitted', 'accepted')
       AND ${downstreamFenceSql('operation', 5, 6, 7)}
     RETURNING operation_key, owner_id, project_id, task_id, tool_id, step_id, request_digest,
               idempotency_key, status, response, provider_task_id, submission_error,
               lease_owner, attempt_count`,
    [input.operationKey, input.leaseOwner, serialized, now,
      input.executionFence.runId, input.executionFence.leaseOwner,
      input.executionFence.generation],
  );
  if (!result.rows[0]) throw new Error('Agent downstream operation lease was lost');
  return mapDownstreamOperation(result.rows[0], input.executionFence, true);
}

export async function markAgentDownstreamOperationSubmitted(
  rawInput: AgentDownstreamOperationIdentity,
): Promise<AgentDownstreamOperation> {
  const input = validateDownstreamIdentity(rawInput);
  const now = input.now ?? Date.now();
  const result = await getPool().query<AgentDownstreamOperationRow>(
    `UPDATE wujie_agent_downstream_operations operation
     SET status = 'submitted', submitted_at = $3, updated_at = $3
     WHERE operation_key = $1 AND lease_owner = $2 AND status = 'prepared'
       AND ${downstreamFenceSql('operation', 4, 5, 6)}
     RETURNING operation_key, owner_id, project_id, task_id, tool_id, step_id, request_digest,
               idempotency_key, status, response, provider_task_id, submission_error,
               lease_owner, attempt_count`,
    [input.operationKey, input.leaseOwner, now,
      input.executionFence.runId, input.executionFence.leaseOwner,
      input.executionFence.generation],
  );
  if (!result.rows[0]) throw new Error('Agent downstream operation lease was lost');
  return mapDownstreamOperation(result.rows[0], input.executionFence, true);
}

export async function markAgentDownstreamOperationAccepted(
  rawInput: AcceptAgentDownstreamOperationInput,
): Promise<AgentDownstreamOperation> {
  const input = validateDownstreamIdentity(rawInput);
  const providerTaskId = validateIdentifier('providerTaskId', rawInput.providerTaskId);
  const now = input.now ?? Date.now();
  const result = await getPool().query<AgentDownstreamOperationRow>(
    `UPDATE wujie_agent_downstream_operations operation
     SET status = 'accepted', provider_task_id = $3, accepted_at = $4, updated_at = $4
     WHERE operation_key = $1 AND lease_owner = $2 AND status = 'submitted'
       AND ${downstreamFenceSql('operation', 5, 6, 7)}
     RETURNING operation_key, owner_id, project_id, task_id, tool_id, step_id, request_digest,
               idempotency_key, status, response, provider_task_id, submission_error,
               lease_owner, attempt_count`,
    [input.operationKey, input.leaseOwner, providerTaskId, now,
      input.executionFence.runId, input.executionFence.leaseOwner,
      input.executionFence.generation],
  );
  if (!result.rows[0]) throw new Error('Agent downstream operation lease was lost');
  return mapDownstreamOperation(result.rows[0], input.executionFence, true);
}

export async function markAgentDownstreamSubmissionUnknown(
  rawInput: MarkAgentDownstreamSubmissionUnknownInput,
): Promise<AgentDownstreamOperation> {
  const input = validateDownstreamIdentity(rawInput);
  const reason = String(rawInput.reason || 'Provider submission outcome is unknown').slice(0, 2048);
  const now = input.now ?? Date.now();
  const result = await getPool().query<AgentDownstreamOperationRow>(
    `UPDATE wujie_agent_downstream_operations operation
     SET status = 'submission_unknown', submission_error = $3,
         submission_unknown_at = $4, lease_owner = '', lease_expires_at = 0, updated_at = $4
     WHERE operation_key = $1 AND lease_owner = $2 AND status IN ('submitted', 'accepted')
       AND ${downstreamFenceSql('operation', 5, 6, 7)}
     RETURNING operation_key, owner_id, project_id, task_id, tool_id, step_id, request_digest,
               idempotency_key, status, response, provider_task_id, submission_error,
               lease_owner, attempt_count`,
    [input.operationKey, input.leaseOwner, reason, now,
      input.executionFence.runId, input.executionFence.leaseOwner,
      input.executionFence.generation],
  );
  if (!result.rows[0]) throw new Error('Agent downstream operation lease was lost');
  return mapDownstreamOperation(result.rows[0], input.executionFence, true);
}

export async function releaseAgentDownstreamOperation(
  rawInput: AgentDownstreamOperationIdentity,
): Promise<boolean> {
  const input = validateDownstreamIdentity(rawInput);
  const result = await getPool().query(
    `UPDATE wujie_agent_downstream_operations operation
     SET lease_owner = '', lease_expires_at = 0, updated_at = $3
     WHERE operation_key = $1 AND lease_owner = $2 AND status IN ('prepared', 'accepted')
       AND ${downstreamFenceSql('operation', 4, 5, 6)}`,
    [input.operationKey, input.leaseOwner, input.now ?? Date.now(),
      input.executionFence.runId, input.executionFence.leaseOwner,
      input.executionFence.generation],
  );
  return (result.rowCount ?? 0) === 1;
}

function terminalObservation(status: string): {
  type: Extract<AgentEventType, 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.timeout'>;
  payload: Record<string, unknown>;
} | null {
  if (status === 'completed') {
    return { type: 'run.completed', payload: { result: { adoptedTask: true } } };
  }
  if (status !== 'failed' && status !== 'cancelled' && status !== 'timeout') {
    return null;
  }
  const code = status === 'cancelled'
    ? 'AGENT_RUN_CANCELLED'
    : status === 'timeout'
      ? 'AGENT_RUN_TIMEOUT'
      : 'AGENT_RUN_FAILED';
  return {
    type: `run.${status}`,
    payload: {
      error: {
        code,
        message: status === 'cancelled'
          ? 'Agent run cancelled'
          : status === 'timeout'
            ? 'Agent run timed out'
            : 'Agent run failed',
        retryable: status !== 'cancelled',
      },
    },
  };
}

export async function observeAdoptedAgentTaskTerminal(
  rawInput: ObserveAdoptedAgentTaskTerminalInput,
): Promise<AgentEvent[]> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const actorUserId = validateIdentifier('actorUserId', rawInput.actorUserId);
    const projectId = validateIdentifier('projectId', rawInput.projectId);
    const runId = validateIdentifier('runId', rawInput.runId);
    const toolId = validateIdentifier('toolId', rawInput.toolId);
    const task = await client.query<{ status: string; type: string }>(
      `SELECT status, type
       FROM cloud_tasks
       WHERE id = $1 AND user_id = $2 AND project_id = $3
       FOR UPDATE`,
      [runId, actorUserId, projectId],
    );
    if ((task.rowCount ?? 0) !== 1) throw new AgentEventNotFoundError();
    const terminal = terminalObservation(task.rows[0].status);
    if (!terminal || task.rows[0].type === 'agent-run') {
      await client.query('COMMIT');
      return [];
    }
    const lease = await client.query<{
      lease_owner: string; generation: number; paused_at: string | number;
    }>(
      `SELECT lease_owner, generation, paused_at
       FROM wujie_agent_execution_leases
       WHERE task_id = $1 AND owner_id = $2 AND project_id = $3`,
      [runId, actorUserId, projectId],
    );
    const activeLease = lease.rows[0];
    if (
      activeLease
      && (
        Number(activeLease.paused_at) > 0
        || (rawInput.leaseOwner !== undefined && activeLease.lease_owner !== rawInput.leaseOwner)
        || (rawInput.generation !== undefined && Number(activeLease.generation) !== rawInput.generation)
      )
    ) {
      await client.query('COMMIT');
      return [];
    }

    const existingTerminal = await client.query<AgentEventRow>(
      `SELECT event_id, task_id, sequence, event_type, request_digest, payload, created_at
       FROM wujie_agent_events
       WHERE task_id = $1 AND event_type IN ('run.completed', 'run.failed', 'run.cancelled', 'run.timeout')
       ORDER BY sequence
       LIMIT 1`,
      [runId],
    );
    if ((existingTerminal.rowCount ?? 0) > 0) {
      await client.query('COMMIT');
      return existingTerminal.rows.map(mapEvent);
    }

    const completedInput = validateAgentEventAppendInput({
      actorUserId,
      projectId,
      runId,
      eventId: `agent-adopt:${runId}:tool:${toolId}:completed`,
      workspace: rawInput.workspace,
      type: 'tool.completed',
      payload: { toolId },
    });
    const terminalInput = validateAgentEventAppendInput({
      actorUserId,
      projectId,
      runId,
      eventId: `agent-adopt:${runId}:terminal:${task.rows[0].status}`,
      workspace: rawInput.workspace,
      type: terminal.type,
      payload: terminal.payload,
    });
    const completed = await insertValidatedEvent(client, completedInput);
    const terminalEvent = await insertValidatedEvent(client, terminalInput);
    if (completed.inserted || terminalEvent.inserted) {
      await client.query(
        `UPDATE cloud_tasks
         SET revision = revision + 1,
             updated_at = GREATEST(updated_at, $2)
         WHERE id = $1`,
        [runId, Date.now()],
      );
    }
    await client.query('COMMIT');
    return [completed.event, terminalEvent.event];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listAgentEventsForActor(
  rawInput: ListAgentEventsInput,
): Promise<AgentEvent[]> {
  const input = {
    ...rawInput,
    actorUserId: validateIdentifier('actorUserId', rawInput.actorUserId),
    projectId: validateIdentifier('projectId', rawInput.projectId),
    runId: validateIdentifier('runId', rawInput.runId),
    afterSequence: rawInput.afterSequence ?? 0,
  };
  if (!Number.isSafeInteger(input.afterSequence) || input.afterSequence < 0) {
    throw new TypeError('afterSequence must be a non-negative integer');
  }

  const result = await getPool().query<AgentEventRow>(
    `SELECT event.event_id,
            event.task_id,
            event.sequence,
            event.event_type,
            event.request_digest,
            event.payload,
            event.created_at
     FROM wujie_agent_events event
     JOIN cloud_tasks task
       ON task.id = event.task_id
      AND task.user_id = event.owner_id
      AND task.project_id = event.project_id
     WHERE event.task_id = $1
       AND event.owner_id = $2
       AND event.project_id = $3
       AND event.sequence > $4
     ORDER BY event.sequence`,
    [input.runId, input.actorUserId, input.projectId, input.afterSequence],
  );
  return result.rows.map(mapEvent);
}

export async function listAgentEventStreamsForActor(
  rawInput: ListAgentEventStreamsInput,
): Promise<AgentEvent[][]> {
  const actorUserId = validateIdentifier('actorUserId', rawInput.actorUserId);
  const limit = rawInput.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('limit must be an integer between 1 and 100');
  }

  const result = await getPool().query<AgentEventRow>(
    `WITH recent_runs AS (
       SELECT DISTINCT task.id, task.updated_at
       FROM cloud_tasks task
       JOIN wujie_agent_events created
         ON created.task_id = task.id
        AND created.owner_id = task.user_id
        AND created.project_id = task.project_id
        AND created.event_type = 'run.created'
        AND created.payload ->> 'observed' IS DISTINCT FROM 'true'
       WHERE task.user_id = $1
       ORDER BY task.updated_at DESC, task.id DESC
       LIMIT $2
     )
     SELECT event.event_id,
            event.task_id,
            event.sequence,
            event.event_type,
            event.request_digest,
            event.payload,
            event.created_at
     FROM recent_runs run
     JOIN wujie_agent_events event
       ON event.task_id = run.id
      AND event.owner_id = $1
     ORDER BY run.updated_at DESC, run.id DESC, event.sequence`,
    [actorUserId, limit],
  );

  const streams = new Map<string, AgentEvent[]>();
  for (const row of result.rows) {
    const stream = streams.get(row.task_id) || [];
    stream.push(mapEvent(row));
    streams.set(row.task_id, stream);
  }
  return [...streams.values()];
}
