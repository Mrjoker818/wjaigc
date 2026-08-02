export type UpscaleProviderErrorCode =
  | 'UPSCALE_PROVIDER_REJECTED'
  | 'UPSCALE_PROVIDER_AUTH'
  | 'UPSCALE_PROVIDER_RATE_LIMIT'
  | 'UPSCALE_PROVIDER_TIMEOUT'
  | 'UPSCALE_PROVIDER_UNAVAILABLE';

export class UpscaleProviderError extends Error {
  readonly provider = '302.ai';

  constructor(
    message: string,
    readonly status: number,
    readonly code: UpscaleProviderErrorCode,
    readonly retryable: boolean,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = 'UpscaleProviderError';
  }
}

function parseProviderPayload(rawBody: string): {
  message: string;
  providerCode?: string;
} {
  const trimmed = rawBody.trim();
  if (!trimmed) return { message: '302.AI 未返回错误说明' };

  try {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    const nestedError = payload.error && typeof payload.error === 'object'
      ? payload.error as Record<string, unknown>
      : undefined;
    const message = [
      payload.err_msg,
      payload.message,
      payload.msg,
      nestedError?.message,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const code = [
      payload.err_code,
      payload.error_code,
      payload.code,
      nestedError?.code,
    ].find((value): value is string | number => typeof value === 'string' || typeof value === 'number');

    return {
      message: message?.trim() || trimmed,
      providerCode: code === undefined ? undefined : String(code),
    };
  } catch {
    return { message: trimmed };
  }
}

export function parse302UpscaleProviderError(
  status: number,
  rawBody: string,
): UpscaleProviderError {
  const { message, providerCode } = parseProviderPayload(rawBody);
  let code: UpscaleProviderErrorCode;
  let retryable: boolean;

  if (status === 401 || status === 403) {
    code = 'UPSCALE_PROVIDER_AUTH';
    retryable = false;
  } else if (status === 400 || status === 422) {
    code = 'UPSCALE_PROVIDER_REJECTED';
    retryable = false;
  } else if (status === 429) {
    code = 'UPSCALE_PROVIDER_RATE_LIMIT';
    retryable = true;
  } else if (status === 408 || status === 504) {
    code = 'UPSCALE_PROVIDER_TIMEOUT';
    retryable = true;
  } else {
    code = 'UPSCALE_PROVIDER_UNAVAILABLE';
    retryable = true;
  }

  const providerSuffix = providerCode ? ` [302:${providerCode}]` : '';
  return new UpscaleProviderError(
    `302.AI 放大失败${providerSuffix}: ${message}`,
    status,
    code,
    retryable,
    providerCode,
  );
}
