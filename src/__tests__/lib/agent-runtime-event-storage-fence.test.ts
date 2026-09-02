import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const operationRow = {
    operation_key: 'agent-op:key', owner_id: 'user-1', project_id: 'project-1',
    task_id: 'run-1', tool_id: 'image_edit', step_id: 'image-edit:1',
    request_digest: 'a'.repeat(64), idempotency_key: 'agent-provider:key',
    status: 'prepared', response: null, provider_task_id: null,
    submission_error: null, lease_owner: 'operation-lease', attempt_count: 1,
  };
  const query = vi.fn(async (rawSql: string, params: unknown[] = []) => {
    const sql = String(rawSql);
    queries.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('SELECT id FROM cloud_tasks')) {
      return { rows: [{ id: 'run-1' }], rowCount: 1 };
    }
    if (sql.includes('SELECT status') && sql.includes('FROM cloud_tasks')) {
      return { rows: [{ status: 'processing' }], rowCount: 1 };
    }
    if (sql.includes('COALESCE(MAX(sequence)')) {
      return { rows: [{ sequence: 2 }], rowCount: 1 };
    }
    if (sql.includes('FROM wujie_agent_events') && sql.includes('event_id =')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO wujie_agent_events')) {
      return {
        rows: [{
          event_id: String(params[0]), task_id: 'run-1', sequence: 2,
          event_type: String(params[6]), request_digest: String(params[7]),
          payload: JSON.parse(String(params[8])), created_at: Number(params[9]),
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('wujie_agent_downstream_operations')) {
      return { rows: [{ ...operationRow }], rowCount: 1 };
    }
    return { rows: [{ id: 'run-1' }], rowCount: 1 };
  });
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) };
  return { queries, query, client, pool };
});

vi.mock('@/lib/db-client', () => ({ getPool: () => mocks.pool }));

import {
  appendAdoptedAgentEvent,
  completeAgentDownstreamOperation,
  getAgentDownstreamOperation,
  markAgentDownstreamOperationAccepted,
  markAgentDownstreamOperationSubmitted,
  markAgentDownstreamSubmissionUnknown,
  prepareAgentDownstreamOperation,
  releaseAgentDownstreamOperation,
  type AppendAgentEventInput,
} from '@/lib/agent-runtime/event-storage';
import type { AgentDownstreamOperationIdentity } from '@/lib/agent-runtime/downstream-operations';

const executionFence = {
  runId: 'run-1', leaseOwner: 'agent-lease-7', generation: 7,
};
const identity = {
  actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
  toolId: 'image_edit', stepId: 'image-edit:1', requestDigest: 'a'.repeat(64),
  operationKey: 'agent-op:key', idempotencyKey: 'agent-provider:key',
  leaseOwner: 'operation-lease', executionFence,
} as AgentDownstreamOperationIdentity;

describe('Agent event and downstream storage execution fences', () => {
  beforeEach(() => {
    mocks.queries.length = 0;
    mocks.query.mockClear();
  });

  it('checks the authoritative run generation and owner for every downstream transition', async () => {
    await prepareAgentDownstreamOperation(identity);
    await getAgentDownstreamOperation(identity);
    await markAgentDownstreamOperationSubmitted(identity);
    await markAgentDownstreamOperationAccepted({ ...identity, providerTaskId: 'provider-task-1' });
    await completeAgentDownstreamOperation({ ...identity, response: { imageUrl: '/result.png' } });
    await markAgentDownstreamSubmissionUnknown({ ...identity, reason: 'unknown' });
    await releaseAgentDownstreamOperation(identity);

    const operationQueries = mocks.queries.filter(({ sql }) => (
      sql.includes('wujie_agent_downstream_operations')
      && !sql.includes('INSERT INTO wujie_agent_downstream_operations')
    ));
    expect(operationQueries.length).toBeGreaterThanOrEqual(7);
    for (const { sql, params } of operationQueries) {
      expect(sql).toContain('wujie_agent_execution_leases');
      expect(sql).toContain('paused_at = 0');
      expect(sql).toContain('completed_at = 0');
      expect(sql).toContain('generation');
      expect(sql).toContain('lease_owner');
      expect(params).toEqual(expect.arrayContaining([
        executionFence.runId, executionFence.leaseOwner, executionFence.generation,
      ]));
    }
  });

  it('fences execution-owned event appends with the claimed generation and owner', async () => {
    await appendAdoptedAgentEvent({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      eventId: 'agent:run-1:tool:image-edit:started', workspace: 'canvas',
      type: 'tool.started', payload: { toolId: 'image_edit', generation: 7 },
      executionFence,
    } as AppendAgentEventInput);

    const taskRead = mocks.queries.find(({ sql }) => (
      sql.includes('FROM cloud_tasks') && sql.includes('FOR UPDATE')
    ));
    expect(taskRead?.sql).toContain('wujie_agent_execution_leases');
    expect(taskRead?.sql).toContain('paused_at = 0');
    expect(taskRead?.sql).toContain('completed_at = 0');
    expect(taskRead?.params).toEqual(expect.arrayContaining([
      executionFence.runId, executionFence.leaseOwner, executionFence.generation,
    ]));
  });
});
