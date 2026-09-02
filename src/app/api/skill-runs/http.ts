const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

export class SkillRunHttpRequestError extends Error {
  readonly code: 'SKILL_RUN_REQUEST_INVALID' | 'UNSUPPORTED_MEDIA_TYPE';
  readonly status: 400 | 415;

  constructor(
    code: 'SKILL_RUN_REQUEST_INVALID' | 'UNSUPPORTED_MEDIA_TYPE',
    status: 400 | 415,
    message: string,
  ) {
    super(message);
    this.name = 'SkillRunHttpRequestError';
    this.code = code;
    this.status = status;
  }
}

function invalid(message: string): never {
  throw new SkillRunHttpRequestError('SKILL_RUN_REQUEST_INVALID', 400, message);
}

export async function readBoundedSkillRunJson(
  request: Request,
  maximumBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new SkillRunHttpRequestError(
      'UNSUPPORTED_MEDIA_TYPE',
      415,
      'Content-Type must be application/json',
    );
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^[0-9]+$/.test(declaredLength)) invalid('Invalid Content-Length');
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) invalid('Request body is too large');
  }
  if (!request.body) invalid('Invalid request body');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('Request body is too large');
        invalid('Request body is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) invalid('Invalid request body');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    invalid('Invalid UTF-8 body');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    invalid('Invalid JSON body');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('JSON body must be an object');
  }
  return value as Record<string, unknown>;
}

export function assertSkillRunFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    invalid('Unknown request field');
  }
}
