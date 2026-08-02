const SECONDS_EPOCH_UPPER_BOUND = 100_000_000_000;

function isValidMilliseconds(value: number): boolean {
  return Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime());
}

/**
 * Converts legacy payment timestamps to the millisecond epoch used by the
 * current order schema. Invalid values remain absent instead of rendering as
 * "Invalid Date" in an administrator workflow.
 */
export function normalizePaymentTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    const milliseconds = value < SECONDS_EPOCH_UPPER_BOUND ? value * 1000 : value;
    return isValidMilliseconds(milliseconds) ? Math.trunc(milliseconds) : null;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue)) return normalizePaymentTimestamp(numericValue);

  const parsed = new Date(trimmed).getTime();
  return isValidMilliseconds(parsed) ? parsed : null;
}

export function formatPaymentTimestamp(value: unknown, locale = 'zh-CN'): string {
  const timestamp = normalizePaymentTimestamp(value);
  return timestamp === null ? '时间未知' : new Date(timestamp).toLocaleString(locale);
}
