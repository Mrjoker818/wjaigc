import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudTask, CreateCloudTaskInput } from '@/lib/cloud-task-storage';

const storage = vi.hoisted(() => ({
  tasks: new Map<string, CloudTask>(),
  createCloudTask: vi.fn(),
  getCloudTaskForUserByIdempotencyKey: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => storage);

describe('element board idempotency', () => {
  beforeEach(() => {
    storage.tasks.clear();
    vi.clearAllMocks();
    storage.createCloudTask.mockImplementation(async (task: CreateCloudTaskInput) => {
      const existing = [...storage.tasks.values()].find(candidate => (
        candidate.userId === task.userId && candidate.idempotencyKey === task.idempotencyKey
      ));
      if (existing) return false;
      storage.tasks.set(task.id, {
        ...task,
        result: task.result || {},
        creditStatus: task.creditStatus || 'not-applicable',
      });
      return true;
    });
    storage.getCloudTaskForUserByIdempotencyKey.mockImplementation(async (userId: string, key: string) => (
      [...storage.tasks.values()].find(task => task.userId === userId && task.idempotencyKey === key) || null
    ));
  });

  it('assigns exactly one owner to concurrent duplicate requests', async () => {
    const { claimElementBoardTask, createElementBoardRequestHash } = await import(
      '@/lib/element-decomposition/board-idempotency'
    );
    const request = {
      sourceHash: 'a'.repeat(64),
      aspectRatio: '16:9',
      background: 'transparent',
      providerId: 'pear',
      modelId: 'gpt-image',
    };
    const requestHash = createElementBoardRequestHash(request);
    const claims = await Promise.all(Array.from({ length: 20 }, () => claimElementBoardTask({
      userId: 'user-1',
      idempotencyKey: 'board-idempotency-key',
      requestHash,
      providerId: request.providerId,
      modelId: request.modelId,
      request,
    })));

    expect(new Set(claims.map(claim => claim.taskId)).size).toBe(1);
    expect(claims.filter(claim => claim.owner)).toHaveLength(1);
    expect(storage.createCloudTask).toHaveBeenCalledTimes(20);
  });

  it('rejects one key reused for different frozen source bytes', async () => {
    const { claimElementBoardTask, createElementBoardRequestHash } = await import(
      '@/lib/element-decomposition/board-idempotency'
    );
    const first = { sourceHash: 'a'.repeat(64), aspectRatio: '16:9', background: 'transparent' };
    const second = { ...first, sourceHash: 'b'.repeat(64) };
    await claimElementBoardTask({
      userId: 'user-1',
      idempotencyKey: 'board-source-conflict',
      requestHash: createElementBoardRequestHash(first),
      request: first,
    });

    await expect(claimElementBoardTask({
      userId: 'user-1',
      idempotencyKey: 'board-source-conflict',
      requestHash: createElementBoardRequestHash(second),
      request: second,
    })).rejects.toMatchObject({ code: 'ELEMENT_BOARD_IDEMPOTENCY_CONFLICT' });
  });
});
