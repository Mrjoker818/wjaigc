import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import { getPool } from '@/lib/db-client';
import { assertAgentEventPayloadSafe } from './event-reducer';
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
}

export interface ValidatedAgentEventInput extends AppendAgentEventInput {
  requestDigest: string;
  serializedPayload: string;
}

export interface AppendAdoptedAgentEventResult {
  event: AgentEvent;
  inserted: boolean;
}

export interface ObserveAdoptedAgentTaskTerminalInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  workspace: AgentWorkspace;
  toolId: string;
}

export interface AgentExecutionLeaseInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  toolId: string;
  leaseOwner?: string;
  now?: number;
  leaseDurationMs?: number;
}

export interface AgentExecutionLeaseClaim {
  claimed: boolean;
  leaseOwner: string;
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
    const { requestDigest, serializedPayload } = input;
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

export async function appendAdoptedAgentEvent(
  rawInput: AppendAgentEventInput,
): Promise<AppendAdoptedAgentEventResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const input = validateAgentEventAppendInput(rawInput);
    const task = await client.query<{ status: string }>(
      `SELECT status
       FROM cloud_tasks
       WHERE id = $1 AND user_id = $2 AND project_id = $3
       FOR UPDATE`,
      [input.runId, input.actorUserId, input.projectId],
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
           attempt_count = attempt_count + 1,
           updated_at = $7
       WHERE task_id = $1 AND owner_id = $2 AND project_id = $3 AND tool_id = $4
         AND completed_at = 0 AND lease_expires_at <= $7`,
      [input.runId, input.actorUserId, input.projectId, input.toolId,
        input.leaseOwner, input.now + input.leaseDurationMs, input.now],
    );
    await client.query('COMMIT');
    return {
      claimed: (claimed.rowCount ?? 0) === 1,
      leaseOwner: (claimed.rowCount ?? 0) === 1 ? input.leaseOwner : '',
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
