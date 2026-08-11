import { createAssetService, type ResolveAssetReferenceInput } from './service';
import type { WorkspaceAssetReference } from './types';
import type { WorkflowNode } from '../workflow-engine';

interface AssetReferenceResolver {
  resolveAssetReference(input: ResolveAssetReferenceInput): Promise<WorkspaceAssetReference>;
}

export async function resolveWorkflowInputImageForActor(
  actorUserId: string,
  node: WorkflowNode,
  resolver: AssetReferenceResolver = createAssetService(),
): Promise<Record<string, unknown>> {
  const projectId = typeof node.config.projectId === 'string' ? node.config.projectId : '';
  const assetVersionId = typeof node.config.assetVersionId === 'string' ? node.config.assetVersionId : '';
  const placementId = typeof node.config.placementId === 'string' ? node.config.placementId : '';
  if (!projectId || !assetVersionId) {
    return {
      ...node.config,
      imageUrl: typeof node.config.imageUrl === 'string' ? node.config.imageUrl : '',
      _type: node.type,
    };
  }

  const reference = await resolver.resolveAssetReference({
    actorUserId,
    projectId,
    assetVersionId,
    ...(placementId ? { placementId } : {}),
  });
  return {
    ...node.config,
    projectId,
    imageUrl: reference.url,
    assetId: reference.assetId,
    assetVersionId: reference.assetVersionId,
    placementId: reference.placementId,
    _type: node.type,
  };
}
