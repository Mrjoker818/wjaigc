import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getSessionUser, WUJIE_SESSION_COOKIE } from '@/lib/server-auth';
import { assertCanvasShareMutationRequest, CanvasShareHttpError } from '@/lib/canvas-share/request';
import { readDocumentExchangeJson } from '@/lib/collaboration/document-exchange-request';
import { DocumentExchangeError } from '@/lib/collaboration/document-exchange-access';
import { startDocumentExchangeSession, renewDocumentExchangeSession } from '@/lib/collaboration/document-exchange-sessions';
import { reserveDocumentExchangeRequest } from '@/lib/collaboration/document-exchange-admission';
import { documentTransportMode } from '@/lib/collaboration/document-transport-mode';
import { executeDocumentRoute } from '@/lib/collaboration/document-execution-route';
import { assertDocumentTransportAdmission, isDocumentTransportUnavailable } from '@/lib/collaboration/document-transport-gate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const projectId = z.string().min(1).max(256).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), projectId, ticket: opaque }).strict(),
  z.object({ action: z.literal('renew'), projectId, sessionToken: opaque }).strict(),
]);
function response(data: unknown, status: number): NextResponse {
  const result = NextResponse.json(data, { status });
  result.headers.set('Cache-Control', 'private, no-store'); result.headers.set('Pragma', 'no-cache');
  result.headers.set('Vary', 'Cookie'); result.headers.set('X-Content-Type-Options', 'nosniff'); return result;
}
function failure(code: string, status: number): NextResponse { return response({ success: false, code }, status); }
export async function POST(request: NextRequest): Promise<NextResponse> {
  return executeDocumentRoute(request, () => handle(request), failure);
}
async function handle(request: NextRequest): Promise<NextResponse> {
  if (process.env.WUJIE_YJS_ENABLED !== 'true' || process.env.WUJIE_YJS_HTTP_ENABLED !== 'true') return failure('DOCUMENT_EXCHANGE_DISABLED', 503);
  let release: (() => void) | undefined;
  try {
    assertCanvasShareMutationRequest(request);
    if (request.nextUrl.search) return failure('DOCUMENT_EXCHANGE_INVALID', 400);
    const user = await getSessionUser(request);
    const cookie = request.cookies.get(WUJIE_SESSION_COOKIE)?.value;
    if (!user || !cookie) return failure('AUTHENTICATION_REQUIRED', 401);
    if (request.headers.get('x-wujie-expected-actor-id') !== user.id) return failure('ACTOR_SCOPE_CHANGED', 409);
    release = reserveDocumentExchangeRequest(user.id);
    const parsed = requestSchema.safeParse(await readDocumentExchangeJson(request));
    if (!parsed.success) return failure('DOCUMENT_EXCHANGE_INVALID', 400);
    if (documentTransportMode() !== 'http') return failure('DOCUMENT_EXCHANGE_DISABLED', 503);
    const identity = { actorId: user.id, projectId: parsed.data.projectId,
      authSessionHash: createHash('sha256').update(cookie).digest('hex') };
    assertDocumentTransportAdmission();
    const session = parsed.data.action === 'start'
      ? await startDocumentExchangeSession({ ...identity, ticket: parsed.data.ticket })
      : await renewDocumentExchangeSession({ ...identity, sessionToken: parsed.data.sessionToken });
    return response({ success: true, session }, 200);
  } catch (error) {
    if (isDocumentTransportUnavailable(error)) throw error;
    if (error instanceof CanvasShareHttpError) return failure('DOCUMENT_EXCHANGE_INVALID', error.status);
    if (error instanceof DocumentExchangeError) {
      const status = error.code === 'DOCUMENT_EXCHANGE_INVALID' || error.code === 'DOCUMENT_EXCHANGE_REQUEST_CANCELLED' ? 400
        : error.code === 'DOCUMENT_EXCHANGE_EXPIRED' ? 410
          : error.code === 'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT' ? 408
            : error.code === 'DOCUMENT_EXCHANGE_TOO_LARGE' ? 413
        : error.code === 'DOCUMENT_EXCHANGE_TICKET_INVALID' ? 401
          : error.code === 'DOCUMENT_EXCHANGE_FORBIDDEN' || error.code === 'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN' ? 403
            : error.code === 'DOCUMENT_EXCHANGE_SESSION_LIMIT' || error.code === 'DOCUMENT_EXCHANGE_BUSY' ? 429 : 503;
      return failure(error.code, status);
    }
    return failure('DOCUMENT_EXCHANGE_UNAVAILABLE', 503);
  } finally { release?.(); }
}
