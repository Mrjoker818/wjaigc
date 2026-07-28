import type {
  LayerDecompositionRequest,
  LayerEngineMode,
} from '@/lib/layer-decomposition/types';

const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
const MAX_DECODED_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_URL_LENGTH = 21 * 1024 * 1024;
const MAX_PROVIDER_ID_LENGTH = 128;
const MAX_MODEL_ID_LENGTH = 256;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export class LayerRequestValidationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'LayerRequestValidationError';
    this.code = code;
    this.status = status;
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LayerRequestValidationError(
      'LAYER_REQUEST_INVALID',
      'Layer request must be a JSON object',
    );
  }
  return value as Record<string, unknown>;
}

function readBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
): string | undefined {
  if (value === undefined || value === null) {
    if (required) {
      throw new LayerRequestValidationError(
        'LAYER_REQUEST_INVALID',
        `${field} is required`,
      );
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new LayerRequestValidationError(
      'LAYER_REQUEST_INVALID',
      `${field} must be a string`,
    );
  }
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maxLength) {
    throw new LayerRequestValidationError(
      'LAYER_REQUEST_INVALID',
      `${field} is invalid`,
    );
  }
  return normalized || undefined;
}

function validateDataUrl(imageUrl: string): void {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(imageUrl);
  if (!match || !ALLOWED_IMAGE_MIME_TYPES.has(match[1].toLowerCase())) {
    throw new LayerRequestValidationError(
      'LAYER_IMAGE_INVALID',
      'image data URL is invalid or unsupported',
    );
  }

  const payload = match[2];
  if (payload.length % 4 === 1) {
    throw new LayerRequestValidationError(
      'LAYER_IMAGE_INVALID',
      'image base64 payload is malformed',
    );
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const decodedBytes = Math.floor((payload.length * 3) / 4) - padding;
  if (decodedBytes > MAX_DECODED_IMAGE_BYTES) {
    throw new LayerRequestValidationError(
      'LAYER_IMAGE_TOO_LARGE',
      'image exceeds the decoded byte limit',
      413,
    );
  }
}

export function parseLayerRequest(value: unknown): LayerDecompositionRequest {
  const body = requireObject(value);
  const imageUrl = readBoundedString(
    body.imageUrl,
    'imageUrl',
    MAX_IMAGE_URL_LENGTH,
    true,
  )!;
  if (imageUrl.startsWith('data:')) validateDataUrl(imageUrl);

  const engineValue = body.engine ?? 'smart';
  if (engineValue !== 'smart' && engineValue !== 'cloud' && engineValue !== 'local') {
    throw new LayerRequestValidationError(
      'LAYER_MODE_INVALID',
      'layer mode must be smart, cloud, or local',
    );
  }
  const engine: LayerEngineMode = engineValue;

  const providerId = readBoundedString(
    body.providerId,
    'providerId',
    MAX_PROVIDER_ID_LENGTH,
  );
  const modelId = readBoundedString(
    body.modelId ?? body.model,
    'modelId',
    MAX_MODEL_ID_LENGTH,
  );

  const hasExactCloudTarget = Boolean(providerId && modelId);
  if (
    (engine === 'cloud' && !hasExactCloudTarget)
    || (engine !== 'local' && Boolean(providerId) !== Boolean(modelId))
  ) {
    throw new LayerRequestValidationError(
      'LAYER_PROVIDER_REQUIRED',
      'providerId and modelId must be selected together for cloud layering',
    );
  }

  return { imageUrl, engine, providerId, modelId };
}

export function validateLayerIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new LayerRequestValidationError(
      'LAYER_IDEMPOTENCY_INVALID',
      'idempotency key must be 8-128 URL-safe characters',
    );
  }
  return value;
}

export async function readLayerRequest(request: Request): Promise<LayerDecompositionRequest> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new LayerRequestValidationError(
      'LAYER_BODY_TOO_LARGE',
      'request body exceeds 16 MiB',
      413,
    );
  }

  if (!request.body) {
    throw new LayerRequestValidationError(
      'LAYER_REQUEST_INVALID',
      'request body is required',
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new LayerRequestValidationError(
          'LAYER_BODY_TOO_LARGE',
          'request body exceeds 16 MiB',
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new LayerRequestValidationError(
      'LAYER_JSON_INVALID',
      'request body must contain valid JSON',
    );
  }
  return parseLayerRequest(value);
}
