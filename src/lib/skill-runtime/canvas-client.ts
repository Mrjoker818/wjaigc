import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { SkillDefinition } from './types';

interface SkillCatalogResponse {
  skills?: unknown;
}

interface SkillMutationResponse {
  skill?: unknown;
}

interface SkillRunHistoryResponse {
  run?: {
    runId?: unknown;
    status?: unknown;
    assetVersionIds?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string';
}

function isSkillInput(value: unknown): boolean {
  return isRecord(value)
    && hasString(value, 'key')
    && hasString(value, 'label')
    && hasString(value, 'kind')
    && typeof value.required === 'boolean';
}

function isSkillStep(value: unknown): boolean {
  return isRecord(value)
    && hasString(value, 'id')
    && hasString(value, 'label')
    && hasString(value, 'toolId')
    && hasString(value, 'execution')
    && hasString(value, 'promptTemplate')
    && hasString(value, 'modelRole')
    && Array.isArray(value.qualityGateIds)
    && value.qualityGateIds.every(item => typeof item === 'string');
}

function isCanvasSkill(value: unknown): value is SkillDefinition {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.version === 'number'
    && hasString(value, 'name')
    && hasString(value, 'category')
    && hasString(value, 'description')
    && hasString(value, 'systemPrompt')
    && Array.isArray(value.allowedSurfaces)
    && value.allowedSurfaces.includes('canvas')
    && Array.isArray(value.inputs)
    && value.inputs.every(isSkillInput)
    && Array.isArray(value.steps)
    && value.steps.every(isSkillStep)
    && typeof value.enabled === 'boolean'
    && typeof value.builtIn === 'boolean'
    && typeof value.createdAt === 'number'
    && typeof value.updatedAt === 'number'
    && typeof value.usageCount === 'number';
}

function isWorkspaceAssetReference(value: unknown): value is WorkspaceAssetReference {
  return isRecord(value)
    && typeof value.url === 'string'
    && Boolean(value.url)
    && typeof value.assetVersionId === 'string'
    && Boolean(value.assetVersionId);
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok || !payload) throw new Error(fallback);
  return payload;
}

export async function loadCanvasSkillCatalog(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SkillDefinition[]> {
  const payload = await readJson<SkillCatalogResponse>(
    await fetcher('/api/skills?surface=canvas', { method: 'GET', signal }),
    'Canvas Skill 目录加载失败',
  );
  if (!Array.isArray(payload.skills)) throw new Error('Canvas Skill 目录格式无效');
  const canvasSkills = payload.skills.filter(value => (
    isRecord(value)
    && Array.isArray(value.allowedSurfaces)
    && value.allowedSurfaces.includes('canvas')
  ));
  if (!canvasSkills.every(isCanvasSkill)) throw new Error('Canvas Skill 目录格式无效');
  return canvasSkills;
}

export async function copyCanvasSkill(
  sourceSkillId: string,
  fetcher: typeof fetch = fetch,
): Promise<SkillDefinition> {
  const payload = await readJson<SkillMutationResponse>(await fetcher('/api/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceSkillId }),
  }), '保存 Skill 失败');
  if (!isCanvasSkill(payload.skill)) throw new Error('保存 Skill 返回格式无效');
  return payload.skill;
}

export async function updateCanvasSkill(
  skillId: string,
  patch: { enabled?: boolean; name?: string; description?: string },
  fetcher: typeof fetch = fetch,
): Promise<SkillDefinition> {
  const payload = await readJson<SkillMutationResponse>(
    await fetcher(`/api/skills/${encodeURIComponent(skillId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    '更新 Skill 失败',
  );
  if (!isCanvasSkill(payload.skill)) throw new Error('更新 Skill 返回格式无效');
  return payload.skill;
}

export async function loadCompletedCanvasSkillAssets(input: {
  projectId: string;
  runId: string;
  sourceVersionIds: readonly string[];
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<WorkspaceAssetReference[]> {
  const fetcher = input.fetcher ?? fetch;
  const payload = await readJson<SkillRunHistoryResponse>(
    await fetcher(`/api/skill-runs/${encodeURIComponent(input.runId)}`, {
      method: 'GET',
      signal: input.signal,
    }),
    'Skill 运行结果加载失败',
  );
  const run = payload.run;
  if (run?.runId !== input.runId || run.status !== 'completed') return [];
  const sourceIds = new Set(input.sourceVersionIds);
  const outputIds = Array.isArray(run.assetVersionIds)
    ? [...new Set(run.assetVersionIds.filter((value): value is string => (
        typeof value === 'string' && Boolean(value) && !sourceIds.has(value)
      )))]
    : [];

  const resolved = await Promise.all(outputIds.map(async assetVersionId => {
    const query = new URLSearchParams({ projectId: input.projectId, assetVersionId });
    const reference = await readJson<WorkspaceAssetReference>(
      await fetcher(`/api/assets?${query.toString()}`, { method: 'GET', signal: input.signal }),
      'Skill 资产版本加载失败',
    );
    return isWorkspaceAssetReference(reference) && reference.assetVersionId === assetVersionId
      ? reference
      : null;
  }));
  return resolved.filter((reference): reference is WorkspaceAssetReference => reference !== null);
}
