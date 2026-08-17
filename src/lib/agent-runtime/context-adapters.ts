import { createPostgresAssetStorage } from '@/lib/asset-core/storage';
import type {
  AgentContextSnapshot,
  AgentRunRequest,
} from './types';

export interface AgentContextTransaction {
  findProject(ownerId: string, projectId: string): Promise<boolean>;
  findVersion(
    ownerId: string,
    projectId: string,
    versionId: string,
  ): Promise<unknown | null>;
  findEntityPlacement?(
    ownerId: string,
    projectId: string,
    workspace: AgentRunRequest['workspace'],
    workspaceId: string,
    entityId: string,
  ): Promise<unknown | null>;
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

export class AgentContextNotFoundError extends Error {
  readonly code = 'AGENT_CONTEXT_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Agent context not found');
    this.name = 'AgentContextNotFoundError';
  }
}

function defaultStorage(): AgentContextStorage {
  const storage = createPostgresAssetStorage();
  return {
    transaction: callback => storage.transaction(transaction => callback({
      findProject: transaction.findProject.bind(transaction),
      findVersion: transaction.findVersion.bind(transaction),
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

export async function authorizeAgentContext({
  actorUserId,
  request,
  storage = defaultStorage(),
}: AuthorizeAgentContextInput): Promise<AgentContextSnapshot> {
  return storage.transaction(async transaction => {
    if (!await transaction.findProject(actorUserId, request.projectId)) {
      throw new AgentContextNotFoundError();
    }

    const versionIds = new Set([
      ...request.sourceVersionIds,
      ...request.context.visibleVersionIds,
    ]);
    for (const versionId of versionIds) {
      const version = await transaction.findVersion(
        actorUserId,
        request.projectId,
        versionId,
      );
      if (!version) throw new AgentContextNotFoundError();
    }
    for (const entityId of new Set(request.context.selectedEntityIds)) {
      if (!transaction.findEntityPlacement) throw new AgentContextNotFoundError();
      const placement = await transaction.findEntityPlacement(
        actorUserId,
        request.projectId,
        request.workspace,
        request.workspaceId,
        entityId,
      );
      if (!placement) throw new AgentContextNotFoundError();
    }
    return request.context;
  });
}
