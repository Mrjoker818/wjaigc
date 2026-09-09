import { createPostgresAssetStorage } from '@/lib/asset-core/storage';
import type { AssetKind, MediaAvailability } from '@/lib/asset-core/types';
import type {
  AgentContextSnapshot,
  AgentRunRequest,
} from './types';

export interface AgentContextTransaction {
  findProject(ownerId: string, projectId: string): Promise<boolean>;
  findAsset?(
    ownerId: string,
    projectId: string,
    assetId: string,
  ): Promise<{ id: string; kind: AssetKind } | null>;
  findVersion(
    ownerId: string,
    projectId: string,
    versionId: string,
  ): Promise<{
    id: string;
    assetId?: string;
    file?: { url?: string; availability?: MediaAvailability; mimeType?: string };
  } | null>;
  findVersionPlacement(
    ownerId: string,
    projectId: string,
    workspace: AgentRunRequest['workspace'],
    workspaceId: string,
    versionId: string,
  ): Promise<{ id: string; assetVersionId?: string } | null>;
  findEntityPlacement?(
    ownerId: string,
    projectId: string,
    workspace: AgentRunRequest['workspace'],
    workspaceId: string,
    entityId: string,
  ): Promise<{ id: string; assetVersionId?: string } | null>;
}

export interface AgentContextStorage {
  transaction<T>(
    callback: (transaction: AgentContextTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface AuthorizeAgentContextInput {
  actorUserId: string;
  request: AgentRunRequest;
  storage?: AgentContextStorage;
}

export interface AuthorizedAgentContext {
  snapshot: AgentContextSnapshot;
  mediaByVersionId: Record<string, string>;
  selectedEntityVersionIds: Record<string, string>;
}

export class AgentContextNotFoundError extends Error {
  readonly code = 'AGENT_CONTEXT_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Agent context not found');
    this.name = 'AgentContextNotFoundError';
  }
}

export function resolveSelectedAgentMediaUrl(
  context: AuthorizedAgentContext,
  selectedEntityIds: string[],
): string {
  if (selectedEntityIds.length !== 1) throw new AgentContextNotFoundError();
  const versionId = context.selectedEntityVersionIds[selectedEntityIds[0]];
  const mediaUrl = versionId ? context.mediaByVersionId[versionId] : undefined;
  if (!mediaUrl) throw new AgentContextNotFoundError();
  return mediaUrl;
}

export function resolveOptionalSelectedAgentMediaUrl(
  context: AuthorizedAgentContext,
  selectedEntityIds: readonly string[],
): string | undefined {
  return selectedEntityIds.length === 1
    ? resolveSelectedAgentMediaUrl(context, [...selectedEntityIds])
    : undefined;
}

export function resolveAgentMediaUrls(
  context: AuthorizedAgentContext,
  versionIds: readonly string[],
): string[] {
  return versionIds.map(versionId => {
    const mediaUrl = context.mediaByVersionId[versionId];
    if (!mediaUrl) throw new AgentContextNotFoundError();
    return mediaUrl;
  });
}

function defaultStorage(): AgentContextStorage {
  const storage = createPostgresAssetStorage();
  return {
    transaction: callback => storage.read(transaction => callback({
      findProject: transaction.findProject.bind(transaction),
      findAsset: transaction.findAsset.bind(transaction),
      findVersion: transaction.findVersion.bind(transaction),
      findVersionPlacement: transaction.findActivePlacementForVersion.bind(transaction),
      async findEntityPlacement(ownerId, projectId, workspace, workspaceId, entityId) {
        const entityTypes = workspace === 'canvas'
          ? ['canvas-image']
          : workspace === 'workflow'
            ? ['workflow-input', 'workflow-output']
            : ['chat-attachment', 'chat-result'];
        for (const entityType of entityTypes) {
          const placement = await transaction.findActivePlacement(
            ownerId, projectId, workspace, workspaceId, entityType, entityId,
          );
          if (placement) return placement;
        }
        return null;
      },
    })),
  };
}

const TRUSTED_SOURCE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
]);

function isTrustedSourceImageMimeType(value: unknown): value is string {
  return typeof value === 'string'
    && TRUSTED_SOURCE_IMAGE_MIME_TYPES.has(value.trim().toLowerCase());
}

export async function authorizeAgentContext({
  actorUserId,
  request,
  storage = defaultStorage(),
}: AuthorizeAgentContextInput): Promise<AuthorizedAgentContext> {
  return storage.transaction(async transaction => {
    if (!await transaction.findProject(actorUserId, request.projectId)) {
      throw new AgentContextNotFoundError();
    }

    // Current workspace writers store Canvas and Workflow IDs without a uniform prefix.
    // Resolve only the exact prefixed/unprefixed alias inside the already-authorized project.
    const canonicalCanvasId = `canvas:${request.projectId}`;
    const workflowPrefix = 'workflow:';
    const workspaceIds = request.workspace === 'canvas'
      && (request.workspaceId === request.projectId || request.workspaceId === canonicalCanvasId)
      ? [request.workspaceId, request.workspaceId === canonicalCanvasId ? request.projectId : canonicalCanvasId]
      : request.workspace === 'workflow'
        ? [
          request.workspaceId,
          request.workspaceId.startsWith(workflowPrefix)
            ? request.workspaceId.slice(workflowPrefix.length)
            : `${workflowPrefix}${request.workspaceId}`,
        ]
      : [request.workspaceId];

    const versionIds = new Set([
      ...request.sourceVersionIds,
      ...request.context.visibleVersionIds,
    ]);
    const sourceVersionIds = new Set(request.sourceVersionIds);
    const mediaByVersionId: Record<string, string> = {};
    for (const versionId of versionIds) {
      const version = await transaction.findVersion(
        actorUserId,
        request.projectId,
        versionId,
      );
      if (!version || !version.file?.url) throw new AgentContextNotFoundError();
      if (sourceVersionIds.has(versionId)) {
        if (!version.assetId || !transaction.findAsset) throw new AgentContextNotFoundError();
        const asset = await transaction.findAsset(
          actorUserId,
          request.projectId,
          version.assetId,
        );
        const persistedMimeType = version.file.mimeType?.trim();
        if (
          asset?.kind !== 'image'
          || version.file.availability !== 'ready'
          || (persistedMimeType && !isTrustedSourceImageMimeType(persistedMimeType))
        ) {
          throw new AgentContextNotFoundError();
        }
      }
      mediaByVersionId[versionId] = version.file.url;
    }
    for (const versionId of new Set(request.sourceVersionIds)) {
      let placement: Awaited<ReturnType<AgentContextTransaction['findVersionPlacement']>> = null;
      for (const workspaceId of workspaceIds) {
        placement = await transaction.findVersionPlacement(
          actorUserId, request.projectId, request.workspace, workspaceId, versionId,
        );
        if (placement) break;
      }
      if (!placement || placement.assetVersionId !== versionId) {
        throw new AgentContextNotFoundError();
      }
    }
    const selectedEntityVersionIds: Record<string, string> = {};
    for (const entityId of new Set(request.context.selectedEntityIds)) {
      if (!transaction.findEntityPlacement) throw new AgentContextNotFoundError();
      let placement: Awaited<ReturnType<NonNullable<AgentContextTransaction['findEntityPlacement']>>> = null;
      for (const workspaceId of workspaceIds) {
        placement = await transaction.findEntityPlacement(
          actorUserId, request.projectId, request.workspace, workspaceId, entityId,
        );
        if (placement) break;
      }
      if (!placement?.assetVersionId) throw new AgentContextNotFoundError();
      if (!versionIds.has(placement.assetVersionId)) throw new AgentContextNotFoundError();
      selectedEntityVersionIds[entityId] = placement.assetVersionId;
    }
    return { snapshot: request.context, mediaByVersionId, selectedEntityVersionIds };
  });
}
