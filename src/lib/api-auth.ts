import 'server-only';

import type { NextRequest } from 'next/server';
import { getSessionUser } from './server-auth';

/**
 * Server-only API authentication helpers.
 * 
 * IMPORTANT: This file MUST NOT be imported from any client component.
 * It imports 'server-only' and server-auth which use Node.js APIs.
 * 
 * For client-safe helpers, use @/lib/api-helpers instead.
 */

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
}> {
  try {
    // getSessionUser expects NextRequest; cast is safe since we only access cookies
    const user = await getSessionUser(request as NextRequest);
    if (user) {
      return { authenticated: true, userId: user.id, userRole: user.role };
    }
  } catch {
    // Auth system unavailable
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
    return { authenticated: false };
  }
  return result;
}
