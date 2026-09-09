export const MULTI_PLATFORM_EXPORT_MANIFEST_SCHEMA_ID = 'multi-platform-export-manifest-v1';
export const MULTI_PLATFORM_EXPORT_RESULT_SCHEMA_ID = 'multi-platform-export-result-v1';

export interface ExportManifestFile {
  filename: string;
  sourceAssetVersionId: string;
  derivedAssetVersionId: string;
  platform: string;
  usage: string;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteSize: number;
  sha256: string;
}

export interface ExportFailure {
  sourceAssetVersionId: string;
  code: string;
  retryable: boolean;
  presetId?: string;
  presetVersion?: number;
  outputFilename?: string;
}

export interface MultiPlatformExportManifestV1 {
  schemaVersion: 1;
  schemaId: typeof MULTI_PLATFORM_EXPORT_MANIFEST_SCHEMA_ID;
  runId: string;
  requestDigest: string;
  createdAt: string;
  frozenParameters: Record<string, unknown>;
  files: ExportManifestFile[];
  failures: ExportFailure[];
}

export interface MultiPlatformExportResultV1 {
  schemaVersion: 1;
  runId: string;
  outcome: 'completed' | 'partial_success';
  imageAssetVersionIds: string[];
  manifestAssetVersionId: string;
  zipAssetVersionId: string;
  failures: ExportFailure[];
}

const FLAT_FILENAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,199}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;

function fail(code: string): never { throw new TypeError(code); }
function order(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function string(value: unknown, code: string, maximum = 256): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}
export function assertFlatExportFilename(value: unknown): string {
  const filename = string(value, 'EXPORT_ARCHIVE_FILENAME_INVALID', 200).normalize('NFC');
  if (filename !== value || !FLAT_FILENAME.test(filename) || filename.includes('/') || filename.includes('\\') || /[. ]$/u.test(filename)) {
    fail('EXPORT_ARCHIVE_FILENAME_INVALID');
  }
  return filename;
}
function positiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(code);
  return value as number;
}
function normalizeFailure(value: ExportFailure): ExportFailure {
  const failure: ExportFailure = {
    sourceAssetVersionId: string(value.sourceAssetVersionId, 'EXPORT_MANIFEST_INVALID'),
    code: string(value.code, 'EXPORT_MANIFEST_INVALID', 64),
    retryable: value.retryable,
  };
  if (!CODE.test(failure.code) || typeof value.retryable !== 'boolean') fail('EXPORT_MANIFEST_INVALID');
  if (value.presetId !== undefined) failure.presetId = string(value.presetId, 'EXPORT_MANIFEST_INVALID');
  if (value.presetVersion !== undefined) failure.presetVersion = positiveInteger(value.presetVersion, 'EXPORT_MANIFEST_INVALID');
  if (value.outputFilename !== undefined) failure.outputFilename = assertFlatExportFilename(value.outputFilename);
  return failure;
}

export function buildMultiPlatformExportManifest(input: Omit<MultiPlatformExportManifestV1, 'schemaVersion' | 'schemaId'>): MultiPlatformExportManifestV1 {
  if (!DIGEST.test(input.requestDigest) || !Number.isFinite(Date.parse(input.createdAt))) fail('EXPORT_MANIFEST_INVALID');
  const names = new Set<string>();
  const files = input.files.map(file => {
    const filename = assertFlatExportFilename(file.filename);
    const key = filename.toLocaleLowerCase('en-US');
    if (names.has(key)) fail('EXPORT_ARCHIVE_FILENAME_DUPLICATE');
    names.add(key);
    const rawDigest = file.sha256.startsWith('sha256:') ? file.sha256.slice(7) : file.sha256;
    if (!DIGEST.test(rawDigest) || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)) fail('EXPORT_MANIFEST_INVALID');
    return {
      filename,
      sourceAssetVersionId: string(file.sourceAssetVersionId, 'EXPORT_MANIFEST_INVALID'),
      derivedAssetVersionId: string(file.derivedAssetVersionId, 'EXPORT_MANIFEST_INVALID'),
      platform: string(file.platform, 'EXPORT_MANIFEST_INVALID'),
      usage: string(file.usage, 'EXPORT_MANIFEST_INVALID'),
      width: positiveInteger(file.width, 'EXPORT_MANIFEST_INVALID'),
      height: positiveInteger(file.height, 'EXPORT_MANIFEST_INVALID'),
      mimeType: file.mimeType,
      byteSize: positiveInteger(file.byteSize, 'EXPORT_MANIFEST_INVALID'),
      sha256: `sha256:${rawDigest}`,
    };
  }).sort((left, right) => order(left.filename, right.filename));
  const failures = input.failures.map(normalizeFailure).sort((left, right) => (
    order(left.sourceAssetVersionId, right.sourceAssetVersionId)
    || order(left.presetId ?? '', right.presetId ?? '')
    || ((left.presetVersion ?? 0) - (right.presetVersion ?? 0))
    || order(left.code, right.code)
  ));
  return {
    schemaVersion: 1,
    schemaId: MULTI_PLATFORM_EXPORT_MANIFEST_SCHEMA_ID,
    runId: string(input.runId, 'EXPORT_MANIFEST_INVALID'),
    requestDigest: input.requestDigest,
    createdAt: input.createdAt,
    frozenParameters: JSON.parse(JSON.stringify(input.frozenParameters)) as Record<string, unknown>,
    files,
    failures,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort(order).map(key => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  fail('EXPORT_MANIFEST_INVALID');
}

export function canonicalMultiPlatformExportManifestJson(value: MultiPlatformExportManifestV1): string {
  const normalized = buildMultiPlatformExportManifest(value);
  return JSON.stringify(canonicalize(normalized));
}

export function parseMultiPlatformExportResult(value: unknown): MultiPlatformExportResultV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('EXPORT_RESULT_SCHEMA_INVALID');
  const record = value as Record<string, unknown>;
  const allowed = new Set(['schemaVersion', 'runId', 'outcome', 'imageAssetVersionIds', 'manifestAssetVersionId', 'zipAssetVersionId', 'failures']);
  if (Object.keys(record).some(key => !allowed.has(key)) || record.schemaVersion !== 1) fail('EXPORT_RESULT_SCHEMA_INVALID');
  if (record.outcome !== 'completed' && record.outcome !== 'partial_success') fail('EXPORT_RESULT_SCHEMA_INVALID');
  if (!Array.isArray(record.imageAssetVersionIds) || record.imageAssetVersionIds.some(id => typeof id !== 'string')) fail('EXPORT_RESULT_SCHEMA_INVALID');
  const failures = Array.isArray(record.failures) ? record.failures.map(item => normalizeFailure(item as ExportFailure)) : fail('EXPORT_RESULT_SCHEMA_INVALID');
  if (
    (record.outcome === 'completed' && failures.length !== 0)
    || (record.outcome === 'partial_success' && failures.length === 0)
  ) fail('EXPORT_RESULT_SCHEMA_INVALID');
  return {
    schemaVersion: 1,
    runId: string(record.runId, 'EXPORT_RESULT_SCHEMA_INVALID'),
    outcome: record.outcome,
    imageAssetVersionIds: [...new Set(record.imageAssetVersionIds.map(id => string(id, 'EXPORT_RESULT_SCHEMA_INVALID')))].sort(order),
    manifestAssetVersionId: string(record.manifestAssetVersionId, 'EXPORT_RESULT_SCHEMA_INVALID'),
    zipAssetVersionId: string(record.zipAssetVersionId, 'EXPORT_RESULT_SCHEMA_INVALID'),
    failures: failures.sort((a, b) => order(a.sourceAssetVersionId, b.sourceAssetVersionId) || order(a.code, b.code)),
  };
}

export function canonicalMultiPlatformExportResultJson(value: unknown): string {
  return JSON.stringify(parseMultiPlatformExportResult(value));
}
