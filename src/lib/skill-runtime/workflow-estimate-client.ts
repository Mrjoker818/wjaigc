import { buildWorkflowSkillRunRequest } from '@/lib/workflow-engine';
import type { WorkflowExecutionScope } from '@/lib/workflow-execution-scope';
import { requiredSkillModelRoles, type SkillDefinition } from './types';
import type { FrozenBindings } from './cost-estimator';

export interface WorkflowSkillQuote {
  nodeId: string;
  label: string;
  minimum: number;
  maximum: number;
}

function managedUpstreamInputs(
  scope: WorkflowExecutionScope,
  targetNodeId: string,
): Record<string, unknown> {
  const ancestorIds = new Set<string>();
  const pending = scope.connections
    .filter(connection => connection.toNodeId === targetNodeId)
    .map(connection => connection.fromNodeId);
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (ancestorIds.has(nodeId)) continue;
    ancestorIds.add(nodeId);
    for (const connection of scope.connections) {
      if (connection.toNodeId === nodeId) pending.push(connection.fromNodeId);
    }
  }
  const assetReferences = scope.nodes
    .filter(node => ancestorIds.has(node.id) && node.type === 'input-image')
    .flatMap(node => {
      const assetVersionId = typeof node.config.assetVersionId === 'string'
        ? node.config.assetVersionId
        : '';
      const url = typeof node.config.imageUrl === 'string' ? node.config.imageUrl : '';
      if (!assetVersionId || !url) return [];
      return [{
        assetVersionId,
        url,
        ...(typeof node.config.assetId === 'string' ? { assetId: node.config.assetId } : {}),
        ...(typeof node.config.placementId === 'string' ? { placementId: node.config.placementId } : {}),
      }];
    });
  return assetReferences.length > 0 ? { assetReferences } : {};
}

export async function estimateWorkflowSkills(
  scope: WorkflowExecutionScope,
  skills: SkillDefinition[],
  context: { projectId: string; workflowId: string; requestKey: string },
  signal: AbortSignal,
): Promise<{ scope: WorkflowExecutionScope; quotes: WorkflowSkillQuote[] }> {
  const nodes = [...scope.nodes];
  const quotes: WorkflowSkillQuote[] = [];
  for (const [index, node] of nodes.entries()) {
    signal.throwIfAborted();
    if (node.type !== 'ai-skill') continue;
    const skill = skills.find(item => item.id === node.config.skillId);
    if (!skill) throw new Error('请等待 Skill 目录加载并选择有效的 Skill');
    const request = buildWorkflowSkillRunRequest(node, managedUpstreamInputs(scope, node.id), skill, {
      projectId: context.projectId, workflowId: context.workflowId, executionId: context.requestKey,
    });
    const response = await fetch('/api/skill-runs/estimate', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request.body, estimateScope: 'workflow-node' }),
    });
    const data = await response.json().catch(() => null) as {
      minimum?: number; maximum?: number; modelBindings?: FrozenBindings; message?: string; error?: string;
    } | null;
    signal.throwIfAborted();
    if (!response.ok) throw new Error(data?.message || data?.error || `费用预估失败 (${response.status})`);
    if (!data || typeof data.minimum !== 'number' || !Number.isFinite(data.minimum) || data.minimum < 0
      || typeof data.maximum !== 'number' || !Number.isFinite(data.maximum) || data.maximum < data.minimum
      || !data.modelBindings || typeof data.modelBindings !== 'object' || Array.isArray(data.modelBindings)) {
      throw new Error('费用预估响应格式无效');
    }
    for (const binding of Object.values(data.modelBindings)) {
      if (!binding || typeof binding.providerId !== 'string' || !binding.providerId
        || typeof binding.modelId !== 'string' || !binding.modelId) throw new Error('预估模型身份无效');
    }
    const selected = request.body.modelBindings as FrozenBindings;
    for (const role of requiredSkillModelRoles(skill)) {
      const frozen = data.modelBindings[role];
      if (!frozen) throw new Error('费用预估缺少必需模型绑定');
      const original = selected[role];
      if (original && (original.providerId !== frozen.providerId || original.modelId !== frozen.modelId)) {
        throw new Error('预估模型与当前选择不一致，请重新选择');
      }
    }
    nodes[index] = { ...node, config: { ...node.config, modelBindings: data.modelBindings } };
    quotes.push({ nodeId: node.id, label: node.label, minimum: data.minimum, maximum: data.maximum });
  }
  return { scope: { ...scope, nodes }, quotes };
}
