import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import {
  buildMultiPlatformExportManifest,
  MULTI_PLATFORM_EXPORT_MANIFEST_SCHEMA_ID,
  parseMultiPlatformExportResult as parseResultSchema,
  type ExportManifestFile,
  type MultiPlatformExportManifestV1,
  type MultiPlatformExportResultV1,
} from '@/lib/multi-platform-export/manifest';
import type { PlatformExportPreset } from '@/lib/multi-platform-export/types';
import { loadCanvasExportImageAssets } from './canvas-client';

const RESULT_SCHEMA_ID = 'multi-platform-export-result-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(response: Response, fallback: string): Promise<unknown> {
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok || payload === null) throw new Error(fallback);
  return payload;
}

function isAssetReference(value: unknown): value is WorkspaceAssetReference {
  return isRecord(value)
    && typeof value.assetVersionId === 'string'
    && typeof value.url === 'string'
    && value.url.length > 0;
}

export function parseMultiPlatformExportResult(output: unknown): MultiPlatformExportResultV1 {
  if (!Array.isArray(output)) throw new Error('EXPORT_RESULT_NOT_FOUND');
  const candidate = [...output].reverse().find(item => (
    isRecord(item)
    && item.kind === 'json'
    && item.schemaId === RESULT_SCHEMA_ID
    && typeof item.content === 'string'
  ));
  if (!candidate || typeof candidate.content !== 'string') throw new Error('EXPORT_RESULT_NOT_FOUND');
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.content) as unknown;
  } catch {
    throw new Error('EXPORT_RESULT_INVALID');
  }
  return parseResultSchema(parsed);
}

export async function loadEnabledPlatformExportPresets(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PlatformExportPreset[]> {
  const payload = await readJson(await fetcher('/api/platform-export-presets', {
    method: 'GET',
    ...(signal ? { signal } : {}),
  }), '平台预设加载失败');
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.presets)) {
    throw new Error('平台预设格式无效');
  }
  return payload.presets.filter((item): item is PlatformExportPreset => (
    isRecord(item)
    && item.enabled === true
    && typeof item.id === 'string'
    && Number.isSafeInteger(item.version)
    && typeof item.platform === 'string'
    && typeof item.usage === 'string'
    && typeof item.label === 'string'
    && Number.isSafeInteger(item.width)
    && Number.isSafeInteger(item.height)
    && ['png', 'jpeg', 'webp'].includes(String(item.recommendedFormat))
    && typeof item.supportsTransparency === 'boolean'
  ));
}

export interface ExportPlanPreview {
  fileCount: number;
  totalPixels: number;
  estimatedZipBytes: number;
  creditCost: 0;
}

export function previewMultiPlatformExportPlan(
  sourceCount: number,
  presets: readonly PlatformExportPreset[],
): ExportPlanPreview {
  const fileCount = Math.max(0, sourceCount) * presets.length;
  const totalPixels = Math.max(0, sourceCount) * presets.reduce(
    (sum, preset) => sum + preset.width * preset.height,
    0,
  );
  // ZIP size is an estimate only; file and pixel counts are the exact Task 3 plan matrix.
  const estimatedZipBytes = fileCount === 0 ? 0 : Math.ceil(totalPixels * 0.72 + fileCount * 1_024);
  return { fileCount, totalPixels, estimatedZipBytes, creditCost: 0 };
}

export async function resolveExportAssetReference(input: {
  projectId: string;
  versionId: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<WorkspaceAssetReference> {
  const query = new URLSearchParams({
    projectId: input.projectId,
    assetVersionId: input.versionId,
  });
  const payload = await readJson(await (input.fetcher ?? fetch)(`/api/assets?${query.toString()}`, {
    method: 'GET',
    ...(input.signal ? { signal: input.signal } : {}),
  }), '导出制品加载失败');
  if (!isAssetReference(payload) || payload.assetVersionId !== input.versionId) {
    throw new Error('导出制品格式无效');
  }
  return payload;
}

export async function resolveExportImageReferences(input: {
  projectId: string;
  versionIds: readonly string[];
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<WorkspaceAssetReference[]> {
  return loadCanvasExportImageAssets({
    projectId: input.projectId,
    assetVersionIds: input.versionIds,
    fetcher: input.fetcher,
    signal: input.signal,
  });
}

export async function loadExportManifestFiles(
  result: MultiPlatformExportResultV1,
  projectId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ExportManifestFile[]> {
  if (!result.manifestAssetVersionId) return [];
  const reference = await resolveExportAssetReference({
    projectId,
    versionId: result.manifestAssetVersionId,
    fetcher,
    signal,
  });
  if (reference.kind !== 'document') throw new Error('EXPORT_MANIFEST_ASSET_INVALID');
  const payload = await readJson(await fetcher(reference.url, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  }), 'EXPORT_MANIFEST_LOAD_FAILED');
  if (
    !isRecord(payload)
    || payload.schemaVersion !== 1
    || payload.schemaId !== MULTI_PLATFORM_EXPORT_MANIFEST_SCHEMA_ID
    || payload.runId !== result.runId
  ) {
    throw new Error('EXPORT_MANIFEST_INVALID');
  }
  return buildMultiPlatformExportManifest(
    payload as unknown as MultiPlatformExportManifestV1,
  ).files;
}

export async function downloadExportArtifact(
  versionId: string,
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const reference = await resolveExportAssetReference({ projectId, versionId, fetcher });
  const anchor = document.createElement('a');
  anchor.href = reference.url;
  anchor.download = reference.name || '';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
