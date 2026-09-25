import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  assertCanvasShareMutationRequest,
  CanvasShareHttpError,
  readCanvasShareJson,
} from '@/lib/canvas-share/request';
import { issueDocumentTicket } from '@/lib/collaboration/document-tickets';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  projectId: z.string().trim().min(1).max(256)
    .refine(value => !/[\u0000-\u001f\u007f]/u.test(value)),
}).strict();

function response(data: Record<string, unknown>, status: number): NextResponse {
  const result = NextResponse.json(data, { status });
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('Pragma', 'no-cache');
  result.headers.set('Vary', 'Cookie');
  return result;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.WUJIE_YJS_ENABLED !== 'true') {
    return response({ success: false, code: 'DOCUMENT_DISABLED' }, 503);
  }
  const user = await getSessionUser(request);
  if (!user) return response({ success: false, code: 'AUTHENTICATION_REQUIRED' }, 401);

  try {
    assertCanvasShareMutationRequest(request);
    if (request.nextUrl.search) {
      return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
    }
    const parsed = requestSchema.safeParse(await readCanvasShareJson(request));
    if (!parsed.success) {
      return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
    }
    const ticket = await issueDocumentTicket(user.id, parsed.data.projectId);
    return response({ success: true, ticket }, 200);
  } catch (error) {
    if (error instanceof CanvasShareHttpError) {
      const status = error.code === 'CANVAS_SHARE_ORIGIN_INVALID' ? 403
        : error.code === 'CANVAS_SHARE_CONTENT_TYPE_UNSUPPORTED' ? 415 : 400;
      return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, status);
    }
    if (typeof error === 'object' && error !== null
      && 'code' in error && error.code === 'DOCUMENT_TICKET_LIMIT') {
      return response({ success: false, code: 'DOCUMENT_TICKET_LIMIT' }, 429);
    }
    if (typeof error === 'object' && error !== null
      && 'code' in error && error.code === 'DOCUMENT_FORBIDDEN') {
      return response({ success: false, code: 'DOCUMENT_FORBIDDEN' }, 403);
    }
    if (typeof error === 'object' && error !== null
      && 'code' in error && error.code === 'DOCUMENT_PROJECT_NOT_ENABLED') {
      return response({ success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' }, 409);
    }
    return response({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' }, 500);
  }
}
