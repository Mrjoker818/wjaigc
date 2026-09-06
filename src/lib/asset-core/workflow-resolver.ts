import {
  createAssetService,
  type CreatePlacementInput,
  type ResolveAssetReferenceInput,
} from './service';
import type { WorkspaceAssetReference } from './types';
import type { WorkflowNode } from '../workflow-engine';

interface AssetReferenceResolver {
  resolveAssetReference(input: ResolveAssetReferenceInput): Promise<WorkspaceAssetReference>;
  bindWorkflowInputPlacement(input: CreatePlacementInput): Promise<{
    placement: { id: string };
    reused: boolean;
  }>;
}

interface WorkflowInputContext {
  projectId: string;
  workspaceId: string;
  entityId: string;
  requireManagedAsset?: boolean;
}

export async function resolveWorkflowInputImageForActor(
  actorUserId: string,
  node: WorkflowNode,
  context?: WorkflowInputContext,
  resolver: AssetReferenceResolver = createAssetService(),
): Promise<Record<string, unknown>> {
  const configuredProjectId = typeof node.config.projectId === 'string' ? node.config.projectId : '';
  const projectId = context?.projectId || configuredProjectId;
  const assetVersionId = typeof node.config.assetVersionId === 'string' ? node.config.assetVersionId : '';
  const placementId = typeof node.config.placementId === 'string' ? node.config.placementId : '';
  if (context && configuredProjectId && configuredProjectId !== context.projectId) {
    throw new Error('工作流图片输入不属于当前项目');
  }
  if (!projectId || !assetVersionId) {
    if (context?.requireManagedAsset) throw new Error('工作流 Skill 图片输入必须使用项目资产');
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
  const workflowPlacement = context
    ? await resolver.bindWorkflowInputPlacement({
        actorUserId,
        projectId,
        assetVersionId,
        workspace: 'workflow',
        workspaceId: context.workspaceId,
        entityType: 'workflow-input',
        entityId: context.entityId,
      })
    : null;
  return {
    ...node.config,
    projectId,
    imageUrl: reference.url,
    assetId: reference.assetId,
    assetVersionId: reference.assetVersionId,
    placementId: workflowPlacement?.placement.id || reference.placementId,
    _type: node.type,
  };
}
