import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import { resolveTaskModel } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import {
  authorizeAgentContext,
  type AuthorizeAgentContextInput,
  type AuthorizedAgentContext,
} from './context-adapters';
import {
  SameTaskAgentToolError,
} from './same-task-adapter';
import { AgentModelRouteMismatchError } from './model-route-error';
import { toAgentModelCapabilitySet } from './model-capability-set';
import { authorizeAgentTools } from './tool-registry';
import type { AgentRunRequest } from './types';
import type { AgentContextSnapshot } from './types';

export interface AgentExecutionAdmissionDependencies {
  authorizeContext(input: AuthorizeAgentContextInput): Promise<AuthorizedAgentContext | AgentContextSnapshot>;
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
  admit(context: AuthorizedAgentContext): Promise<T>;
}

const defaultDependencies: AgentExecutionAdmissionDependencies = {
  authorizeContext: authorizeAgentContext,
  resolveTaskModel,
};

function userProductTypes(user: User): string[] {
  if (user.role === 'admin') return ['canvas', 'chat', 'simple-chat'];
  return (user.productType || '').split(',').map(value => value.trim()).filter(Boolean);
}

export async function admitAuthorizedAgentExecution<T>(
  input: AdmitAuthorizedAgentExecutionInput<T>,
  dependencies: AgentExecutionAdmissionDependencies = defaultDependencies,
): Promise<T> {
  const authorizedValue = await dependencies.authorizeContext({
    actorUserId: input.actor.id,
    request: input.request,
  });
  const authorizedContext: AuthorizedAgentContext = 'snapshot' in authorizedValue
    ? authorizedValue
    : { snapshot: authorizedValue, mediaByVersionId: {}, selectedEntityVersionIds: {} };

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
    modelCapabilities: [...toAgentModelCapabilitySet(model)],
    capabilityScope: 'downstream',
  });
  if (
    authorization.denials.length > 0
    || !authorization.tools.some(tool => tool.toolId === input.toolId)
  ) {
    throw new SameTaskAgentToolError(authorization.denials);
  }

  return input.admit(authorizedContext);
}
