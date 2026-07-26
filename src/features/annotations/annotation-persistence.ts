import { migrateLegacyAnnotation } from './annotation-bundle';
import type {
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
    && typeof candidate.geometry === 'object'
    && candidate.geometry !== null
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
