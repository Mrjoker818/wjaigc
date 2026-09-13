import { getInternalRequestHeaders } from '@/lib/api-auth';
import type { GatewayPrincipal } from '@/lib/media-gateway/key-service';
import type {
  GatewayImageRequest,
  GatewayVideoRequest,
} from '@/lib/media-gateway/schema';
import { GatewayError, type GatewayErrorCode } from '@/lib/media-gateway/types';

const INTERNAL_SUBMIT_TIMEOUT_MS = 30_000;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const DIAGNOSTIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
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

function rejectionCode(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'AUTHORITATIVE_REJECTED';
  const code = (value as Record<string, unknown>).code;
  return typeof code === 'string' && TASK_ID_PATTERN.test(code)
    ? code
    : 'AUTHORITATIVE_REJECTED';
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

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw unavailable();
  }
  const taskIds = authoritativeTaskIds(responseBody);
  if (taskIds === null) throw unavailable();
  if (taskIds.length > 0) {
    const status = responseBody && typeof responseBody === 'object'
      && typeof (responseBody as Record<string, unknown>).status === 'string'
      ? String((responseBody as Record<string, unknown>).status)
      : 'queued';
    return { kind: 'accepted', taskIds, status };
  }

  return {
    kind: 'rejected',
    taskIds: [],
    code: response.status >= 500
      ? 'GATEWAY_INTERNAL_UNAVAILABLE'
      : 'GATEWAY_INVALID_REQUEST',
    status: response.status >= 400 && response.status <= 599 ? response.status : 502,
    retryable: response.status >= 500,
    rejectionCode: rejectionCode(responseBody),
  };
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
