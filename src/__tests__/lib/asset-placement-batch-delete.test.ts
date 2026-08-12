import { describe, expect, it, vi } from 'vitest';

import { reconcileImageBatchDeletion } from '@/lib/asset-core/batch-placement-delete';

describe('asset placement batch deletion', () => {
  it('reconciles each successful deletion before returning a later managed failure', async () => {
    const events: string[] = [];
    const failure = new Error('second placement failed');
    const deletePlacement = vi.fn(async (item: { id: string }) => {
      events.push(`delete:${item.id}`);
      if (item.id === 'managed-b') throw failure;
    });
    const onDeleted = vi.fn(async (item: { id: string }) => {
      events.push(`remove:${item.id}`);
    });

    const result = await reconcileImageBatchDeletion([
      { id: 'legacy-a', projectId: 'project-a' },
      { id: 'managed-a', projectId: 'project-a', assetId: 'asset-a', placementId: 'placement-a' },
      { id: 'managed-b', projectId: 'project-a', assetId: 'asset-b', placementId: 'placement-b' },
      { id: 'managed-c', projectId: 'project-a', assetId: 'asset-c', placementId: 'placement-c' },
    ], deletePlacement, onDeleted);

    expect(result).toEqual({
      deletedIds: ['legacy-a', 'managed-a'],
      failedId: 'managed-b',
      error: failure,
    });
    expect(events).toEqual([
      'remove:legacy-a',
      'delete:managed-a',
      'remove:managed-a',
      'delete:managed-b',
    ]);
  });

  it('keeps legacy-only images deletable without a placement request', async () => {
    const deletePlacement = vi.fn();
    const onDeleted = vi.fn();

    await expect(reconcileImageBatchDeletion([
      { id: 'legacy-a', projectId: 'old-project' },
      { id: 'legacy-b', projectId: 'old-project' },
    ], deletePlacement, onDeleted)).resolves.toEqual({
      deletedIds: ['legacy-a', 'legacy-b'],
    });
    expect(deletePlacement).not.toHaveBeenCalled();
    expect(onDeleted.mock.calls.map(([item]) => item.id)).toEqual(['legacy-a', 'legacy-b']);
  });
});
