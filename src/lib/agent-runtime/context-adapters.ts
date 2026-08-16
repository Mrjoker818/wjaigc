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
    transaction: callback => storage.transaction(callback),
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
    return request.context;
  });
}
