import type {
  AgentContextSnapshot,
  AgentMode,
  AgentRunRequest,
} from './types';

type SurfaceWorkspace = 'canvas' | 'chat';

interface SurfaceRequestInput {
  projectId: string;
  workspaceId: string;
  providerId: string;
  modelId: string;
  prompt: string;
  sourceVersionIds: string[];
  visibleVersionIds?: string[];
  selectedEntityIds?: string[];
  conversationId?: string;
  mode?: AgentMode;
  locale?: 'zh-CN' | 'en-US';
  idempotencyKey?: string;
  apiKey?: unknown;
  token?: unknown;
  password?: unknown;
}

export type CanvasAgentRequestInput = SurfaceRequestInput;

export type SimpleChatAgentRequestInput = SurfaceRequestInput;

export interface AgentEditRequestInput extends Omit<SurfaceRequestInput,
  'selectedEntityIds' | 'sourceVersionIds' | 'mode'
> {
  selectedEntityId: string;
  sourceVersionId?: string;
}

export class SurfaceAgentRequestError extends Error {
  readonly code = 'AGENT_SURFACE_REQUEST_INVALID';

  constructor(message = 'Agent surface request is invalid') {
    super(message);
    this.name = 'SurfaceAgentRequestError';
  }
}

function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SurfaceAgentRequestError(`${name} is required`);
  }
  return value.trim();
}

function identifiers(values: unknown, name: string): string[] {
  if (!Array.isArray(values)) throw new SurfaceAgentRequestError(`${name} is invalid`);
  return [...new Set(values.map(value => required(value, name)))];
}

function assertNoClientCredentials(input: SurfaceRequestInput): void {
  if (input.apiKey !== undefined || input.token !== undefined || input.password !== undefined) {
    throw new SurfaceAgentRequestError('Client credentials are not accepted');
  }
}

function mode(value: AgentMode | undefined): AgentMode {
  if (value === undefined) return 'agent';
  if (value === 'conversation' || value === 'vision' || value === 'agent') return value;
  throw new SurfaceAgentRequestError('mode is invalid');
}

function context(input: SurfaceRequestInput, sourceVersionIds: string[]): AgentContextSnapshot {
  const visibleVersionIds = identifiers(
    input.visibleVersionIds === undefined ? sourceVersionIds : input.visibleVersionIds,
    'visibleVersionIds',
  );
  return {
    selectedEntityIds: identifiers(input.selectedEntityIds || [], 'selectedEntityIds'),
    visibleVersionIds: [...new Set([...visibleVersionIds, ...sourceVersionIds])],
    ...(input.conversationId ? { conversationId: required(input.conversationId, 'conversationId') } : {}),
    locale: input.locale || 'zh-CN',
  };
}

function tools(workspace: SurfaceWorkspace, requestMode: AgentMode): string[] {
  if (requestMode === 'conversation' || requestMode === 'vision') return [];
  return workspace === 'chat'
    ? ['analyze_image', 'generate_image']
    : ['analyze_image', 'generate_image', 'edit_image'];
}

function build(
  workspace: SurfaceWorkspace,
  input: SurfaceRequestInput,
): AgentRunRequest {
  assertNoClientCredentials(input);
  const requestMode = mode(input.mode);
  const sourceVersionIds = identifiers(input.sourceVersionIds, 'sourceVersionIds');
  if (requestMode === 'vision' && sourceVersionIds.length === 0) {
    throw new SurfaceAgentRequestError('vision requires an image version');
  }
  const workspaceId = required(input.workspaceId, 'workspaceId');
  return {
    projectId: required(input.projectId, 'projectId'),
    workspace,
    workspaceId,
    mode: requestMode,
    providerId: required(input.providerId, 'providerId'),
    modelId: required(input.modelId, 'modelId'),
    prompt: required(input.prompt, 'prompt'),
    sourceVersionIds,
    allowedToolIds: tools(workspace, requestMode),
    idempotencyKey: input.idempotencyKey || `agent:${workspace}:${workspaceId}:${Date.now()}`,
    context: context(input, sourceVersionIds),
  };
}

export function buildCanvasAgentRequest(input: CanvasAgentRequestInput): AgentRunRequest {
  return build('canvas', input);
}

export function buildSimpleChatAgentRequest(
  input: SimpleChatAgentRequestInput,
): AgentRunRequest {
  return build('chat', input);
}

export function buildAgentEditRequest(input: AgentEditRequestInput): AgentRunRequest {
  const sourceVersionIds = input.sourceVersionId ? [input.sourceVersionId] : [];
  const request = build('canvas', {
    ...input,
    sourceVersionIds,
    selectedEntityIds: [input.selectedEntityId],
    mode: 'agent',
  });
  return { ...request, allowedToolIds: ['agent_edit'] };
}
