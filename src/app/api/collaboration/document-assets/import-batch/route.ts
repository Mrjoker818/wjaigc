import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { assertCanvasShareMutationRequest } from '@/lib/canvas-share/request';
import { importDocumentMediaBatch } from '@/lib/collaboration/document-media-batch';
import { parseDocumentMediaBatchRequest } from '@/lib/collaboration/document-media-batch-request';
import { readMediaBody, consumeMediaBody, mediaDeadline, DocumentMediaError, mediaImportResponse, mediaImportFailure } from '@/lib/collaboration/document-media-request';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getSessionUser(request);
    if (!user) return mediaImportResponse({ success: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
    assertCanvasShareMutationRequest(request);
    const expectedActor = request.headers.get('x-wujie-expected-actor-id');
    if (expectedActor !== null && expectedActor !== user.id) return mediaImportResponse({ success: false, code: 'ACTOR_SCOPE_CHANGED' }, 409);
    if (request.nextUrl.search) return mediaImportResponse({ success: false, code: 'DOCUMENT_MEDIA_INVALID' }, 400);
    const deadline = mediaDeadline(request.signal, 120_000);
    let input;
    try {
      const body = consumeMediaBody(await readMediaBody(request, 64 * 1024, deadline.signal));
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.bytes)); }
      catch { throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID'); }
      input = parseDocumentMediaBatchRequest(value);
    } finally { deadline.dispose(); }
    const result = await importDocumentMediaBatch(user.id, input, request.signal);
    return mediaImportResponse({ success: true, ...result }, 200);
  } catch (error) { return mediaImportFailure(error); }
}
