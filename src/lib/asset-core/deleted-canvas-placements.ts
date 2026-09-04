export interface DeletedCanvasPlacement {
  projectId: string;
  entityId: string;
  assetId: string;
  assetVersionId: string;
  placementId: string;
}

const identityFields = ['projectId', 'entityId', 'assetId', 'assetVersionId', 'placementId'] as const;

export function parseDeletedCanvasPlacements(value: unknown): DeletedCanvasPlacement[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const entries: DeletedCanvasPlacement[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (identityFields.some(field => typeof record[field] !== 'string' || !record[field])) return null;
    entries.push(Object.fromEntries(identityFields.map(field => [field, record[field]])) as unknown as DeletedCanvasPlacement);
  }
  return entries;
}

export function excludeDeletedCanvasPlacements<T extends {
  id: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
}>(projectId: string, images: T[], deleted: readonly DeletedCanvasPlacement[]): T[] {
  const identities = new Set(deleted.filter(entry => entry.projectId === projectId).map(entry => (
    JSON.stringify([entry.entityId, entry.assetId, entry.assetVersionId, entry.placementId])
  )));
  if (identities.size === 0) return images;
  return images.filter(image => !identities.has(JSON.stringify([
    image.id, image.assetId, image.assetVersionId, image.placementId,
  ])));
}
