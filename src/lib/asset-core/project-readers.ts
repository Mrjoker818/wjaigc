import type { CanvasImage, Project } from '@/lib/user-types';

import type { MediaAvailability } from './types';

export type ProjectSchemaVersion = 1 | 2 | 3;

export type ProjectReadWarningCode =
  | 'PROJECT_V2_TRANSITIONAL'
  | 'PROJECT_QUARANTINED';

export interface ProjectReadWarning {
  code: ProjectReadWarningCode;
  message: string;
  severity: 'warning' | 'error';
}

export interface UnresolvedProjectMedia {
  imageId: string;
  url: string;
  availability: Extract<MediaAvailability, 'pending-persist' | 'missing'>;
  recoverySourceUrl?: string;
}

export interface ProjectReadResult {
  project: Project | null;
  sourceSchemaVersion: ProjectSchemaVersion | null;
  writeTargetVersion: 3;
  warnings: ProjectReadWarning[];
  unresolvedMedia: UnresolvedProjectMedia[];
}

export interface ProjectionComparisonInput {
  legacy: unknown;
  assetProjection: unknown;
}

export interface ProjectionComparison {
  matches: boolean;
  differences: string[];
}

const AUDIT_FIELDS = new Set(['legacyAudit', 'legacyAuditPayload']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) throw new Error('Circular project snapshot');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => cloneValue(item, ancestors));
    }
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneValue(item, ancestors);
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

function schemaVersionOf(raw: Record<string, unknown>): ProjectSchemaVersion | null {
  if (!Object.hasOwn(raw, 'schemaVersion')) return 1;
  return raw.schemaVersion === 1 || raw.schemaVersion === 2 || raw.schemaVersion === 3
    ? raw.schemaVersion
    : null;
}

function normalizeLegacyUploadUrl(value: string): string {
  if (!value.startsWith('/uploads/')) return value;
  return `/api/serve-upload/uploads/${value.slice('/uploads/'.length)}`;
}

function normalizeReturnedUrls(value: unknown, fieldName?: string): unknown {
  if (typeof value === 'string') {
    return fieldName === 'sourceUrl' ? value : normalizeLegacyUploadUrl(value);
  }
  if (Array.isArray(value)) return value.map((item) => normalizeReturnedUrls(item));
  if (!isRecord(value)) return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    normalized[key] = AUDIT_FIELDS.has(key)
      ? item
      : normalizeReturnedUrls(item, key);
  }
  return normalized;
}

function quarantine(
  sourceSchemaVersion: ProjectSchemaVersion | null,
  message: string,
): ProjectReadResult {
  return {
    project: null,
    sourceSchemaVersion,
    writeTargetVersion: 3,
    warnings: [{ code: 'PROJECT_QUARANTINED', message, severity: 'error' }],
    unresolvedMedia: [],
  };
}

function availabilityFor(image: CanvasImage): MediaAvailability {
  if (image.url.startsWith('data:')) return 'pending-persist';
  if (image.url.startsWith('blob:') || image.url.length === 0) return 'missing';
  return image.mediaAvailability ?? 'ready';
}

function prepareImages(
  images: unknown[],
): { images: CanvasImage[]; unresolvedMedia: UnresolvedProjectMedia[] } | null {
  const projected: CanvasImage[] = [];
  const unresolvedMedia: UnresolvedProjectMedia[] = [];
  const imageIds = new Set<string>();

  for (const value of images) {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.url !== 'string') return null;
    if (imageIds.has(value.id)) return null;
    imageIds.add(value.id);

    const image = value as unknown as CanvasImage;
    const availability = availabilityFor(image);
    const marked: CanvasImage = {
      ...image,
      mediaAvailability: availability,
      ...(availability === 'pending-persist' ? { _pendingPersist: true } : {}),
    };
    projected.push(marked);
    if (availability === 'pending-persist' || availability === 'missing') {
      unresolvedMedia.push({
        imageId: image.id,
        url: image.url,
        availability,
        ...(image.sourceUrl ? { recoverySourceUrl: image.sourceUrl } : {}),
      });
    }
  }

  return { images: projected, unresolvedMedia };
}

export function readProjectSnapshot(raw: unknown): ProjectReadResult {
  if (!isRecord(raw)) return quarantine(null, 'Project snapshot is not an object');
  const sourceSchemaVersion = schemaVersionOf(raw);
  if (sourceSchemaVersion === null) return quarantine(null, 'Project schemaVersion is unsupported');

  let cloned: Record<string, unknown>;
  try {
    cloned = normalizeReturnedUrls(cloneValue(raw)) as Record<string, unknown>;
  } catch {
    return quarantine(sourceSchemaVersion, 'Project snapshot cannot be cloned safely');
  }

  const candidateImages = sourceSchemaVersion === 3
    ? cloned.canvasImages
    : cloned.canvasImages ?? cloned.images;
  if (!Array.isArray(candidateImages)) {
    return quarantine(sourceSchemaVersion, 'Project canvas image collection is missing or invalid');
  }
  if (typeof cloned.id !== 'string' || cloned.id.length === 0) {
    return quarantine(sourceSchemaVersion, 'Project id is missing or invalid');
  }

  const prepared = prepareImages(candidateImages);
  if (!prepared) return quarantine(sourceSchemaVersion, 'Project contains an invalid canvas placement');

  const project = {
    ...cloned,
    canvasImages: prepared.images,
    settings: isRecord(cloned.settings) ? cloned.settings : {},
  } as unknown as Project;
  return {
    project,
    sourceSchemaVersion,
    writeTargetVersion: 3,
    warnings: sourceSchemaVersion === 2
      ? [{
          code: 'PROJECT_V2_TRANSITIONAL',
          message: 'Project was read through the transitional v2 compatibility reader',
          severity: 'warning',
        }]
      : [],
    unresolvedMedia: prepared.unresolvedMedia,
  };
}

function comparableProject(project: Project): Record<string, unknown> {
  const record = project as unknown as Record<string, unknown>;
  const comparable: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'schemaVersion' || key === 'images' || AUDIT_FIELDS.has(key)) continue;
    comparable[key] = value;
  }
  return comparable;
}

export function compareLegacyAndAssetProjection(
  input: ProjectionComparisonInput,
): ProjectionComparison {
  const legacy = readProjectSnapshot(input.legacy);
  const asset = readProjectSnapshot(input.assetProjection);
  const differences: string[] = [];

  if (!legacy.project) differences.push('legacy:quarantined');
  if (!asset.project) differences.push('assetProjection:quarantined');
  if (legacy.project && asset.project) {
    const legacyJson = JSON.stringify(comparableProject(legacy.project));
    const assetJson = JSON.stringify(comparableProject(asset.project));
    if (legacyJson !== assetJson) differences.push('project:projection-mismatch');
  }

  return { matches: differences.length === 0, differences };
}
