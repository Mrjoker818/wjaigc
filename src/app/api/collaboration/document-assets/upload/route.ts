import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { assertCanvasShareMutationOrigin } from '@/lib/canvas-share/request';
import { importDocumentUpload } from '@/lib/collaboration/document-media-import';
import { mediaImportResponse, mediaImportFailure } from '@/lib/collaboration/document-media-request';
import { mp4UploadDiagnosticScope, type Mp4UploadDiagnostic, type Mp4UploadDiagnosticTrace } from '@/lib/asset-core/mp4-upload-diagnostic';

export const dynamic = 'force-dynamic';

function withMp4Diagnostic(response: NextResponse, diagnostic?: Mp4UploadDiagnostic): NextResponse {
  if (!diagnostic || ![200, 400, 413, 500, 503].includes(response.status)) return response;
  response.headers.set('x-wujie-mp4-phase', diagnostic.phase);
  if (diagnostic.phase === 'ffprobe') {
    response.headers.set('x-wujie-mp4-probe-error', diagnostic.error);
    if (diagnostic.exitCode !== undefined) response.headers.set('x-wujie-mp4-probe-exit-code', String(diagnostic.exitCode));
  }
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let diagnostic: Mp4UploadDiagnosticTrace | undefined;
  try {
    const user = await getSessionUser(request);
    if (!user) return mediaImportResponse({ success: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
    assertCanvasShareMutationOrigin(request);
    const expectedActorId = request.headers.get('x-wujie-expected-actor-id');
    if (expectedActorId !== null && expectedActorId !== user.id) {
      return mediaImportResponse({ success: false, code: 'ACTOR_SCOPE_CHANGED' }, 409);
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'video/mp4') {
      diagnostic = { current: { phase: 'request_admission' } };
    }
    if (request.nextUrl.search) {
      return withMp4Diagnostic(mediaImportResponse({ success: false, code: 'DOCUMENT_MEDIA_INVALID' }, 400), diagnostic?.current);
    }
    const execute = () => importDocumentUpload(user.id, request);
    const result = await (diagnostic ? mp4UploadDiagnosticScope.run(diagnostic, execute) : execute());
    return withMp4Diagnostic(mediaImportResponse({ success: true, ...result }, 200), diagnostic && { phase: 'complete' });
  } catch (error) { return withMp4Diagnostic(mediaImportFailure(error), diagnostic?.current); }
}
