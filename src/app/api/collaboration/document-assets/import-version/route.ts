import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { assertCanvasShareMutationRequest } from '@/lib/canvas-share/request';
import { importDocumentAssetVersion } from '@/lib/collaboration/document-media-import';
import { readMediaVersionImportJson, mediaImportResponse, mediaImportFailure } from '@/lib/collaboration/document-media-request';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getSessionUser(request);
    if (!user) return mediaImportResponse({ success: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
    assertCanvasShareMutationRequest(request);
    const expectedActorId = request.headers.get('x-wujie-expected-actor-id');
    if (expectedActorId !== null && expectedActorId !== user.id) {
      return mediaImportResponse({ success: false, code: 'ACTOR_SCOPE_CHANGED' }, 409);
    }
    if (request.nextUrl.search) return mediaImportResponse({ success: false, code: 'DOCUMENT_MEDIA_INVALID' }, 400);
    const input = await readMediaVersionImportJson(request);
    const result = await importDocumentAssetVersion(user.id, input, request.signal);
    return mediaImportResponse({ success: true, ...result }, 200);
  } catch (error) { return mediaImportFailure(error); }
}
