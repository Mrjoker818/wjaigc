import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { parseWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import type { SkillDefinition } from './types';
import { parseDurableSkillOutputs } from './structured-output';

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
    outputs?: unknown;
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

function sanitizeWorkspaceAssetReference(value: WorkspaceAssetReference): WorkspaceAssetReference {
  const sourceTrace = parseWorkspaceSourceTrace(value.sourceTrace);
  const safe = { ...value };
  delete safe.sourceTrace;
  return { ...safe, ...(sourceTrace ? { sourceTrace } : {}) };
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

export async function createConversationCanvasSkill(
  input: { name: string; description: string; category: string; systemPrompt: string; conversation: string },
  fetcher: typeof fetch = fetch,
): Promise<SkillDefinition> {
  const payload = await readJson<SkillMutationResponse>(await fetcher('/api/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }), '保存 Skill 失败');
  if (!isCanvasSkill(payload.skill)) throw new Error('保存 Skill 返回格式无效');
  return payload.skill;
}

export async function deleteCanvasSkill(
  skillId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`/api/skills/${encodeURIComponent(skillId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('删除 Skill 失败');
}

export async function deleteCanvasSkillsSequentially(
  skillIds: readonly string[],
  remove: (skillId: string) => Promise<void> = deleteCanvasSkill,
): Promise<void> {
  for (const skillId of skillIds) await remove(skillId);
}

export function canvasSkillProjectionIdentity(runId: string, assetVersionId: string): string {
  return `canvas-skill:${runId}:${assetVersionId}`;
}

export async function transferCanvasSkillAsset(input: {
  reference: WorkspaceAssetReference;
  projectId: string;
  runId: string;
  sourceVersionIds: readonly string[];
  restoreDeletedPlacement?: boolean;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<WorkspaceAssetReference & { projectRevision?: number }> {
  if (!input.reference.assetVersionId) throw new Error('Skill 资产版本无效');
  const identity = canvasSkillProjectionIdentity(input.runId, input.reference.assetVersionId);
  const response = await (input.fetcher ?? fetch)('/api/assets/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceVersion: input.reference.assetVersionId,
      targetProject: input.projectId,
      targetWorkspace: `canvas:${input.projectId}`,
      entityType: 'canvas-image',
      entityId: identity,
      idempotencyKey: identity,
      metadata: {
        source: 'canvas-skill',
        runId: input.runId,
        sourceVersionIds: [...input.sourceVersionIds],
        ...(input.reference.sourceTrace ? { sourceTrace: input.reference.sourceTrace } : {}),
      },
    }),
    signal: input.signal,
  });
  const transferred = await readJson<WorkspaceAssetReference & { placementStatus?: string; placementRevision?: string; projectRevision?: number }>(response, 'Skill 资产加入画布失败');
  if (!isWorkspaceAssetReference(transferred) || !transferred.assetId || !transferred.placementId) {
    throw new Error('Skill 资产加入画布返回格式无效');
  }
  if (transferred.placementStatus === 'trashed') {
    if (!input.restoreDeletedPlacement) throw new Error('Skill 结果已删除，请从运行记录显式恢复');
    if (!transferred.placementRevision || !/^\d{1,10}$/.test(transferred.placementRevision)) {
      throw new Error('Skill 结果恢复缺少删除版本，请刷新后重试');
    }
    const restoreResponse = await (input.fetcher ?? fetch)(
      `/api/assets/${encodeURIComponent(transferred.assetId)}/restore`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: input.projectId, placementId: transferred.placementId,
          expectedPlacementRevision: transferred.placementRevision }),
        signal: input.signal,
      },
    );
    const restored: unknown = await restoreResponse.json().catch(() => null);
    if (!restoreResponse.ok) {
      const code = isRecord(restored) && typeof restored.error === 'string'
        && /^ASSET_[A-Z_]{1,64}$/.test(restored.error) ? restored.error : '';
      throw new Error(code ? `Skill 结果恢复失败：${code}` : 'Skill 结果恢复失败');
    }
    if (!isRecord(restored) || !isRecord(restored.placement)
      || restored.placement.id !== transferred.placementId
      || restored.placement.assetId !== transferred.assetId
      || restored.placement.assetVersionId !== transferred.assetVersionId
      || restored.placement.status !== 'active') {
      throw new Error('Skill 结果恢复返回格式无效');
    }
    transferred.placementStatus = 'active';
    if (typeof restored.projectRevision === 'number'
      && Number.isSafeInteger(restored.projectRevision) && restored.projectRevision >= 0) {
      transferred.projectRevision = restored.projectRevision;
    }
  }
  return { ...sanitizeWorkspaceAssetReference(transferred),
    ...(transferred.projectRevision === undefined ? {} : { projectRevision: transferred.projectRevision }) };
}

export function createCanvasSkillProjectionCoordinator() {
  let active: { runId: string; projectId: string; controller: AbortController } | null = null;
  const pending = new Map<string, AbortSignal>();
  const completed = new Set<string>();

  const isActive = (runId: string, projectId: string): boolean => (
    active?.runId === runId && active.projectId === projectId && !active.controller.signal.aborted
  );

  return {
    activate(runId: string, projectId: string): void {
      if (isActive(runId, projectId)) return;
      active?.controller.abort();
      completed.clear();
      active = { runId, projectId, controller: new AbortController() };
    },
    cancel(): void {
      active?.controller.abort();
      active = null;
    },
    isActive,
    async project(input: {
      runId: string;
      projectId: string;
      assetVersionId: string;
      isAlreadyProjected?: () => boolean;
      project: (signal: AbortSignal) => Promise<void>;
    }): Promise<boolean> {
      if (!isActive(input.runId, input.projectId) || !active) return false;
      if (input.isAlreadyProjected?.()) return false;
      const identity = canvasSkillProjectionIdentity(input.runId, input.assetVersionId);
      if (pending.get(identity)?.aborted === false || completed.has(identity)) return false;
      const signal = active.controller.signal;
      pending.set(identity, signal);
      try {
        await input.project(signal);
        if (!isActive(input.runId, input.projectId) || signal.aborted) return false;
        completed.add(identity);
        return true;
      } finally {
        if (pending.get(identity) === signal) pending.delete(identity);
      }
    },
  };
}

export async function startCanvasSkillRun(
  coordinator: Pick<ReturnType<typeof createCanvasSkillProjectionCoordinator>, 'cancel' | 'activate'>,
  startRun: () => Promise<string | null | undefined>,
  projectId?: string,
): Promise<string | null | undefined> {
  coordinator.cancel();
  const runId = await startRun();
  if (runId && projectId) coordinator.activate(runId, projectId);
  return runId;
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
  parseDurableSkillOutputs(run.outputs);
  const sourceIds = new Set(input.sourceVersionIds);
  const outputIds = Array.isArray(run.assetVersionIds)
    ? [...new Set(run.assetVersionIds.filter((value): value is string => (
        typeof value === 'string' && Boolean(value) && !sourceIds.has(value)
      )))]
    : [];

  const resolved = await Promise.all(outputIds.map(async assetVersionId => {
    const query = new URLSearchParams({ projectId: input.projectId, assetVersionId });
    const reference = await readJson<WorkspaceAssetReference & { kind?: string }>(
      await fetcher(`/api/assets?${query.toString()}`, { method: 'GET', signal: input.signal }),
      'Skill 资产版本加载失败',
    );
    return reference.kind === 'image'
      && isWorkspaceAssetReference(reference)
      && reference.assetVersionId === assetVersionId
      ? reference
      : null;
  }));
  return resolved.filter((reference): reference is WorkspaceAssetReference => reference !== null);
}
