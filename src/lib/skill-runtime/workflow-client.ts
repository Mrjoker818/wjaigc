import type { SkillDefinition } from './types';

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
