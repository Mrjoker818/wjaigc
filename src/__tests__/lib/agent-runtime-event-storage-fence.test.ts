import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let rejectFencedTaskRead = false;
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
      if (rejectFencedTaskRead && sql.includes('wujie_agent_execution_leases')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ status: 'processing', revision: 0 }], rowCount: 1 };
    }
    if (sql.includes('COALESCE(MAX(sequence)')) {
      return { rows: [{ sequence: 2 }], rowCount: 1 };
    }
    if (sql.includes('FROM wujie_agent_events') && sql.includes('event_id =')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM wujie_agent_events') && sql.includes('ORDER BY sequence')) {
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
  return {
    queries, query, client, pool,
    setRejectFencedTaskRead(value: boolean) { rejectFencedTaskRead = value; },
  };
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
  transitionAgentRunControl,
  type AppendAgentEventInput,
} from '@/lib/agent-runtime/event-storage';
import type { AgentDownstreamOperationIdentity } from '@/lib/agent-runtime/downstream-operations';
import { createSameTaskAgentAdapter } from '@/lib/agent-runtime/same-task-adapter';

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
    mocks.setRejectFencedTaskRead(false);
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
      if (!sql.includes('lease_expires_at = 0')) {
        expect(sql).toContain('paused_at = 0');
      }
      expect(sql).toContain('completed_at = 0');
      expect(sql).toContain('generation');
      expect(sql).toContain('lease_owner');
      expect(params).toEqual(expect.arrayContaining([
        executionFence.runId, executionFence.leaseOwner, executionFence.generation,
      ]));
    }
  });

  it('releases the matching downstream lease after the run pauses for retry', async () => {
    await releaseAgentDownstreamOperation(identity, { knownSubmissionOutcome: true });

    const releaseQuery = mocks.queries.find(({ sql }) => sql.includes('lease_expires_at = 0'));
    expect(releaseQuery?.sql).toContain('wujie_agent_execution_leases');
    expect(releaseQuery?.sql).toContain("operation.status <> 'accepted'");
    expect(releaseQuery?.sql).toContain('agent_lease.paused_at = 0');
    expect(releaseQuery?.sql).toContain('agent_lease.paused_at > 0');
    expect(releaseQuery?.sql).toContain("agent_lease.lease_owner = ''");
    expect(releaseQuery?.sql).toMatch(
      /agent_lease\.lease_owner = \$5\s+OR\s+\(\s*agent_lease\.paused_at > 0/,
    );
    expect(releaseQuery?.sql).toContain('completed_at = 0');
    expect(releaseQuery?.params).toEqual(expect.arrayContaining([
      executionFence.runId, executionFence.leaseOwner, executionFence.generation,
    ]));
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

  it('rejects stale execution-error pauses through the authoritative generation lease query', async () => {
    await transitionAgentRunControl({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      eventId: 'agent:run-1:paused:1', workspace: 'canvas', type: 'run.paused',
      payload: { nextStepId: 'generate-2', pauseReason: 'execution-error' },
      expectedRevision: 0, executionFence,
    });

    const taskRead = mocks.queries.find(({ sql }) => (
      sql.includes('SELECT status, revision FROM cloud_tasks')
    ));
    expect(taskRead?.sql).toContain('wujie_agent_execution_leases');
    expect(taskRead?.sql).toContain('paused_at = 0');
    expect(taskRead?.sql).toContain('completed_at = 0');
    expect(taskRead?.params).toEqual(expect.arrayContaining([
      executionFence.runId, executionFence.leaseOwner, executionFence.generation,
    ]));
  });

  it('does not persist a pause when a newer execution generation owns the lease', async () => {
    mocks.setRejectFencedTaskRead(true);

    await expect(transitionAgentRunControl({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      eventId: 'agent:run-1:paused:stale', workspace: 'canvas', type: 'run.paused',
      payload: { nextStepId: 'generate-2', pauseReason: 'execution-error' },
      expectedRevision: 0, executionFence,
    })).rejects.toMatchObject({ name: 'AgentEventNotFoundError' });

    expect(mocks.queries.some(({ sql }) => sql.includes('INSERT INTO wujie_agent_events'))).toBe(false);
    expect(mocks.queries.some(({ sql }) => sql.includes('SET lease_owner = \'\''))).toBe(false);
  });

  it('accepts the database initial generation zero for the first tool.started event', async () => {
    const initialFence = { runId: 'run-1', leaseOwner: 'agent-lease-initial', generation: 0 };

    await expect(appendAdoptedAgentEvent({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      eventId: 'agent:run-1:tool:image-edit:initial', workspace: 'canvas',
      type: 'tool.started', payload: { toolId: 'image_edit', generation: 0 },
      executionFence: initialFence,
    } as AppendAgentEventInput)).resolves.toMatchObject({ inserted: true });

    const taskRead = mocks.queries.find(({ sql, params }) => (
      sql.includes('FROM cloud_tasks')
      && sql.includes('FOR UPDATE')
      && params.includes('agent-lease-initial')
    ));
    expect(taskRead?.params).toEqual(expect.arrayContaining(['agent-lease-initial', 0]));
  });

  it('combines a generation-zero claim with the real fenced event writer', async () => {
    const execute = vi.fn().mockResolvedValue('complete');
    const adapter = createSameTaskAgentAdapter({
      getTaskForUser: vi.fn().mockResolvedValue({
        id: 'run-1', userId: 'user-1', projectId: 'project-1', type: 'generate-async',
        status: 'processing', providerId: 'provider-image', model: 'model-image', progress: 5,
        creditStatus: 'pending', creditCost: 1, createdAt: 1, updatedAt: 1, revision: 0,
      }),
      resolveTaskModel: vi.fn(),
      authorizeContext: vi.fn(),
      appendAdoptedEvent: appendAdoptedAgentEvent,
      observeTerminal: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([]),
      claimExecution: vi.fn().mockResolvedValue({
        claimed: true, leaseOwner: 'agent-lease-initial', generation: 0,
      }),
      completeExecution: vi.fn().mockResolvedValue(true),
      releaseExecution: vi.fn().mockResolvedValue(true),
    });

    await expect(adapter.executeAdoption({
      adoption: {
        runId: 'run-1', reused: false, claimed: true, projection: {
          runId: 'run-1', status: 'planning', lastSequence: 0, plan: [], assetVersionIds: [],
          qualityChecks: [], missingSequences: [], ignoredEventIds: [],
        },
        tools: [], actorUserId: 'user-1', projectId: 'project-1', workspace: 'canvas',
        toolId: 'generate_image', requestDigest: 'a'.repeat(64),
      },
      execute,
    })).resolves.toMatchObject({ executed: true, value: 'complete' });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      executionFence: { runId: 'run-1', leaseOwner: 'agent-lease-initial', generation: 0 },
      signal: expect.any(AbortSignal),
    }));
  });
});
