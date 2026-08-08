import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execSql } = vi.hoisted(() => ({ execSql: vi.fn() }));

vi.mock('@/lib/db-client', () => ({ execSql }));

import {
  chargeCloudTaskCredits,
  claimCloudTaskLease,
  createCloudTask,
  getCloudTaskById,
  getCloudTaskForUser,
  getCloudTaskForUserByIdempotencyKey,
  listCloudTasks,
  getCloudTaskProviderSummary,
  refundCloudTaskCredits,
  releaseCloudTaskLease,
  renewCloudTaskLease,
  terminateCloudTaskAndRefund,
  transitionCloudTaskStatus,
  type CloudTaskStatus,
  updateCloudTask,
} from '@/lib/cloud-task-storage';
import * as cloudTaskStorage from '@/lib/cloud-task-storage';

describe('cloud-task-storage', () => {
  beforeEach(() => {
    execSql.mockReset();
    execSql.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('creates a task with cloud recovery context', async () => {
    const created = await createCloudTask({
      id: 'task-create',
      userId: 'user-a',
      type: 'generate',
      status: 'processing',
      providerId: 'provider-a',
      model: 'image-model-a',
      remoteTaskId: 'remote-a',
      progress: 15,
      createdAt: 100,
      updatedAt: 100,
    });

    const insert = execSql.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO cloud_tasks'));
    expect(insert).toBeDefined();
    expect(insert?.[1]).toEqual(expect.arrayContaining([
      'task-create',
      'user-a',
      'generate',
      'processing',
      'provider-a',
      'image-model-a',
      'remote-a',
    ]));
    expect(created).toBe(true);
  });

  it('reports an idempotency-key conflict instead of treating it as a new task', async () => {
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const created = await createCloudTask({
      id: 'task-duplicate',
      userId: 'user-a',
      type: 'generate',
      status: 'processing',
      progress: 5,
      idempotencyKey: 'retry-key-1',
      createdAt: 100,
      updatedAt: 100,
    });

    const insert = execSql.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO cloud_tasks'));
    expect(insert?.[0]).toContain('ON CONFLICT DO NOTHING');
    expect(created).toBe(false);
  });

  it('updates status only through an allowed edge with status and revision CAS', async () => {
    execSql.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM cloud_tasks WHERE id = $1')) {
        return {
          rows: [{
            id: 'task-finish',
            user_id: 'user-a',
            type: 'generate',
            status: 'processing',
            progress: 50,
            credit_status: 'pending',
            revision: 4,
            created_at: 100,
            updated_at: 100,
          }],
          rowCount: 1,
        };
      }
      return { rows: [{ id: 'task-finish' }], rowCount: 1 };
    });

    await expect(updateCloudTask('task-finish', {
      status: 'completed',
      progress: 100,
      result: { imageUrl: '/result.png' },
      creditStatus: 'charged',
    })).resolves.toBe(true);

    const update = execSql.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE cloud_tasks SET'));
    expect(update).toBeDefined();
    expect(update?.[0]).toContain('status = $');
    expect(update?.[0]).toContain('result = $');
    expect(update?.[0]).toContain('credit_status = $');
    expect(update?.[0]).toContain('status = ANY');
    expect(update?.[0]).toContain('revision = $');
    expect(update?.[1]).toEqual(expect.arrayContaining([
      ['processing'],
      4,
    ]));
  });

  it.each([
    ['processing', 'created'],
    ['uploading', 'queued'],
    ['created', 'processing'],
  ] as const)('rejects generic status bypass %s -> %s', async (from, to) => {
    execSql.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM cloud_tasks WHERE id = $1')) {
        return {
          rows: [{
            id: 'task-invalid-edge',
            user_id: 'user-a',
            type: 'generate',
            status: from,
            progress: 30,
            credit_status: 'pending',
            revision: 2,
            created_at: 100,
            updated_at: 100,
          }],
          rowCount: 1,
        };
      }
      return { rows: [{ id: 'task-invalid-edge' }], rowCount: 1 };
    });

    await expect(updateCloudTask('task-invalid-edge', {
      status: to as CloudTaskStatus,
    })).resolves.toBe(false);
    expect(execSql.mock.calls.some(([sql]) =>
      String(sql).startsWith('UPDATE cloud_tasks SET')
    )).toBe(false);
  });

  it.each([
    ['progress', { progress: 5 }],
    ['result', { result: { imageUrl: '/overwrite.png' } }],
    ['error', { error: 'overwrite' }],
    ['remoteTaskId', { remoteTaskId: 'remote-overwrite' }],
    ['creditStatus', { creditStatus: 'refunded' as const }],
    ['creditCost', { creditCost: 99 }],
  ])('blocks terminal statusless %s business-field updates', async (_field, input) => {
    execSql.mockImplementation(async (sql: string) => ({
      rows: [],
      rowCount: sql.includes(
        "status NOT IN ('completed', 'failed', 'cancelled', 'timeout')",
      ) ? 0 : 1,
    }));

    await expect(updateCloudTask('terminal-task', input)).resolves.toBe(false);
    const update = execSql.mock.calls.find(([sql]) =>
      String(sql).startsWith('UPDATE cloud_tasks SET')
    );
    expect(update?.[0]).toContain(
      "status NOT IN ('completed', 'failed', 'cancelled', 'timeout')",
    );
  });

  it('allows a terminal audit label without opening business fields', async () => {
    execSql.mockResolvedValueOnce({
      rows: [{ id: 'terminal-task' }],
      rowCount: 1,
    });

    await expect(updateCloudTask('terminal-task', {
      label: 'late audit note',
    })).resolves.toBe(true);

    const update = execSql.mock.calls.find(([sql]) =>
      String(sql).startsWith('UPDATE cloud_tasks SET')
    );
    expect(update?.[0]).toContain('label = $');
    expect(update?.[0]).not.toContain("status NOT IN ('completed'");
  });

  it('queries a task with both task id and owner id', async () => {
    execSql.mockResolvedValueOnce({
      rows: [{
        id: 'task-owned', user_id: 'user-a', type: 'generate', status: 'completed',
        progress: 100, provider_id: 'provider-a', model: 'image-model-a',
        remote_task_id: 'remote-a', result: { imageUrl: '/result.png' }, error: '',
        credit_status: 'charged', created_at: 100, updated_at: 200,
      }],
      rowCount: 1,
    });

    const task = await getCloudTaskForUser('task-owned', 'user-a');

    const select = execSql.mock.calls.find(([sql]) => String(sql).includes('WHERE id = $1 AND user_id = $2'));
    expect(select).toBeDefined();
    expect(select?.[1]).toEqual(['task-owned', 'user-a']);
    expect(task).toMatchObject({
      id: 'task-owned',
      userId: 'user-a',
      status: 'completed',
      result: { imageUrl: '/result.png' },
    });
  });

  it('keeps durable raw status while projecting legacy readers centrally', async () => {
    const row = {
      id: 'task-uploading',
      user_id: 'user-a',
      type: 'generate',
      status: 'uploading',
      progress: 90,
      credit_status: 'pending',
      revision: 3,
      created_at: 100,
      updated_at: 200,
    };
    execSql.mockResolvedValue({ rows: [row], rowCount: 1 });

    await expect(getCloudTaskById('task-uploading')).resolves.toMatchObject({
      status: 'uploading',
      revision: 3,
    });
    await expect(
      getCloudTaskForUser('task-uploading', 'user-a'),
    ).resolves.toMatchObject({
      status: 'processing',
      revision: 3,
    });
  });

  it('lists cloud tasks with provider and status filters', async () => {
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await listCloudTasks({ providerId: 'provider-a', status: 'failed', limit: 25 });

    const select = execSql.mock.calls.find(([sql]) => String(sql).includes('FROM cloud_tasks'));
    expect(select?.[0]).toContain('provider_id = $1');
    expect(select?.[0]).toContain('status = $2');
    expect(select?.[1]).toEqual(['provider-a', 'failed', 25]);
  });

  it.each([
    ['queued', ['created', 'queued']],
    ['pending', ['submitting', 'pending']],
    ['processing', ['processing', 'uploading']],
  ] as const)('expands the legacy %s filter to durable persisted states', async (
    status,
    persistedStatuses,
  ) => {
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await listCloudTasks({ status });

    const select = execSql.mock.calls.find(([sql]) =>
      String(sql).includes('ORDER BY updated_at DESC')
    );
    expect(select?.[0]).toContain('status = ANY');
    expect(select?.[1]).toEqual(expect.arrayContaining([persistedStatuses]));
  });

  it('summarizes task states by provider without reading task payloads', async () => {
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await getCloudTaskProviderSummary();

    const select = execSql.mock.calls.find(([sql]) => String(sql).includes('GROUP BY provider_id'));
    expect(select?.[0]).toContain(
      "status IN ('created', 'queued', 'submitting', 'pending', 'processing', 'uploading')",
    );
    expect(select?.[0]).toContain("status IN ('failed', 'timeout', 'cancelled')");
    expect(select?.[0]).not.toContain('result');
  });

  it('claims an expired-or-unclaimed task lease atomically', async () => {
    execSql.mockResolvedValueOnce({
      rows: [{ id: 'task-lease', lease_owner: 'worker-a', lease_expires_at: 5000, attempt_count: 2 }],
      rowCount: 1,
    });

    const lease = await claimCloudTaskLease('task-lease', 'worker-a', 4000, 1000);

    const update = execSql.mock.calls.find(([sql]) => String(sql).includes('lease_expires_at'));
    expect(update?.[0]).toContain(
      "status IN ('created', 'queued', 'submitting', 'pending', 'processing', 'uploading')",
    );
    expect(update?.[0]).toContain('lease_expires_at < $');
    expect(update?.[1]).toEqual(expect.arrayContaining(['task-lease', 'worker-a', 5000, 1000]));
    expect(lease).toEqual({ taskId: 'task-lease', owner: 'worker-a', expiresAt: 5000, attemptCount: 2 });
  });

  it('does not claim a task when another worker holds a live lease', async () => {
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(claimCloudTaskLease('task-live', 'worker-b', 4000, 1000)).resolves.toBeNull();
  });

  it('guards worker progress updates by live status and lease owner', async () => {
    execSql.mockResolvedValueOnce({ rows: [{ id: 'task-guarded' }], rowCount: 1 });

    await expect(updateCloudTask('task-guarded', {
      progress: 62,
      result: { phase: 'extracting-psd' },
      expectedStatuses: ['processing'],
      leaseOwner: 'worker-a',
    })).resolves.toBe(true);

    const update = execSql.mock.calls.find(([sql]) => String(sql).includes('status = ANY'));
    expect(update?.[0]).toContain('lease_owner = $');
    expect(update?.[0]).toContain('RETURNING id');
    expect(update?.[1]).toEqual(expect.arrayContaining([
      'task-guarded',
      ['processing'],
      'worker-a',
    ]));
  });

  it('releases a task lease only for its current owner', async () => {
    execSql.mockResolvedValueOnce({ rows: [{ id: 'task-lease' }], rowCount: 1 });

    await expect(releaseCloudTaskLease('task-lease', 'worker-a')).resolves.toBe(true);

    const update = execSql.mock.calls.find(([sql]) => String(sql).includes("lease_owner = ''"));
    expect(update?.[0]).toContain('lease_owner = $2');
    expect(update?.[1]).toEqual(['task-lease', 'worker-a', expect.any(Number)]);
  });

  it('renews a live task lease only for its current owner', async () => {
    execSql.mockResolvedValueOnce({ rows: [{ id: 'task-lease' }], rowCount: 1 });

    await expect(renewCloudTaskLease('task-lease', 'worker-a', 4000, 1000))
      .resolves.toBe(true);

    const update = execSql.mock.calls.find(([sql]) => String(sql).includes('lease_expires_at = $3'));
    expect(update?.[0]).toContain('lease_owner = $2');
    expect(update?.[0]).toContain(
      "status IN ('created', 'queued', 'submitting', 'pending', 'processing', 'uploading')",
    );
    expect(update?.[1]).toEqual(['task-lease', 'worker-a', 5000, 1000]);
  });

  it('finds an existing task by owner and idempotency key', async () => {
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getCloudTaskForUserByIdempotencyKey('user-a', 'retry-key-1');

    const select = execSql.mock.calls.find(([sql]) => String(sql).includes('idempotency_key'));
    expect(select?.[0]).toContain('user_id = $1 AND idempotency_key = $2');
    expect(select?.[1]).toEqual(['user-a', 'retry-key-1']);
  });

  it('claims a pending cloud-task credit refund atomically by task id', async () => {
    execSql.mockResolvedValueOnce({
      rows: [{ user_id: 'user-a', credit_cost: 6, balance: 94 }],
      rowCount: 1,
    });

    const refund = await refundCloudTaskCredits('task-refund-once', '图像生成失败退款');

    const settlement = execSql.mock.calls.find(([sql]) => String(sql).includes('WITH refundable AS'));
    expect(settlement).toBeDefined();
    expect(settlement?.[0]).toContain("credit_status = 'pending'");
    expect(settlement?.[0]).toContain("SET credit_status = 'refunded'");
    expect(refund).toEqual({ refunded: true, creditCost: 6, balance: 94, userId: 'user-a' });
  });

  it('switches to local fallback and refunds in one owner-fenced statement', async () => {
    execSql.mockResolvedValueOnce({
      rows: [{
        transitioned: true,
        refunded: true,
        credit_cost: 6,
        balance: 94,
        user_id: 'user-a',
      }],
      rowCount: 1,
    });
    const transition = (
      cloudTaskStorage as typeof cloudTaskStorage & {
        transitionCloudTaskToLocalFallbackAndRefund: (
          taskId: string,
          result: Record<string, unknown>,
          reason: string,
          leaseOwner: string,
        ) => Promise<{
          transitioned: boolean;
          refunded: boolean;
          creditCost: number;
          balance?: number;
          userId?: string;
        }>;
      }
    ).transitionCloudTaskToLocalFallbackAndRefund;

    const outcome = await transition(
      'task-fallback',
      { phase: 'running-local-fallback', fallbackReason: 'bad PSD' },
      'Pear fallback refund',
      'worker-a',
    );

    const statement = execSql.mock.calls.find(([sql]) => (
      String(sql).includes('SET result = $2')
      && String(sql).includes('refund_claimed')
    ));
    expect(statement).toBeDefined();
    expect(statement?.[0]).toContain("status = 'processing'");
    expect(statement?.[0]).toContain('lease_owner = $');
    expect(statement?.[0]).toContain('INSERT INTO wujie_credit_transactions');
    expect(statement?.[1]).toEqual(expect.arrayContaining([
      expect.stringContaining('"phase":"running-local-fallback"'),
      'worker-a',
    ]));
    expect(outcome).toEqual({
      transitioned: true,
      refunded: true,
      creditCost: 6,
      balance: 94,
      userId: 'user-a',
    });
  });

  it('settles a failure without updating the same cloud task row twice', async () => {
    execSql.mockResolvedValueOnce({
      rows: [{
        status: 'failed',
        user_id: 'user-a',
        credit_cost: 6,
        transitioned: true,
        refunded: true,
        balance: 100,
      }],
      rowCount: 1,
    });

    const termination = await terminateCloudTaskAndRefund(
      'task-failed-after-charge',
      'failed',
      'Remote image returned HTTP 403',
    );

    const settlement = execSql.mock.calls.find(([sql]) => String(sql).includes('recorded_refund'));
    const taskUpdates = String(settlement?.[0]).match(/UPDATE\s+cloud_tasks\b/gi) || [];
    expect(taskUpdates).toHaveLength(1);
    expect(settlement?.[0]).toContain('FOR UPDATE');
    expect(settlement?.[0]).toMatch(/FOR UPDATE OF credit/i);
    expect(termination).toEqual({
      status: 'failed',
      transitioned: true,
      refunded: true,
      creditCost: 6,
      balance: 100,
      userId: 'user-a',
    });
  });

  it('charges credits and marks the idempotent task in one atomic statement', async () => {
    execSql.mockResolvedValueOnce({
      rows: [{ user_id: 'user-a', credit_cost: 6, balance: 88 }],
      rowCount: 1,
    });

    const charge = await chargeCloudTaskCredits(
      'task-charge-once',
      'user-a',
      6,
      'Annotation edit',
    );

    const settlement = execSql.mock.calls.find(([sql]) => String(sql).includes('WITH chargeable AS'));
    expect(settlement).toBeDefined();
    expect(settlement?.[0]).toContain("credit_status = 'not-applicable'");
    expect(settlement?.[0]).toContain("credit_status = 'pending'");
    expect(settlement?.[0]).toContain('balance >= chargeable.credit_cost');
    expect(charge).toEqual({ charged: true, creditCost: 6, balance: 88, userId: 'user-a' });
  });

  it('does not report a zero-cost charge when the guarded task update loses its lease', async () => {
    execSql
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-zero-cost',
          user_id: 'user-a',
          type: 'annotation-edit',
          status: 'pending',
          progress: 0,
          credit_status: 'not-applicable',
          revision: 3,
          created_at: 100,
          updated_at: 100,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const charge = await chargeCloudTaskCredits(
      'task-zero-cost',
      'user-a',
      0,
      'Free layer model',
      'worker-a',
    );

    expect(charge).toEqual({ charged: false, creditCost: 0 });
    const update = execSql.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE cloud_tasks SET'));
    expect(update?.[0]).toContain('lease_owner = $');
    expect(update?.[1]).toEqual(expect.arrayContaining(['worker-a']));
  });

  it('writes terminal credit compatibility metadata in the same CAS statement', async () => {
    execSql.mockResolvedValueOnce({
      rows: [{
        id: 'task-terminal-credit',
        user_id: 'user-a',
        type: 'generate',
        status: 'completed',
        progress: 100,
        credit_status: 'charged',
        revision: 8,
        created_at: 100,
        updated_at: 200,
      }],
      rowCount: 1,
    });

    await expect(transitionCloudTaskStatus({
      taskId: 'task-terminal-credit',
      from: ['processing'],
      to: 'completed',
      revision: 7,
      result: { imageUrl: '/result.png' },
      creditStatus: 'charged',
    })).resolves.toMatchObject({
      transitioned: true,
      task: {
        status: 'completed',
        creditStatus: 'charged',
        revision: 8,
      },
    });

    const update = execSql.mock.calls.find(([sql]) =>
      String(sql).includes('AND revision = $3')
    );
    expect(update?.[0]).toContain('credit_status = $');
    expect(update?.[1]).toEqual(expect.arrayContaining(['charged']));
  });
});
