import 'server-only';

import type {
  SimpleChatMessage,
  SimpleChatProject,
  SimpleChatTask,
} from '@/components/simple-chat/simple-chat-types';
import {
  bindWorkspaceSourceTraceToChat,
  parseWorkspaceSourceTrace,
  type SimpleChatWorkspaceSourceTrace,
} from '@/lib/asset-core/source-trace';
import { createPostgresAssetStorage } from '@/lib/asset-core/storage';
import type { WorkspacePlacement } from '@/lib/asset-core/types';
import { DocumentWorkspaceReferenceError, readDocumentWorkspaceProject, resolveDocumentWorkspaceReference, resolvePersonalWorkspaceReference } from '@/lib/collaboration/document-workspace-reference';
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
  resolveVersionProject(userId: string, assetVersionId: string): Promise<string | null>;
  findPlacement(
    userId: string,
    projectId: string,
    placementId: string,
  ): Promise<Pick<WorkspacePlacement, 'assetVersionId' | 'status'> | null>;
  resolveDocumentReference?: typeof resolveDocumentWorkspaceReference;
  resolvePersonalReference?: typeof resolvePersonalWorkspaceReference;
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
  projectExists: async (userId, projectId) => {
    const document = await readDocumentWorkspaceProject(userId, projectId);
    return document !== null || await createPostgresAssetStorage().read(
      transaction => transaction.findProject(userId, projectId),
    );
  },
  resolveDocumentReference: resolveDocumentWorkspaceReference,
  resolvePersonalReference: resolvePersonalWorkspaceReference,
  readSnapshot: readSimpleChatSnapshot,
  resolveVersionProject: (userId, assetVersionId) => createPostgresAssetStorage().read(
    transaction => transaction.resolveVersionProject(userId, assetVersionId),
  ),
  findPlacement: (userId, projectId, placementId) => createPostgresAssetStorage().read(
    transaction => transaction.findPlacement(userId, projectId, placementId),
  ),
};

function buildWorkspaceSourceTrace(
  project: SimpleChatProject,
  task: SimpleChatTask,
  message: SimpleChatMessage,
): SimpleChatWorkspaceSourceTrace {
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
  if (!sourceTrace || sourceTrace.source !== 'simple-chat') {
    throw new Error('Invalid simple chat workspace source trace');
  }
  return sourceTrace;
}

async function alignManagedMessageImages(
  message: SimpleChatMessage,
  sourceTrace: SimpleChatWorkspaceSourceTrace,
  actorUserId: string,
  targetProjectId: string,
  dependencies: ResolverDependencies,
): Promise<SimpleChatWorkspaceHandoffImage[]> {
  const images = await Promise.all((message.images || []).map(async (imageUrl, imageIndex) => {
    const assetRef = message.imageRefs?.[imageIndex];
    if (!imageUrl || !assetRef?.assetVersionId || !assetRef.placementId || assetRef.url !== imageUrl) {
      return null;
    }

    // Private discovery remains actor-scoped. An editor's shared source is only resolved in
    // the explicitly authorized target project, never by searching the owner's asset graph.
    const sourceProjectId = await dependencies.resolveVersionProject(actorUserId, assetRef.assetVersionId);
    const documentReference = await dependencies.resolveDocumentReference?.(actorUserId, {
      projectId: sourceProjectId ?? targetProjectId,
      assetVersionId: assetRef.assetVersionId, placementId: assetRef.placementId,
    });
    let managedReference = documentReference;
    if (!managedReference) {
      if (!sourceProjectId) return null;
      if (dependencies.resolvePersonalReference) {
        managedReference = await dependencies.resolvePersonalReference(actorUserId, {
          projectId: sourceProjectId, assetVersionId: assetRef.assetVersionId, placementId: assetRef.placementId,
        });
      } else {
        const placement = await dependencies.findPlacement(actorUserId, sourceProjectId, assetRef.placementId);
        if (placement?.status !== 'active' || placement.assetVersionId !== assetRef.assetVersionId) return null;
      }
    }
    const imageSourceTrace = bindWorkspaceSourceTraceToChat(assetRef.sourceTrace, sourceTrace);
    if (!imageSourceTrace) return null;
    return { imageIndex, assetRef: managedReference ? { ...assetRef, ...managedReference } : assetRef,
      sourceTrace: imageSourceTrace };
  }));
  return images.filter((image): image is SimpleChatWorkspaceHandoffImage => image !== null);
}

export async function resolveSimpleChatWorkspaceHandoff(
  input: ResolveSimpleChatWorkspaceHandoffInput,
  dependencies: ResolverDependencies = defaultDependencies,
): Promise<SimpleChatWorkspaceHandoff> {
  try {
    return await resolveAuthorizedHandoff(input, dependencies);
  } catch (error) {
    if (error instanceof DocumentWorkspaceReferenceError) {
      throw new SimpleChatWorkspaceHandoffError(
        error.status === 403 ? 'FORBIDDEN' : 'HANDOFF_SOURCE_NOT_FOUND', error.status,
      );
    }
    throw error;
  }
}

async function resolveAuthorizedHandoff(
  input: ResolveSimpleChatWorkspaceHandoffInput, dependencies: ResolverDependencies,
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
  const images = await alignManagedMessageImages(
    message,
    sourceTrace,
    input.actorUserId,
    input.targetProjectId,
    dependencies,
  );
  const text = message.content.trim() || null;
  if (!text && images.length === 0) {
    throw new SimpleChatWorkspaceHandoffError('NO_MANAGED_MEDIA', 422);
  }
  // Recheck target admission after snapshot/media awaits; it never changes the chat actor.
  if (!await dependencies.projectExists(input.actorUserId, input.targetProjectId)) {
    throw new SimpleChatWorkspaceHandoffError('FORBIDDEN', 403);
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
