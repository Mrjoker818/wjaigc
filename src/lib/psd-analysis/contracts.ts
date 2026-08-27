import { createHash } from 'node:crypto';

export const PSD_ANALYSIS_MAX_BODY_BYTES = 28 * 1024 * 1024;
export const PSD_ANALYSIS_MAX_RESPONSE_BYTES = 256 * 1024;
export const PSD_ANALYSIS_DEADLINE_MS = 45_000;

const REQUEST_FIELDS = new Set([
  'image',
  'projectId',
  'sourceVersionId',
  'providerId',
  'model',
]);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{7,127}$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MODEL_PATTERN = /^[^\u0000-\u001f\u007f]{1,160}$/;
const BACKGROUND_MODES = new Set<PsdAnalysisBackgroundMode>([
  'white',
  'corner',
  'color',
  'white-preserve',
  'none',
]);
const LAYER_ROLES = new Set<PsdAnalysisLayerRole>([
  'bg',
  'subject',
  'text',
  'deco',
  'fx',
]);

export type PsdAnalysisBackgroundMode =
  | 'white'
  | 'corner'
  | 'color'
  | 'white-preserve'
  | 'none';

export type PsdAnalysisLayerRole = 'bg' | 'subject' | 'text' | 'deco' | 'fx';

export interface PsdAnalysisLayer {
  name: string;
  role: PsdAnalysisLayerRole;
  description: string;
}

export interface PsdAnalysisResult {
  backgroundColor: [number, number, number];
  backgroundMode: PsdAnalysisBackgroundMode;
  layers: PsdAnalysisLayer[];
}

export interface PsdAnalysisRequest {
  image?: string;
  projectId?: string;
  sourceVersionId?: string;
  providerId?: string;
  model?: string;
  idempotencyKey: string;
}

export interface PsdAnalysisRequestDigestInput {
  imageSha256: string;
  sourceVersionId?: string;
  providerId?: string;
  model?: string;
}

export class PsdAnalysisError extends Error {
  readonly taskId?: string;

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
    options?: ErrorOptions & { taskId?: string },
  ) {
    super(message, options);
    this.name = 'PsdAnalysisError';
    this.taskId = options?.taskId;
  }
}

function invalidRequest(message: string, code = 'PSD_ANALYSIS_REQUEST_INVALID'): never {
  throw new PsdAnalysisError(code, message, 400, false);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalidRequest(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) invalidRequest(`${field} is invalid`);
  return normalized;
}

function abortReason(signal: AbortSignal): PsdAnalysisError {
  if (signal.reason instanceof PsdAnalysisError) return signal.reason;
  return new PsdAnalysisError(
    'PSD_ANALYSIS_CANCELLED',
    'PSD 分析请求已取消',
    499,
    false,
    { cause: signal.reason },
  );
}

function readWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(abortReason(signal));
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', aborted);
    });
  });
}

async function readLimitedRequestBody(
  request: Request,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > PSD_ANALYSIS_MAX_BODY_BYTES) {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_BODY_TOO_LARGE',
      'PSD 分析请求体超过 28 MiB',
      413,
      false,
    );
  }
  if (!request.body) invalidRequest('Request body is required');

  const reader = request.body!.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readWithAbort(reader.read(), signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > PSD_ANALYSIS_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PsdAnalysisError(
          'PSD_ANALYSIS_BODY_TOO_LARGE',
          'PSD 分析请求体超过 28 MiB',
          413,
          false,
        );
      }
      chunks.push(value);
    }
  } finally {
    if (signal?.aborted) await reader.cancel(signal.reason).catch(() => undefined);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readPsdAnalysisRequest(
  request: Request,
  signal?: AbortSignal,
): Promise<PsdAnalysisRequest> {
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_IDEMPOTENCY_INVALID',
      'Idempotency-Key 必须为 8-128 个 URL 安全字符',
      400,
      false,
    );
  }

  const bytes = await readLimitedRequestBody(request, signal);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_JSON_INVALID',
      'PSD 分析请求体必须是有效 JSON',
      400,
      false,
      { cause: error },
    );
  }
  if (!isRecord(value) || Object.keys(value).some(key => !REQUEST_FIELDS.has(key))) {
    invalidRequest('PSD analysis request contains unsupported fields');
  }

  const image = optionalString(value.image, 'image', PSD_ANALYSIS_MAX_BODY_BYTES);
  const projectId = optionalString(value.projectId, 'projectId', 128);
  const sourceVersionId = optionalString(value.sourceVersionId, 'sourceVersionId', 128);
  const providerId = optionalString(value.providerId, 'providerId', 128);
  const model = optionalString(value.model, 'model', 160);

  const hasAssetReference = Boolean(projectId && sourceVersionId);
  if (Boolean(projectId) !== Boolean(sourceVersionId) || Boolean(image) === hasAssetReference) {
    invalidRequest('Exactly one image or projectId/sourceVersionId source is required');
  }
  if (Boolean(providerId) !== Boolean(model)) {
    invalidRequest('providerId and model must be provided together', 'PSD_ANALYSIS_MODEL_PAIR_INVALID');
  }
  if (providerId && !PROVIDER_ID_PATTERN.test(providerId)) {
    invalidRequest('providerId is invalid');
  }
  if (model && !MODEL_PATTERN.test(model)) {
    invalidRequest('model is invalid');
  }

  return {
    ...(image ? { image } : {}),
    ...(projectId ? { projectId } : {}),
    ...(sourceVersionId ? { sourceVersionId } : {}),
    ...(providerId ? { providerId } : {}),
    ...(model ? { model } : {}),
    idempotencyKey,
  };
}

function assertJsonDepth(value: unknown, depth = 0): void {
  if (depth > 8) {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_OUTPUT_INVALID',
      'PSD 分析模型返回的 JSON 层级过深',
      502,
      true,
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonDepth(item, depth + 1);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) assertJsonDepth(item, depth + 1);
  }
}

function outputInvalid(message: string): never {
  throw new PsdAnalysisError(
    'PSD_ANALYSIS_OUTPUT_INVALID',
    message,
    502,
    true,
  );
}

function boundedOutputString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') outputInvalid(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) outputInvalid(`${field} is outside its length budget`);
  return normalized;
}

export function parsePsdAnalysisOutput(text: string): PsdAnalysisResult {
  if (new TextEncoder().encode(text).byteLength > PSD_ANALYSIS_MAX_RESPONSE_BYTES) {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_OUTPUT_TOO_LARGE',
      'PSD 分析模型响应超过 256 KiB',
      502,
      true,
    );
  }

  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  let value: unknown;
  try {
    value = JSON.parse(jsonText) as unknown;
  } catch (error) {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_OUTPUT_INVALID',
      'PSD 分析模型没有返回有效 JSON',
      502,
      true,
      { cause: error },
    );
  }

  assertJsonDepth(value);
  if (!isRecord(value)) outputInvalid('PSD analysis output must be an object');

  const color = value.backgroundColor;
  if (
    !Array.isArray(color)
    || color.length !== 3
    || color.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255)
  ) {
    outputInvalid('backgroundColor must contain three byte values');
  }
  if (typeof value.backgroundMode !== 'string' || !BACKGROUND_MODES.has(value.backgroundMode as PsdAnalysisBackgroundMode)) {
    outputInvalid('backgroundMode is invalid');
  }
  if (!Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > 8) {
    outputInvalid('layers must contain 1-8 entries');
  }

  const layers = value.layers.map((layer, index): PsdAnalysisLayer => {
    if (!isRecord(layer)) outputInvalid(`layers[${index}] must be an object`);
    const name = boundedOutputString(layer.name, `layers[${index}].name`, 80);
    const description = boundedOutputString(layer.description, `layers[${index}].description`, 300);
    if (typeof layer.role !== 'string' || !LAYER_ROLES.has(layer.role as PsdAnalysisLayerRole)) {
      outputInvalid(`layers[${index}].role is invalid`);
    }
    return { name, role: layer.role as PsdAnalysisLayerRole, description };
  });
  if (layers[0].role !== 'bg') outputInvalid('The first PSD analysis layer must be background');

  return {
    backgroundColor: [color[0] as number, color[1] as number, color[2] as number],
    backgroundMode: value.backgroundMode as PsdAnalysisBackgroundMode,
    layers,
  };
}

export function createPsdAnalysisRequestDigest(input: PsdAnalysisRequestDigestInput): string {
  return createHash('sha256')
    .update(JSON.stringify({
      schema: 'psd-analysis-request.v1',
      imageSha256: input.imageSha256,
      sourceVersionId: input.sourceVersionId ?? '',
      providerId: input.providerId ?? '',
      model: input.model ?? '',
    }))
    .digest('hex');
}
