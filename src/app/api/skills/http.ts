import { NextResponse } from 'next/server';

const MAX_BODY_LENGTH = 8_192;

export class SkillRequestError extends Error {
  constructor(
    readonly code: 'INVALID_REQUEST_BODY' | 'UNSUPPORTED_MEDIA_TYPE',
    readonly status: 400 | 415,
    message: string,
  ) {
    super(message);
    this.name = 'SkillRequestError';
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readStrictJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new SkillRequestError(
      'UNSUPPORTED_MEDIA_TYPE',
      415,
      'Content-Type must be application/json',
    );
  }
  const text = await request.text();
  if (text.length === 0 || text.length > MAX_BODY_LENGTH) {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'Invalid request body');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'Invalid JSON body');
  }
  if (!isPlainObject(value)) {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'JSON body must be an object');
  }
  return value;
}

export function assertOnlyFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'Unknown request field');
  }
}

export function parseBoundedString(
  value: unknown,
  field: string,
  maximum: number,
): string {
  if (typeof value !== 'string') {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, `${field} has invalid length`);
  }
  return normalized;
}

export function skillHttpError(error: unknown): NextResponse {
  if (error instanceof SkillRequestError) {
    return NextResponse.json({ code: error.code, error: error.message }, { status: error.status });
  }
  const candidate = isPlainObject(error) ? error : {};
  const code = typeof candidate.code === 'string' ? candidate.code : 'SKILL_STORAGE_ERROR';
  if (code === 'SKILL_NOT_FOUND') {
    return NextResponse.json({ code, error: 'Skill not found' }, { status: 404 });
  }
  if (code === 'SKILL_REVISION_CONFLICT') {
    return NextResponse.json({ code, error: 'Skill catalog revision conflict' }, { status: 409 });
  }
  if (code === 'INVALID_SKILL_SURFACE') {
    return NextResponse.json({ code, error: 'Invalid skill surface' }, { status: 400 });
  }
  return NextResponse.json(
    { code: 'SKILL_STORAGE_ERROR', error: 'Skill storage failed' },
    { status: 500 },
  );
}
