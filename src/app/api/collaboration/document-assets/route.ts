import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { assertCanvasShareMutationRequest, CanvasShareHttpError, readCanvasShareJson } from '@/lib/canvas-share/request';
import { parseDocumentAssetCommandRequest } from '@/lib/collaboration/canvas-asset-command';
import { executeDocumentAssetCommand } from '@/lib/collaboration/document-asset-commands';

export const dynamic = 'force-dynamic';
function response(data: Record<string, unknown>, status: number): NextResponse {
  const result = NextResponse.json(data, { status });
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('Vary', 'Cookie');
  return result;
}
const statuses: Readonly<Record<string, number>> = {
  DOCUMENT_FORBIDDEN: 403, DOCUMENT_ASSET_FORBIDDEN: 403,
  DOCUMENT_DISABLED: 503, DOCUMENT_PROJECT_NOT_ENABLED: 503,
  DOCUMENT_ASSET_COMMAND_INVALID: 400, DOCUMENT_ASSET_COMMAND_CONFLICT: 409,
};
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getSessionUser(request);
    if (!user) return response({ success: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
    if (process.env.WUJIE_YJS_ENABLED !== 'true') return response({ success: false, code: 'DOCUMENT_DISABLED' }, 503);
    assertCanvasShareMutationRequest(request);
    const expectedActorId = request.headers.get('x-wujie-expected-actor-id');
    if (expectedActorId !== null && expectedActorId !== user.id) {
      return response({ success: false, code: 'ACTOR_SCOPE_CHANGED' }, 409);
    }
    if (request.nextUrl.search) return response({ success: false, code: 'DOCUMENT_ASSET_COMMAND_INVALID' }, 400);
    const input = parseDocumentAssetCommandRequest(await readCanvasShareJson(request));
    const result = await executeDocumentAssetCommand({ actorId: user.id, ...input });
    return response({ success: true, ...result }, 200);
  } catch (error) {
    if (error instanceof CanvasShareHttpError) {
      return response({ success: false, code: 'DOCUMENT_ASSET_COMMAND_INVALID' }, error.status);
    }
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
    if (Object.hasOwn(statuses, code)) return response({ success: false, code }, statuses[code]);
    return response({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' }, 500);
  }
}
