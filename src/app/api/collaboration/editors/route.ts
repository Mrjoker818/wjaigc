import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  assertCanvasShareMutationRequest,
  CanvasShareHttpError,
  readCanvasShareJson,
} from '@/lib/canvas-share/request';
import {
  grantDocumentEditor,
  grantDocumentEditorByName,
  listDocumentEditors,
  revokeDocumentEditor,
} from '@/lib/collaboration/document-access';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const identifier = z.string().trim().min(1).max(256)
  .refine(value => !/[\u0000-\u001f\u007f]/u.test(value));
const mutationSchema = z.object({
  projectId: identifier,
  memberUserId: identifier,
}).strict();
const grantSchema = z.union([mutationSchema, z.object({
  projectId: identifier,
  memberName: identifier,
}).strict()]);

function response(data: Record<string, unknown>, status: number): NextResponse {
  const result = NextResponse.json(data, { status });
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('Vary', 'Cookie');
  return result;
}

function errorResponse(error: unknown): NextResponse {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'DOCUMENT_INVITEE_INVALID') return response({ success: false, code: error.code }, 400);
    if (error.code === 'DOCUMENT_PROJECT_NOT_ENABLED' || error.code === 'DOCUMENT_AUTHORITY_CONFLICT') {
      return response({ success: false, code: error.code }, 409);
    }
    if (error.code === 'DOCUMENT_DISABLED') return response({ success: false, code: error.code }, 503);
  }
  if (error instanceof CanvasShareHttpError) {
    const status = error.code === 'CANVAS_SHARE_ORIGIN_INVALID' ? 403
      : error.code === 'CANVAS_SHARE_CONTENT_TYPE_UNSUPPORTED' ? 415 : 400;
    return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, status);
  }
  if (typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'DOCUMENT_FORBIDDEN') {
    return response({ success: false, code: 'DOCUMENT_FORBIDDEN' }, 403);
  }
  return response({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' }, 500);
}

async function authorize(request: NextRequest): Promise<string | NextResponse> {
  if (process.env.WUJIE_YJS_ENABLED !== 'true') {
    return response({ success: false, code: 'DOCUMENT_DISABLED' }, 503);
  }
  const user = await getSessionUser(request);
  if (!user) return response({ success: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
  return user.id;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const actor = await authorize(request);
  if (typeof actor !== 'string') return actor;
  const projectId = identifier.safeParse(request.nextUrl.searchParams.get('projectId'));
  if (!projectId.success) return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
  try {
    const editors = await listDocumentEditors(actor, projectId.data);
    return response({ success: true, editors }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}

async function mutate(request: NextRequest, action: 'grant' | 'revoke'): Promise<NextResponse> {
  const actor = await authorize(request);
  if (typeof actor !== 'string') return actor;
  try {
    assertCanvasShareMutationRequest(request);
    const parsed = (action === 'grant' ? grantSchema : mutationSchema).safeParse(await readCanvasShareJson(request));
    if (!parsed.success) return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
    if (action === 'grant') {
      if ('memberName' in parsed.data) {
        await grantDocumentEditorByName(actor, parsed.data.projectId, parsed.data.memberName);
      } else {
        await grantDocumentEditor(actor, parsed.data.projectId, parsed.data.memberUserId);
      }
    } else {
      if (!('memberUserId' in parsed.data)) return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
      await revokeDocumentEditor(actor, parsed.data.projectId, parsed.data.memberUserId);
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
