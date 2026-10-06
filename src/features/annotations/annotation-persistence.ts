import { migrateLegacyAnnotation } from './annotation-bundle';
import { isNormalizedRegion } from './annotation-geometry';
import type {
  AnnotationRegion,
  AnnotationStatus,
  CanvasAnnotationV2,
  LegacyCanvasAnnotation,
  NormalizedAnnotationGeometry,
} from './annotation-types';

export interface AnnotationSourceSnapshot {
  imageId: string;
  versionId: string;
  url: string;
}

export interface RestoreAnnotationsOptions {
  projectId: string;
  sources: AnnotationSourceSnapshot[];
  now?: number;
}

const ANNOTATION_TYPES = new Set([
  'semantic-object',
  'region',
  'brush',
  'arrow',
  'text',
]);

const ANNOTATION_STATUSES = new Set<AnnotationStatus>([
  'draft',
  'ready',
  'stale',
  'running',
  'done',
  'failed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNormalizedPoint(value: unknown): boolean {
  return isRecord(value)
    && typeof value.x === 'number' && Number.isFinite(value.x)
    && typeof value.y === 'number' && Number.isFinite(value.y)
    && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;
}

function isPointArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (const point of value) {
    if (!isNormalizedPoint(point)) return false;
  }
  return true;
}

function isRestorableGeometry(value: unknown, type: string, status: unknown): boolean {
  if (!isRecord(value) || value.kind !== type) return false;
  switch (value.kind) {
    case 'brush':
      // Draft gestures may have only one point; restoration is not execution.
      return isPointArray(value.points)
        && typeof value.width === 'number' && Number.isFinite(value.width)
        && value.width > 0 && value.width <= 1;
    case 'arrow':
      return isNormalizedPoint(value.start) && isNormalizedPoint(value.end);
    case 'text':
      // Legacy migration uses this exact stale sentinel until bounds are known.
      return isNormalizedPoint(value.point)
        || (status === 'stale' && isRecord(value.point)
          && value.point.x === -1 && value.point.y === -1);
    case 'region':
    case 'semantic-object': {
      const region = value.region;
      if (!isRecord(region)
        || typeof region.x !== 'number' || typeof region.y !== 'number'
        || typeof region.w !== 'number' || typeof region.h !== 'number'
        || !isNormalizedRegion(region as unknown as AnnotationRegion)) return false;
      return value.kind === 'region' || value.polygon === undefined
        || isPointArray(value.polygon);
    }
    default:
      return false;
  }
}

function cloneGeometry(
  geometry: NormalizedAnnotationGeometry,
): NormalizedAnnotationGeometry {
  if (geometry.kind === 'brush') {
    return {
      ...geometry,
      points: geometry.points.map((point) => ({ ...point })),
    };
  }
  if (geometry.kind === 'arrow') {
    return {
      ...geometry,
      start: { ...geometry.start },
      end: { ...geometry.end },
    };
  }
  if (geometry.kind === 'text') {
    return {
      ...geometry,
      point: { ...geometry.point },
    };
  }
  return {
    ...geometry,
    region: { ...geometry.region },
    ...(
      geometry.kind === 'semantic-object' && geometry.polygon
        ? { polygon: geometry.polygon.map((point) => ({ ...point })) }
        : {}
    ),
  };
}

function cloneAnnotation(annotation: CanvasAnnotationV2): CanvasAnnotationV2 {
  return {
    ...annotation,
    geometry: cloneGeometry(annotation.geometry),
  };
}

function isTemporaryAssetReference(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('data:') || normalized.startsWith('blob:');
}

function isCanvasAnnotationV2(value: unknown): value is CanvasAnnotationV2 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CanvasAnnotationV2>;
  return (
    typeof candidate.id === 'string'
    && typeof candidate.projectId === 'string'
    && typeof candidate.sourceImageId === 'string'
    && typeof candidate.sourceVersionId === 'string'
    && typeof candidate.type === 'string'
    && ANNOTATION_TYPES.has(candidate.type)
    && isRestorableGeometry(candidate.geometry, candidate.type, candidate.status)
    && typeof candidate.status === 'string'
    && ANNOTATION_STATUSES.has(candidate.status as AnnotationStatus)
    && typeof candidate.createdAt === 'number'
    && typeof candidate.updatedAt === 'number'
  );
}

function isLegacyCanvasAnnotation(value: unknown): value is LegacyCanvasAnnotation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LegacyCanvasAnnotation>;
  return (
    typeof candidate.id === 'string'
    && typeof candidate.x === 'number'
    && typeof candidate.y === 'number'
    && typeof candidate.text === 'string'
    && (
      typeof candidate.targetImageId === 'string'
      || candidate.targetImageId === null
    )
    && typeof candidate.createdAt === 'number'
  );
}

function isSpatialAnnotation(annotation: CanvasAnnotationV2): boolean {
  return annotation.type !== 'text';
}

export function serializeAnnotations(
  annotations: CanvasAnnotationV2[],
): CanvasAnnotationV2[] {
  return annotations.map((annotation) => {
    const serialized = cloneAnnotation(annotation);
    // JSON used to omit these absent UI values, but Yjs preserves own keys
    // with undefined values. Keep the strict document contract unchanged.
    // orderKey is deliberately excluded: a malformed frozen identity must fail.
    for (const field of ['label', 'instruction', 'confidence', 'maskAssetId', 'overlayAssetId'] as const) {
      if (serialized[field] === undefined) delete serialized[field];
    }
    if (isTemporaryAssetReference(serialized.maskAssetId)) {
      delete serialized.maskAssetId;
    }
    if (isTemporaryAssetReference(serialized.overlayAssetId)) {
      delete serialized.overlayAssetId;
    }
    return serialized;
  });
}

export function markStaleAnnotations(
  annotations: CanvasAnnotationV2[],
  sources: AnnotationSourceSnapshot[],
): CanvasAnnotationV2[] {
  const sourceById = new Map(
    sources.map((source) => [source.imageId, source]),
  );

  return annotations
    .filter((annotation) => sourceById.has(annotation.sourceImageId))
    .map((annotation) => {
      const source = sourceById.get(annotation.sourceImageId);
      if (
        source
        && source.versionId !== annotation.sourceVersionId
        && isSpatialAnnotation(annotation)
      ) {
        return {
          ...cloneAnnotation(annotation),
          status: 'stale',
        };
      }
      return cloneAnnotation(annotation);
    });
}

export function restoreAnnotations(
  records: unknown,
  options: RestoreAnnotationsOptions,
): CanvasAnnotationV2[] {
  if (!Array.isArray(records)) return [];

  const sourceById = new Map(
    options.sources.map((source) => [source.imageId, source]),
  );
  const restored: CanvasAnnotationV2[] = [];

  for (const record of records) {
    if (isCanvasAnnotationV2(record)) {
      if (
        record.projectId !== options.projectId
        || !sourceById.has(record.sourceImageId)
      ) {
        continue;
      }
      restored.push(cloneAnnotation(record));
      continue;
    }

    if (!isLegacyCanvasAnnotation(record) || !record.targetImageId) continue;
    const source = sourceById.get(record.targetImageId);
    if (!source) continue;
    restored.push(migrateLegacyAnnotation(record, {
      projectId: options.projectId,
      sourceVersionId: source.versionId,
      now: options.now,
    }));
  }

  return markStaleAnnotations(restored, options.sources);
}
