import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { readCollaborativeProject } from '@/lib/collaboration/document-project-bridge';
import { documentTransportMode } from '@/lib/collaboration/document-transport-mode';
import { assertDocumentTransportAdmission, isDocumentTransportUnavailable } from '@/lib/collaboration/document-transport-gate';
import { getSessionUser } from '@/lib/server-auth';
import { executeDocumentRoute } from '@/lib/collaboration/document-execution-route';
import { reserveDocumentExecutionActor } from '@/lib/collaboration/document-execution-scope';

export const dynamic = 'force-dynamic';

const projectIdSchema = z.string().trim().min(1).max(256)
  .refine(value => !/[\u0000-\u001f\u007f]/u.test(value));

function response(data: Record<string, unknown>, status: number): NextResponse {
  const result = NextResponse.json(data, { status });
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('Vary', 'Cookie');
  return result;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return executeDocumentRoute(request, () => handle(request), (code, status) => response({ success: false, code }, status));
}
async function handle(request: NextRequest): Promise<NextResponse> {
  let user: Awaited<ReturnType<typeof getSessionUser>>;
  try { user = await getSessionUser(request); }
  catch { return response({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' }, 500); }
  if (!user) return response({ success: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
  const expectedActorId = request.headers.get('x-wujie-expected-actor-id');
  if (expectedActorId !== null && expectedActorId !== user.id) {
    return response({ success: false, code: 'ACTOR_SCOPE_CHANGED' }, 409);
  }
  reserveDocumentExecutionActor(user.id);
  if (request.nextUrl.searchParams.size !== 1) {
    return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
  }
  const projectId = projectIdSchema.safeParse(request.nextUrl.searchParams.get('projectId'));
  if (!projectId.success) return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
  try {
    assertDocumentTransportAdmission();
    const project = await readCollaborativeProject(user.id, projectId.data);
    assertDocumentTransportAdmission();
    return response({ success: true, ...project, documentTransport: documentTransportMode() }, 200);
  } catch (error) {
    if (isDocumentTransportUnavailable(error)) throw error;
    if (error instanceof Error && 'code' in error && error.code === 'DOCUMENT_FORBIDDEN') {
      return response({ success: false, code: 'DOCUMENT_FORBIDDEN' }, 403);
    }
    if (error instanceof Error && 'code' in error && error.code === 'DOCUMENT_PROJECT_NOT_ENABLED') {
      return response({ success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' }, 409);
    }
    if (error instanceof Error && 'code' in error && error.code === 'DOCUMENT_AUTHORITY_CONFLICT') {
      return response({ success: false, code: 'DOCUMENT_AUTHORITY_CONFLICT' }, 409);
    }
    return response({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' }, 500);
  }
}
