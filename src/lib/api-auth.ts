import 'server-only';

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDesktopAuth, tokenFromHeader } from './desktop-cloud';
import { getAuthSecretForInternalRequests, getSessionUser } from './server-auth';
import type { User } from './user-types';

/**
 * Server-only API authentication helpers.
 * 
 * IMPORTANT: This file MUST NOT be imported from any client component.
 * It imports 'server-only' and server-auth which use Node.js APIs.
 * 
 * For client-safe helpers, use @/lib/api-helpers instead.
 */

/**
 * Get request user from cookie or desktop/connector Bearer token.
 * Supports: session cookie, Authorization header, x-wujie-connector-token header, verified internal request headers.
 */

async function getInternalApiSecret(): Promise<string> {
  const secret = (
    process.env.INTERNAL_API_SECRET
    || process.env.WUJIE_AUTH_SECRET
    || process.env.NEXTAUTH_SECRET
    || ''
  ).trim();
  return secret.length >= 32 ? secret : getAuthSecretForInternalRequests();
}

function secretsMatch(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

/** Build authenticated headers for server-to-server API calls within this application. */
export async function getInternalRequestHeaders(userId: string, userRole: 'user' | 'admin' = 'user'): Promise<Record<string, string>> {
  const secret = await getInternalApiSecret();

  return {
    'x-internal-request': 'true',
    'x-internal-user-id': userId,
    'x-internal-user-role': userRole,
    'x-wujie-internal-secret': secret,
  };
}

export async function getRequestUser(request: Request | NextRequest): Promise<{
  user: User;
  source: 'cookie' | 'desktop-token' | 'internal';
} | null> {
  // 1. Internal service request (x-internal-request header) - highest priority.
  // The caller must also prove possession of a server-only shared secret.
  const isInternal = request.headers.get('x-internal-request') === 'true';
  const internalUserId = request.headers.get('x-internal-user-id');
  const internalUserRoleRaw = request.headers.get('x-internal-user-role') || 'user';
  const internalUserRole: 'user' | 'admin' = internalUserRoleRaw === 'admin' ? 'admin' : 'user';
  const receivedInternalSecret = request.headers.get('x-wujie-internal-secret') || '';
  if (isInternal && internalUserId) {
    try {
      const internalSecret = await getInternalApiSecret();
      if (internalSecret && secretsMatch(receivedInternalSecret, internalSecret)) {
        // Directly return authenticated user from internal header (no DB lookup needed)
        return {
          user: {
            id: internalUserId,
            name: 'internal-user',
            role: internalUserRole,
            status: 'active',
            apiPermissions: {
              image: true,
              chat: true,
              threeD: true,
              imageEdit: true,
              vectorize: true,
              vlm: true,
              layer: true,
              video: true,
              upscaler: true,
              removebg: true,
              audio: true,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          source: 'internal',
        };
      }
    } catch {
      // A missing internal secret is an authentication failure, not a route error.
    }
  }

  // 2. Session cookie
  try {
    const user = await getSessionUser(request as NextRequest);
    if (user) return { user, source: 'cookie' };
  } catch {
    // Continue with desktop/connector bearer token
  }

  // 3. Desktop/Connector Bearer token (Authorization header or x-wujie-connector-token)
  const token = tokenFromHeader(
    request.headers.get('authorization'),
    request.headers.get('x-wujie-connector-token') || ''
  );
  if (!token) return null;
  const auth = await getDesktopAuth(token);
  return auth ? { user: auth.user, source: 'desktop-token' } : null;
}

/**
 * Optional auth check for API routes.
 * Verifies session cookie and returns user info if valid.
 * Currently logs warning on missing/invalid auth but does NOT reject the request.
 * Can be upgraded to mandatory auth by setting MANDATORY_API_AUTH=true env var.
 */
export async function optionalApiAuth(request: Request | NextRequest): Promise<{
  authenticated: boolean;
  userId?: string;
  userRole?: string;
  source?: 'cookie' | 'desktop-token' | 'internal';
}> {
  const auth = await getRequestUser(request);
  if (auth) {
    return {
      authenticated: true,
      userId: auth.user.id,
      userRole: auth.user.role,
      source: auth.source,
    };
  }

  // Log warning but don't reject (progressive rollout)
  if (process.env.MANDATORY_API_AUTH === 'true') {
    return { authenticated: false };
  }

  return { authenticated: false };
}

/**
 * Require API authentication - rejects with 401 if MANDATORY_API_AUTH=true and user not authenticated.
 * Otherwise same as optionalApiAuth (progressive rollout).
 */
export async function requireApiAuth(request: Request | NextRequest): Promise<{
  authenticated: boolean;
  userId?: string;
  userRole?: string;
}> {
  const result = await optionalApiAuth(request);
  if (!result.authenticated && process.env.MANDATORY_API_AUTH === 'true') {
    // Return 401-like marker so callers can check and reject
    return { authenticated: false };
  }
  return result;
}

/**
 * Require API auth and return 401 NextResponse if not authenticated.
 * Use this in API routes that MUST have authentication.
 * Returns user info if authenticated, or a NextResponse with 401 status.
 */
export async function requireApiAuthOrReject(request: Request | NextRequest): Promise<{
  authenticated: true;
  userId: string;
  userRole: string;
} | NextResponse> {
  const result = await optionalApiAuth(request);
  if (!result.authenticated) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  return result as { authenticated: true; userId: string; userRole: string };
}
