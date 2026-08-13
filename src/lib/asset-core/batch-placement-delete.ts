export interface BatchDeleteImageIdentity {
  id: string;
  projectId: string;
  assetId?: string;
  placementId?: string;
}

export interface ManagedBatchDeleteImageIdentity extends BatchDeleteImageIdentity {
  assetId: string;
  placementId: string;
}

export interface PlacementHistoryIdentity {
  id: string;
  assetId?: string;
  placementId?: string;
}

export type ManagedPlacementHistoryIdentity<T extends PlacementHistoryIdentity> = T & {
  assetId: string;
  placementId: string;
};

export type BatchDeleteResult =
  | { deletedIds: string[] }
  | { deletedIds: string[]; failedId: string; error: unknown };

export interface ManagedPlacementHistoryOperations<T extends PlacementHistoryIdentity> {
  restorePlacement: (item: ManagedPlacementHistoryIdentity<T>) => Promise<void>;
  trashPlacement: (item: ManagedPlacementHistoryIdentity<T>) => Promise<void>;
  commitSnapshot: (items: readonly T[]) => Promise<void> | void;
}

export function reconcileSelectedImageAfterBatchDeletion<T extends { id: string }>(
  selectedImage: T | null,
  deletedIds: readonly string[],
): T | null {
  return selectedImage && deletedIds.includes(selectedImage.id) ? null : selectedImage;
}

export async function reconcileImageBatchDeletion<T extends BatchDeleteImageIdentity>(
  items: readonly T[],
  deletePlacement: (item: T & ManagedBatchDeleteImageIdentity) => Promise<void>,
  onDeleted: (item: T) => Promise<void> | void,
): Promise<BatchDeleteResult> {
  const deletedIds: string[] = [];
  for (const item of items) {
    try {
      const hasAssetId = Boolean(item.assetId);
      const hasPlacementId = Boolean(item.placementId);
      if (hasAssetId !== hasPlacementId) {
        throw new Error('Asset placement identity is incomplete');
      }
      if (hasAssetId && hasPlacementId) {
        await deletePlacement(item as T & ManagedBatchDeleteImageIdentity);
      }
      await onDeleted(item);
      deletedIds.push(item.id);
    } catch (error) {
      return { deletedIds, failedId: item.id, error };
    }
  }
  return { deletedIds };
}

function isManagedPlacement<T extends PlacementHistoryIdentity>(
  item: T,
): item is ManagedPlacementHistoryIdentity<T> {
  const hasAssetId = Boolean(item.assetId);
  const hasPlacementId = Boolean(item.placementId);
  if (hasAssetId !== hasPlacementId) {
    throw new Error('Asset placement identity is incomplete');
  }
  return hasAssetId && hasPlacementId;
}

export async function reconcileManagedPlacementHistoryTransition<T extends PlacementHistoryIdentity>(
  before: readonly T[],
  after: readonly T[],
  operations: ManagedPlacementHistoryOperations<T>,
): Promise<void> {
  const beforeIds = new Set(before.map((item) => item.id));
  const afterIds = new Set(after.map((item) => item.id));
  const transitions: Array<{
    item: ManagedPlacementHistoryIdentity<T>;
    apply: (item: ManagedPlacementHistoryIdentity<T>) => Promise<void>;
    compensate: (item: ManagedPlacementHistoryIdentity<T>) => Promise<void>;
  }> = [];
  for (const item of after) {
    if (!beforeIds.has(item.id) && isManagedPlacement(item)) {
      transitions.push({ item, apply: operations.restorePlacement, compensate: operations.trashPlacement });
    }
  }
  for (const item of before) {
    if (!afterIds.has(item.id) && isManagedPlacement(item)) {
      transitions.push({ item, apply: operations.trashPlacement, compensate: operations.restorePlacement });
    }
  }
  const completed: typeof transitions = [];

  try {
    for (const transition of transitions) {
      await transition.apply(transition.item);
      completed.push(transition);
    }
    await operations.commitSnapshot(after);
  } catch (error) {
    const compensationFailures: unknown[] = [];
    for (const transition of completed.reverse()) {
      try {
        await transition.compensate(transition.item);
      } catch (compensationError) {
        compensationFailures.push(compensationError);
      }
    }
    if (compensationFailures.length > 0) {
      throw new AggregateError([error, ...compensationFailures], 'Asset placement history compensation failed');
    }
    throw error;
  }
}
