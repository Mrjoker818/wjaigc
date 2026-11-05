import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { assertCanvasShareMutationOrigin, CanvasShareHttpError } from '@/lib/canvas-share/request';
import { getSessionUser, WUJIE_SESSION_COOKIE } from '@/lib/server-auth';
import { DocumentExchangeError } from '@/lib/collaboration/document-exchange-access';
import { readDocumentExchangeBytes } from '@/lib/collaboration/document-exchange-request';
import { executeDocumentExchangeUpdate, readDocumentExchangeReceipt } from '@/lib/collaboration/document-exchange-receipts';
import { readDocumentExchangeSnapshot } from '@/lib/collaboration/document-exchange-snapshot';
import { reserveDocumentExchangeRequest } from '@/lib/collaboration/document-exchange-admission';
import { documentTransportMode } from '@/lib/collaboration/document-transport-mode';
import { executeDocumentRoute } from '@/lib/collaboration/document-execution-route';
import { assertDocumentTransportAdmission, isDocumentTransportUnavailable } from '@/lib/collaboration/document-transport-gate';

// Isolated, default-off candidate. Original WebSocket entry remains independent.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function privateHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store'); response.headers.set('Pragma', 'no-cache');
  response.headers.set('Vary', 'Cookie'); response.headers.set('X-Content-Type-Options', 'nosniff'); return response;
}
function failure(code: string, status: number): NextResponse {
  return privateHeaders(NextResponse.json({ success: false, code }, { status }));
}
function invalid(): never { throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID'); }

export async function POST(request: NextRequest): Promise<NextResponse> {
  return executeDocumentRoute(request, () => handle(request), failure);
}
async function handle(request: NextRequest): Promise<NextResponse> {
  if (process.env.WUJIE_YJS_ENABLED !== 'true' || process.env.WUJIE_YJS_HTTP_ENABLED !== 'true') {
    return failure('DOCUMENT_EXCHANGE_DISABLED', 503);
  }
  let release: (() => void) | undefined;
  try {
    assertCanvasShareMutationOrigin(request);
    if (request.nextUrl.search) invalid();
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/octet-stream') {
      return failure('DOCUMENT_EXCHANGE_INVALID', 415);
    }
    const user = await getSessionUser(request), cookie = request.cookies.get(WUJIE_SESSION_COOKIE)?.value;
    if (!user || !cookie) return failure('AUTHENTICATION_REQUIRED', 401);
    if (request.headers.get('x-wujie-expected-actor-id') !== user.id) return failure('ACTOR_SCOPE_CHANGED', 409);
    const projectId = request.headers.get('x-wujie-project-id') ?? '';
    const sessionToken = request.headers.get('x-wujie-document-session') ?? '';
    if (!projectId || projectId.length > 256 || projectId !== projectId.trim() || /[\u0000-\u001f\u007f]/u.test(projectId)
      || !/^[A-Za-z0-9_-]{43}$/u.test(sessionToken)
      || request.headers.has('x-wujie-document-ticket') || request.headers.has('x-wujie-document-grant-generation')) invalid();
    const operationId = request.headers.get('x-wujie-document-operation-id');
    const mode = request.headers.get('x-wujie-document-operation');
    const after = request.headers.get('x-wujie-document-after-sequence');
    if (mode !== null && mode !== 'receipt') invalid();
    if (after !== null && (!/^(?:0|[1-9]\d*)$/u.test(after) || !Number.isSafeInteger(Number(after)))) invalid();
    release = reserveDocumentExchangeRequest(user.id);
    const frame = await readDocumentExchangeBytes(request, 1_048_577);
    if (request.signal.aborted || frame.length < 2) invalid();
    if (documentTransportMode() !== 'http') return failure('DOCUMENT_EXCHANGE_DISABLED', 503);
    const identity = { actorId: user.id, projectId, sessionToken, authSessionHash: createHash('sha256').update(cookie).digest('hex') };
    assertDocumentTransportAdmission();
    if (frame[0] === 1) {
      if (operationId !== null || mode !== null) invalid();
      const snapshot = await readDocumentExchangeSnapshot({ ...identity, stateVector: frame.subarray(1),
        ...(after !== null ? { afterSequence: Number(after) } : {}) });
      const headers = { 'x-wujie-document-session-fingerprint': snapshot.sessionFingerprint };
      const bytes = new Uint8Array(9 + snapshot.update.length); bytes[0] = 0x11;
      new DataView(bytes.buffer).setBigUint64(1, BigInt(snapshot.sequence), false); bytes.set(snapshot.update, 9);
      return privateHeaders(new NextResponse(bytes.buffer, { headers: { ...headers, 'Content-Type': 'application/octet-stream' } }));
    }
    if (frame[0] !== 2 || !operationId || !/^[A-Za-z0-9_-]{16,128}$/u.test(operationId) || after !== null) invalid();
    const input = { ...identity, operationId, bytes: frame.subarray(1) };
    const receipt = mode === 'receipt' ? await readDocumentExchangeReceipt(input) : await executeDocumentExchangeUpdate(input);
    return privateHeaders(NextResponse.json({ success: true, receipt }));
  } catch (error) {
    if (isDocumentTransportUnavailable(error)) throw error;
    if (error instanceof CanvasShareHttpError) return failure('DOCUMENT_EXCHANGE_INVALID', error.status);
    if (error instanceof DocumentExchangeError) {
      const status = error.code === 'DOCUMENT_EXCHANGE_INVALID' || error.code === 'DOCUMENT_EXCHANGE_REQUEST_CANCELLED' ? 400
        : error.code === 'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT' ? 408 : error.code === 'DOCUMENT_EXCHANGE_TOO_LARGE' ? 413
          : error.code === 'DOCUMENT_EXCHANGE_FORBIDDEN' || error.code === 'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN' ? 403
            : error.code === 'DOCUMENT_EXCHANGE_CONFLICT' || error.code === 'DOCUMENT_EXCHANGE_DEPENDENCY_PENDING' ? 409
              : error.code === 'DOCUMENT_EXCHANGE_REJECTED' ? 422 : error.code === 'DOCUMENT_EXCHANGE_BUSY' ? 429 : 503;
      return failure(error.code, status);
    }
    return failure('DOCUMENT_EXCHANGE_UNAVAILABLE', 503);
  } finally { release?.(); }
}
