import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execSql } = vi.hoisted(() => ({ execSql: vi.fn() }));

vi.mock('@/lib/db-client', () => ({ execSql }));

import {
  chargeCloudTaskCredits,
  claimCloudTaskLease,
  createCloudTask,
  getCloudTaskForUser,
  getCloudTaskForUserByIdempotencyKey,
  listCloudTasks,
  getCloudTaskProviderSummary,
  refundCloudTaskCredits,
  releaseCloudTaskLease,
  updateCloudTask,
} from '@/lib/cloud-task-storage';

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

  it('updates a task terminal status with result and credit state', async () => {
    await updateCloudTask('task-finish', {
      status: 'completed',
      progress: 100,
      result: { imageUrl: '/result.png' },
      creditStatus: 'charged',
    });

    const update = execSql.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE cloud_tasks SET'));
    expect(update).toBeDefined();
    expect(update?.[0]).toContain('status = $');
    expect(update?.[0]).toContain('result = $');
    expect(update?.[0]).toContain('credit_status = $');
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

  it('lists cloud tasks with provider and status filters', async () => {
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await listCloudTasks({ providerId: 'provider-a', status: 'failed', limit: 25 });

    const select = execSql.mock.calls.find(([sql]) => String(sql).includes('FROM cloud_tasks'));
    expect(select?.[0]).toContain('provider_id = $1');
    expect(select?.[0]).toContain('status = $2');
    expect(select?.[1]).toEqual(['provider-a', 'failed', 25]);
  });

  it('summarizes task states by provider without reading task payloads', async () => {
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await getCloudTaskProviderSummary();

    const select = execSql.mock.calls.find(([sql]) => String(sql).includes('GROUP BY provider_id'));
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
    expect(update?.[0]).toContain("status IN ('queued', 'pending', 'processing')");
    expect(update?.[0]).toContain('lease_expires_at < $');
    expect(update?.[1]).toEqual(expect.arrayContaining(['task-lease', 'worker-a', 5000, 1000]));
    expect(lease).toEqual({ taskId: 'task-lease', owner: 'worker-a', expiresAt: 5000, attemptCount: 2 });
  });

  it('does not claim a task when another worker holds a live lease', async () => {
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(claimCloudTaskLease('task-live', 'worker-b', 4000, 1000)).resolves.toBeNull();
  });

  it('releases a task lease only for its current owner', async () => {
    execSql.mockResolvedValueOnce({ rows: [{ id: 'task-lease' }], rowCount: 1 });

    await expect(releaseCloudTaskLease('task-lease', 'worker-a')).resolves.toBe(true);

    const update = execSql.mock.calls.find(([sql]) => String(sql).includes("lease_owner = ''"));
    expect(update?.[0]).toContain('lease_owner = $2');
    expect(update?.[1]).toEqual(['task-lease', 'worker-a', expect.any(Number)]);
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
});
