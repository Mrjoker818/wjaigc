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

function createRequestDigest(input: {
  projectId: string;
  runId: string;
  workspace: AgentWorkspace;
  type: AgentEventType;
  payload: Record<string, unknown>;
}): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex');
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

export async function appendAgentEvent(
  rawInput: AppendAgentEventInput,
): Promise<AgentEvent> {
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
  const requestDigest = createRequestDigest(input);
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const task = await client.query(
      `SELECT id
       FROM cloud_tasks
       WHERE id = $1 AND user_id = $2 AND project_id = $3
       FOR UPDATE`,
      [input.runId, input.actorUserId, input.projectId],
    );
    if ((task.rowCount ?? 0) !== 1) throw new AgentEventNotFoundError();

    const existing = await findExistingEvent(client, input);
    if (existing) {
      if (existing.request_digest !== requestDigest) {
        throw new AgentEventConflictError();
      }
      await client.query('COMMIT');
      return mapEvent(existing);
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
          requestDigest,
          serializedPayload,
          createdAt,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new AgentEventConflictError();
      throw error;
    }
    await client.query('COMMIT');
    return mapEvent(inserted.rows[0]);
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
       SELECT task.id, task.updated_at
       FROM cloud_tasks task
       WHERE task.user_id = $1
         AND task.type = 'agent-run'
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
