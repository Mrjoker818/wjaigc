import 'server-only';

import type {
  SimpleChatMessage,
  SimpleChatProject,
  SimpleChatTask,
} from '@/components/simple-chat/simple-chat-types';
import { parseWorkspaceSourceTrace, type WorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { createPostgresAssetStorage } from '@/lib/asset-core/storage';
import type { SimpleChatStoredSnapshot } from '@/lib/simple-chat-sync-server';
import { readSimpleChatSnapshot } from '@/lib/simple-chat-sync-server';
import type {
  SimpleChatWorkspaceHandoff,
  SimpleChatWorkspaceHandoffImage,
  SimpleChatWorkspaceHandoffIntent,
} from '@/lib/simple-chat-workspace-handoff';

export interface ResolveSimpleChatWorkspaceHandoffInput extends SimpleChatWorkspaceHandoffIntent {
  actorUserId: string;
}

export interface ResolverDependencies {
  projectExists(userId: string, projectId: string): Promise<boolean>;
  readSnapshot(userId: string): Promise<SimpleChatStoredSnapshot>;
}

export type SimpleChatWorkspaceHandoffErrorCode =
  | 'FORBIDDEN'
  | 'HANDOFF_SOURCE_NOT_FOUND'
  | 'NO_MANAGED_MEDIA';

export class SimpleChatWorkspaceHandoffError extends Error {
  constructor(
    readonly code: SimpleChatWorkspaceHandoffErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = 'SimpleChatWorkspaceHandoffError';
  }
}

const defaultDependencies: ResolverDependencies = {
  projectExists: (userId, projectId) => createPostgresAssetStorage().read(
    transaction => transaction.findProject(userId, projectId),
  ),
  readSnapshot: readSimpleChatSnapshot,
};

function buildWorkspaceSourceTrace(
  project: SimpleChatProject,
  task: SimpleChatTask,
  message: SimpleChatMessage,
): WorkspaceSourceTrace {
  const sourceTrace = parseWorkspaceSourceTrace({
    source: 'simple-chat',
    chatProjectId: project.id,
    chatTaskId: task.id,
    messageId: message.id,
    modelId: message.model || task.model,
    providerId: message.providerId || task.providerId,
    agentRunId: message.agentRunId,
    createdAt: new Date(message.createdAt).toISOString(),
  });
  if (!sourceTrace) throw new Error('Invalid simple chat workspace source trace');
  return sourceTrace;
}

function alignManagedMessageImages(
  message: SimpleChatMessage,
  sourceTrace: WorkspaceSourceTrace,
): SimpleChatWorkspaceHandoffImage[] {
  return (message.images || []).flatMap((_, imageIndex) => {
    const assetRef = message.imageRefs?.[imageIndex];
    if (!assetRef?.assetVersionId || !assetRef.placementId) return [];
    return [{ imageIndex, assetRef, sourceTrace }];
  });
}

export async function resolveSimpleChatWorkspaceHandoff(
  input: ResolveSimpleChatWorkspaceHandoffInput,
  dependencies: ResolverDependencies = defaultDependencies,
): Promise<SimpleChatWorkspaceHandoff> {
  if (!await dependencies.projectExists(input.actorUserId, input.targetProjectId)) {
    throw new SimpleChatWorkspaceHandoffError('FORBIDDEN', 403);
  }

  const snapshot = await dependencies.readSnapshot(input.actorUserId);
  const project = snapshot.projects.find(item => item.id === input.chatProjectId);
  const task = project?.tasks.find(item => item.id === input.chatTaskId);
  const message = task?.messages.find(item => item.id === input.chatMessageId);
  if (!project || !task || !message) {
    throw new SimpleChatWorkspaceHandoffError('HANDOFF_SOURCE_NOT_FOUND', 404);
  }

  const sourceTrace = buildWorkspaceSourceTrace(project, task, message);
  const images = alignManagedMessageImages(message, sourceTrace);
  const text = message.content.trim() || null;
  if (!text && images.length === 0) {
    throw new SimpleChatWorkspaceHandoffError('NO_MANAGED_MEDIA', 422);
  }

  return {
    text,
    images,
    sourceTrace,
    warnings: images.length < (message.images?.length || 0)
      ? ['UNMANAGED_IMAGE_SKIPPED']
      : [],
  };
}
