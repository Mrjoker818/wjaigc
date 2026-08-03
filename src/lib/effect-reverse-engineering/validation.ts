import type {
  EffectReverseRegion,
  EffectReverseRegionKind,
  EffectReverseSessionInput,
  NormalizedPoint,
  NormalizedQuad,
} from './types';

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_REGIONS = 80;
const MIN_REGION_POINTS = 3;
const MAX_REGION_POINTS = 128;
const MAX_LABEL_LENGTH = 120;
const MAX_INSTRUCTION_LENGTH = 4_000;
const MAX_IDENTIFIER_LENGTH = 160;
const MANAGED_SOURCE_PREFIXES = [
  '/api/serve-upload/',
  '/api/media/',
  '/uploads/',
];
const REGION_KINDS = new Set<EffectReverseRegionKind>([
  'wall',
  'floor',
  'ceiling',
  'object',
  'text',
  'material',
  'custom',
]);

export class EffectReverseValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EffectReverseValidationError';
  }
}

function assertString(
  value: unknown,
  field: string,
  maximumLength: number,
  allowEmpty = false,
): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new EffectReverseValidationError(
      'EFFECT_REVERSE_FIELD_INVALID',
      `${field} must be a non-empty string`,
    );
  }
  if (value.length > maximumLength) {
    throw new EffectReverseValidationError(
      'EFFECT_REVERSE_FIELD_TOO_LONG',
      `${field} must not exceed ${maximumLength} characters`,
    );
  }
}

export function assertNormalizedPoint(point: NormalizedPoint): void {
  if (!point || typeof point !== 'object' ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new EffectReverseValidationError(
      'EFFECT_REVERSE_POINT_INVALID',
      'Point must contain normalized coordinates between 0 and 1',
    );
  }
}

export function normalizePerspectivePoints(value: unknown): NormalizedQuad {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new EffectReverseValidationError(
      'EFFECT_REVERSE_PERSPECTIVE_INVALID',
      'Perspective must contain exactly four points',
    );
  }

  value.forEach((point) => assertNormalizedPoint(point as NormalizedPoint));
  return value.map((point) => ({
    x: (point as NormalizedPoint).x,
    y: (point as NormalizedPoint).y,
  })) as NormalizedQuad;
}

function assertManagedSource(imageUrl: unknown): asserts imageUrl is string {
  assertString(imageUrl, 'imageUrl', 2_048);
  const normalized = imageUrl.trim();
  if (normalized.startsWith('data:') || normalized.startsWith('blob:') ||
      !MANAGED_SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new EffectReverseValidationError(
      'EFFECT_REVERSE_SOURCE_INVALID',
      'Source image must use a managed media path',
    );
  }
}

function assertRegion(region: EffectReverseRegion, index: number): void {
  if (!region || typeof region !== 'object') {
    throw new EffectReverseValidationError('EFFECT_REVERSE_REGION_INVALID', `Region ${index} is invalid`);
  }
  assertString(region.id, `regions[${index}].id`, MAX_IDENTIFIER_LENGTH);
  assertString(region.label, `regions[${index}].label`, MAX_LABEL_LENGTH, true);
  if (!REGION_KINDS.has(region.kind)) {
    throw new EffectReverseValidationError(
      'EFFECT_REVERSE_REGION_KIND_INVALID',
      `Region ${index} has an unsupported kind`,
    );
  }
  if (!Array.isArray(region.points) ||
      region.points.length < MIN_REGION_POINTS ||
      region.points.length > MAX_REGION_POINTS) {
    throw new EffectReverseValidationError(
      'EFFECT_REVERSE_REGION_POINTS_INVALID',
      `Region points must contain between ${MIN_REGION_POINTS} and ${MAX_REGION_POINTS} points`,
    );
  }
  region.points.forEach(assertNormalizedPoint);
  for (const field of ['visible', 'locked', 'inferred'] as const) {
    if (typeof region[field] !== 'boolean') {
      throw new EffectReverseValidationError(
        'EFFECT_REVERSE_REGION_INVALID',
        `regions[${index}].${field} must be boolean`,
      );
    }
  }
}

export function validateEffectReverseSessionInput(input: EffectReverseSessionInput): EffectReverseSessionInput {
  if (!input || typeof input !== 'object') {
    throw new EffectReverseValidationError('EFFECT_REVERSE_REQUEST_INVALID', 'Request body is required');
  }

  const requestBytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (requestBytes > MAX_REQUEST_BYTES) {
    throw new EffectReverseValidationError(
      'EFFECT_REVERSE_REQUEST_TOO_LARGE',
      `Request body must not exceed ${MAX_REQUEST_BYTES} bytes`,
    );
  }

  assertString(input.projectId, 'projectId', MAX_IDENTIFIER_LENGTH);
  assertString(input.sourceImageId, 'sourceImageId', MAX_IDENTIFIER_LENGTH);
  assertString(input.sourceVersionId, 'sourceVersionId', MAX_IDENTIFIER_LENGTH);
  assertManagedSource(input.imageUrl);
  normalizePerspectivePoints(input.perspective);

  if (!Array.isArray(input.regions) || input.regions.length > MAX_REGIONS) {
    throw new EffectReverseValidationError(
      'EFFECT_REVERSE_REGIONS_INVALID',
      `Request must not contain more than ${MAX_REGIONS} regions`,
    );
  }
  input.regions.forEach(assertRegion);

  if (input.instruction !== undefined) {
    assertString(input.instruction, 'instruction', MAX_INSTRUCTION_LENGTH, true);
  }

  return input;
}
