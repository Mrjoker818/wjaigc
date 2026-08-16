export type AgentRuntimeMode = 'legacy' | 'shadow' | 'agent-v2';

export function resolveAgentRuntimeMode(raw?: string): AgentRuntimeMode {
  return raw === 'shadow' || raw === 'agent-v2' ? raw : 'legacy';
}
