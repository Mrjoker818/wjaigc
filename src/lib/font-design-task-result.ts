type UnknownRecord = Record<string, unknown>;

/**
 * Normalizes the font-design fallback cache to the same result payload used by
 * the normal task-registry path.
 */
export function unwrapFontDesignTaskResult(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const cached = value as UnknownRecord;
  if (!cached.result || typeof cached.result !== 'object' || Array.isArray(cached.result)) {
    return undefined;
  }
  return cached.result as UnknownRecord;
}
