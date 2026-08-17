import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import { resolveTaskModel } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import {
  authorizeAgentContext,
  type AuthorizeAgentContextInput,
} from './context-adapters';
import {
  AgentModelRouteMismatchError,
  SameTaskAgentToolError,
} from './same-task-adapter';
import { authorizeAgentTools } from './tool-registry';
import type { AgentRunRequest } from './types';

export interface AgentExecutionAdmissionDependencies {
  authorizeContext(input: AuthorizeAgentContextInput): Promise<unknown>;
  resolveTaskModel(
    providerId: string,
    modelId: string,
    actorUserId: string,
  ): Promise<TaskModelDescriptor>;
}

export interface AdmitAuthorizedAgentExecutionInput<T> {
  actor: User;
  request: AgentRunRequest;
  toolId: string;
  admit(): Promise<T>;
}

const defaultDependencies: AgentExecutionAdmissionDependencies = {
  authorizeContext: authorizeAgentContext,
  resolveTaskModel,
};

function userProductTypes(user: User): string[] {
  if (user.role === 'admin') return ['canvas', 'chat', 'simple-chat'];
  return (user.productType || '').split(',').map(value => value.trim()).filter(Boolean);
}

function modelCapabilities(model: TaskModelDescriptor): string[] {
  const capabilities = new Set<string>([model.kind]);
  if (model.kind === 'image') capabilities.add('image');
  if (model.kind === 'edit') {
    capabilities.add('image');
    capabilities.add('edit');
  }
  if (model.supportsMask) capabilities.add('edit');
  if (model.supportsReferenceImages) capabilities.add('reference-images');
  if (model.sourceType === 'vlm') capabilities.add('vision');
  return [...capabilities];
}

export async function admitAuthorizedAgentExecution<T>(
  input: AdmitAuthorizedAgentExecutionInput<T>,
  dependencies: AgentExecutionAdmissionDependencies = defaultDependencies,
): Promise<T> {
  await dependencies.authorizeContext({
    actorUserId: input.actor.id,
    request: input.request,
  });

  let model: TaskModelDescriptor;
  try {
    model = await dependencies.resolveTaskModel(
      input.request.providerId,
      input.request.modelId,
      input.actor.id,
    );
  } catch {
    throw new AgentModelRouteMismatchError();
  }

  const authorization = authorizeAgentTools({
    requestedToolIds: input.request.allowedToolIds,
    workspace: input.request.workspace,
    userProductTypes: userProductTypes(input.actor),
    modelCapabilities: modelCapabilities(model),
  });
  if (
    authorization.denials.length > 0
    || !authorization.tools.some(tool => tool.toolId === input.toolId)
  ) {
    throw new SameTaskAgentToolError(authorization.denials);
  }

  return input.admit();
}
