export interface FailedProcessingFrame {
  progress: -1;
  status: string;
  error: string;
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
    if (parsed && typeof parsed === 'object') {
      const data = parsed as { error?: unknown; message?: unknown };
      if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
      if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
    }
  } catch {
    // A plain-text error response is still useful feedback to the user.
  }

  return trimmed;
}
