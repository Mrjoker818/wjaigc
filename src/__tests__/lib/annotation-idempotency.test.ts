import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCloudTask: vi.fn(),
  getCloudTaskForUserByIdempotencyKey: vi.fn(),
  updateCloudTask: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({
  createCloudTask: mocks.createCloudTask,
  getCloudTaskForUserByIdempotencyKey: mocks.getCloudTaskForUserByIdempotencyKey,
  updateCloudTask: mocks.updateCloudTask,
}));

import {
  AnnotationIdempotencyConflictError,
  claimAnnotationEditTask,
  createAnnotationRequestHash,
} from '@/lib/annotation-idempotency';

describe('annotation database idempotency', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('returns ownership only to the atomic insert winner', async () => {
    mocks.createCloudTask.mockResolvedValue(true);

    const claim = await claimAnnotationEditTask({
      userId: 'user-1',
      idempotencyKey: 'annotation-request-1',
      requestHash: 'hash-1',
      providerId: 'provider-1',
      model: 'gpt-image-1',
    });

    expect(claim.owner).toBe(true);
    expect(claim.taskId).toMatch(/^edit_/);
    expect(mocks.createCloudTask).toHaveBeenCalledTimes(1);
  });

  it('persists workflow identity and projection metadata on the legacy edit task', async () => {
    mocks.createCloudTask.mockResolvedValue(true);

    await claimAnnotationEditTask({
      userId: 'user-1',
      idempotencyKey: 'workflow:execution-1:node-1:0',
      requestHash: 'hash-1',
      providerId: 'provider-1',
      model: 'gpt-image-1',
      projectId: 'project-1',
      sessionId: 'workflow:project-1',
      messageId: 'execution-1:node-1',
      submissionPayload: {
        assetParentVersionIds: ['source-version-1'],
        assetProjectionMode: 'revision',
      },
    });

    expect(mocks.createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      sessionId: 'workflow:project-1',
      messageId: 'execution-1:node-1',
      result: {
        requestHash: 'hash-1',
        submissionPayload: {
          assetParentVersionIds: ['source-version-1'],
          assetProjectionMode: 'revision',
        },
      },
    }));
  });

  it('returns the existing task for a concurrent duplicate request', async () => {
    mocks.createCloudTask.mockResolvedValue(false);
    mocks.getCloudTaskForUserByIdempotencyKey.mockResolvedValue({
      id: 'edit-existing',
      userId: 'user-1',
      idempotencyKey: 'annotation-request-1',
      result: { requestHash: 'hash-1' },
    });

    const claim = await claimAnnotationEditTask({
      userId: 'user-1',
      idempotencyKey: 'annotation-request-1',
      requestHash: 'hash-1',
      providerId: 'provider-1',
      model: 'gpt-image-1',
    });

    expect(claim).toEqual({ owner: false, taskId: 'edit-existing' });
  });

  it('gives exactly one owner to concurrent requests and returns one task ID', async () => {
    let insertedTaskId = '';
    mocks.createCloudTask.mockImplementation(async (input: { id: string }) => {
      if (insertedTaskId) return false;
      insertedTaskId = input.id;
      return true;
    });
    mocks.getCloudTaskForUserByIdempotencyKey.mockImplementation(async () => ({
      id: insertedTaskId,
      userId: 'user-1',
      idempotencyKey: 'annotation-request-1',
      result: { requestHash: 'hash-1' },
    }));

    const claims = await Promise.all([
      claimAnnotationEditTask({
        userId: 'user-1',
        idempotencyKey: 'annotation-request-1',
        requestHash: 'hash-1',
        providerId: 'provider-1',
        model: 'gpt-image-1',
      }),
      claimAnnotationEditTask({
        userId: 'user-1',
        idempotencyKey: 'annotation-request-1',
        requestHash: 'hash-1',
        providerId: 'provider-1',
        model: 'gpt-image-1',
      }),
    ]);

    expect(claims.filter((claim) => claim.owner)).toHaveLength(1);
    expect(new Set(claims.map((claim) => claim.taskId))).toEqual(new Set([insertedTaskId]));
  });

  it('rejects the same user key when the canonical request differs', async () => {
    mocks.createCloudTask.mockResolvedValue(false);
    mocks.getCloudTaskForUserByIdempotencyKey.mockResolvedValue({
      id: 'edit-existing',
      userId: 'user-1',
      idempotencyKey: 'annotation-request-1',
      result: { requestHash: 'different-hash' },
    });

    await expect(claimAnnotationEditTask({
      userId: 'user-1',
      idempotencyKey: 'annotation-request-1',
      requestHash: 'hash-1',
      providerId: 'provider-1',
      model: 'gpt-image-1',
    })).rejects.toBeInstanceOf(AnnotationIdempotencyConflictError);
  });

  it('hashes canonical object ordering identically', () => {
    expect(createAnnotationRequestHash({ a: 1, nested: { y: 2, x: 3 } }))
      .toBe(createAnnotationRequestHash({ nested: { x: 3, y: 2 }, a: 1 }));
  });
});
