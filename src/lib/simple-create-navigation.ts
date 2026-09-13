import type { WorkspaceAssetReference } from '@/lib/asset-core/types';

export function buildSimpleCreateCanvasUrl(
  projectId: string,
  reference: WorkspaceAssetReference,
): string {
  const query = new URLSearchParams({ projectId });
  if (reference.assetVersionId) query.set('assetVersionId', reference.assetVersionId);
  if (reference.placementId) query.set('placementId', reference.placementId);
  return `/?${query.toString()}`;
}

export function buildSimpleCreateLoginUrl(returnTo: string): string {
  return `/?${new URLSearchParams({ returnTo }).toString()}`;
}
