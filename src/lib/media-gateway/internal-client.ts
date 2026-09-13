import { NextRequest, NextResponse } from 'next/server';

import { getInternalRequestHeaders } from '@/lib/api-auth';
import {
  markGatewayAdmitted,
  markGatewayRejected,
  recordGatewayAttempt,
  reserveGatewayRequest,
} from '@/lib/media-gateway/admission';
import { readGatewayJson } from '@/lib/media-gateway/http';
import {
  authenticateGatewayBearer,
  type GatewayPrincipal,
} from '@/lib/media-gateway/key-service';
import {
  digestGatewayRequest,
  type GatewayImageRequest,
  type GatewayVideoRequest,
} from '@/lib/media-gateway/schema';
import { GatewayError, type GatewayErrorCode } from '@/lib/media-gateway/types';
import { getRequestId } from '@/lib/request-id';
import { assertGatewayProjectAccess } from '@/lib/media-gateway/project-access';

const INTERNAL_SUBMIT_TIMEOUT_MS = 30_000;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const DIAGNOSTIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const PUBLIC_ACCEPTED_STATUSES = new Set(['queued', 'processing']);
const FORBIDDEN_FIELD = /^(?:_skipCredits|_skipCloudTaskPersistence|sourceChannel)$/i;
const SECRET_FIELD = /(?:api[_-]?key|authorization|secret|hash)/i;

export type GatewayAuthSource = 'cookie' | 'desktop-token' | 'internal';

export interface TrustedGatewayContext {
  sourceChannel: 'gateway';
  gatewayRequestId?: string;
  gatewayKeyId?: string;
}

interface SubmitGatewayInput<T> {
  principal: GatewayPrincipal;
  requestId: string;
  gatewayRequestId: string;
  input: T;
}

interface GatewayRouteConfig<T extends object> {
  mediaType: 'image' | 'video';
  normalize: (value: unknown) => T;
  submit: (input: SubmitGatewayInput<T>) => Promise<GatewaySubmissionResult>;
}

export type GatewaySubmissionResult =
  | { kind: 'accepted'; taskIds: string[]; status: string }
  | {
      kind: 'rejected';
      taskIds: [];
      code: GatewayErrorCode;
      status: number;
      retryable: boolean;
      rejectionCode: string;
    };

function safeDiagnosticId(value: string | null): string | undefined {
  const normalized = value?.trim() || '';
  return DIAGNOSTIC_ID_PATTERN.test(normalized) ? normalized : undefined;
}

export function trustedGatewayContext(
  authSource: GatewayAuthSource,
  headers: Headers,
): TrustedGatewayContext | undefined {
  if (authSource !== 'internal' || headers.get('x-wujie-source-channel') !== 'gateway') {
    return undefined;
  }
  const gatewayRequestId = safeDiagnosticId(headers.get('x-wujie-gateway-request-id'));
  const gatewayKeyId = safeDiagnosticId(headers.get('x-wujie-gateway-key-id'));
  return {
    sourceChannel: 'gateway',
    ...(gatewayRequestId ? { gatewayRequestId } : {}),
    ...(gatewayKeyId ? { gatewayKeyId } : {}),
  };
}

async function gatewayHeaders(
  principal: GatewayPrincipal,
  requestId: string,
  gatewayRequestId: string,
): Promise<Record<string, string>> {
  return {
    'content-type': 'application/json',
    'x-request-id': requestId,
    ...(await getInternalRequestHeaders(principal.userId, 'user')),
    'x-wujie-source-channel': 'gateway',
    'x-wujie-gateway-request-id': gatewayRequestId,
    'x-wujie-gateway-key-id': principal.keyId,
    'x-wujie-agent-strict-routing': 'true',
    'idempotency-key': gatewayRequestId,
  };
}

function unavailable(): GatewayError {
  return new GatewayError(
    'GATEWAY_INTERNAL_UNAVAILABLE',
    503,
    'Media gateway internal submission is unavailable',
    true,
  );
}

function authoritativeTaskIds(value: unknown): string[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.taskIds !== undefined) {
    if (!Array.isArray(body.taskIds)) return null;
    if (body.taskIds.some(taskId => typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId))) {
      return null;
    }
    if (body.taskIds.length > 0) return body.taskIds as string[];
  }
  if (body.taskId === undefined || body.taskId === null || body.taskId === '') return [];
  return typeof body.taskId === 'string' && TASK_ID_PATTERN.test(body.taskId)
    ? [body.taskId]
    : null;
}

function isExplicitClientRejection(response: Response, value: unknown): boolean {
  if (response.status < 400 || response.status > 499) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return body.success === false
    || (typeof body.error === 'string' && body.error.length > 0)
    || (typeof body.error === 'object' && body.error !== null)
    || (typeof body.code === 'string' && body.code.length > 0);
}

function acceptedStatus(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'queued';
  const status = (value as Record<string, unknown>).status;
  return typeof status === 'string' && PUBLIC_ACCEPTED_STATUSES.has(status)
    ? status
    : 'queued';
}

async function submitAuthoritative(
  path: string,
  body: Record<string, unknown>,
  context: Omit<SubmitGatewayInput<unknown>, 'input'>,
): Promise<GatewaySubmissionResult> {
  let response: Response;
  try {
    response = await fetch(
      `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${path}`,
      {
        method: 'POST',
        headers: await gatewayHeaders(
          context.principal,
          context.requestId,
          context.gatewayRequestId,
        ),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(INTERNAL_SUBMIT_TIMEOUT_MS),
      },
    );
  } catch {
    throw unavailable();
  }

  if (response.status >= 500 && response.status <= 599) throw unavailable();

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw unavailable();
  }
  const taskIds = authoritativeTaskIds(responseBody);
  if (taskIds === null) throw unavailable();
  if (taskIds.length > 0) {
    return { kind: 'accepted', taskIds, status: acceptedStatus(responseBody) };
  }

  if (!isExplicitClientRejection(response, responseBody)) throw unavailable();

  return {
    kind: 'rejected',
    taskIds: [],
    code: 'GATEWAY_INVALID_REQUEST',
    status: 400,
    retryable: false,
    rejectionCode: 'GATEWAY_INVALID_REQUEST',
  };
}

function stableMessage(code: GatewayErrorCode): string {
  if (code === 'GATEWAY_DISABLED') return 'Media gateway is disabled';
  if (code === 'GATEWAY_AUTH_REQUIRED') return 'Gateway bearer authentication is required';
  if (code === 'GATEWAY_KEY_INVALID') return 'Gateway key is invalid';
  if (code === 'GATEWAY_RATE_LIMITED') return '请求过于频繁，请稍后重试';
  if (code === 'GATEWAY_DAILY_QUOTA_EXCEEDED') return 'Gateway daily quota exceeded';
  if (code === 'GATEWAY_IDEMPOTENCY_REQUIRED') return 'Idempotency-Key is required';
  if (code === 'GATEWAY_IDEMPOTENCY_CONFLICT') return 'Idempotency key conflicts with another request';
  if (code === 'GATEWAY_BODY_TOO_LARGE') return 'Gateway request body is too large';
  if (code === 'GATEWAY_INVALID_REQUEST') return 'Invalid gateway request';
  return 'Media gateway is unavailable';
}

function errorResponse(
  requestId: string,
  code: GatewayErrorCode,
  status: number,
  retryable = false,
): NextResponse {
  return NextResponse.json({
    success: false, code, message: stableMessage(code), requestId, retryable,
  }, { status });
}

function successResponse(
  requestId: string,
  gatewayRequestId: string,
  taskIds: string[],
  status: string,
): NextResponse {
  return NextResponse.json({
    success: true,
    requestId,
    gatewayRequestId,
    taskId: taskIds[0],
    taskIds,
    status,
  }, { status: 202 });
}

function assertSafeExternalBody(value: unknown, ancestors = new Set<object>()): void {
  if (!value || typeof value !== 'object') return;
  if (ancestors.has(value)) throw new GatewayError('GATEWAY_INVALID_REQUEST', 400, 'Invalid body');
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeExternalBody(entry, ancestors);
  } else {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_FIELD.test(key) || SECRET_FIELD.test(key)) {
        throw new GatewayError('GATEWAY_INVALID_REQUEST', 400, 'Forbidden field');
      }
      assertSafeExternalBody(entry, ancestors);
    }
  }
  ancestors.delete(value);
}

export async function handleGatewaySubmission<T extends object>(
  request: NextRequest,
  config: GatewayRouteConfig<T>,
): Promise<NextResponse> {
  const requestId = getRequestId(request);
  if (process.env.GATEWAY_ENABLED !== 'true') {
    return errorResponse(requestId, 'GATEWAY_DISABLED', 503);
  }

  try {
    const authorization = request.headers.get('authorization');
    if (!authorization) {
      throw new GatewayError('GATEWAY_AUTH_REQUIRED', 401, 'Authentication required');
    }
    const principal = await authenticateGatewayBearer(authorization);
    const attemptPermit = await recordGatewayAttempt(principal);
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
    if (!idempotencyKey) {
      throw new GatewayError('GATEWAY_IDEMPOTENCY_REQUIRED', 400, 'Idempotency required');
    }
    const rawBody = await readGatewayJson(request);
    assertSafeExternalBody(rawBody);
    const input = config.normalize(rawBody);
    await assertGatewayProjectAccess(principal, (input as { projectId: string }).projectId);
    const decision = await reserveGatewayRequest({
      principal,
      idempotencyKey,
      requestDigest: digestGatewayRequest(input),
      mediaType: config.mediaType,
      attemptPermit,
    });

    if (decision.kind === 'reuse') {
      if (decision.request.admissionStatus === 'admitted' && decision.request.taskIds.length > 0) {
        return successResponse(requestId, decision.request.id, decision.request.taskIds, 'queued');
      }
      if (decision.request.admissionStatus === 'rejected') {
        return errorResponse(requestId, 'GATEWAY_INVALID_REQUEST', 400);
      }
      return errorResponse(requestId, 'GATEWAY_INTERNAL_UNAVAILABLE', 503, true);
    }

    const submission = await config.submit({
      principal, requestId, gatewayRequestId: decision.request.id, input,
    });
    if (submission.kind === 'rejected') {
      await markGatewayRejected({
        gatewayRequestId: decision.request.id,
        rejectionCode: submission.rejectionCode,
        outcome: 'explicit',
      });
      return errorResponse(requestId, submission.code, submission.status, submission.retryable);
    }
    await markGatewayAdmitted({
      gatewayRequestId: decision.request.id,
      taskIds: submission.taskIds,
    });
    return successResponse(
      requestId,
      decision.request.id,
      submission.taskIds,
      submission.status,
    );
  } catch (error) {
    if (error instanceof GatewayError) {
      return errorResponse(requestId, error.code, error.status, error.retryable);
    }
    return errorResponse(requestId, 'GATEWAY_INTERNAL_UNAVAILABLE', 503, true);
  }
}

export async function submitGatewayImage(
  input: SubmitGatewayInput<GatewayImageRequest>,
): Promise<GatewaySubmissionResult> {
  const count = input.input.n ?? 1;
  const { modelId, ...rest } = input.input;
  return submitAuthoritative('/api/generate', {
    ...rest,
    model: modelId,
    n: count,
    outputCount: count,
    submitOnly: true,
  }, input);
}

export async function submitGatewayVideo(
  input: SubmitGatewayInput<GatewayVideoRequest>,
): Promise<GatewaySubmissionResult> {
  const { modelId, firstFrameImageUrl, ...rest } = input.input;
  return submitAuthoritative('/api/video/generate', {
    ...rest,
    model: modelId,
    ...(firstFrameImageUrl ? { imageUrl: firstFrameImageUrl } : {}),
  }, input);
}
