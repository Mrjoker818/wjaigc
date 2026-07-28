import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCloudTask: vi.fn(),
  getCloudTaskForUserByIdempotencyKey: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({
  createCloudTask: mocks.createCloudTask,
  getCloudTaskForUserByIdempotencyKey: mocks.getCloudTaskForUserByIdempotencyKey,
}));

import {
  claimLayerTask,
  createLayerRequestHash,
} from '@/lib/layer-decomposition/idempotency';

describe('layer decomposition database idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a stable hash independent of object key order', () => {
    expect(createLayerRequestHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      createLayerRequestHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('gives one owner to concurrent duplicates and replays one task ID', async () => {
    let insertedTaskId = '';
    mocks.createCloudTask.mockImplementation(async (input: { id: string }) => {
      if (insertedTaskId) return false;
      insertedTaskId = input.id;
      return true;
    });
    mocks.getCloudTaskForUserByIdempotencyKey.mockImplementation(async () => ({
      id: insertedTaskId,
      result: { requestHash: 'same-hash' },
    }));

    const input = {
      userId: 'user-1',
      idempotencyKey: 'layer-request-1',
      requestHash: 'same-hash',
      providerId: 'pear',
      modelId: 'Image-Layered',
      request: {
        imageUrl: '/image-a.png',
        engine: 'smart' as const,
        providerId: 'pear',
        modelId: 'Image-Layered',
      },
    };
    const claims = await Promise.all([
      claimLayerTask(input),
      claimLayerTask(input),
    ]);

    expect(claims.filter((claim) => claim.owner)).toHaveLength(1);
    expect(new Set(claims.map((claim) => claim.taskId)))
      .toEqual(new Set([insertedTaskId]));
  });

  it('rejects the same user key when the canonical request differs', async () => {
    mocks.createCloudTask.mockResolvedValue(false);
    mocks.getCloudTaskForUserByIdempotencyKey.mockResolvedValue({
      id: 'layer-existing',
      result: { requestHash: 'other-hash' },
    });

    await expect(claimLayerTask({
      userId: 'user-1',
      idempotencyKey: 'layer-request-1',
      requestHash: 'new-hash',
      providerId: 'pear',
      modelId: 'Image-Layered',
      request: {
        imageUrl: '/image-b.png',
        engine: 'smart',
        providerId: 'pear',
        modelId: 'Image-Layered',
      },
    })).rejects.toMatchObject({ code: 'LAYER_IDEMPOTENCY_CONFLICT' });
  });
});
