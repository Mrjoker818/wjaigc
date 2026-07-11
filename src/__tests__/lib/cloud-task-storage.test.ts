import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execSql } = vi.hoisted(() => ({ execSql: vi.fn() }));

vi.mock('@/lib/db-client', () => ({ execSql }));

import {
  createCloudTask,
  getCloudTaskForUser,
  listCloudTasks,
  getCloudTaskProviderSummary,
  updateCloudTask,
} from '@/lib/cloud-task-storage';

describe('cloud-task-storage', () => {
  beforeEach(() => {
    execSql.mockReset();
    execSql.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('creates a task with cloud recovery context', async () => {
    await createCloudTask({
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
});
