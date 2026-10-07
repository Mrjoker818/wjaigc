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
import JSZip from 'jszip';
import { loadCanvasExportImageAssets, resolveCanvasSkillAssets, resolveCanvasSkillSources } from './canvas-client';

const RESULT_SCHEMA_ID = 'multi-platform-export-result-v1';
const DEFAULT_EXPORT_BACKGROUND = '#ffffffff';
const DEFAULT_EXPORT_NAMING_TEMPLATE = '{project}-{asset}-{platform}-{size}-{index}';

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

export function createMultiPlatformExportRequestFingerprint(input: {
  projectId: string;
  sourceAssetVersionIds: readonly string[];
  values: Record<string, unknown>;
}): string {
  const targetPresetIds = Array.isArray(input.values.targetPresetIds)
    ? input.values.targetPresetIds.filter((value): value is string => typeof value === 'string')
    : [];
  return JSON.stringify({
    schemaVersion: 1,
    projectId: input.projectId,
    sourceAssetVersionIds: input.sourceAssetVersionIds.filter(value => typeof value === 'string'),
    targetPresetIds,
    fit: input.values.fit === 'contain' ? 'contain' : 'cover',
    background: typeof input.values.background === 'string'
      ? input.values.background
      : DEFAULT_EXPORT_BACKGROUND,
    namingTemplate: typeof input.values.namingTemplate === 'string'
      ? input.values.namingTemplate
      : DEFAULT_EXPORT_NAMING_TEMPLATE,
  });
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
  runId?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<WorkspaceAssetReference> {
  if(input.runId) return (await resolveCanvasSkillAssets({...input,runId:input.runId,assetVersionIds:[input.versionId]}))[0];
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

export async function resolveExportSourceReference(input: {
  projectId: string; runId: string; versionId: string; authority: 'document' | 'legacy' | 'pending';
  expectedActorId?: string; fetcher?: typeof fetch; signal?: AbortSignal;
}): Promise<WorkspaceAssetReference> {
  input.signal?.throwIfAborted();
  if (input.authority === 'pending') throw new Error('画布权威尚未就绪');
  const reference = input.authority === 'document'
    ? (await resolveCanvasSkillSources({ ...input, assetVersionIds: [input.versionId] }))[0]
    : await resolveExportAssetReference({ projectId: input.projectId, versionId: input.versionId, fetcher: input.fetcher, signal: input.signal });
  input.signal?.throwIfAborted();
  return reference;
}

export async function resolveExportImageReferences(input: {
  projectId: string;
  versionIds: readonly string[];
  runId?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<WorkspaceAssetReference[]> {
  return loadCanvasExportImageAssets({
    projectId: input.projectId,
    assetVersionIds: input.versionIds,
    runId: input.runId,
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
    runId: result.runId,
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
  runId?: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const reference = await resolveExportAssetReference({ projectId, versionId, fetcher,runId,signal });
  signal?.throwIfAborted();
  const response = await fetcher(reference.url, { method: 'GET', credentials: 'same-origin',signal });
  if (!response.ok) throw new Error(`导出制品下载失败 (${response.status})`);
  const blob=await response.blob();signal?.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  const encodedFilename = new URL(reference.url, window.location.href).pathname.split('/').filter(Boolean).at(-1) || '';
  let fallbackFilename = encodedFilename;
  try {
    fallbackFilename = decodeURIComponent(encodedFilename);
  } catch {
    // Keep the encoded basename when a legacy URL contains malformed escapes.
  }
  anchor.download = reference.name?.trim() || fallbackFilename || `export-${versionId}`;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }, 30_000);
}

const MAX_GROUP_FILES = 100;
// JSZip holds source blobs and the generated archive concurrently in the browser.
const MAX_GROUP_BYTES = 64 * 1_048_576;

export async function downloadExportGroup(input: {
  platform: string;
  projectId: string;
  runId?: string;
  references: readonly WorkspaceAssetReference[];
  files: readonly ExportManifestFile[];
  fetcher?: typeof fetch;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  input.signal?.throwIfAborted();
  if (input.references.length < 1 || input.references.length > MAX_GROUP_FILES) {
    throw new Error('EXPORT_GROUP_FILE_LIMIT');
  }
  const fetcher = input.fetcher ?? fetch;
  const fileByVersionId = new Map(input.files.map(file => [file.derivedAssetVersionId, file]));
  const zip = new JSZip();
  let totalBytes = 0;
  for (let index = 0; index < input.references.length; index += 1) {
    const reference = input.references[index];
    const versionId = reference.assetVersionId;
    const file = versionId ? fileByVersionId.get(versionId) : undefined;
    if (!versionId || reference.kind !== 'image' || !file || file.platform !== input.platform) {
      throw new Error('EXPORT_GROUP_REFERENCE_INVALID');
    }
    const stableReference = await resolveExportAssetReference({
      projectId: input.projectId,
      versionId,
      fetcher,
      runId:input.runId,
      signal:input.signal,
    });
    input.signal?.throwIfAborted();
    if (stableReference.kind !== 'image') throw new Error('EXPORT_GROUP_REFERENCE_INVALID');
    const response = await fetcher(stableReference.url, { method: 'GET', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`导出图片下载失败 (${response.status})`);
    const contentLength = Number(response.headers.get('Content-Length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_GROUP_BYTES - totalBytes) {
      throw new Error('EXPORT_GROUP_BYTE_LIMIT');
    }
    const blob = await response.blob();
    input.signal?.throwIfAborted();
    totalBytes += blob.size;
    if (totalBytes > MAX_GROUP_BYTES) throw new Error('EXPORT_GROUP_BYTE_LIMIT');
    zip.file(file.filename, blob);
    input.onProgress?.(Math.round(((index + 1) / (input.references.length + 1)) * 100));
  }
  const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, metadata => {
    input.signal?.throwIfAborted();
    const fileProgress = input.references.length / (input.references.length + 1) * 100;
    input.onProgress?.(Math.min(99, Math.round(fileProgress + metadata.percent / (input.references.length + 1))));
  });
  input.signal?.throwIfAborted();
  const objectUrl = URL.createObjectURL(archive);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${input.platform || 'platform'}-export.zip`;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  input.onProgress?.(100);
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }, 0);
}
