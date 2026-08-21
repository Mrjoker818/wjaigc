import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'node:net';

import { getRequestUser } from '@/lib/api-auth';
import {
  errorResponse,
  getRequestId,
  successResponse,
} from '@/lib/request-id';

const DEFAULT_DISCOVERY_LIMIT = 20;
const MAX_DISCOVERY_LIMIT = 100;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_FORWARD_HEADER_BYTES = 2048;
const MAX_TRUSTED_PROXY_HOPS = 10;

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

function invalidAdministratorOrigin(requestId: string): NextResponse {
  return errorResponse(
    403,
    'ADMINISTRATOR_ORIGIN_INVALID',
    'Administrator request origin is invalid',
    requestId,
  );
}

function invalidAdministratorAuthSource(requestId: string): NextResponse {
  return errorResponse(
    403,
    'ADMINISTRATOR_AUTH_SOURCE_INVALID',
    'Administrator authentication source is invalid',
    requestId,
  );
}

function unsupportedContentType(requestId: string): NextResponse {
  return errorResponse(
    415,
    'HISTORICAL_MEDIA_CONTENT_TYPE_UNSUPPORTED',
    'Historical media remediation requires application/json',
    requestId,
  );
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

function configuredPublicOrigin(): string | null {
  const configuredDomain = process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim();
  if (!configuredDomain) return null;
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(configuredDomain)
        ? configuredDomain
        : `https://${configuredDomain}`,
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

function hasAllowedAdministratorOrigin(request: NextRequest): boolean {
  const expectedOrigin = configuredPublicOrigin();
  const suppliedOrigin = request.headers.get('origin')?.trim();
  if (!suppliedOrigin) return false;
  try {
    const parsed = new URL(suppliedOrigin);
    const isValidOrigin = ['http:', 'https:'].includes(parsed.protocol)
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash;
    if (!isValidOrigin) return false;
    if (expectedOrigin) return parsed.origin === expectedOrigin;
    if (process.env.NODE_ENV === 'production') return false;

    const requestHostname = request.nextUrl.hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(requestHostname)
      && parsed.origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function hasJsonContentType(request: NextRequest): boolean {
  const contentType = request.headers.get('content-type');
  if (!contentType) return false;
  return contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function readTrustedProxyHops(): number | null {
  const configured = process.env.WUJIE_TRUSTED_PROXY_HOPS?.trim();
  if (!configured || !/^[1-9]\d*$/.test(configured)) return null;
  const hops = Number(configured);
  return Number.isSafeInteger(hops) && hops <= MAX_TRUSTED_PROXY_HOPS ? hops : null;
}

function canonicalizeIp(value: string): string | null {
  const candidate = value.trim();
  const version = isIP(candidate);
  if (version === 4) return candidate;
  if (version !== 6) return null;
  try {
    const hostname = new URL(`http://[${candidate}]/`).hostname.toLowerCase();
    return hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  } catch {
    return null;
  }
}

function resolveAuditIp(request: NextRequest): string | null {
  const trustedHops = readTrustedProxyHops();
  if (trustedHops === null) return null;

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor !== null) {
    if (Buffer.byteLength(forwardedFor, 'utf8') > MAX_FORWARD_HEADER_BYTES) return null;
    const addresses = forwardedFor.split(',').map(value => value.trim());
    if (addresses.length < trustedHops) return null;
    return canonicalizeIp(addresses[addresses.length - trustedHops] ?? '');
  }

  const realIp = request.headers.get('x-real-ip');
  if (
    trustedHops !== 1
    || realIp === null
    || Buffer.byteLength(realIp, 'utf8') > MAX_FORWARD_HEADER_BYTES
  ) return null;
  return canonicalizeIp(realIp);
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

  let remediation: typeof import('@/lib/asset-core/historical-media-remediation');
  try {
    remediation = await import('@/lib/asset-core/historical-media-remediation');
  } catch {
    return internalFailure(requestId);
  }

  try {
    const discovery = await remediation.discoverHistoricalMediaArchiveCandidates({ limit });
    return successResponse(discovery, requestId);
  } catch (error) {
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
  if (auth.source === 'cookie') {
    if (!hasAllowedAdministratorOrigin(request)) return invalidAdministratorOrigin(requestId);
  } else if (auth.source !== 'desktop-token' && auth.source !== 'internal') {
    return invalidAdministratorAuthSource(requestId);
  }
  if (!hasJsonContentType(request)) return unsupportedContentType(requestId);

  let rawRequest: unknown;
  try {
    rawRequest = await readBoundedJson(request);
  } catch {
    return invalidRequest(requestId);
  }

  let remediation: typeof import('@/lib/asset-core/historical-media-remediation');
  try {
    remediation = await import('@/lib/asset-core/historical-media-remediation');
  } catch {
    return internalFailure(requestId);
  }
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
      ipAddress: resolveAuditIp(request),
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
