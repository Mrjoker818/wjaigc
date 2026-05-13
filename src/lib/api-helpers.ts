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
 * Check if a response appears to be a valid API response (JSON content)
 * Some API gateways (e.g. New API) return 200 + HTML for non-/v1 paths,
 * which is not a real API response and should trigger /v1 retry.
 */
function isJsonLikeResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') || contentType.includes('text/json');
}

/**
 * Fetch with automatic /v1 retry logic
 * - First tries the exact baseUrl + path
 * - If that fails (non-OK status, or 200 but non-JSON content) and baseUrl doesn't have /v1, retries with /v1 inserted
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
  
  // Determine if we need to retry with /v1:
  // 1. Response is not OK (4xx/5xx)
  // 2. Response is 200 but content is not JSON (e.g. SPA HTML page from API gateways)
  const needsRetry = retryWithV1 && !hasVersionPath(cleanBase) && (
    !response.ok || !isJsonLikeResponse(response)
  );
  
  if (needsRetry) {
    const v1Base = `${cleanBase}/v1`;
    const retryUrl = `${v1Base}${path}`;
    const reason = !response.ok ? `${response.status}` : `non-JSON response (${response.headers.get('content-type') || 'unknown'})`;
    console.log(`[api-helpers] ${url} needs retry (${reason}), retrying with ${retryUrl}`);
    try {
      // Create fresh options for retry - if original used AbortSignal.timeout, create a new one
      const retryOptions: RequestInit = { ...options };
      if (options.signal && options.signal instanceof AbortSignal) {
        // Create a fresh timeout signal for the retry
        // Direct mode APIs (like tokln.com GPT Image 2) need 120s+ to generate images
        const remainingMs = 120000; // Long timeout for image generation APIs
        retryOptions.signal = AbortSignal.timeout(remainingMs);
      }
      const retryResponse = await fetch(retryUrl, retryOptions);
      // Accept retry response if it's JSON (even if status is 4xx like 401 - means API is reachable)
      // or if it's a successful response
      if (retryResponse.ok || isJsonLikeResponse(retryResponse)) {
        return retryResponse;
      }
    } catch {
      // Retry also failed, fall through to return original response
    }
  }
  
  return response;
}
