import type { AgentWorkspace } from './types';

export interface AgentToolDefinition {
  toolId: string;
  workspaces: AgentWorkspace[];
  productTypes: string[];
  modelCapabilities: string[];
}

export type AuthorizedAgentTool = AgentToolDefinition;

export type AgentToolDenialCode =
  | 'TOOL_NOT_FOUND'
  | 'WORKSPACE_FORBIDDEN'
  | 'PRODUCT_PERMISSION_REQUIRED'
  | 'MODEL_CAPABILITY_REQUIRED';

export interface AgentToolAuthorizationResult {
  tools: AuthorizedAgentTool[];
  denials: Array<{
    toolId: string;
    code: AgentToolDenialCode;
  }>;
}

export interface AuthorizeAgentToolsInput {
  requestedToolIds: string[];
  workspace: AgentWorkspace;
  userProductTypes: string[];
  modelCapabilities: string[];
  registry?: readonly AgentToolDefinition[];
}

export const AGENT_TOOL_REGISTRY: readonly AgentToolDefinition[] = [
  {
    toolId: 'generate_image',
    workspaces: ['canvas', 'workflow', 'chat'],
    productTypes: ['canvas', 'chat', 'simple-chat'],
    modelCapabilities: ['image'],
  },
  {
    toolId: 'edit_image',
    workspaces: ['canvas', 'workflow'],
    productTypes: ['canvas'],
    modelCapabilities: ['image', 'edit'],
  },
  {
    toolId: 'analyze_image',
    workspaces: ['canvas', 'workflow', 'chat'],
    productTypes: ['canvas', 'chat', 'simple-chat'],
    modelCapabilities: ['vision'],
  },
  {
    toolId: 'adjust_color',
    workspaces: ['canvas', 'workflow'],
    productTypes: ['canvas'],
    modelCapabilities: ['image'],
  },
] as const;

export function authorizeAgentTools({
  requestedToolIds,
  workspace,
  userProductTypes,
  modelCapabilities,
  registry = AGENT_TOOL_REGISTRY,
}: AuthorizeAgentToolsInput): AgentToolAuthorizationResult {
  const definitions = new Map(registry.map(tool => [tool.toolId, tool]));
  const products = new Set(userProductTypes);
  const capabilities = new Set(modelCapabilities);
  const tools: AuthorizedAgentTool[] = [];
  const denials: AgentToolAuthorizationResult['denials'] = [];
  const seen = new Set<string>();

  for (const toolId of requestedToolIds) {
    if (seen.has(toolId)) continue;
    seen.add(toolId);
    const tool = definitions.get(toolId);
    if (!tool) {
      denials.push({ toolId, code: 'TOOL_NOT_FOUND' });
      continue;
    }
    if (!tool.workspaces.includes(workspace)) {
      denials.push({ toolId, code: 'WORKSPACE_FORBIDDEN' });
      continue;
    }
    if (!tool.productTypes.some(product => products.has(product))) {
      denials.push({ toolId, code: 'PRODUCT_PERMISSION_REQUIRED' });
      continue;
    }
    if (!tool.modelCapabilities.every(capability => capabilities.has(capability))) {
      denials.push({ toolId, code: 'MODEL_CAPABILITY_REQUIRED' });
      continue;
    }
    tools.push(tool);
  }

  return { tools, denials };
}
