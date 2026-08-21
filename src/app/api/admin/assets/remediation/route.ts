import { NextRequest, NextResponse } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import {
  errorResponse,
  getRequestId,
  successResponse,
} from '@/lib/request-id';

const DEFAULT_DISCOVERY_LIMIT = 20;
const MAX_DISCOVERY_LIMIT = 100;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

function invalidRequest(requestId: string): NextResponse {
  return errorResponse(
    400,
    'HISTORICAL_MEDIA_REQUEST_INVALID',
    'Historical media remediation request is invalid',
    requestId,
  );
}

function authenticationRequired(requestId: string): NextResponse {
  return errorResponse(401, 'AUTHENTICATION_REQUIRED', 'Authentication required', requestId);
}

function administratorRequired(requestId: string): NextResponse {
  return errorResponse(403, 'ADMINISTRATOR_REQUIRED', 'Administrator session required', requestId);
}

function internalFailure(requestId: string): NextResponse {
  return errorResponse(
    500,
    'HISTORICAL_MEDIA_REMEDIATION_FAILED',
    'Historical media remediation failed',
    requestId,
  );
}

function parseDiscoveryLimit(value: string | null): number | null {
  if (value === null) return DEFAULT_DISCOVERY_LIMIT;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_DISCOVERY_LIMIT
    ? limit
    : null;
}

async function readBoundedJson(request: NextRequest): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isInteger(length) || length < 0 || length > MAX_REQUEST_BODY_BYTES) {
      throw new Error('HISTORICAL_MEDIA_REQUEST_INVALID');
    }
  }
  if (!request.body) throw new Error('HISTORICAL_MEDIA_REQUEST_INVALID');

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
        throw new Error('HISTORICAL_MEDIA_REQUEST_INVALID');
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
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  let auth: Awaited<ReturnType<typeof getRequestUser>>;
  try {
    auth = await getRequestUser(request);
  } catch {
    return internalFailure(requestId);
  }
  if (!auth) return authenticationRequired(requestId);
  if (auth.user.role !== 'admin') return administratorRequired(requestId);

  const limit = parseDiscoveryLimit(request.nextUrl.searchParams.get('limit'));
  if (limit === null) return invalidRequest(requestId);

  try {
    const remediation = await import('@/lib/asset-core/historical-media-remediation');
    const discovery = await remediation.discoverHistoricalMediaArchiveCandidates({ limit });
    return successResponse(discovery, requestId);
  } catch (error) {
    const remediation = await import('@/lib/asset-core/historical-media-remediation');
    if (
      error instanceof remediation.HistoricalMediaRemediationError
      && error.code === 'HISTORICAL_MEDIA_REQUEST_INVALID'
    ) {
      return invalidRequest(requestId);
    }
    return internalFailure(requestId);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  let auth: Awaited<ReturnType<typeof getRequestUser>>;
  try {
    auth = await getRequestUser(request);
  } catch {
    return internalFailure(requestId);
  }
  if (!auth) return authenticationRequired(requestId);
  if (auth.user.role !== 'admin') return administratorRequired(requestId);

  let rawRequest: unknown;
  try {
    rawRequest = await readBoundedJson(request);
  } catch {
    return invalidRequest(requestId);
  }

  const remediation = await import('@/lib/asset-core/historical-media-remediation');
  let archiveRequest: ReturnType<typeof remediation.parseHistoricalMediaArchiveRequest>;
  try {
    archiveRequest = remediation.parseHistoricalMediaArchiveRequest(rawRequest);
  } catch {
    return invalidRequest(requestId);
  }

  try {
    const result = await remediation.archiveHistoricalMedia({
      actorUserId: auth.user.id,
      actorUserName: auth.user.name,
      ipAddress: request.headers.get('x-forwarded-for')
        || request.headers.get('x-real-ip')
        || null,
      request: archiveRequest,
    });
    return successResponse({ ...result }, requestId);
  } catch (error) {
    if (error instanceof remediation.HistoricalMediaRemediationError) {
      if (error.code === 'HISTORICAL_MEDIA_REQUEST_INVALID') {
        return invalidRequest(requestId);
      }
      if (error.code === 'HISTORICAL_MEDIA_NOT_FOUND') {
        return errorResponse(404, error.code, 'Historical media candidate was not found', requestId);
      }
      if (
        error.code === 'HISTORICAL_MEDIA_CANDIDATE_STALE'
        || error.code === 'HISTORICAL_MEDIA_IDEMPOTENCY_CONFLICT'
      ) {
        return errorResponse(409, error.code, 'Historical media archive conflict', requestId);
      }
    }
    return internalFailure(requestId);
  }
}
