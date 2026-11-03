import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCanvasShareMutationRequest, CanvasShareHttpError } from '@/lib/canvas-share/request';
import { getSessionUser, WUJIE_SESSION_COOKIE } from '@/lib/server-auth';
import { DocumentExchangeError } from '@/lib/collaboration/document-exchange-access';
import { reserveDocumentExchangeRequest } from '@/lib/collaboration/document-exchange-admission';
import { readDocumentExchangeJson } from '@/lib/collaboration/document-exchange-request';
import { readDocumentExchangeReceiptByDigest } from '@/lib/collaboration/document-exchange-receipts';
import { documentTransportMode } from '@/lib/collaboration/document-transport-mode';
import { executeDocumentRoute } from '@/lib/collaboration/document-execution-route';
import { assertDocumentTransportAdmission, isDocumentTransportUnavailable } from '@/lib/collaboration/document-transport-gate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const requestSchema = z.object({
  projectId: z.string().min(1).max(256).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)),
  sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  operationId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
  updateDigest: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict();
function response(data: unknown, status = 200): NextResponse {
  const result = NextResponse.json(data, { status });
  result.headers.set('Cache-Control', 'private, no-store'); result.headers.set('Pragma', 'no-cache');
  result.headers.set('Vary', 'Cookie'); result.headers.set('X-Content-Type-Options', 'nosniff'); return result;
}
function failure(code: string, status: number): NextResponse { return response({ success: false, code }, status); }

/** Read an existing receipt. No session issuance, canonical write or operation replay. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return executeDocumentRoute(request, () => handle(request), failure);
}
async function handle(request: NextRequest): Promise<NextResponse> {
  if (process.env.WUJIE_YJS_ENABLED !== 'true' || process.env.WUJIE_YJS_HTTP_ENABLED !== 'true') {
    return failure('DOCUMENT_EXCHANGE_DISABLED', 503);
  }
  let release: (() => void) | undefined;
  try {
    assertCanvasShareMutationRequest(request);
    if (request.nextUrl.search) return failure('DOCUMENT_EXCHANGE_INVALID', 400);
    const user = await getSessionUser(request), cookie = request.cookies.get(WUJIE_SESSION_COOKIE)?.value;
    if (!user || !cookie) return failure('AUTHENTICATION_REQUIRED', 401);
    if (request.headers.get('x-wujie-expected-actor-id') !== user.id) return failure('ACTOR_SCOPE_CHANGED', 409);
    release = reserveDocumentExchangeRequest(user.id);
    const parsed = requestSchema.safeParse(await readDocumentExchangeJson(request));
    if (!parsed.success) return failure('DOCUMENT_EXCHANGE_INVALID', 400);
    if (documentTransportMode() !== 'http') return failure('DOCUMENT_EXCHANGE_DISABLED', 503);
    assertDocumentTransportAdmission();
    const receipt = await readDocumentExchangeReceiptByDigest({ ...parsed.data, actorId: user.id,
      authSessionHash: createHash('sha256').update(cookie).digest('hex') });
    return response({ success: true, receipt });
  } catch (error) {
    if (isDocumentTransportUnavailable(error)) throw error;
    if (error instanceof CanvasShareHttpError) return failure('DOCUMENT_EXCHANGE_INVALID', error.status);
    if (error instanceof DocumentExchangeError) {
      const status = error.code === 'DOCUMENT_EXCHANGE_INVALID' || error.code === 'DOCUMENT_EXCHANGE_REQUEST_CANCELLED' ? 400
        : error.code === 'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT' ? 408 : error.code === 'DOCUMENT_EXCHANGE_TOO_LARGE' ? 413
          : error.code === 'DOCUMENT_EXCHANGE_FORBIDDEN' || error.code === 'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN' ? 403
            : error.code === 'DOCUMENT_EXCHANGE_CONFLICT' ? 409 : error.code === 'DOCUMENT_EXCHANGE_BUSY' ? 429 : 503;
      return failure(error.code, status);
    }
    return failure('DOCUMENT_EXCHANGE_UNAVAILABLE', 503);
  } finally { release?.(); }
}
