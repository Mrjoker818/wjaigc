import type { SkillDefinition } from './types';
import { projectWorkflowSkillRun, type WorkflowSkillAssetReference } from '../workflow-skill-execution';
import { parseDurableSkillOutputs } from './structured-output';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isWorkflowSkill(value: unknown): value is SkillDefinition {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.version === 'number'
    && typeof value.name === 'string'
    && typeof value.category === 'string'
    && typeof value.description === 'string'
    && typeof value.systemPrompt === 'string'
    && Array.isArray(value.allowedSurfaces)
    && value.allowedSurfaces.includes('workflow')
    && Array.isArray(value.inputs)
    && Array.isArray(value.steps)
    && typeof value.enabled === 'boolean'
    && typeof value.builtIn === 'boolean';
}

export async function loadWorkflowSkillCatalog(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SkillDefinition[]> {
  const response = await fetcher('/api/skills?surface=workflow', { method: 'GET', signal });
  const payload = await response.json().catch(() => null) as { skills?: unknown } | null;
  if (!response.ok || !payload || !Array.isArray(payload.skills)) {
    throw new Error('节点 Skill 目录加载失败');
  }
  if (!payload.skills.every(isWorkflowSkill)) throw new Error('节点 Skill 目录格式无效');
  return payload.skills.filter(skill => skill.enabled);
}

export async function loadSavedWorkflowSkillResult(input: {
  runId: string; projectId: string; workflowId: string; skillId: string; skillVersion: number;
  signal: AbortSignal; fetcher?: typeof fetch;
}): Promise<{ status: string; output: Record<string, unknown> }> {
  const fetcher = input.fetcher ?? fetch;
  input.signal.throwIfAborted();
  const response = await fetcher(`/api/skill-runs/${encodeURIComponent(input.runId)}?observeOnly=true`, { method: 'GET', signal: input.signal });
  const payload: unknown = await response.json();
  input.signal.throwIfAborted();
  if (!response.ok || !isRecord(payload) || !isRecord(payload.run)) throw new Error('Skill 运行记录恢复失败');
  const run = payload.run;
  if (run.runId !== input.runId || run.projectId !== input.projectId || run.surface !== 'workflow'
    || run.workspaceId !== `workflow:${input.workflowId}` || run.skillId !== input.skillId
    || run.skillVersion !== input.skillVersion) throw new Error('Skill 运行记录与当前节点不匹配');
  if (typeof run.status !== 'string' || !Array.isArray(run.assetVersionIds)
    || !run.assetVersionIds.every(id => typeof id === 'string')) throw new Error('Skill 运行记录格式无效');
  const references: WorkflowSkillAssetReference[] = [];
  if (run.status === 'completed') {
    for (const assetVersionId of new Set(run.assetVersionIds as string[])) {
      input.signal.throwIfAborted();
      const query = new URLSearchParams({ projectId: input.projectId, assetVersionId });
      const assetResponse = await fetcher(`/api/assets?${query}`, { method: 'GET', signal: input.signal });
      const asset: unknown = await assetResponse.json();
      input.signal.throwIfAborted();
      if (!assetResponse.ok || !isRecord(asset) || asset.assetVersionId !== assetVersionId
        || typeof asset.url !== 'string' || !asset.url) throw new Error('Skill 成品版本恢复失败');
      references.push({ assetVersionId, url: asset.url, ...(typeof asset.assetId === 'string' ? { assetId: asset.assetId } : {}) });
    }
  }
  input.signal.throwIfAborted();
  const outputs = parseDurableSkillOutputs(run.outputs);
  return {
    status: run.status === 'completed' ? 'success' : ['failed', 'timeout'].includes(run.status) ? 'error'
      : ['created', 'queued', 'planning', 'awaiting-confirmation', 'executing', 'uploading'].includes(run.status) ? 'running' : run.status,
    output: projectWorkflowSkillRun({ runId: input.runId, status: run.status, assetVersionIds: run.assetVersionIds as string[], outputs }, references),
  };
}
