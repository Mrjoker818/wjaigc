import type { Workflow } from './workflow-engine';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function workflowFromProjectMetadata(metadata: unknown): Workflow | null {
  if (!isRecord(metadata) || !isRecord(metadata.workflow)) return null;
  const workflow = metadata.workflow;
  if (
    typeof workflow.id !== 'string'
    || !workflow.id
    || typeof workflow.name !== 'string'
    || typeof workflow.version !== 'string'
    || !Array.isArray(workflow.nodes)
    || !Array.isArray(workflow.connections)
    || typeof workflow.createdAt !== 'number'
    || typeof workflow.updatedAt !== 'number'
    || !['idle', 'running', 'paused', 'completed', 'failed'].includes(String(workflow.status))
  ) {
    return null;
  }
  return workflow as unknown as Workflow;
}
