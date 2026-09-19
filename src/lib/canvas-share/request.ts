import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getRequestId } from '@/lib/request-id';

import { CanvasShareError } from './errors';
import type { CanvasShareRecord } from './types';

const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

const identifierSchema = z.string().trim().min(1).max(256)
  .refine(value => !CONTROL_CHARACTERS.test(value));
const titleSchema = z.string().trim().min(1).max(200)
  .refine(value => !CONTROL_CHARACTERS.test(value));
const futureIsoDateSchema = z.string().trim().max(64).refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && timestamp > Date.now()
    && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
});
const viewportSchema = z.object({
  offsetX: z.number().finite().optional(),
  offsetY: z.number().finite().optional(),
  zoom: z.number().finite().positive().optional(),
}).strict();

const createSchema = z.object({
  projectId: identifierSchema,
  title: titleSchema,
  requestedViewport: viewportSchema.nullable().optional(),
  expiresAt: futureIsoDateSchema.nullable().optional(),
  allowDownload: z.boolean().optional().default(false),
}).strict();

const patchSchema = z.object({
  expiresAt: futureIsoDateSchema.nullable().optional(),
  allowDownload: z.boolean().optional(),
}).strict().refine(
  value => value.expiresAt !== undefined || value.allowDownload !== undefined,
);

const preflightSchema = z.object({
  projectId: identifierSchema,
  requestedViewport: viewportSchema.nullable().optional(),
  displayContext: z.object({
    projectName: titleSchema.optional(),
  }).strict().optional(),
}).strict();

const TOLERATED_PREFLIGHT_FORGERY_FIELDS = new Set([
  'ownerId',
  'projectRevision',
  'assetId',
  'assetVersionId',
  'mediaUrl',
  'items',
]);

const emptyCommandSchema = z.object({}).strict();

export type CanvasShareCreateRequest = z.infer<typeof createSchema>;
export type CanvasSharePatchRequest = z.infer<typeof patchSchema>;
export type CanvasSharePreflightRequest = z.infer<typeof preflightSchema>;

type CanvasShareHttpErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'CANVAS_SHARE_REQUEST_INVALID'
  | 'CANVAS_SHARE_ORIGIN_INVALID'
  | 'CANVAS_SHARE_CONTENT_TYPE_UNSUPPORTED'
  | 'CANVAS_SHARE_REQUEST_FAILED';

const HTTP_ERROR_DEFINITIONS: Readonly<Record<
  CanvasShareHttpErrorCode,
  { status: number; message: string }
>> = {
  AUTHENTICATION_REQUIRED: { status: 401, message: '请先登录后再管理画布分享' },
  CANVAS_SHARE_REQUEST_INVALID: { status: 400, message: '画布分享请求无效' },
  CANVAS_SHARE_ORIGIN_INVALID: { status: 403, message: '画布分享请求来源无效' },
  CANVAS_SHARE_CONTENT_TYPE_UNSUPPORTED: {
    status: 415,
    message: '画布分享请求必须使用 JSON 格式',
  },
  CANVAS_SHARE_REQUEST_FAILED: { status: 500, message: '画布分享请求失败' },
};

export class CanvasShareHttpError extends Error {
  readonly code: CanvasShareHttpErrorCode;
  readonly status: number;

  constructor(code: CanvasShareHttpErrorCode) {
    const definition = HTTP_ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = 'CanvasShareHttpError';
    this.code = code;
    this.status = definition.status;
  }
}

function withPrivateNoStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Vary', 'Cookie');
  return response;
}

export function canvasShareSuccess(
  request: NextRequest,
  data: Record<string, unknown>,
  status = 200,
): NextResponse {
  const requestId = getRequestId(request);
  const response = NextResponse.json({ success: true, requestId, ...data }, { status });
  response.headers.set('x-request-id', requestId);
  return withPrivateNoStore(response);
}

export function canvasShareErrorResponse(
  request: NextRequest,
  error: unknown,
): NextResponse {
  const requestId = getRequestId(request);
  const resolved = error instanceof CanvasShareError || error instanceof CanvasShareHttpError
    ? error
    : new CanvasShareHttpError('CANVAS_SHARE_REQUEST_FAILED');
  const response = NextResponse.json({
    success: false,
    code: resolved.code,
    message: resolved.message,
    requestId,
  }, { status: resolved.status });
  response.headers.set('x-request-id', requestId);
  return withPrivateNoStore(response);
}

const PUBLIC_ROBOTS_POLICY = 'noindex, nofollow, noarchive';

export function applyCanvasSharePublicHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Robots-Tag', PUBLIC_ROBOTS_POLICY);
  return response;
}

export function canvasSharePublicDataResponse(
  data: unknown,
  status = 200,
): NextResponse {
  return applyCanvasSharePublicHeaders(NextResponse.json(data, { status }));
}

interface CanvasSharePublicTransportError {
  code: string;
  message: string;
  status: number;
  retryAfterSeconds?: number;
}

function isCanvasSharePublicTransportError(
  error: unknown,
): error is CanvasSharePublicTransportError {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    && 'message' in error
    && typeof error.message === 'string'
    && 'status' in error
    && typeof error.status === 'number';
}

function normalizePublicCanvasShareError(error: unknown): CanvasSharePublicTransportError {
  if (error instanceof CanvasShareError) {
    if (error.code === 'CANVAS_SHARE_DOWNLOAD_DISABLED') return error;
    if (error.code === 'CANVAS_SHARE_MEDIA_UNAVAILABLE') return error;
    return new CanvasShareError('CANVAS_SHARE_NOT_FOUND');
  }
  if (isCanvasSharePublicTransportError(error)) {
    if (error.code === 'CANVAS_SHARE_RATE_LIMITED' && error.status === 429) {
      return {
        code: error.code,
        message: '请求过于频繁，请稍后重试',
        status: 429,
        retryAfterSeconds: Number.isFinite(error.retryAfterSeconds)
          ? Math.max(1, Math.ceil(error.retryAfterSeconds ?? 1))
          : 60,
      };
    }
    if (error.code === 'CANVAS_SHARE_RANGE_NOT_SATISFIABLE' && error.status === 416) {
      return {
        code: error.code,
        message: '媒体范围请求无效',
        status: 416,
      };
    }
  }
  return {
    code: 'CANVAS_SHARE_REQUEST_FAILED',
    message: '画布分享请求失败',
    status: 500,
  };
}

export function canvasSharePublicErrorResponse(
  _request: NextRequest,
  error: unknown,
): NextResponse {
  const requestId = `req_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const resolved = normalizePublicCanvasShareError(error);
  const response = NextResponse.json({
    success: false,
    code: resolved.code,
    message: resolved.message,
    requestId,
  }, { status: resolved.status });
  response.headers.set('x-request-id', requestId);
  if (resolved.status === 429) {
    response.headers.set('Retry-After', String(resolved.retryAfterSeconds ?? 60));
  }
  return applyCanvasSharePublicHeaders(response);
}

export function isCanvasShareEnabled(): boolean {
  return process.env.WUJIE_CANVAS_SHARE_ENABLED === 'true';
}

function configuredPublicOrigin(): string | null {
  const configured = process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//iu.test(configured) ? configured : `https://${configured}`,
    );
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function hasAllowedMutationOrigin(request: NextRequest): boolean {
  const supplied = request.headers.get('origin')?.trim();
  if (!supplied) return false;
  try {
    const parsed = new URL(supplied);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) return false;
    const configured = configuredPublicOrigin();
    if (configured) return parsed.origin === configured;
    if (process.env.NODE_ENV === 'production') return false;
    const hostname = request.nextUrl.hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
      && parsed.origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function hasJsonContentType(request: NextRequest): boolean {
  const contentType = request.headers.get('content-type');
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

export function assertCanvasShareMutationRequest(request: NextRequest): void {
  if (!hasAllowedMutationOrigin(request)) {
    throw new CanvasShareHttpError('CANVAS_SHARE_ORIGIN_INVALID');
  }
  if (!hasJsonContentType(request)) {
    throw new CanvasShareHttpError('CANVAS_SHARE_CONTENT_TYPE_UNSUPPORTED');
  }
}

export function canvasSharePublicOrigin(request: NextRequest): string {
  return configuredPublicOrigin() ?? request.nextUrl.origin;
}

export async function readCanvasShareJson(request: NextRequest): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isInteger(length) || length < 0 || length > MAX_REQUEST_BODY_BYTES) {
      throw new CanvasShareHttpError('CANVAS_SHARE_REQUEST_INVALID');
    }
  }
  if (!request.body) throw new CanvasShareHttpError('CANVAS_SHARE_REQUEST_INVALID');
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
        throw new CanvasShareHttpError('CANVAS_SHARE_REQUEST_INVALID');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CanvasShareHttpError) throw error;
    throw new CanvasShareHttpError('CANVAS_SHARE_REQUEST_INVALID');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new CanvasShareHttpError('CANVAS_SHARE_REQUEST_INVALID');
  }
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CanvasShareHttpError('CANVAS_SHARE_REQUEST_INVALID');
  return result.data;
}

export function parseCanvasShareCreateRequest(value: unknown): CanvasShareCreateRequest {
  return parseWith(createSchema, value);
}

export function parseCanvasSharePatchRequest(value: unknown): CanvasSharePatchRequest {
  return parseWith(patchSchema, value);
}

export function parseCanvasSharePreflightRequest(value: unknown): CanvasSharePreflightRequest {
  const sanitized = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(
      ([key]) => !TOLERATED_PREFLIGHT_FORGERY_FIELDS.has(key),
    ))
    : value;
  return parseWith(preflightSchema, sanitized);
}

export function parseCanvasShareEmptyCommand(value: unknown): Record<string, never> {
  return parseWith(emptyCommandSchema, value);
}

export function parseCanvasShareProjectId(value: string | null): string {
  return parseWith(identifierSchema, value);
}

export function parseCanvasShareId(value: string): string {
  return parseWith(identifierSchema, value);
}

export interface CanvasShareOwnerRecord extends CanvasShareRecord {
  itemCount?: number;
}

export function projectCanvasShareForOwner(record: CanvasShareOwnerRecord): Record<string, unknown> {
  return {
    shareId: record.id,
    title: record.title,
    status: record.status,
    projectRevision: record.projectRevision,
    itemCount: record.itemCount ?? 0,
    expiresAt: record.expiresAt,
    allowDownload: record.allowDownload,
    viewCount: record.viewCount,
    lastViewedAt: record.lastViewedAt,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
  };
}
