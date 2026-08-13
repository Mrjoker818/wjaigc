import { describe, expect, it, vi } from 'vitest';

import {
  reconcileManagedPlacementHistoryTransition,
  reconcileImageBatchDeletion,
  reconcileSelectedImageAfterBatchDeletion,
} from '@/lib/asset-core/batch-placement-delete';

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

  it('clears a selected image that was removed before a later batch failure', () => {
    const selected = { id: 'managed-a', url: '/managed-a.png' };

    expect(reconcileSelectedImageAfterBatchDeletion(selected, ['legacy-a', 'managed-a'])).toBeNull();
    expect(reconcileSelectedImageAfterBatchDeletion(selected, ['legacy-a'])).toBe(selected);
  });
});

describe('managed placement history transitions', () => {
  const managed = (id: string) => ({
    id,
    projectId: 'project-a',
    assetId: `asset-${id}`,
    placementId: `placement-${id}`,
  });

  it('restores a managed placement before committing an undo result', async () => {
    const restored = managed('restored');
    const restorePlacement = vi.fn().mockResolvedValue(undefined);
    const trashPlacement = vi.fn().mockResolvedValue(undefined);
    const commitSnapshot = vi.fn();

    await reconcileManagedPlacementHistoryTransition(
      [],
      [restored],
      { restorePlacement, trashPlacement, commitSnapshot },
    );

    expect(restorePlacement).toHaveBeenCalledOnce();
    expect(restorePlacement).toHaveBeenCalledWith(restored);
    expect(trashPlacement).not.toHaveBeenCalled();
    expect(commitSnapshot).toHaveBeenCalledWith([restored]);
  });

  it('trashes a managed placement before committing a redo result', async () => {
    const removed = managed('removed');
    const restorePlacement = vi.fn().mockResolvedValue(undefined);
    const trashPlacement = vi.fn().mockResolvedValue(undefined);
    const commitSnapshot = vi.fn();

    await reconcileManagedPlacementHistoryTransition(
      [removed],
      [],
      { restorePlacement, trashPlacement, commitSnapshot },
    );

    expect(trashPlacement).toHaveBeenCalledOnce();
    expect(trashPlacement).toHaveBeenCalledWith(removed);
    expect(restorePlacement).not.toHaveBeenCalled();
    expect(commitSnapshot).toHaveBeenCalledWith([]);
  });

  it('ignores movement-only history and legacy images without graph identity', async () => {
    const original = managed('same');
    type HistoryItem = {
      id: string;
      projectId: string;
      assetId?: string;
      placementId?: string;
      x?: number;
    };
    const before: HistoryItem[] = [original, { id: 'legacy', projectId: 'project-a' }];
    const after: HistoryItem[] = [{ ...original, x: 80 }, { id: 'legacy', projectId: 'project-a', x: 40 }];
    const restorePlacement = vi.fn().mockResolvedValue(undefined);
    const trashPlacement = vi.fn().mockResolvedValue(undefined);
    const commitSnapshot = vi.fn();

    await reconcileManagedPlacementHistoryTransition(
      before,
      after,
      { restorePlacement, trashPlacement, commitSnapshot },
    );

    expect(restorePlacement).not.toHaveBeenCalled();
    expect(trashPlacement).not.toHaveBeenCalled();
    expect(commitSnapshot).toHaveBeenCalledWith(after);
  });

  it('compensates an earlier lifecycle change when a later request fails', async () => {
    const first = managed('first');
    const second = managed('second');
    const failure = new Error('second restore failed');
    const restorePlacement = vi.fn(async (item: { id: string }) => {
      if (item.id === 'second') throw failure;
    });
    const trashPlacement = vi.fn().mockResolvedValue(undefined);
    const commitSnapshot = vi.fn();

    await expect(reconcileManagedPlacementHistoryTransition(
      [],
      [first, second],
      { restorePlacement, trashPlacement, commitSnapshot },
    )).rejects.toBe(failure);

    expect(trashPlacement).toHaveBeenCalledOnce();
    expect(trashPlacement).toHaveBeenCalledWith(first);
    expect(commitSnapshot).not.toHaveBeenCalled();
  });

  it('compensates lifecycle changes when the authoritative snapshot cannot be committed', async () => {
    const restored = managed('restored');
    const failure = new Error('snapshot failed');
    const restorePlacement = vi.fn().mockResolvedValue(undefined);
    const trashPlacement = vi.fn().mockResolvedValue(undefined);
    const commitSnapshot = vi.fn().mockRejectedValue(failure);

    await expect(reconcileManagedPlacementHistoryTransition(
      [],
      [restored],
      { restorePlacement, trashPlacement, commitSnapshot },
    )).rejects.toBe(failure);

    expect(restorePlacement).toHaveBeenCalledWith(restored);
    expect(commitSnapshot).toHaveBeenCalledWith([restored]);
    expect(trashPlacement).toHaveBeenCalledWith(restored);
  });
});
