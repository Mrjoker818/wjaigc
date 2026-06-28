/**
 * Shared API helper utilities (client-safe)
 *
 * NOTE: Auth helpers (optionalApiAuth, requireApiAuth) are in @/lib/api-auth
 * because they import 'server-only' which cannot be bundled for client components.
 */

/**
 * Build an internal API URL for server-side fetch (calling self).
 * Uses DEPLOY_RUN_PORT (default 5000) to ensure correct resolution
 * in all deployment environments (dev, production, behind load balancers).
 */
export function getInternalApiUrl(path: string): string {
  const port = process.env.DEPLOY_RUN_PORT || '5000';
  return `http://127.0.0.1:${port}${path}`;
}

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
 * Check if a base URL explicitly includes /v1 (or any version path).
 * Used to decide whether /v1 retry should be attempted.
 */
export function baseUrlHasVersionPath(baseUrl: string): boolean {
  return /\/v\d+\/?$/.test(baseUrl.replace(/\/+$/, ''));
}

/**
 * Check if a base URL looks like a unified/non-standard API that should NOT
 * be retried with /v1. These providers have their own routing and /v1 would
 * cause 404 or HTML responses.
 * 
 * Known patterns:
 * - URLs ending with /api, /api/v2, /proxy etc. (non-/v1 version paths)
 * - URLs containing known unified API patterns
 */
function isUnifiedApiUrl(baseUrl: string): boolean {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  // If URL has a version path that is NOT /v1 (e.g. /api, /api/v2, /proxy)
  const nonV1VersionMatch = cleanBase.match(/\/(api|proxy|gateway|rest)(\/v?\d+)?\/?$/);
  if (nonV1VersionMatch) return true;
  return false;
}

/**
 * Public helper: determine whether /v1 retry should be skipped for a given baseUrl.
 * Returns true if:
 * - baseUrl already includes a version path (/v1, /v2, etc.)
 * - baseUrl looks like a unified API (/api, /proxy, etc.)
 */
export function shouldSkipV1Retry(baseUrl: string): boolean {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return hasVersionPath(cleanBase) || isUnifiedApiUrl(cleanBase);
}

/**
 * Fetch with automatic /v1 retry logic
 * - First tries the exact baseUrl + path
 * - If that fails (non-OK status, or 200 but non-JSON content) and baseUrl doesn't have /v1, retries with /v1 inserted
 * - Retry uses a fresh AbortSignal (if original signal was a timeout) with the same duration
 * - Set retryWithV1=false to disable /v1 retry for providers known to not use /v1 paths
 */
export async function fetchWithV1Retry(
  baseUrl: string,
  path: string,
  options: RequestInit & { skipV1Retry?: boolean } = {},
  retryWithV1 = true,
  defaultTimeoutMs = 300_000 // 5min default timeout for all external API calls (some models take >2min)
): Promise<Response> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const url = `${cleanBase}${path}`;
  const { skipV1Retry, ...fetchOptions } = options;

  // Apply default timeout if no signal is already set
  const effectiveOptions: RequestInit = { ...fetchOptions };
  if (!effectiveOptions.signal) {
    effectiveOptions.signal = AbortSignal.timeout(defaultTimeoutMs);
  }
  
  const response = await fetch(url, effectiveOptions);
  
  // Determine if we need to retry with /v1:
  // 1. retryWithV1 is explicitly enabled AND skipV1Retry is not set
  // 2. baseUrl doesn't already have /v1 or any version path
  // 3. URL doesn't look like a unified API that wouldn't have /v1
  // 4. Response is not OK (4xx/5xx) or is 200 but non-JSON
  const shouldRetryV1 = retryWithV1 
    && !skipV1Retry
    && !hasVersionPath(cleanBase) 
    && !isUnifiedApiUrl(cleanBase)
    && !path.startsWith('/v1/') // path已含/v1时跳过，避免双重/v1/v1/
    && (!response.ok || !isJsonLikeResponse(response));
  
  if (shouldRetryV1) {
    const v1Base = `${cleanBase}/v1`;
    const retryUrl = `${v1Base}${path}`;
    const reason = !response.ok ? `${response.status}` : `non-JSON response (${response.headers.get('content-type') || 'unknown'})`;
    console.log(`[api-helpers] ${url} needs retry (${reason}), retrying with ${retryUrl}`);
    try {
      // Create fresh options for retry with a fresh timeout signal
      const retryOptions: RequestInit = { ...fetchOptions };
      const timeoutSignal = AbortSignal.timeout(defaultTimeoutMs);
      if (fetchOptions.signal) {
        retryOptions.signal = AbortSignal.any([fetchOptions.signal, timeoutSignal]);
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

// Auth helpers (optionalApiAuth, requireApiAuth) have been moved to @/lib/api-auth
// to avoid importing 'server-only' into client component bundles.
// Import from @/lib/api-auth in API route handlers only.
