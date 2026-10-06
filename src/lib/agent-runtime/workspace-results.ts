import {
  projectCompletedTaskToAssets,
  recordTaskProjectionCompleted,
  TaskProjectionError,
  type ProjectCompletedTaskInput,
} from '@/lib/asset-core/task-projector';
import type { AssetVersion, WorkspaceAssetReference } from '@/lib/asset-core/types';

export interface ProjectAgentResultToWorkspaceInput extends ProjectCompletedTaskInput {
  idempotencyKey: string;
}

export function agentWorkspaceProjectionIdempotencyKey(input: {
  taskId: string;
  workspace: ProjectCompletedTaskInput['workspace'];
  workspaceId: string;
  sourceEntityId: string;
}): string {
  return `task-workspace:${input.taskId}:${input.workspace}:${input.workspaceId}:${input.sourceEntityId}`;
}

interface CompletedTaskProjection {
  versions: AssetVersion[];
  placements: Array<{ id: string; entityId: string }>;
  reused: boolean;
}

type CompletedTaskProjector = (
  input: ProjectAgentResultToWorkspaceInput,
) => Promise<CompletedTaskProjection>;

type CompletedProjectionRecorder = (input: {
  actorUserId: string;
  taskId: string;
  versionIds: string[];
  references: WorkspaceAssetReference[];
}) => Promise<void>;

export function createAgentWorkspaceResultProjector(
  projectCompletedTask: CompletedTaskProjector = projectCompletedTaskToAssets,
  recordCompletedProjection: CompletedProjectionRecorder = recordTaskProjectionCompleted,
): (input: ProjectAgentResultToWorkspaceInput) => Promise<WorkspaceAssetReference[]> {
  return async (input) => {
    const projected = await projectCompletedTask(input);
    if (projected.versions.length !== projected.placements.length) {
      throw new TaskProjectionError('TASK_PROJECTION_CONFLICT');
    }
    const references = projected.versions.map((version, index) => ({
      assetId: version.assetId,
      assetVersionId: version.id,
      placementId: projected.placements[index].id,
      entityId: projected.placements[index].entityId,
      url: version.file.url,
      ...(input.sourceTrace ? { sourceTrace: input.sourceTrace } : {}),
    }));
    await recordCompletedProjection({
      actorUserId: input.actorUserId,
      taskId: input.taskId,
      versionIds: projected.versions.map(version => version.id),
      references,
    });
    return references;
  };
}

const privateProjector = createAgentWorkspaceResultProjector();
export async function projectAgentResultToWorkspace(input: ProjectAgentResultToWorkspaceInput): Promise<WorkspaceAssetReference[]> {
  const { projectCanvasTaskResult } = await import('@/lib/collaboration/task-result-publication');
  return await projectCanvasTaskResult(input) ?? privateProjector(input);
}
