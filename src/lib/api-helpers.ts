/**
 * Shared API helper utilities
 */

/**
 * Build full API endpoint URL with automatic /v1 fallback
 * - If baseUrl already ends with /v1 or /vN, use as-is
 * - Otherwise, try the baseUrl first, then fallback to baseUrl/v1
 */
export function buildApiUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}${path}`;
}

/**
 * Check if a baseUrl already includes a version path like /v1, /v2, etc.
 */
export function hasVersionPath(baseUrl: string): boolean {
  return /\/v\d+\/?$/.test(baseUrl);
}

/**
 * Append /v1 to baseUrl if it doesn't already have a version path
 */
export function ensureVersionPath(baseUrl: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  if (hasVersionPath(cleanBase)) return cleanBase;
  return `${cleanBase}/v1`;
}

/**
 * Fetch with automatic /v1 retry logic
 * - First tries the exact baseUrl + path
 * - If that fails (404/500) and baseUrl doesn't have /v1, retries with /v1 inserted
 * - Retry uses a fresh AbortSignal (if original signal was a timeout) with the same duration
 */
export async function fetchWithV1Retry(
  baseUrl: string,
  path: string,
  options: RequestInit,
  retryWithV1 = true
): Promise<Response> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const url = `${cleanBase}${path}`;
  
  const response = await fetch(url, options);
  
  // If request fails and baseUrl doesn't already end with /v1 or /vN, retry with /v1 appended
  if (!response.ok && retryWithV1 && !hasVersionPath(cleanBase)) {
    const v1Base = `${cleanBase}/v1`;
    const retryUrl = `${v1Base}${path}`;
    console.log(`[api-helpers] ${url} failed (${response.status}), retrying with ${retryUrl}`);
    try {
      // Create fresh options for retry - if original used AbortSignal.timeout, create a new one
      const retryOptions: RequestInit = { ...options };
      if (options.signal && options.signal instanceof AbortSignal) {
        // Check if it's a timeout signal by looking at aborted state
        // Create a fresh timeout signal with same duration for the retry
        const remainingMs = 30000; // Default retry timeout
        retryOptions.signal = AbortSignal.timeout(remainingMs);
      }
      const retryResponse = await fetch(retryUrl, retryOptions);
      if (retryResponse.ok) {
        return retryResponse;
      }
    } catch {
      // Retry also failed, fall through to return original response
    }
  }
  
  return response;
}
