import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloudTaskMocks = vi.hoisted(() => ({
  createCloudTask: vi.fn(),
  getCloudTaskForUserByIdempotencyKey: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({
  createCloudTask: cloudTaskMocks.createCloudTask,
  getCloudTaskForUserByIdempotencyKey: cloudTaskMocks.getCloudTaskForUserByIdempotencyKey,
}));

import {
  VectorDesignIdempotencyConflictError,
  claimVectorDesignTask,
  createVectorDesignRequestHash,
} from '@/lib/vector-design-idempotency';

describe('vector design idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates stable hashes independent of object key order', () => {
    expect(createVectorDesignRequestHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      createVectorDesignRequestHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('returns the existing task for the same user, key and request', async () => {
    cloudTaskMocks.createCloudTask.mockResolvedValue(false);
    cloudTaskMocks.getCloudTaskForUserByIdempotencyKey.mockResolvedValue({
      id: 'vector_existing',
      result: { requestHash: 'same-hash' },
    });

    await expect(claimVectorDesignTask({
      userId: 'user-1',
      idempotencyKey: 'key-1',
      requestHash: 'same-hash',
      providerId: 'provider-1',
      model: 'recraftv4_1_vector',
    })).resolves.toEqual({ owner: false, taskId: 'vector_existing' });
  });

  it('rejects a reused key bound to a different request body', async () => {
    cloudTaskMocks.createCloudTask.mockResolvedValue(false);
    cloudTaskMocks.getCloudTaskForUserByIdempotencyKey.mockResolvedValue({
      id: 'vector_existing',
      result: { requestHash: 'other-hash' },
    });

    await expect(claimVectorDesignTask({
      userId: 'user-1',
      idempotencyKey: 'key-1',
      requestHash: 'new-hash',
      providerId: 'provider-1',
      model: 'recraftv4_1_vector',
    })).rejects.toBeInstanceOf(VectorDesignIdempotencyConflictError);
  });
});
