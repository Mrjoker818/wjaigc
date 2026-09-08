import { canonicalComplianceReportJson, parsePlatformComplianceReport } from '@/lib/platform-compliance/report-schema';
import type { PlatformComplianceReportV1 } from '@/lib/platform-compliance/types';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';
import type { DurableSkillOutput, SkillDefinition } from '@/lib/skill-runtime/types';

const REPORT_SCHEMA_ID = 'platform-compliance-report-v1';

export interface PlatformComplianceReportProjection {
  stepId: string;
  report: PlatformComplianceReportV1;
  downloadUrls: { json: string; html: string };
}

let fallbackIdCounter = 0;

export class PlatformComplianceProjectionError extends Error {
  constructor() {
    super('报告加载失败，请重试');
    this.name = 'PlatformComplianceProjectionError';
  }
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前浏览器不支持报告完整性校验');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function reportDownloadUrl(
  runId: string,
  stepId: string,
  projectId: string,
  checksum: string,
  format: 'json' | 'html',
): string {
  const query = new URLSearchParams({ projectId, checksum, format });
  return `/api/skill-reports/${encodeURIComponent(runId)}/${encodeURIComponent(stepId)}?${query}`;
}

export async function projectPlatformComplianceReports(
  outputs: unknown,
  input: { runId: string; projectId: string },
): Promise<PlatformComplianceReportProjection[]> {
  if (!Array.isArray(outputs)) return [];
  const reports: PlatformComplianceReportProjection[] = [];
  for (const candidate of outputs) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const output = candidate as Partial<DurableSkillOutput>;
    if (
      output.kind !== 'json'
      || output.schemaId !== REPORT_SCHEMA_ID
      || typeof output.stepId !== 'string'
      || !output.stepId
      || typeof output.content !== 'string'
    ) continue;
    try {
      const report = parsePlatformComplianceReport(JSON.parse(output.content) as unknown);
      if (report.runId !== input.runId) throw new PlatformComplianceProjectionError();
      const canonical = canonicalComplianceReportJson(report);
      if (canonical !== output.content) throw new PlatformComplianceProjectionError();
      const checksum = await sha256(output.content);
      reports.push({
        stepId: output.stepId,
        report,
        downloadUrls: {
          json: reportDownloadUrl(input.runId, output.stepId, input.projectId, checksum, 'json'),
          html: reportDownloadUrl(input.runId, output.stepId, input.projectId, checksum, 'html'),
        },
      });
    } catch {
      throw new PlatformComplianceProjectionError();
    }
  }
  return reports;
}

export function createCanvasSkillIdempotencyKey(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return `canvas-skill:${randomUUID()}`;
  fallbackIdCounter = (fallbackIdCounter + 1) % Number.MAX_SAFE_INTEGER;
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues?.(bytes);
  const random = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `canvas-skill:${Date.now().toString(36)}:${fallbackIdCounter.toString(36)}:${random}`;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

export function frozenSkillRunRequestFromHistory(value: unknown): SkillRunRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('历史运行上下文无效');
  const item = value as Record<string, unknown>;
  if (!nonEmptyString(item.skillId) || !Number.isSafeInteger(item.skillVersion) || Number(item.skillVersion) < 1
    || item.surface !== 'canvas' || !nonEmptyString(item.projectId) || !nonEmptyString(item.workspaceId)
    || !item.inputValues || typeof item.inputValues !== 'object' || Array.isArray(item.inputValues)
    || !Array.isArray(item.sourceVersionIds) || item.sourceVersionIds.some(id => !nonEmptyString(id))
    || !item.modelBindings || typeof item.modelBindings !== 'object' || Array.isArray(item.modelBindings)) {
    throw new Error('历史运行上下文无效');
  }
  const modelBindings: SkillRunRequest['modelBindings'] = {};
  const allowedRoles = new Set(['orchestrator', 'image', 'video', 'vision', 'edit', 'three-d']);
  for (const [role, rawBinding] of Object.entries(item.modelBindings as Record<string, unknown>)) {
    if (!allowedRoles.has(role) || !rawBinding || typeof rawBinding !== 'object' || Array.isArray(rawBinding)) {
      throw new Error('历史运行上下文无效');
    }
    const binding = rawBinding as Record<string, unknown>;
    if (Object.keys(binding).some(key => key !== 'providerId' && key !== 'modelId')
      || !nonEmptyString(binding.providerId) || !nonEmptyString(binding.modelId)) {
      throw new Error('历史运行上下文无效');
    }
    modelBindings[role as keyof SkillRunRequest['modelBindings']] = {
      providerId: binding.providerId,
      modelId: binding.modelId,
    };
  }
  return {
    skillId: item.skillId,
    skillVersion: Number(item.skillVersion),
    surface: 'canvas',
    projectId: item.projectId,
    workspaceId: item.workspaceId,
    inputValues: structuredClone(item.inputValues as Record<string, unknown>),
    sourceVersionIds: [...item.sourceVersionIds] as string[],
    modelBindings: structuredClone(modelBindings),
    idempotencyKey: createCanvasSkillIdempotencyKey(),
  };
}

export function currentSkillRecheckRequestFromHistory(
  value: unknown,
  currentSkill: SkillDefinition | undefined,
): SkillRunRequest {
  if (!currentSkill || !currentSkill.enabled || !currentSkill.allowedSurfaces.includes('canvas')) {
    throw new Error('当前 Skill 已删除或不可用，无法按当前规则复检');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('旧运行记录缺少冻结复检上下文，无法按当前规则复检');
  }
  const item = value as Record<string, unknown>;
  if (item.skillId !== currentSkill.id) {
    throw new Error('当前 Skill 已删除或不可用，无法按当前规则复检');
  }
  if (!nonEmptyString(item.workspaceId)) {
    throw new Error('旧运行记录缺少工作区信息，无法按当前规则复检');
  }
  try {
    return { ...frozenSkillRunRequestFromHistory(value), skillVersion: currentSkill.version };
  } catch {
    throw new Error('旧运行记录缺少冻结复检上下文，无法按当前规则复检');
  }
}

export async function downloadPlatformComplianceReport(
  url: string,
  filename: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let objectUrl: string | undefined;
  try {
    const response = await fetcher(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('download failed');
    objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch {
    throw new Error('报告下载失败，请重试');
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function createPlatformComplianceRecheckRequest(
  historical: SkillRunRequest,
  idempotencyKey: string,
): SkillRunRequest {
  return {
    ...historical,
    inputValues: structuredClone(historical.inputValues),
    sourceVersionIds: [...historical.sourceVersionIds],
    modelBindings: structuredClone(historical.modelBindings),
    idempotencyKey,
  };
}
