import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  assertCanvasShareMutationRequest,
  CanvasShareHttpError,
} from '@/lib/canvas-share/request';
import { readDocumentExchangeJson } from '@/lib/collaboration/document-exchange-request';
import { DocumentExchangeError } from '@/lib/collaboration/document-exchange-access';
import { issueDocumentTicket } from '@/lib/collaboration/document-tickets';
import { documentTransportMode } from '@/lib/collaboration/document-transport-mode';
import { assertDocumentTransportAdmission, isDocumentTransportUnavailable } from '@/lib/collaboration/document-transport-gate';
import { getSessionUser } from '@/lib/server-auth';
import { executeDocumentRoute } from '@/lib/collaboration/document-execution-route';
import { reserveDocumentExecutionActor } from '@/lib/collaboration/document-execution-scope';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  projectId: z.string().trim().min(1).max(256)
    .refine(value => !/[\u0000-\u001f\u007f]/u.test(value)),
}).strict();

function response(data: Record<string, unknown>, status: number): NextResponse {
  const result = NextResponse.json(data, { status });
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('Pragma', 'no-cache');
  result.headers.set('Vary', 'Cookie');
  return result;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return executeDocumentRoute(request, () => handle(request), (code, status) => response({ success: false, code }, status));
}
async function handle(request: NextRequest): Promise<NextResponse> {
  if (process.env.WUJIE_YJS_ENABLED !== 'true') {
    return response({ success: false, code: 'DOCUMENT_DISABLED' }, 503);
  }
  let user: Awaited<ReturnType<typeof getSessionUser>>;
  try { user = await getSessionUser(request); }
  catch { return response({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' }, 500); }
  if (!user) return response({ success: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
  const expectedActorId = request.headers.get('x-wujie-expected-actor-id');
  if (expectedActorId !== null && expectedActorId !== user.id) {
    return response({ success: false, code: 'ACTOR_SCOPE_CHANGED' }, 409);
  }
  reserveDocumentExecutionActor(user.id);
  const requestedTransport = request.headers.get('x-wujie-document-transport');
  const transportAllowed = (): boolean => documentTransportMode() === 'http'
    ? requestedTransport === 'http' : requestedTransport === null || requestedTransport === 'ws';
  let issueStarted = false;

  try {
    assertCanvasShareMutationRequest(request);
    if (request.nextUrl.search) {
      return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
    }
    const parsed = requestSchema.safeParse(await readDocumentExchangeJson(request));
    if (!parsed.success) {
      return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
    }
    if (process.env.WUJIE_YJS_ENABLED !== 'true') return response({ success: false, code: 'DOCUMENT_DISABLED' }, 503);
    if (requestedTransport !== null && requestedTransport !== 'ws' && requestedTransport !== 'http') {
      return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
    }
    if (!transportAllowed()) return response({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' }, 409);
    assertDocumentTransportAdmission();
    issueStarted = true;
    const ticket = await issueDocumentTicket(user.id, parsed.data.projectId);
    if (process.env.WUJIE_YJS_ENABLED !== 'true') return response({ success: false, code: 'DOCUMENT_DISABLED' }, 503);
    if (!transportAllowed()) return response({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' }, 409);
    assertDocumentTransportAdmission();
    return response({ success: true, ticket }, 200);
  } catch (error) {
    if (isDocumentTransportUnavailable(error)) throw error;
    if (error instanceof DocumentExchangeError) {
      if (error.code === 'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT') return response({ success: false, code: error.code }, 408);
      if (error.code === 'DOCUMENT_EXCHANGE_REQUEST_CANCELLED') return response({ success: false, code: error.code }, 400);
      return response({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }, 400);
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
    if (typeof error === 'object' && error !== null
      && 'code' in error && error.code === 'DOCUMENT_PROJECT_NOT_ENABLED') {
      return response({ success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' }, 409);
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'DOCUMENT_DISABLED') {
      return response({ success: false, code: 'DOCUMENT_DISABLED' }, 503);
    }
    if (issueStarted && process.env.WUJIE_YJS_ENABLED !== 'true') return response({ success: false, code: 'DOCUMENT_DISABLED' }, 503);
    if (issueStarted && !transportAllowed()) return response({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' }, 409);
    if (typeof error === 'object' && error !== null
      && 'code' in error && error.code === 'DOCUMENT_TICKET_LIMIT') {
      return response({ success: false, code: 'DOCUMENT_TICKET_LIMIT' }, 429);
    }
    return response({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' }, 500);
  }
}
