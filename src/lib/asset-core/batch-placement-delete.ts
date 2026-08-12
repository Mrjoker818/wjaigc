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

export type BatchDeleteResult =
  | { deletedIds: string[] }
  | { deletedIds: string[]; failedId: string; error: unknown };

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
