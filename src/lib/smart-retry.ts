/**
 * CF 524/504 智能重试 + 错误分类模块
 *
 * 参考 Image-Studio 的 IsRetryable / DescribeProblem 设计，
 * 实现 Cloudflare 超时识别、错误分类和智能重试策略。
 *
 * 安全设计：
 * - 只在明确识别到 CF 超时错误时才触发重试
 * - 其他错误走原有逻辑，不影响现有行为
 * - 同模型重试 2 次（间隔 10s），不需要切换模型
 */

import { translateApiError, isCloudflareTimeoutError } from './api-error-translator';

/** 错误分类 */
export type ErrorCategory =
  | 'cf_timeout'        // Cloudflare 524/504 网关超时
  | 'rate_limit'        // 限速 429
  | 'insufficient_quota' // 余额不足
  | 'auth_error'        // 认证失败 401/403
  | 'model_not_found'   // 模型不可用
  | 'content_blocked'   // 内容审核拦截
  | 'size_error'        // 尺寸无效
  | 'server_error'      // 服务端错误 5xx
  | 'network_error'     // 网络层错误（连接重置、DNS、超时等）
  | 'request_error'     // 请求格式错误 400
  | 'unknown';          // 未知错误

/** 分类后的错误信息 */
export interface ClassifiedError {
  category: ErrorCategory;
  /** 原始错误消息 */
  rawMessage: string;
  /** 是否可重试 */
  isRetryable: boolean;
  /** 建议重试次数（0 = 不重试） */
  suggestedRetries: number;
  /** 重试间隔（毫秒） */
  retryDelayMs: number;
  /** 翻译后的友好提示 */
  friendlyMessage: string;
  /** 操作建议 */
  suggestion: string;
}

/** CF 超时标记关键词 */
const CF_TIMEOUT_MARKERS = [
  'error code 524',
  '524: a timeout occurred',
  'error code 504',
  'gateway time-out',
  'gateway timeout',
  'origin_gateway_timeout',
  'error code 503',
  'service unavailable',
  'service temporarily unavailable',
];

/** 网络层 / 传输层错误关键词 (Image-Studio isTransportishError + 扩展) */
const NETWORK_ERROR_MARKERS = [
  'connection reset',
  'econnreset',
  'eof',
  'timeout',
  'deadline exceeded',
  'i/o timeout',
  'tls handshake',
  'no such host',
  'enotfound',
  'econnrefused',
  'socket hang up',
  'upstream connect error',
  'fetch failed',
  'epipe',
  'broken pipe',
  'premature close',
  'content-length',
  'redirect was aborted',
  'request aborted',
];

/** 上游可重试标记 (Image-Studio retryableMarkers + 扩展) */
const UPSTREAM_RETRYABLE_MARKERS = [
  'upstream request failed',
  'error code 524',
  '524: a timeout occurred',
  'error code 503',
  'service unavailable',
  'error code 504',
  'gateway time-out',
  'service temporarily unavailable',
  'origin_gateway_timeout',
  'overloaded',
  'capacity',
  'try again',
  'please retry',
  'temporarily unavailable',
];

/**
 * 分类 API 错误
 *
 * 核心函数：将原始 API 错误消息分类，决定是否重试以及如何重试
 */
export function classifyApiError(
  errorMessage: string,
  statusCode?: number,
  responseBody?: string,
): ClassifiedError {
  const lower = (errorMessage || '').toLowerCase();
  const bodyLower = (responseBody || '').toLowerCase();
  const combinedLower = lower + ' ' + bodyLower;

  // 1. CF 超时（最高优先级，因为这是最常见的可恢复错误）
  if (isCFTimeout(combinedLower)) {
    return {
      category: 'cf_timeout',
      rawMessage: errorMessage,
      isRetryable: true,
      suggestedRetries: 2,
      retryDelayMs: 10000, // 10秒退避
      friendlyMessage: translateApiError('cloudflare_timeout').description,
      suggestion: 'Cloudflare 网关超时，同模型自动重试中...',
    };
  }

  // 2. 限速
  if (isRateLimit(combinedLower, statusCode)) {
    return {
      category: 'rate_limit',
      rawMessage: errorMessage,
      isRetryable: true,
      suggestedRetries: 1,
      retryDelayMs: 30000, // 30秒，限速需要更长时间
      friendlyMessage: translateApiError('rate_limit_exceeded').description,
      suggestion: '上游限速，稍后自动重试...',
    };
  }

  // 3. 认证错误
  if (isAuthError(combinedLower, statusCode)) {
    return {
      category: 'auth_error',
      rawMessage: errorMessage,
      isRetryable: false,
      suggestedRetries: 0,
      retryDelayMs: 0,
      friendlyMessage: translateApiError('invalid_api_key').description,
      suggestion: 'API Key 无效或已过期，请在管理员面板检查配置',
    };
  }

  // 4. 余额不足
  if (isInsufficientQuota(combinedLower)) {
    return {
      category: 'insufficient_quota',
      rawMessage: errorMessage,
      isRetryable: false,
      suggestedRetries: 0,
      retryDelayMs: 0,
      friendlyMessage: translateApiError('insufficient_quota').description,
      suggestion: '上游账户额度不足，请联系管理员充值或更换提供商',
    };
  }

  // 5. 模型不可用
  if (isModelNotFound(combinedLower, statusCode)) {
    return {
      category: 'model_not_found',
      rawMessage: errorMessage,
      isRetryable: false,
      suggestedRetries: 0,
      retryDelayMs: 0,
      friendlyMessage: translateApiError('model_not_found').description,
      suggestion: '指定模型不可用，请尝试切换其他模型',
    };
  }

  // 6. 内容审核拦截
  if (isContentBlocked(combinedLower)) {
    return {
      category: 'content_blocked',
      rawMessage: errorMessage,
      isRetryable: false,
      suggestedRetries: 0,
      retryDelayMs: 0,
      friendlyMessage: translateApiError('moderation_blocked').description,
      suggestion: '内容被审核系统拦截，请修改提示词后重试',
    };
  }

  // 7. 尺寸错误
  if (isSizeError(combinedLower)) {
    return {
      category: 'size_error',
      rawMessage: errorMessage,
      isRetryable: false,
      suggestedRetries: 0,
      retryDelayMs: 0,
      friendlyMessage: translateApiError('invalid_size').description,
      suggestion: '图片尺寸不被当前模型支持，系统将自动修正',
    };
  }

  // 8. 网络层错误
  if (isNetworkError(combinedLower)) {
    return {
      category: 'network_error',
      rawMessage: errorMessage,
      isRetryable: true,
      suggestedRetries: 2,
      retryDelayMs: 5000, // 5秒
      friendlyMessage: '网络连接异常',
      suggestion: '网络不稳定，自动重试中...',
    };
  }

  // 9. 服务端错误 5xx（非 CF 超时）
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return {
      category: 'server_error',
      rawMessage: errorMessage,
      isRetryable: true,
      suggestedRetries: 1,
      retryDelayMs: 15000, // 15秒
      friendlyMessage: `上游服务错误 (${statusCode})`,
      suggestion: '上游服务暂时不可用，稍后自动重试...',
    };
  }

  // 10. 请求格式错误
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return {
      category: 'request_error',
      rawMessage: errorMessage,
      isRetryable: false,
      suggestedRetries: 0,
      retryDelayMs: 0,
      friendlyMessage: `请求格式错误 (${statusCode})`,
      suggestion: '请求参数有误，请检查后重试',
    };
  }

  // 11. 上游可重试标记（来自响应体中的 retryable 标志或 upstreamStatus）
  if (responseBody && isUpstreamRetryable(responseBody)) {
    return {
      category: 'server_error',
      rawMessage: errorMessage,
      isRetryable: true,
      suggestedRetries: 1,
      retryDelayMs: 15000,
      friendlyMessage: '上游服务暂时不可用',
      suggestion: '上游标记为可重试错误，自动重试中...',
    };
  }

  // 12. 传输层错误（来自 Image-Studio 的 isTransportishError）
  if (isTransportError(combinedLower)) {
    return {
      category: 'network_error',
      rawMessage: errorMessage,
      isRetryable: true,
      suggestedRetries: 2,
      retryDelayMs: 8000,
      friendlyMessage: '传输层连接异常',
      suggestion: '连接被重置或中断，自动重试中...',
    };
  }

  // 13. 未知错误
  return {
    category: 'unknown',
    rawMessage: errorMessage,
    isRetryable: false,
    suggestedRetries: 0,
    retryDelayMs: 0,
    friendlyMessage: errorMessage || '未知错误',
    suggestion: '请稍后重试或联系管理员',
  };
}

/** 识别 CF 超时 */
function isCFTimeout(lower: string): boolean {
  return CF_TIMEOUT_MARKERS.some(marker => lower.includes(marker));
}

/** 识别限速 */
function isRateLimit(lower: string, statusCode?: number): boolean {
  if (statusCode === 429) return true;
  return lower.includes('rate_limit') || lower.includes('rate limit') || lower.includes('too many requests');
}

/** 识别认证错误 */
function isAuthError(lower: string, statusCode?: number): boolean {
  if (statusCode === 401 || statusCode === 403) return true;
  return (
    lower.includes('invalid_api_key') ||
    lower.includes('incorrect_api_key') ||
    lower.includes('authentication') ||
    lower.includes('unauthorized') ||
    (lower.includes('api key') && (lower.includes('invalid') || lower.includes('expired')))
  );
}

/** 识别余额不足 */
function isInsufficientQuota(lower: string): boolean {
  return (
    lower.includes('insufficient_quota') ||
    lower.includes('billing_hard_limit') ||
    lower.includes('quota exceeded') ||
    lower.includes('insufficient quota')
  );
}

/** 识别模型不可用 */
function isModelNotFound(lower: string, statusCode?: number): boolean {
  if (statusCode === 404) return true;
  return (
    lower.includes('model_not_found') ||
    lower.includes('model not found') ||
    lower.includes('model is not available') ||
    lower.includes('no available channel')
  );
}

/** 识别内容审核拦截 */
function isContentBlocked(lower: string): boolean {
  return (
    lower.includes('moderation_blocked') ||
    lower.includes('content_policy_violation') ||
    lower.includes('content policy') ||
    lower.includes('safety') && lower.includes('blocked')
  );
}

/** 识别尺寸错误 */
function isSizeError(lower: string): boolean {
  return (
    lower.includes('invalid size') ||
    lower.includes('must be divisible by') ||
    (lower.includes('size') && lower.includes('not supported')) ||
    lower.includes('unsupported size')
  );
}

/** 识别网络层错误 */
function isNetworkError(lower: string): boolean {
  return NETWORK_ERROR_MARKERS.some(marker => lower.includes(marker));
}

/** 识别上游可重试错误（含响应体检查） */
function isUpstreamRetryable(body: string): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();

  // 1. 关键词匹配
  if (UPSTREAM_RETRYABLE_MARKERS.some(m => lower.includes(m))) return true;

  // 2. SSE 事件流中有 partial_image 但无 final image（流中断）
  let partialSeen = false;
  let finalSeen = false;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const ev = JSON.parse(payload);
      const evType = ev?.type;
      if (evType === 'response.image_generation_call.partial_image' && ev?.partial_image_b64) partialSeen = true;
      if (evType === 'response.output_item.done' && ev?.item?.type === 'image_generation_call' && ev?.item?.result) finalSeen = true;
      if ((evType === 'image_generation.partial_image' || evType === 'image_edit.partial_image') && ev?.b64_json) partialSeen = true;
      if ((evType === 'image_generation.completed' || evType === 'image_edit.completed') && ev?.b64_json) finalSeen = true;
    } catch { /* skip */ }
  }
  if (partialSeen && !finalSeen) return true;

  // 3. JSON 结构化检查
  try {
    const data = JSON.parse(body);
    if (data?.retryable === true) return true;
    if ([403, 502, 503, 504, 524].includes(Number(data?.status))) return true;
    const err = data?.error;
    if (err && typeof err === 'object') {
      const upstreamStatus = Number(err.upstreamStatus ?? err.upstream_status ?? err.status);
      if ([403, 502, 503, 504, 524].includes(upstreamStatus)) return true;
      const msg = String(err.message || '').toLowerCase();
      if (msg.includes('temporarily unavailable') || msg.includes('upstream request failed')) return true;
      const errType = String(err.type || '').toLowerCase();
      if (['api_error', 'server_error', 'upstream_error'].includes(errType)) return true;
    }
  } catch { /* not JSON */ }

  return false;
}

/** 传输层错误关键词（来自 Image-Studio isTransportishError） */
const TRANSPORT_ERROR_MARKERS = [
  'connection reset',
  'eof',
  'timeout',
  'deadline exceeded',
  'i/o timeout',
  'tls handshake',
  'no such host',
  'upstream connect error',
  'socket hang up',
  'econnrefused',
  'econnreset',
  'etimedout',
  'enotfound',
  'epipe',
];

/** 识别传输层错误 */
function isTransportError(errorMessage: string): boolean {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return TRANSPORT_ERROR_MARKERS.some(m => lower.includes(m));
}

/**
 * 带重试的 fetch 请求
 *
 * 核心重试逻辑：
 * - 根据 classifyApiError 的分类决定是否重试
 * - CF 超时：同模型重试 2 次，间隔 10s
 * - 限速：重试 1 次，间隔 30s
 * - 网络错误：重试 2 次，间隔 5s
 * - 其他不可重试错误：直接返回
 *
 * @param fetchFn - 实际的 fetch 函数
 * @param maxRetries - 最大重试次数（默认由错误分类决定）
 * @param onRetry - 重试回调
 */
export async function fetchWithSmartRetry<T>(
  fetchFn: () => Promise<T>,
  maxRetries?: number,
  onRetry?: (attempt: number, error: ClassifiedError) => void,
): Promise<T> {
  let lastError: ClassifiedError | null = null;
  let attemptCount = 0;
  const maxAttempts = maxRetries !== undefined ? maxRetries + 1 : 4; // 默认最多 3 次重试

  while (attemptCount < maxAttempts) {
    attemptCount++;
    try {
      return await fetchFn();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // 尝试从错误中提取 status code
      let statusCode: number | undefined;
      if (err && typeof err === 'object' && 'status' in err) {
        statusCode = (err as { status: number }).status;
      }

      lastError = classifyApiError(errMsg, statusCode);

      // 不可重试的错误，立即抛出
      if (!lastError.isRetryable) {
        throw err;
      }

      // 用分类建议的重试次数限制
      const effectiveMaxRetries = maxRetries ?? lastError.suggestedRetries;
      if (attemptCount - 1 >= effectiveMaxRetries) {
        throw err;
      }

      // 通知调用方
      if (onRetry) {
        onRetry(attemptCount - 1, lastError);
      }

      // 等待退避
      await new Promise(resolve => setTimeout(resolve, lastError?.retryDelayMs ?? 15000));
    }
  }

  throw new Error(lastError?.rawMessage || '多次重试后仍失败');
}

/**
 * 带重试的 fetch（HTTP 响应版本）
 *
 * 与 fetchWithSmartRetry 不同，这个版本检查 HTTP 状态码，
 * 因为某些 5xx 错误不会抛异常，而是返回非 200 响应。
 */
export async function fetchWithSmartRetryHttp(
  url: string,
  options: RequestInit,
  maxRetries?: number,
  onRetry?: (attempt: number, error: ClassifiedError) => void,
): Promise<Response> {
  let lastError: ClassifiedError | null = null;
  let attemptCount = 0;
  const maxAttempts = maxRetries !== undefined ? maxRetries + 1 : 4;

  while (attemptCount < maxAttempts) {
    attemptCount++;
    try {
      const response = await fetch(url, options);

      // 非 2xx 且是可重试的
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const classified = classifyApiError(body, response.status, body);

        if (classified.isRetryable && attemptCount < maxAttempts) {
          const effectiveMaxRetries = maxRetries ?? classified.suggestedRetries;
          if (attemptCount - 1 < effectiveMaxRetries) {
            if (onRetry) {
              onRetry(attemptCount - 1, classified);
            }
            await new Promise(resolve => setTimeout(resolve, classified.retryDelayMs));
            continue;
          }
        }

        // 不可重试或已达最大重试次数，返回原始响应（让调用方处理）
        return response;
      }

      return response;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      lastError = classifyApiError(errMsg);

      if (!lastError.isRetryable || attemptCount >= maxAttempts) {
        throw err;
      }

      const effectiveMaxRetries = maxRetries ?? lastError.suggestedRetries;
      if (attemptCount - 1 >= effectiveMaxRetries) {
        throw err;
      }

      if (onRetry) {
        onRetry(attemptCount - 1, lastError);
      }

      await new Promise(resolve => setTimeout(resolve, lastError?.retryDelayMs ?? 15000));
    }
  }

  throw new Error(lastError?.rawMessage || '多次重试后仍失败');
}
