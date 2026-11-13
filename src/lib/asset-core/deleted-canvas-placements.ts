export interface DeletedCanvasPlacement {
  projectId: string;
  entityId: string;
  assetId: string;
  assetVersionId: string;
  placementId: string;
}

export interface RestoredCanvasPlacement extends DeletedCanvasPlacement {
  revision: number;
}

export function canvasPlacementIdentityKey(projectId: string, image: {
  id: string; assetId?: string; assetVersionId?: string; placementId?: string;
}): string {
  return JSON.stringify([projectId, image.id, image.assetId, image.assetVersionId, image.placementId]);
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

export function parseRestoredCanvasPlacements(value: unknown): RestoredCanvasPlacement[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const entries: RestoredCanvasPlacement[] = [];
  for (const item of value) {
    const placement = parseDeletedCanvasPlacements([item])?.[0];
    const revision = (item as { revision?: unknown } | null)?.revision;
    if (!placement || !Number.isSafeInteger(revision) || Number(revision) < 1) return null;
    entries.push({ ...placement, revision: Number(revision) });
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
