type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as UnknownRecord;
}

function getMessageText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const message = value.replace(/\s+/g, ' ').trim();
  return message ? message.slice(0, 320) : null;
}

/**
 * Preserve the provider's actionable task failure for canvas generation groups.
 * Polling payloads differ between providers, so only inspect documented
 * top-level and result-level error fields before using the generic fallback.
 */
export function getGroupGenerationFailureMessage(failures: Iterable<unknown>): string {
  for (const failure of failures) {
    const directMessage = getMessageText(failure);
    if (directMessage) {
      return directMessage;
    }

    const payload = asRecord(failure);
    if (!payload) {
      continue;
    }

    const result = asRecord(payload.result);
    const candidates = [
      payload.error,
      payload.message,
      payload.detail,
      result?.error,
      result?.message,
      result?.detail,
    ];

    for (const candidate of candidates) {
      const message = getMessageText(candidate);
      if (message) {
        return message;
      }
    }
  }

  return '生成任务失败，但服务端未返回详细原因';
}
