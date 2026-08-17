export type WorkflowRendererMode = 'legacy' | 'shadow' | 'react-flow-v2';

export const WORKFLOW_RENDERER_MODES = ['legacy', 'shadow', 'react-flow-v2'] as const;

export function resolveWorkflowRendererMode(raw?: string): WorkflowRendererMode {
  return raw === 'shadow' || raw === 'react-flow-v2' ? raw : 'legacy';
}
