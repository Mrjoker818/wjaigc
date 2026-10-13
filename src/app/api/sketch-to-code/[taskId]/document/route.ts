import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getRequestId } from '@/lib/request-id';
import { readSketchDocument } from '@/lib/sketch-to-code/document';
import { sketchAuthResponse, sketchError, sketchHttpId, SketchHttpError } from '@/lib/sketch-to-code/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox";
export async function GET(request: NextRequest, context: { params: Promise<{ taskId: string }> }): Promise<NextResponse> {
  const requestId = getRequestId(request);
  try {
    const auth = await requireApiAuthOrReject(request);
    if (auth instanceof NextResponse) return sketchAuthResponse(auth, requestId);
    const taskId = sketchHttpId((await context.params).taskId);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'projectId') || query.getAll('projectId').length !== 1) throw new SketchHttpError(400, 'SKETCH_INPUT_INVALID');
    const projectId = sketchHttpId(query.get('projectId'));
    let document: Awaited<ReturnType<typeof readSketchDocument>>;
    try { document = await readSketchDocument({ actorUserId: auth.user.id, projectId, taskId, signal: request.signal }); }
    catch { throw new SketchHttpError(404, 'SKETCH_DOCUMENT_UNAVAILABLE'); }
    return new NextResponse(new Uint8Array(document.bytes), { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="sketch-code.html"',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': CSP, 'x-request-id': requestId,
    } });
  } catch (error) { return sketchError(error, requestId); }
}
