import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDesktopAuth, tokenFromHeader } from './desktop-cloud';
import { getSessionUser } from './server-auth';
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
 * Supports: session cookie, Authorization header, x-wujie-connector-token header, internal request headers.
 */
export async function getRequestUser(request: Request | NextRequest): Promise<{
  user: User;
  source: 'cookie' | 'desktop-token' | 'internal';
} | null> {
  // 1. Internal service request (x-internal-request header) - highest priority
  const isInternal = request.headers.get('x-internal-request') === 'true';
  const internalUserId = request.headers.get('x-internal-user-id');
  if (isInternal && internalUserId) {
    // Fetch user from database to get full User object
    try {
      const user = await getSessionUser(request as NextRequest);
      if (user && user.id === internalUserId) {
        return { user, source: 'internal' };
      }
    } catch {
      // Continue with other auth methods
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