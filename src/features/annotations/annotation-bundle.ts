import {
  isNormalizedRegion,
  normalizeScreenPoint,
  type ScreenRect,
} from './annotation-geometry';
import type {
  CanvasAnnotationV2,
  EditIntentBundle,
  LegacyCanvasAnnotation,
  NormalizedAnnotationGeometry,
} from './annotation-types';

export interface BuildEditIntentBundleOptions {
  prompt?: string;
  modelId?: string;
  providerId?: string;
  idempotencyKey?: string;
  skipGeometryValidation?: boolean;
  now?: number;
}

export type BundleValidationResult =
  | { success: true }
  | {
      success: false;
      code:
        | 'ANNOTATION_COUNT_INVALID'
        | 'ANNOTATION_COMPLEXITY_INVALID'
        | 'ANNOTATION_IDS_INVALID'
        | 'ANNOTATION_SOURCE_MISMATCH'
        | 'ANNOTATION_SOURCE_STALE'
        | 'ANNOTATION_GEOMETRY_INVALID';
      message: string;
    };

const MAX_PROMPT_LENGTH = 4_000;
const MAX_INSTRUCTION_LENGTH = 2_000;
const MAX_LABEL_LENGTH = 200;
const MAX_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_BRUSH_POINTS = 2_048;
const MAX_POLYGON_POINTS = 1_024;
const MAX_TOTAL_GEOMETRY_POINTS = 4_096;

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isPointValid(point: { x: number; y: number }): boolean {
  return (
    Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && point.x >= 0
    && point.x <= 1
    && point.y >= 0
    && point.y <= 1
  );
}

function isGeometryValid(geometry: NormalizedAnnotationGeometry): boolean {
  if (geometry.kind === 'region' || geometry.kind === 'semantic-object') {
    return (
      isNormalizedRegion(geometry.region)
      && (
        geometry.kind !== 'semantic-object'
        || geometry.polygon === undefined
        || geometry.polygon.every(isPointValid)
      )
    );
  }
  if (geometry.kind === 'brush') {
    return (
      geometry.points.length >= 2
      && geometry.points.every(isPointValid)
      && Number.isFinite(geometry.width)
      && geometry.width > 0
      && geometry.width <= 1
    );
  }
  if (geometry.kind === 'arrow') {
    return isPointValid(geometry.start) && isPointValid(geometry.end)
      && (geometry.start.x !== geometry.end.x || geometry.start.y !== geometry.end.y);
  }
  return isPointValid(geometry.point);
}

export function validateEditIntentBundle(
  bundle: EditIntentBundle,
): BundleValidationResult {
  if (bundle.annotations.length < 1 || bundle.annotations.length > 10) {
    return {
      success: false,
      code: 'ANNOTATION_COUNT_INVALID',
      message: '批注数量必须为 1 到 10 条',
    };
  }

  const identifierValues = [
    bundle.id,
    bundle.projectId,
    bundle.sourceImageId,
    bundle.sourceVersionId,
    bundle.modelId,
    bundle.providerId,
    ...bundle.annotationIds,
    ...bundle.annotations.flatMap((annotation) => [
      annotation.id,
      annotation.projectId,
      annotation.sourceImageId,
      annotation.sourceVersionId,
      annotation.maskAssetId || '',
      annotation.overlayAssetId || '',
    ]),
  ];
  const totalGeometryPoints = bundle.annotations.reduce((total, annotation) => {
    const geometry = annotation.geometry;
    if (geometry.kind === 'brush') return total + geometry.points.length;
    if (geometry.kind === 'semantic-object') return total + (geometry.polygon?.length || 0);
    if (geometry.kind === 'arrow') return total + 2;
    return total + 1;
  }, 0);
  const complexityInvalid = (
    bundle.prompt.length > MAX_PROMPT_LENGTH
    || bundle.idempotencyKey.length === 0
    || bundle.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
    || identifierValues.some((value) => value.length > MAX_ID_LENGTH)
    || bundle.annotations.some((annotation) =>
      (annotation.instruction?.length || 0) > MAX_INSTRUCTION_LENGTH
      || (annotation.label?.length || 0) > MAX_LABEL_LENGTH
      || (
        annotation.geometry.kind === 'brush'
        && annotation.geometry.points.length > MAX_BRUSH_POINTS
      )
      || (
        annotation.geometry.kind === 'semantic-object'
        && (annotation.geometry.polygon?.length || 0) > MAX_POLYGON_POINTS
      )
    )
    || totalGeometryPoints > MAX_TOTAL_GEOMETRY_POINTS
  );
  if (complexityInvalid) {
    return {
      success: false,
      code: 'ANNOTATION_COMPLEXITY_INVALID',
      message: 'Annotation request exceeds the supported complexity limits',
    };
  }

  const hasInvalidSourceIdentity = (
    !bundle.projectId.trim()
    || !bundle.sourceImageId.trim()
    || !bundle.sourceVersionId.trim()
    || bundle.annotations.some((annotation) =>
      !annotation.projectId.trim()
      || !annotation.sourceImageId.trim()
      || !annotation.sourceVersionId.trim()
    )
  );
  if (hasInvalidSourceIdentity) {
    return {
      success: false,
      code: 'ANNOTATION_SOURCE_MISMATCH',
      message: 'Annotation source identity must not be empty',
    };
  }

  const sourceMismatch = bundle.annotations.some((annotation) =>
    annotation.projectId !== bundle.projectId
    || annotation.sourceImageId !== bundle.sourceImageId
    || annotation.sourceVersionId !== bundle.sourceVersionId
  );
  if (sourceMismatch) {
    return {
      success: false,
      code: 'ANNOTATION_SOURCE_MISMATCH',
      message: '批注来源图片或版本不一致',
    };
  }

  const annotationIds = bundle.annotations.map((annotation) => annotation.id);
  const hasInvalidAnnotationIds = (
    annotationIds.some((id) => !id.trim())
    || bundle.annotationIds.some((id) => !id.trim())
    || new Set(annotationIds).size !== annotationIds.length
    || new Set(bundle.annotationIds).size !== bundle.annotationIds.length
    || bundle.annotationIds.length !== annotationIds.length
    || bundle.annotationIds.some((id, index) => id !== annotationIds[index])
  );
  if (hasInvalidAnnotationIds) {
    return {
      success: false,
      code: 'ANNOTATION_IDS_INVALID',
      message: 'Annotation IDs must uniquely match annotations',
    };
  }

  if (bundle.annotations.some((annotation) => annotation.status === 'stale')) {
    return {
      success: false,
      code: 'ANNOTATION_SOURCE_STALE',
      message: '来源图片已变化，请重新确认批注',
    };
  }

  if (bundle.annotations.some((annotation) =>
    annotation.type !== annotation.geometry.kind
    || !isGeometryValid(annotation.geometry)
  )) {
    return {
      success: false,
      code: 'ANNOTATION_GEOMETRY_INVALID',
      message: '批注空间数据无效',
    };
  }

  return { success: true };
}

export function buildEditIntentBundle(
  annotations: CanvasAnnotationV2[],
  options: BuildEditIntentBundleOptions = {},
): EditIntentBundle {
  if (annotations.length === 0) {
    throw new Error('至少需要 1 条批注');
  }
  if (annotations.length > 10) {
    throw new Error('最多支持 10 条批注');
  }

  const first = annotations[0];
  if (annotations.some((annotation) => annotation.projectId !== first.projectId)) {
    throw new Error('批注所属项目不一致');
  }
  if (annotations.some((annotation) => annotation.sourceImageId !== first.sourceImageId)) {
    throw new Error('批注来源图片不一致');
  }
  if (annotations.some((annotation) => annotation.sourceVersionId !== first.sourceVersionId)) {
    throw new Error('批注来源版本不一致');
  }

  const now = options.now ?? Date.now();
  const bundle: EditIntentBundle = {
    id: makeId('annotation_bundle'),
    projectId: first.projectId,
    sourceImageId: first.sourceImageId,
    sourceVersionId: first.sourceVersionId,
    annotationIds: annotations.map((annotation) => annotation.id),
    annotations: annotations.map((annotation) => ({ ...annotation })),
    prompt: options.prompt?.trim() ?? '',
    modelId: options.modelId ?? '',
    providerId: options.providerId ?? '',
    idempotencyKey: options.idempotencyKey ?? makeId('annotation_request'),
    createdAt: now,
  };

  if (!options.skipGeometryValidation) {
    const validation = validateEditIntentBundle(bundle);
    if (!validation.success) throw new Error(validation.message);
  }

  return bundle;
}

export function migrateLegacyAnnotation(
  annotation: LegacyCanvasAnnotation,
  options: {
    projectId: string;
    sourceVersionId?: string;
    sourceImageBounds?: ScreenRect;
    now?: number;
  },
): CanvasAnnotationV2 {
  const now = options.now ?? Date.now();
  const sourceVersionId = options.sourceVersionId ?? 'legacy-unversioned';
  const sourceImageId = annotation.targetImageId?.trim() ?? '';
  let geometry: NormalizedAnnotationGeometry;
  let hasResolvedGeometry = false;

  if (annotation.brushMaskDataUrl) {
    geometry = {
      kind: 'brush',
      points: [],
      width: 0.02,
    };
  } else if (annotation.region) {
    geometry = {
      kind: 'region',
      region: { ...annotation.region },
    };
    hasResolvedGeometry = isNormalizedRegion(annotation.region);
  } else if (options.sourceImageBounds) {
    const bounds = options.sourceImageBounds;
    const hasValidBounds = (
      Number.isFinite(bounds.x)
      && Number.isFinite(bounds.y)
      && Number.isFinite(bounds.width)
      && Number.isFinite(bounds.height)
      && bounds.width > 0
      && bounds.height > 0
    );
    const isInsideSourceImage = (
      hasValidBounds
      && Number.isFinite(annotation.x)
      && Number.isFinite(annotation.y)
      && annotation.x >= bounds.x
      && annotation.x <= bounds.x + bounds.width
      && annotation.y >= bounds.y
      && annotation.y <= bounds.y + bounds.height
    );

    geometry = {
      kind: 'text',
      point: isInsideSourceImage
        ? normalizeScreenPoint(annotation, bounds)
        : { x: -1, y: -1 },
    };
    hasResolvedGeometry = isInsideSourceImage;
  } else {
    geometry = {
      kind: 'text',
      point: { x: -1, y: -1 },
    };
  }

  const status = (
    options.projectId.trim()
    && sourceImageId
    && options.sourceVersionId?.trim()
    && hasResolvedGeometry
  )
    ? 'ready'
    : 'stale';

  return {
    id: annotation.id,
    projectId: options.projectId,
    sourceImageId,
    sourceVersionId,
    type: annotation.brushMaskDataUrl ? 'brush' : annotation.region ? 'region' : 'text',
    geometry,
    instruction: annotation.text,
    status,
    createdAt: annotation.createdAt,
    updatedAt: now,
  };
}
