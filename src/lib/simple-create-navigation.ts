import type { WorkspaceAssetReference } from '@/lib/asset-core/types';

const HANDOFF_ID = /^[A-Za-z0-9._:/ -]{1,200}$/;

export interface SimpleCreateCanvasHandoff {
  projectId: string;
  assetVersionId: string;
  placementId: string;
}

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

export function parseSimpleCreateCanvasHandoff(
  search: string,
): SimpleCreateCanvasHandoff | null {
  const query = new URLSearchParams(search);
  const projectId = query.get('projectId') || '';
  const assetVersionId = query.get('assetVersionId') || '';
  const placementId = query.get('placementId') || '';
  if (![projectId, assetVersionId, placementId].every(value => HANDOFF_ID.test(value))) {
    return null;
  }
  return { projectId, assetVersionId, placementId };
}

export function clearSimpleCreateCanvasHandoff(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('assetVersionId');
  url.searchParams.delete('placementId');
  return url.toString();
}

export async function consumeSimpleCreateCanvasHandoff(input: {
  handoff: SimpleCreateCanvasHandoff | null;
  currentProjectId: string | null;
  resolveReference: (handoff: SimpleCreateCanvasHandoff) => Promise<WorkspaceAssetReference>;
  merge: (reference: WorkspaceAssetReference) => void | Promise<void>;
  cleanUrl: () => void;
}): Promise<{
  status: 'waiting' | 'consumed';
  reference: WorkspaceAssetReference | null;
}> {
  if (!input.handoff || input.handoff.projectId !== input.currentProjectId) {
    return { status: 'waiting', reference: null };
  }
  const reference = await input.resolveReference(input.handoff);
  if (
    !reference.url
    || reference.assetVersionId !== input.handoff.assetVersionId
    || reference.placementId !== input.handoff.placementId
  ) {
    throw new Error('SIMPLE_CREATE_ASSET_REFERENCE_INVALID');
  }
  await input.merge(reference);
  input.cleanUrl();
  return { status: 'consumed', reference };
}
