export interface FailedProcessingFrame {
  progress: -1;
  status: string;
  error: string;
}

type ErrorRecord = Record<string, unknown>;

const CONTENT_REVIEW_MESSAGE = '当前图片未通过 302.AI 的内容审核，请更换图片或改用其他放大模型。';

function isRecord(value: unknown): value is ErrorRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readProviderCode(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function parseEmbeddedJson(value: string | null): ErrorRecord | null {
  if (!value) return null;
  const jsonStart = value.indexOf('{');
  if (jsonStart < 0) return null;

  try {
    const parsed: unknown = JSON.parse(value.slice(jsonStart));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractProviderCode(payload: ErrorRecord | null): string | null {
  if (!payload) return null;
  const nestedError = isRecord(payload.error) ? payload.error : null;
  return readProviderCode(payload.providerCode)
    || readProviderCode(payload.err_code)
    || readProviderCode(payload.error_code)
    || readProviderCode(nestedError?.err_code)
    || readProviderCode(nestedError?.error_code)
    || readProviderCode(nestedError?.code);
}

function extractNestedMessage(payload: ErrorRecord | null): string | null {
  if (!payload) return null;
  const nestedError = isRecord(payload.error) ? payload.error : null;
  return readString(nestedError?.message_cn)
    || readString(nestedError?.message)
    || readString(payload.message_cn)
    || readString(payload.message)
    || readString(payload.err_msg);
}

function isContentReviewRejection(providerCode: string | null, messages: Array<string | null>): boolean {
  if (providerCode === '-10021') return true;
  const combined = messages.filter((message): message is string => Boolean(message)).join(' ').toLowerCase();
  return combined.includes('content checker')
    || combined.includes('material flagged')
    || combined.includes('content could not be processed')
    || combined.includes('内容检查器');
}

export function buildFailedProcessingFrame(
  message: string | null | undefined,
  fallbackMessage: string,
): FailedProcessingFrame {
  const error = message?.trim() || fallbackMessage;

  return {
    progress: -1,
    status: `❌ ${error}`,
    error,
  };
}

export function extractImageEditErrorMessage(rawResponse: string, status: number): string {
  const fallback = `服务器错误 (${status})`;
  const trimmed = rawResponse.trim();
  if (!trimmed) return fallback;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      const responseError = readString(parsed.error);
      const embeddedPayload = parseEmbeddedJson(responseError);
      const providerCode = extractProviderCode(parsed) || extractProviderCode(embeddedPayload);
      const nestedMessage = extractNestedMessage(embeddedPayload);
      const directMessage = responseError || extractNestedMessage(parsed);

      if (isContentReviewRejection(providerCode, [responseError, nestedMessage, directMessage])) {
        return CONTENT_REVIEW_MESSAGE;
      }

      if (embeddedPayload && responseError) {
        return '302.AI 放大失败，请稍后重试或切换其他放大模型。';
      }

      if (directMessage) return directMessage;
    }
  } catch {
    // A plain-text error response is still useful feedback to the user.
  }

  return trimmed;
}
