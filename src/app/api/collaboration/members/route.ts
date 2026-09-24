import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  assertCanvasShareMutationRequest,
  CanvasShareHttpError,
  readCanvasShareJson,
} from '@/lib/canvas-share/request';
import {
  grantPresenceMember,
  listPresenceMembers,
  revokePresenceMember,
} from '@/lib/collaboration/presence-members';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const identifier = z.string().trim().min(1).max(256)
  .refine(value => !/[\u0000-\u001f\u007f]/u.test(value));
const mutationSchema = z.object({
  projectId: identifier,
  memberUserId: identifier,
}).strict();

function response(data: Record<string, unknown>, status: number): NextResponse {
  const result = NextResponse.json(data, { status });
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('Vary', 'Cookie');
  return result;
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof CanvasShareHttpError) {
    const status = error.code === 'CANVAS_SHARE_ORIGIN_INVALID' ? 403
      : error.code === 'CANVAS_SHARE_CONTENT_TYPE_UNSUPPORTED' ? 415 : 400;
    return response({ success: false, code: 'PRESENCE_REQUEST_INVALID' }, status);
  }
  if (typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'PRESENCE_FORBIDDEN') {
    return response({ success: false, code: 'PRESENCE_FORBIDDEN' }, 403);
  }
  return response({ success: false, code: 'PRESENCE_INTERNAL_ERROR' }, 500);
}

async function authorize(request: NextRequest): Promise<string | NextResponse> {
  if (process.env.WUJIE_PRESENCE_ENABLED !== 'true') {
    return response({ success: false, code: 'PRESENCE_DISABLED' }, 503);
  }
  const user = await getSessionUser(request);
  if (!user) return response({ success: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
  return user.id;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const actor = await authorize(request);
  if (typeof actor !== 'string') return actor;
  const projectId = identifier.safeParse(request.nextUrl.searchParams.get('projectId'));
  if (!projectId.success) return response({ success: false, code: 'PRESENCE_REQUEST_INVALID' }, 400);
  try {
    const members = await listPresenceMembers(actor, projectId.data);
    return response({ success: true, members }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}

async function mutate(request: NextRequest, action: 'grant' | 'revoke'): Promise<NextResponse> {
  const actor = await authorize(request);
  if (typeof actor !== 'string') return actor;
  try {
    assertCanvasShareMutationRequest(request);
    const parsed = mutationSchema.safeParse(await readCanvasShareJson(request));
    if (!parsed.success) return response({ success: false, code: 'PRESENCE_REQUEST_INVALID' }, 400);
    if (action === 'grant') {
      await grantPresenceMember(actor, parsed.data.projectId, parsed.data.memberUserId);
    } else {
      await revokePresenceMember(actor, parsed.data.projectId, parsed.data.memberUserId);
    }
    return response({ success: true }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return mutate(request, 'grant');
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  return mutate(request, 'revoke');
}
