import { classifyApiError } from '@/lib/smart-retry';
import {
  normalizeTaskError,
  type UnifiedTaskError,
} from '@/lib/task-core/task-error';

interface RecoverySubmissionFailureInput {
  status?: number;
  responseData?: Record<string, unknown> | null;
  error?: unknown;
  attemptCount: number;
  requestId: string;
}

export interface RecoverySubmissionFailureDecision {
  defer: boolean;
  retryDelayMs: number;
  taskError: UnifiedTaskError;
}

const SAFE_FAILURES: Record<string, { code: string; message: string }> = {
  rate_limit: {
    code: 'TASK_RECOVERY_RATE_LIMITED',
    message: '上游服务请求过于频繁，正在自动重试',
  },
  server_error: {
    code: 'TASK_RECOVERY_PROVIDER_UNAVAILABLE',
    message: '上游服务暂时不可用，正在自动重试',
  },
  cf_timeout: {
    code: 'TASK_RECOVERY_PROVIDER_TIMEOUT',
    message: '上游网关响应超时，正在自动重试',
  },
  network_error: {
    code: 'TASK_RECOVERY_NETWORK_ERROR',
    message: '任务恢复连接暂时中断，正在自动重试',
  },
  auth_error: {
    code: 'TASK_RECOVERY_AUTH_FAILED',
    message: '模型提供商凭证无效或权限不足',
  },
  insufficient_quota: {
    code: 'TASK_RECOVERY_PROVIDER_QUOTA_EXHAUSTED',
    message: '模型提供商账户额度不足',
  },
  model_not_found: {
    code: 'TASK_RECOVERY_MODEL_UNAVAILABLE',
    message: '所选模型当前不可用',
  },
  content_blocked: {
    code: 'TASK_RECOVERY_CONTENT_BLOCKED',
    message: '生成内容未通过模型提供商审核',
  },
  size_error: {
    code: 'TASK_RECOVERY_SIZE_REJECTED',
    message: '所选模型不支持当前图像尺寸',
  },
  request_error: {
    code: 'TASK_RECOVERY_REQUEST_REJECTED',
    message: '模型提供商拒绝了当前生成参数',
  },
  unknown: {
    code: 'TASK_RECOVERY_FAILED',
    message: '任务恢复失败，请稍后重试',
  },
};

function getRawFailureMessage(input: RecoverySubmissionFailureInput): string {
  if (input.error instanceof Error) return input.error.message;
  if (input.error !== undefined) return String(input.error);
  const responseError = input.responseData?.error;
  if (typeof responseError === 'string') return responseError;
  const responseMessage = input.responseData?.message;
  if (typeof responseMessage === 'string') return responseMessage;
  return input.status ? `Recovery submission failed (${input.status})` : 'Recovery submission failed';
}

export function classifyRecoverySubmissionFailure(
  input: RecoverySubmissionFailureInput,
): RecoverySubmissionFailureDecision {
  const rawMessage = getRawFailureMessage(input);
  const responseBody = input.responseData ? JSON.stringify(input.responseData) : undefined;
  const classified = classifyApiError(rawMessage, input.status, responseBody);
  const safe = SAFE_FAILURES[classified.category] || SAFE_FAILURES.unknown;
  const retryBudget = Math.max(0, classified.suggestedRetries);
  const defer = classified.isRetryable && input.attemptCount <= retryBudget;
  const source = classified.category === 'network_error'
    ? 'network'
    : input.status || classified.category !== 'unknown'
      ? 'provider'
      : 'wujie';

  return {
    defer,
    retryDelayMs: defer ? Math.max(3_000, classified.retryDelayMs) : 0,
    taskError: normalizeTaskError(null, {
      code: safe.code,
      message: safe.message,
      source,
      retryable: classified.isRetryable,
      requestId: input.requestId,
      providerStatus: input.status,
    }),
  };
}
