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
  retryWithV1 = true,
  defaultTimeoutMs = 300_000 // 5min default timeout for all external API calls (some models take >2min)
): Promise<Response> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const url = `${cleanBase}${path}`;

  // Apply default timeout if no signal is already set
  const effectiveOptions = { ...options };
  if (!effectiveOptions.signal) {
    effectiveOptions.signal = AbortSignal.timeout(defaultTimeoutMs);
  }
  
  const response = await fetch(url, effectiveOptions);
  
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
      // Create fresh options for retry with a fresh timeout signal
      // ★ 使用 AbortSignal.any 合并原始 signal 和超时 signal，
      // 避免覆盖调用方传入的 abort controller
      const retryOptions: RequestInit = { ...options };
      const timeoutSignal = AbortSignal.timeout(defaultTimeoutMs);
      if (options.signal) {
        retryOptions.signal = AbortSignal.any([options.signal, timeoutSignal]);
      } else {
        retryOptions.signal = timeoutSignal;
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

/**
 * Timeout presets for different API operation types
 */
export const API_TIMEOUTS = {
  /** Chat/completions: 60s */
  chat: 60_000,
  /** Image generation: 300s (some models take >2min, token link can take 3+ min) */
  imageGeneration: 300_000,
  /** Image editing (inpaint/mask): 120s */
  imageEdit: 120_000,
  /** Vision/analyze: 60s */
  vision: 60_000,
  /** Model list/test: 15s */
  quick: 15_000,
  /** Vectorize/SVG trace: 120s */
  vectorize: 120_000,
  /** Default: 60s */
  default: 60_000,
} as const;

export type ApiTimeoutCategory = keyof typeof API_TIMEOUTS;

/**
 * Fetch with automatic timeout control.
 * Wraps native fetch with AbortSignal.timeout, combining gracefully with any
 * existing signal in options.
 *
 * @param url - Request URL
 * @param options - Standard fetch options
 * @param timeoutMs - Timeout in milliseconds (default: 60s). Can also pass a category string from API_TIMEOUTS.
 */
export async function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeoutMs: number | ApiTimeoutCategory = API_TIMEOUTS.default
): Promise<Response> {
  const ms = typeof timeoutMs === 'string' ? API_TIMEOUTS[timeoutMs] : timeoutMs;

  // Combine with existing signal if present
  const existingSignal = options.signal;
  const timeoutSignal = AbortSignal.timeout(ms);

  let combinedSignal: AbortSignal;
  if (existingSignal) {
    // Use AbortSignal.any to combine — aborts when either signal aborts
    combinedSignal = AbortSignal.any([existingSignal, timeoutSignal]);
  } else {
    combinedSignal = timeoutSignal;
  }

  return fetch(url, { ...options, signal: combinedSignal });
}
