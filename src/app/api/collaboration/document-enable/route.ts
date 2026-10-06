import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  assertCanvasShareMutationRequest,
  CanvasShareHttpError,
  readCanvasShareJson,
} from '@/lib/canvas-share/request';
import { enableCollaborativeProject } from '@/lib/collaboration/document-project-bridge';
import { readDocumentOwnerStatus } from '@/lib/collaboration/document-owner-status';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  projectId: z.string().trim().min(1).max(256)
    .refine(value => !/[\u0000-\u001f\u007f]/u.test(value)),
  expectedRevision: z.number().int().nonnegative().safe(),
}).strict();

function response(data: Record<string, unknown>, status: number): NextResponse {
  const result = NextResponse.json(data, { status });
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('Vary', 'Cookie');
  return result;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser(request);
  if (!user) return response({ success: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
  const params = request.nextUrl.searchParams;
  const projectId = requestSchema.shape.projectId.safeParse(params.get('projectId'));
  if (params.size !== 1 || !projectId.success) {
    return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
  }
  try {
    const status = await readDocumentOwnerStatus(user.id, projectId.data);
    return response({ success: true, ...status }, 200);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'DOCUMENT_FORBIDDEN') return response({ success: false, code: error.code }, 403);
      if (error.code === 'DOCUMENT_AUTHORITY_CONFLICT') return response({ success: false, code: error.code }, 409);
    }
    return response({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' }, 500);
  }
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
    if (!parsed.success) return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
    await enableCollaborativeProject(user.id, parsed.data.projectId, parsed.data.expectedRevision);
    return response({ success: true, projectId: parsed.data.projectId }, 200);
  } catch (error) {
    if (error instanceof CanvasShareHttpError) {
      const status = error.code === 'CANVAS_SHARE_ORIGIN_INVALID' ? 403
        : error.code === 'CANVAS_SHARE_CONTENT_TYPE_UNSUPPORTED' ? 415 : 400;
      return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, status);
    }
    if (error instanceof Error && 'code' in error
      && error.code === 'DOCUMENT_PROJECT_REVISION_CONFLICT'
      && 'currentRevision' in error) {
      return response({
        success: false, code: 'DOCUMENT_PROJECT_REVISION_CONFLICT',
        currentRevision: error.currentRevision,
      }, 409);
    }
    if (error instanceof Error && 'code' in error && error.code === 'DOCUMENT_AUTHORITY_CONFLICT') {
      return response({ success: false, code: 'DOCUMENT_AUTHORITY_CONFLICT' }, 409);
    }
    return response({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' }, 500);
  }
}
