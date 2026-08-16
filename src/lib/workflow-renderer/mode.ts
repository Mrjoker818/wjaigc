export type WorkflowRendererMode = 'legacy' | 'shadow' | 'react-flow-v2';

export function resolveWorkflowRendererMode(raw?: string): WorkflowRendererMode {
  return raw === 'shadow' || raw === 'react-flow-v2' ? raw : 'legacy';
}
