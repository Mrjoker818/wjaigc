/**
 * API Compatibility Layer
 *
 * This module provides a unified abstraction over the compatibility differences
 * between various OpenAI-compatible image generation APIs. When adding a new API
 * provider, you only need to select the right compat profile — all downstream
 * code (generate route, image-edit route, poll-task route) automatically handles:
 *
 *   1. Response mode  — async (task_id + polling) vs direct (url / b64_json)
 *   2. Size format    — aspect-ratio ("1:1") vs pixel ("1024x1024")
 *   3. API endpoint   — /images/generations vs /images/edits
 *   4. Form encoding  — JSON vs multipart/form-data for /images/edits
 *   5. Base URL path  — whether /v1 is needed (handled by fetchWithV1Retry)
 *
 * Usage:
 *   import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from './api-compatibility';
 *
 *   const profile = resolveCompatProfile(provider);
 *   const adjusted = adjustRequestForProfile(rawRequest, profile, { hasImage: true });
 *   const result   = parseResponseForProfile(apiResponse, profile);
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Response mode returned by the API */
export type ResponseMode = 'polling' | 'direct';

/** Size format accepted by the API */
export type SizeFormat = 'aspect-ratio' | 'pixel';

/** Which endpoint to use for image generation */
export type ImageEndpoint = '/images/generations' | '/images/edits';

/** How to encode /images/edits requests */
export type EditEncoding = 'json-first' | 'multipart-only';

/**
 * A compatibility profile describes how a specific API provider deviates from
 * standard defaults. New providers just pick or create a profile.
 */
export interface ApiCompatProfile {
  /** Unique identifier for this profile */
  id: string;

  /** Human-readable label */
  label: string;

  /** Default response mode */
  responseMode: ResponseMode;

  /** Size format this API accepts */
  sizeFormat: SizeFormat;

  /** Default endpoint for standard generation (text→image) */
  defaultEndpoint: ImageEndpoint;

  /** Default endpoint for image editing (image+text→image) */
  editEndpoint: ImageEndpoint;

  /** How to encode /images/edits requests */
  editEncoding: EditEncoding;

  /**
   * For /images/edits with input_fidelity — some providers support it,
   * some ignore it, some error on it.
   */
  supportsInputFidelity: boolean;

  /**
   * Polling configuration for async providers.
   * - 'path': Poll via GET /tasks/{taskId} (APImart style)
   * - 'images-id': Poll via GET /images/{taskId} (some OpenAI proxies)
   * - 'none': No polling needed (direct response only)
   */
  pollMode: 'path' | 'images-id' | 'none';

  /**
   * The URL path template for polling task status.
   * Available placeholders: {taskId}
   * Example: '/tasks/{taskId}?language=zh'
   */
  pollPathTemplate: string;
}

// ---------------------------------------------------------------------------
// Built-in profiles
// ---------------------------------------------------------------------------

/**
 * APImart-style async provider.
 * - Accepts aspect-ratio size format ("1:1", "16:9", …)
 * - Returns task_id for polling
 * - /images/generations for everything
 * - Poll via GET /tasks/{taskId}
 */
export const PROFILE_APIMART: ApiCompatProfile = {
  id: 'apimart',
  label: '异步轮询 (宽高比)',
  responseMode: 'polling',
  sizeFormat: 'aspect-ratio',
  defaultEndpoint: '/images/generations',
  editEndpoint: '/images/generations',
  editEncoding: 'json-first',
  supportsInputFidelity: false,
  pollMode: 'path',
  pollPathTemplate: '/tasks/{taskId}?language=zh',
};

/**
 * OpenAI-compatible providers that return images directly (e.g. token-link, official OpenAI, any /v1 proxy).
 * - Requires pixel size format ("1024x1024")
 * - Returns data[].url or data[].b64_json directly
 * - Uses /images/edits for image editing
 * - Supports input_fidelity parameter
 * - No polling needed (direct response)
 */
export const PROFILE_OPENAI: ApiCompatProfile = {
  id: 'openai',
  label: 'OpenAI 兼容 (直接返回)',
  responseMode: 'direct',
  sizeFormat: 'pixel',
  defaultEndpoint: '/images/generations',
  editEndpoint: '/images/edits',
  editEncoding: 'multipart-only',
  supportsInputFidelity: true,
  pollMode: 'none',
  pollPathTemplate: '',
};

/**
 * OpenAI-compatible providers that use async task_id (some proxies).
 * - Requires pixel size format
 * - Returns task_id for polling
 * - Uses /images/edits for image editing
 * - Poll via GET /tasks/{taskId} (same as APImart pattern)
 */
export const PROFILE_OPENAI_ASYNC: ApiCompatProfile = {
  id: 'openai-async',
  label: 'OpenAI 兼容 (异步轮询)',
  responseMode: 'polling',
  sizeFormat: 'pixel',
  defaultEndpoint: '/images/generations',
  editEndpoint: '/images/edits',
  editEncoding: 'multipart-only',
  supportsInputFidelity: true,
  pollMode: 'path',
  pollPathTemplate: '/tasks/{taskId}',
};

/**
 * Generic / custom provider — auto-detect everything.
 * The code will try JSON first, handle both response modes, etc.
 */
export const PROFILE_AUTO: ApiCompatProfile = {
  id: 'auto',
  label: '自动检测',
  responseMode: 'direct',       // will be overridden by actual response
  sizeFormat: 'pixel',          // safe default: convert to pixel format
  defaultEndpoint: '/images/generations',
  editEndpoint: '/images/edits',        // /images/edits forces AI to process the image field (mandatory)
  editEncoding: 'json-first',          // JSON-first, fallback to multipart if needed
  supportsInputFidelity: true,
  pollMode: 'path',
  pollPathTemplate: '/tasks/{taskId}',
};

/** Map of all built-in profiles by id */
export const COMPAT_PROFILES: Record<string, ApiCompatProfile> = {
  [PROFILE_APIMART.id]: PROFILE_APIMART,
  [PROFILE_OPENAI.id]: PROFILE_OPENAI,
  [PROFILE_OPENAI_ASYNC.id]: PROFILE_OPENAI_ASYNC,
  [PROFILE_AUTO.id]: PROFILE_AUTO,
};

// ---------------------------------------------------------------------------
// Profile resolution
// ---------------------------------------------------------------------------

/**
 * Known provider URL patterns for auto-detection.
 * Order matters — first match wins.
 */
const URL_PROFILE_RULES: Array<{ pattern: RegExp; profile: ApiCompatProfile }> = [
  { pattern: /apimart\.ai/i,              profile: PROFILE_APIMART },
  { pattern: /api\.openai\.com/i,         profile: PROFILE_OPENAI },
];

// ---------------------------------------------------------------------------
// Utility: build polling URL
// ---------------------------------------------------------------------------

/**
 * Build the polling URL for an async task.
 * Uses the profile's pollPathTemplate and pollMode to construct the correct URL.
 * Returns null if the profile doesn't support polling.
 */
export function buildPollUrl(
  apiBaseUrl: string,
  taskId: string,
  profile: ApiCompatProfile,
): string | null {
  if (profile.pollMode === 'none' || !profile.pollPathTemplate) {
    return null;
  }
  const path = profile.pollPathTemplate.replace('{taskId}', taskId);
  // ★ 防止 base URL 末尾斜杠与 path 开头斜杠拼成双斜杠
  const cleanBase = apiBaseUrl.replace(/\/+$/, '');
  return `${cleanBase}${path}`;
}

/**
 * Extract an image URL from an API poll response using robust 5-path parsing.
 * Same logic as /api/poll-task route's response handling.
 * Returns the first found image URL, or null if none found.
 */
export function extractImageUrl(pollData: Record<string, unknown>): string | null {
  // Path 1: data.result.images[0].url / .image_url / .src
  const result = pollData?.result as Record<string, unknown> | undefined;
  if (result) {
    const images = result.images as Array<Record<string, unknown>> | undefined;
    if (images?.length) {
      const first = images[0];
      const url = first?.url || first?.image_url || first?.src;
      if (typeof url === 'string' && url) return url;
    }
    // Path 2: data.result.b64_json
    if (result.b64_json && typeof result.b64_json === 'string') {
      return `data:image/png;base64,${result.b64_json}`;
    }
  }
  // Path 3: data.output[0].url / .image_url
  const output = pollData?.output as Array<Record<string, unknown>> | undefined;
  if (output?.length) {
    const url = output[0]?.url || output[0]?.image_url;
    if (typeof url === 'string' && url) return url;
  }
  // Path 4: data.data[0].url / .image_url / .b64_json
  const nestedData = pollData?.data as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(nestedData) && nestedData.length) {
    const url = nestedData[0]?.url || nestedData[0]?.image_url || nestedData[0]?.b64_json;
    if (typeof url === 'string' && url) {
      if (url.startsWith('data:') || url.startsWith('http')) return url;
      return `data:image/png;base64,${url}`;
    }
  }
  // Path 5: data.image_url / data.url (single image format)
  const singleUrl = pollData?.image_url || pollData?.url;
  if (typeof singleUrl === 'string' && singleUrl) return singleUrl;
  // Extra: data.data.image_url / data.data.url (nested single)
  if (nestedData && !Array.isArray(nestedData)) {
    const dataObj = nestedData as Record<string, unknown>;
    const nestedUrl = dataObj?.image_url || dataObj?.url;
    if (typeof nestedUrl === 'string' && nestedUrl) return nestedUrl;
  }
  return null;
}

/**
 * Resolve the compatibility profile for a given provider.
 *
 * Resolution order:
 * 1. If the provider has an explicit `compatProfile` field → use it
 * 2. If the provider's baseUrl matches a known pattern → use the matched profile
 * 3. If the provider's `requestStyle` gives a hint → use it
 * 4. Fallback to PROFILE_AUTO
 */
export function resolveCompatProfile(
  provider: {
    baseUrl?: string;
    requestStyle?: string;
    compatProfile?: string;
    advancedParams?: Record<string, string>;
  } | null | undefined,
): ApiCompatProfile {
  if (!provider) return PROFILE_AUTO;

  // 1. Explicit profile
  if (provider.compatProfile && COMPAT_PROFILES[provider.compatProfile]) {
    return COMPAT_PROFILES[provider.compatProfile];
  }

  // 2. URL pattern match
  const url = provider.baseUrl || '';
  for (const rule of URL_PROFILE_RULES) {
    if (rule.pattern.test(url)) {
      return rule.profile;
    }
  }

  // 3. advancedParams hint (e.g. compatProfile=openai)
  if (provider.advancedParams?.compatProfile && COMPAT_PROFILES[provider.advancedParams.compatProfile]) {
    return COMPAT_PROFILES[provider.advancedParams.compatProfile];
  }

  // 4. Default: non-apimart providers use pixel format and direct mode
  //    (safe defaults that work with the majority of OpenAI-compatible APIs)
  return PROFILE_AUTO;
}

// ---------------------------------------------------------------------------
// Request adjustment
// ---------------------------------------------------------------------------

/** Aspect-ratio to pixel-size mapping (GPT-Image-2 / OpenAI standard sizes) */
const ASPECT_RATIO_TO_PIXELS: Record<string, string> = {
  '1:1':  '1024x1024',
  '3:2':  '1536x1024',
  '2:3':  '1024x1536',
  '16:9': '2048x1152',
  '9:16': '1152x2048',
  // Legacy ratios (non-GPT models may still use these)
  '4:3':  '1536x1024',
  '3:4':  '1024x1536',
  '21:9': '2048x878',
};

/**
 * Model-specific pixel size lookup for accurate API size parameter generation.
 * Keyed by lowercase model substring → ratio → quality → pixel size string.
 * This mirrors the MODEL_PIXEL_SIZES in canvas-generation-group.ts but is kept
 * here to avoid circular dependency.
 *
 * Ref: https://www.volcengine.com/docs/6492/2172373
 * Ref: https://docs.geekai.co/cn/docs/image/bytedance/doubao-seedream-5.0-lite
 */
const MODEL_SPECIFIC_PIXEL_SIZES: Record<string, Record<string, Record<string, string>>> = {
  // Seedream 5.0 Lite — 官方: size="2K"|"3K"
  // Ref: https://www.volcengine.com/docs/6492/2172373
  // Ref: https://docs.geekai.co/cn/docs/image/bytedance/doubao-seedream-5.0-lite
  'doubao-seedream-5-0-lite': {
    '1:1': { '2K': '2048x2048', '3K': '3072x3072' },
    '4:3': { '2K': '2304x1728', '3K': '3456x2592' },
    '3:4': { '2K': '1728x2304', '3K': '2592x3456' },
    '16:9': { '2K': '2848x1600', '3K': '4096x2304' },
    '9:16': { '2K': '1600x2848', '3K': '2304x4096' },
    '3:2': { '2K': '2496x1664', '3K': '3744x2496' },
    '2:3': { '2K': '1664x2496', '3K': '2496x3744' },
    '21:9': { '2K': '3136x1344', '3K': '4704x2016' },
  },
  'seedream-5-0-lite': {
    '1:1': { '2K': '2048x2048', '3K': '3072x3072' },
    '4:3': { '2K': '2304x1728', '3K': '3456x2592' },
    '3:4': { '2K': '1728x2304', '3K': '2592x3456' },
    '16:9': { '2K': '2848x1600', '3K': '4096x2304' },
    '9:16': { '2K': '1600x2848', '3K': '2304x4096' },
    '3:2': { '2K': '2496x1664', '3K': '3744x2496' },
    '2:3': { '2K': '1664x2496', '3K': '2496x3744' },
    '21:9': { '2K': '3136x1344', '3K': '4704x2016' },
  },
  // Seedream 5.0 (非lite) — 官方: size="2K"|"4K"
  'doubao-seedream-5-0': {
    '1:1': { '2K': '2048x2048', '4K': '4096x4096' },
    '4:3': { '2K': '2304x1728', '4K': '4096x3072' },
    '3:4': { '2K': '1728x2304', '4K': '3072x4096' },
    '16:9': { '2K': '2848x1600', '4K': '4096x2304' },
    '9:16': { '2K': '1600x2848', '4K': '2304x4096' },
    '3:2': { '2K': '2496x1664', '4K': '4096x2730' },
    '2:3': { '2K': '1664x2496', '4K': '2730x4096' },
    '21:9': { '2K': '3136x1344', '4K': '4704x2016' },
  },
  'seedream-5': {
    '1:1': { '2K': '2048x2048', '4K': '4096x4096' },
    '4:3': { '2K': '2304x1728', '4K': '4096x3072' },
    '3:4': { '2K': '1728x2304', '4K': '3072x4096' },
    '16:9': { '2K': '2848x1600', '4K': '4096x2304' },
    '9:16': { '2K': '1600x2848', '4K': '2304x4096' },
    '3:2': { '2K': '2496x1664', '4K': '4096x2730' },
    '2:3': { '2K': '1664x2496', '4K': '2730x4096' },
    '21:9': { '2K': '3136x1344', '4K': '4704x2016' },
  },
  // Seedream 4.5 — 官方: size="2K"|"4K" (最小2K起步)
  'doubao-seedream-4-5': {
    '1:1': { '2K': '2048x2048', '4K': '4096x4096' },
    '4:3': { '2K': '2304x1728', '4K': '4096x3072' },
    '3:4': { '2K': '1728x2304', '4K': '3072x4096' },
    '16:9': { '2K': '2560x1440', '4K': '4096x2304' },
    '9:16': { '2K': '1440x2560', '4K': '2304x4096' },
    '3:2': { '2K': '2496x1664', '4K': '4096x2730' },
    '2:3': { '2K': '1664x2496', '4K': '2730x4096' },
    '21:9': { '2K': '3024x1296', '4K': '4096x1756' },
  },
  'seedream-4-5': {
    '1:1': { '2K': '2048x2048', '4K': '4096x4096' },
    '4:3': { '2K': '2304x1728', '4K': '4096x3072' },
    '3:4': { '2K': '1728x2304', '4K': '3072x4096' },
    '16:9': { '2K': '2560x1440', '4K': '4096x2304' },
    '9:16': { '2K': '1440x2560', '4K': '2304x4096' },
    '3:2': { '2K': '2496x1664', '4K': '4096x2730' },
    '2:3': { '2K': '1664x2496', '4K': '2730x4096' },
    '21:9': { '2K': '3024x1296', '4K': '4096x1756' },
  },
  // Seedream 4.0 — 官方: size="1K"|"2K"|"4K"
  'doubao-seedream-4': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
    '4:3': { '1K': '1152x864', '2K': '2304x1728', '4K': '4096x3072' },
    '3:4': { '1K': '864x1152', '2K': '1728x2304', '4K': '3072x4096' },
    '16:9': { '1K': '1280x720', '2K': '2560x1440', '4K': '4096x2304' },
    '9:16': { '1K': '720x1280', '2K': '1440x2560', '4K': '2304x4096' },
    '3:2': { '1K': '1248x832', '2K': '2496x1664', '4K': '4096x2730' },
    '2:3': { '1K': '832x1248', '2K': '1664x2496', '4K': '2730x4096' },
    '21:9': { '1K': '1512x648', '2K': '3024x1296', '4K': '4096x1756' },
  },
  'seedream-4': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
    '4:3': { '1K': '1152x864', '2K': '2304x1728', '4K': '4096x3072' },
    '3:4': { '1K': '864x1152', '2K': '1728x2304', '4K': '3072x4096' },
    '16:9': { '1K': '1280x720', '2K': '2560x1440', '4K': '4096x2304' },
    '9:16': { '1K': '720x1280', '2K': '1440x2560', '4K': '2304x4096' },
    '3:2': { '1K': '1248x832', '2K': '2496x1664', '4K': '4096x2730' },
    '2:3': { '1K': '832x1248', '2K': '1664x2496', '4K': '2730x4096' },
    '21:9': { '1K': '1512x648', '2K': '3024x1296', '4K': '4096x1756' },
  },
  // Seedream 3.0 — 官方: 仅像素值，最大2048x2048
  'doubao-seedream-3': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '4:3': { '1K': '1024x768', '2K': '2048x1536' },
    '3:4': { '1K': '768x1024', '2K': '1536x2048' },
    '16:9': { '1K': '1024x576', '2K': '2048x1152' },
    '9:16': { '1K': '576x1024', '2K': '1152x2048' },
    '3:2': { '1K': '1024x683', '2K': '2048x1365' },
    '2:3': { '1K': '683x1024', '2K': '1365x2048' },
    '21:9': { '1K': '1024x439', '2K': '2048x878' },
  },
  'seedream-3': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '4:3': { '1K': '1024x768', '2K': '2048x1536' },
    '3:4': { '1K': '768x1024', '2K': '1536x2048' },
    '16:9': { '1K': '1024x576', '2K': '2048x1152' },
    '9:16': { '1K': '576x1024', '2K': '1152x2048' },
    '3:2': { '1K': '1024x683', '2K': '2048x1365' },
    '2:3': { '1K': '683x1024', '2K': '1365x2048' },
    '21:9': { '1K': '1024x439', '2K': '2048x878' },
  },
  // Seedance 4.5 — 官方: size="2K"|"4K"
  'doubao-seedance-4-5': {
    '1:1': { '2K': '2048x2048', '4K': '4096x4096' },
    '4:3': { '2K': '2048x1536', '4K': '3840x2880' },
    '3:4': { '2K': '1536x2048', '4K': '2880x3840' },
    '16:9': { '2K': '2048x1152', '4K': '3840x2160' },
    '9:16': { '2K': '1152x2048', '4K': '2160x3840' },
  },
  'seedance': {
    '1:1': { '2K': '2048x2048', '4K': '4096x4096' },
    '4:3': { '2K': '2048x1536', '4K': '3840x2880' },
    '3:4': { '2K': '1536x2048', '4K': '2880x3840' },
    '16:9': { '2K': '2048x1152', '4K': '3840x2160' },
    '9:16': { '2K': '1152x2048', '4K': '2160x3840' },
  },
  // GPT Image 2 — 官方支持的尺寸
  'gpt-image-2': {
    '1:1':  { 'auto': '1024x1024', 'low': '1024x1024', 'medium': '1024x1024', 'high': '1024x1024' },
    '3:2':  { 'auto': '1536x1024', 'low': '1536x1024', 'medium': '1536x1024', 'high': '1536x1024' },
    '2:3':  { 'auto': '1024x1536', 'low': '1024x1536', 'medium': '1024x1536', 'high': '1024x1536' },
    '16:9': { 'auto': '2048x1152', 'low': '2048x1152', 'medium': '2048x1152', 'high': '3840x2160' },
    '9:16': { 'auto': '1152x2048', 'low': '1152x2048', 'medium': '1152x2048', 'high': '2160x3840' },
  },
  // DALL-E 3 — 官方支持的尺寸
  'dall-e-3': {
    '1:1': { 'standard': '1024x1024', 'hd': '1024x1024' },
    '16:9': { 'standard': '1792x1024', 'hd': '1792x1024' },
    '9:16': { 'standard': '1024x1792', 'hd': '1024x1792' },
  },
  // ========== 补充：其他模型官方尺寸 ==========
  // Gemini 2.5 Flash Image — 仅1K
  'gemini-2.5-flash-image': {
    '1:1': { '1K': '1024x1024' },
    '4:3': { '1K': '1024x768' },
    '3:4': { '1K': '768x1024' },
    '16:9': { '1K': '1024x576' },
    '9:16': { '1K': '576x1024' },
    '3:2': { '1K': '1024x683' },
    '2:3': { '1K': '683x1024' },
  },
  // Gemini 2.5 Pro Image — 1K/2K
  'gemini-2.5-pro-image': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '4:3': { '1K': '1024x768', '2K': '2048x1536' },
    '3:4': { '1K': '768x1024', '2K': '1536x2048' },
    '16:9': { '1K': '1024x576', '2K': '2048x1152' },
    '9:16': { '1K': '576x1024', '2K': '1152x2048' },
    '3:2': { '1K': '1024x683', '2K': '2048x1365' },
    '2:3': { '1K': '683x1024', '2K': '1365x2048' },
  },
  // Gemini 3 Flash Image — 仅1K
  'gemini-3-flash-image': {
    '1:1': { '1K': '1024x1024' },
    '4:3': { '1K': '1024x768' },
    '3:4': { '1K': '768x1024' },
    '16:9': { '1K': '1024x576' },
    '9:16': { '1K': '576x1024' },
    '3:2': { '1K': '1024x683' },
    '2:3': { '1K': '683x1024' },
  },
  // Gemini 3 Pro Image — 1K/2K
  'gemini-3-pro-image': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '4:3': { '1K': '1024x768', '2K': '2048x1536' },
    '3:4': { '1K': '768x1024', '2K': '1536x2048' },
    '16:9': { '1K': '1024x576', '2K': '2048x1152' },
    '9:16': { '1K': '576x1024', '2K': '1152x2048' },
    '3:2': { '1K': '1024x683', '2K': '2048x1365' },
    '2:3': { '1K': '683x1024', '2K': '1365x2048' },
  },
  // Gemini 3.1 Flash Image — 1K/2K/4K
  'gemini-3.1-flash-image': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
    '4:3': { '1K': '1024x768', '2K': '2048x1536', '4K': '4096x3072' },
    '3:4': { '1K': '768x1024', '2K': '1536x2048', '4K': '3072x4096' },
    '16:9': { '1K': '1024x576', '2K': '2048x1152', '4K': '4096x2304' },
    '9:16': { '1K': '576x1024', '2K': '1152x2048', '4K': '2304x4096' },
    '3:2': { '1K': '1024x683', '2K': '2048x1365', '4K': '4096x2730' },
    '2:3': { '1K': '683x1024', '2K': '1365x2048', '4K': '2730x4096' },
  },
  // Imagen 3 — 1K/2K
  'imagen-3': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '4:3': { '1K': '1024x768', '2K': '2048x1536' },
    '3:4': { '1K': '768x1024', '2K': '1536x2048' },
    '16:9': { '1K': '1024x576', '2K': '2048x1152' },
    '9:16': { '1K': '576x1024', '2K': '1152x2048' },
    '3:2': { '1K': '1024x683', '2K': '2048x1365' },
    '2:3': { '1K': '683x1024', '2K': '1365x2048' },
  },
  // Imagen 4 — 1K/2K
  'imagen-4': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '4:3': { '1K': '1024x768', '2K': '2048x1536' },
    '3:4': { '1K': '768x1024', '2K': '1536x2048' },
    '16:9': { '1K': '1024x576', '2K': '2048x1152' },
    '9:16': { '1K': '576x1024', '2K': '1152x2048' },
    '3:2': { '1K': '1024x683', '2K': '2048x1365' },
    '2:3': { '1K': '683x1024', '2K': '1365x2048' },
  },
  // Imagen 4 Ultra — 1K/2K
  'imagen-4-ultra': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '4:3': { '1K': '1024x768', '2K': '2048x1536' },
    '3:4': { '1K': '768x1024', '2K': '1536x2048' },
    '16:9': { '1K': '1024x576', '2K': '2048x1152' },
    '9:16': { '1K': '576x1024', '2K': '1152x2048' },
    '3:2': { '1K': '1024x683', '2K': '2048x1365' },
    '2:3': { '1K': '683x1024', '2K': '1365x2048' },
  },
  // Stable Diffusion — 1024基础
  'stable-diffusion': {
    '1:1': { 'standard': '1024x1024', 'hd': '1024x1024' },
    '4:3': { 'standard': '1152x896', 'hd': '1152x896' },
    '3:4': { 'standard': '896x1152', 'hd': '896x1152' },
    '16:9': { 'standard': '1344x768', 'hd': '1344x768' },
    '9:16': { 'standard': '768x1344', 'hd': '768x1344' },
    '3:2': { 'standard': '1216x832', 'hd': '1216x832' },
    '2:3': { 'standard': '832x1216', 'hd': '832x1216' },
  },
  // SD XL — 1024基础 + 21:9
  'sd-xl': {
    '1:1': { 'standard': '1024x1024', 'hd': '1024x1024' },
    '4:3': { 'standard': '1152x896', 'hd': '1152x896' },
    '3:4': { 'standard': '896x1152', 'hd': '896x1152' },
    '16:9': { 'standard': '1344x768', 'hd': '1344x768' },
    '9:16': { 'standard': '768x1344', 'hd': '768x1344' },
    '3:2': { 'standard': '1216x832', 'hd': '1216x832' },
    '2:3': { 'standard': '832x1216', 'hd': '832x1216' },
    '21:9': { 'standard': '1536x640', 'hd': '1536x640' },
  },
  // SD 3 — 1024基础
  'sd-3': {
    '1:1': { 'standard': '1024x1024', 'hd': '1024x1024' },
    '4:3': { 'standard': '1152x896', 'hd': '1152x896' },
    '3:4': { 'standard': '896x1152', 'hd': '896x1152' },
    '16:9': { 'standard': '1344x768', 'hd': '1344x768' },
    '9:16': { 'standard': '768x1344', 'hd': '768x1344' },
    '3:2': { 'standard': '1216x832', 'hd': '1216x832' },
    '2:3': { 'standard': '832x1216', 'hd': '832x1216' },
  },
  // Kling — 1K/2K
  'kling': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '16:9': { '1K': '1280x720', '2K': '2048x1152' },
    '9:16': { '1K': '720x1280', '2K': '1152x2048' },
  },
  // GPT Image 1.5 — 同GPT Image 2尺寸
  'gpt-image-1-5': {
    '1:1':  { 'auto': '1024x1024', 'low': '1024x1024', 'medium': '1024x1024', 'high': '1024x1024' },
    '3:2':  { 'auto': '1536x1024', 'low': '1536x1024', 'medium': '1536x1024', 'high': '1536x1024' },
    '2:3':  { 'auto': '1024x1536', 'low': '1024x1536', 'medium': '1024x1536', 'high': '1024x1536' },
    '16:9': { 'auto': '2048x1152', 'low': '2048x1152', 'medium': '2048x1152', 'high': '3840x2160' },
    '9:16': { 'auto': '1152x2048', 'low': '1152x2048', 'medium': '1152x2048', 'high': '2160x3840' },
  },
  // GPT Image 1 — 同GPT Image 2尺寸
  'gpt-image-1': {
    '1:1':  { 'auto': '1024x1024', 'low': '1024x1024', 'medium': '1024x1024', 'high': '1024x1024' },
    '3:2':  { 'auto': '1536x1024', 'low': '1536x1024', 'medium': '1536x1024', 'high': '1536x1024' },
    '2:3':  { 'auto': '1024x1536', 'low': '1024x1536', 'medium': '1024x1536', 'high': '1024x1536' },
    '16:9': { 'auto': '2048x1152', 'low': '2048x1152', 'medium': '2048x1152', 'high': '3840x2160' },
    '9:16': { 'auto': '1152x2048', 'low': '1152x2048', 'medium': '1152x2048', 'high': '2160x3840' },
  },
  // Kling V3 — 1K/2K
  'kling-v3': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '16:9': { '1K': '1280x720', '2K': '2048x1152' },
    '9:16': { '1K': '720x1280', '2K': '1152x2048' },
  },
  // Kling V3 Omni — 1K/2K/4K
  'kling-v3-omni': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
    '16:9': { '1K': '1280x720', '2K': '2048x1152', '4K': '3840x2160' },
    '9:16': { '1K': '720x1280', '2K': '1152x2048', '4K': '2160x3840' },
  },
  // Ideogram — 1K/2K (API用aspect_ratio + render_speed)
  'ideogram': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '4:3': { '1K': '1024x768', '2K': '2048x1536' },
    '3:4': { '1K': '768x1024', '2K': '1536x2048' },
    '16:9': { '1K': '1024x576', '2K': '2048x1152' },
    '9:16': { '1K': '576x1024', '2K': '1152x2048' },
    '3:2': { '1K': '1024x683', '2K': '2048x1365' },
    '2:3': { '1K': '683x1024', '2K': '1365x2048' },
  },
  // HiDream — 最大2048x2048
  'hidream': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
    '4:3': { '1K': '1024x768', '2K': '2048x1536' },
    '3:4': { '1K': '768x1024', '2K': '1536x2048' },
    '16:9': { '1K': '1024x576', '2K': '2048x1152' },
    '9:16': { '1K': '576x1024', '2K': '1152x2048' },
    '3:2': { '1K': '1024x683', '2K': '2048x1365' },
    '2:3': { '1K': '683x1024', '2K': '1365x2048' },
  },
  // Seedream 4.0 alias (full model ID)
  'doubao-seedream-4-0': {
    '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
    '4:3': { '1K': '1152x864', '2K': '2304x1728', '4K': '4096x3072' },
    '3:4': { '1K': '864x1152', '2K': '1728x2304', '4K': '3072x4096' },
    '16:9': { '1K': '1280x720', '2K': '2560x1440', '4K': '4096x2304' },
    '9:16': { '1K': '720x1280', '2K': '1440x2560', '4K': '2304x4096' },
    '3:2': { '1K': '1248x832', '2K': '2496x1664', '4K': '4096x2730' },
    '2:3': { '1K': '832x1248', '2K': '1664x2496', '4K': '2730x4096' },
    '21:9': { '1K': '1512x648', '2K': '3024x1296', '4K': '4096x1756' },
  },
};

/**
 * Look up model-specific pixel size for a given ratio+quality combination.
 * Returns undefined if no model-specific mapping exists.
 */
function getModelSpecificPixelSize(ratio: string, quality: string, modelId: string): string | undefined {
  const lowerModel = modelId.toLowerCase();
  // Find the best matching model key (longest match = most specific)
  let matchedKey: string | undefined;
  let matchedLen = 0;
  for (const key of Object.keys(MODEL_SPECIFIC_PIXEL_SIZES)) {
    if (lowerModel.includes(key) && key.length > matchedLen) {
      matchedKey = key;
      matchedLen = key.length;
    }
  }
  if (!matchedKey) return undefined;

  const modelSizes = MODEL_SPECIFIC_PIXEL_SIZES[matchedKey];
  const ratioSizes = modelSizes[ratio];
  if (!ratioSizes) return undefined;

  // Try exact quality match
  if (ratioSizes[quality]) return ratioSizes[quality];
  // Try 'standard' fallback
  if (ratioSizes['standard']) return ratioSizes['standard'];
  // Return first available
  return Object.values(ratioSizes)[0];
}

/**
 * Convert an aspect-ratio string ("1:1", "16:9") to a pixel-size string
 * ("1024x1024", "1536x1024") suitable for OpenAI-compatible APIs.
 *
 * When modelId and quality are provided, uses the model-specific pixel mapping
 * from calculateActualPixels (which has per-model official API pixel sizes).
 * Falls back to generic ASPECT_RATIO_TO_PIXELS mapping for unknown models.
 *
 * For GPT Image 2, quality affects the actual pixel dimensions:
 * - high quality + 16:9 → 3840x2160 (4K)
 * - high quality + 9:16 → 2160x3840 (4K)
 *
 * For ratios not in the lookup table, dynamically calculates based on 2048 max edge.
 */
export function convertAspectRatioToSize(ratio: string, quality?: string, modelId?: string): string {
  // Priority 1: Use model-specific pixel mapping when modelId is provided
  // This ensures accurate pixel sizes per official API docs
  // (e.g., Seedream 5.0 Lite 2K 16:9 = 2848x1600 instead of generic 2048x1152)
  if (modelId) {
    const modelResult = getModelSpecificPixelSize(ratio, quality || 'standard', modelId);
    if (modelResult) return modelResult;
  }

  // GPT Image 2 with high quality uses 4K sizes for wide/tall ratios
  const lowerModel = (modelId || '').toLowerCase();
  const isGptImage2 = lowerModel.includes('gpt-image-2') || lowerModel.includes('gpt-image2');
  if (isGptImage2 && quality === 'high') {
    const gptImage2HighResMap: Record<string, string> = {
      '16:9': '3840x2160',
      '9:16': '2160x3840',
    };
    if (gptImage2HighResMap[ratio]) return gptImage2HighResMap[ratio];
  }

  if (ASPECT_RATIO_TO_PIXELS[ratio]) return ASPECT_RATIO_TO_PIXELS[ratio];

  // Dynamic calculation for non-standard ratios
  const parts = ratio.split(':').map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
    const [w, h] = parts;
    const MAX = 2048;
    let pxW: number, pxH: number;
    if (w >= h) {
      pxW = MAX;
      pxH = Math.round((MAX * h) / w / 64) * 64;
    } else {
      pxH = MAX;
      pxW = Math.round((MAX * w) / h / 64) * 64;
    }
    // Ensure minimum dimensions
    pxW = Math.max(pxW, 256);
    pxH = Math.max(pxH, 256);
    return `${pxW}x${pxH}`;
  }

  return '1024x1024';
}

/**
 * Convert a pixel size string (e.g. "1248x1064") to the closest supported aspect ratio.
 * Many models (especially Gemini) only accept specific aspect ratios like "4:3", "16:9", etc.
 * This function finds the best match from the model's supported ratios.
 */
export function convertPixelSizeToAspectRatio(pixelSize: string, modelId?: string): string {
  const parts = pixelSize.split('x').map(Number);
  if (parts.length !== 2 || parts[0] <= 0 || parts[1] <= 0) {
    return '1:1';
  }

  const [w, h] = parts;
  const actualRatio = w / h;

  // Gemini-supported aspect ratios (width:height)
  const SUPPORTED_RATIOS = [
    '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3',
    '4:5', '5:4', '1:4', '4:1', '1:8', '8:1', '21:9',
  ];

  let bestRatio = '1:1';
  let bestDiff = Infinity;

  for (const ratio of SUPPORTED_RATIOS) {
    const [rw, rh] = ratio.split(':').map(Number);
    const ratioValue = rw / rh;
    const diff = Math.abs(Math.log(actualRatio / ratioValue));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestRatio = ratio;
    }
  }

  return bestRatio;
}

/**
 * Adjust a request body according to the compatibility profile.
 *
 * - Converts size format if needed
 * - Selects the correct endpoint
 * - Adds/removes profile-specific parameters (e.g. input_fidelity)
 *
 * @returns The adjusted request body and the recommended endpoint
 */
export function adjustRequestForProfile(
  requestBody: Record<string, unknown>,
  profile: ApiCompatProfile,
  options: {
    /** Whether this is an image-editing request (has source image) */
    hasImage?: boolean;
    /** Whether this is an edits endpoint request (vs generations) */
    isEditEndpoint?: boolean;
  } = {},
): { body: Record<string, unknown>; endpoint: ImageEndpoint } {
  const { hasImage = false, isEditEndpoint = false } = options;
  // ★ 防御空 body 导致后续解构崩溃
  const body = requestBody ? { ...requestBody } : {};

  // --- Size format conversion ---
  if (profile.sizeFormat === 'pixel' && body.size && typeof body.size === 'string') {
    const sizeStr = body.size as string;
    if (sizeStr.includes(':')) {
      const quality = typeof body.quality === 'string' ? body.quality :
                      typeof body.resolution === 'string' ? body.resolution : undefined;
      const modelId = typeof body.model === 'string' ? body.model : undefined;
      body.size = convertAspectRatioToSize(sizeStr, quality, modelId);
    }
  } else if (profile.sizeFormat === 'aspect-ratio' && body.size && typeof body.size === 'string') {
    const sizeStr = body.size as string;
    // If size is in pixel format (e.g., "1248x1064"), convert to closest supported aspect ratio
    if (/^\d+x\d+$/.test(sizeStr)) {
      const modelId = typeof body.model === 'string' ? body.model : undefined;
      body.size = convertPixelSizeToAspectRatio(sizeStr, modelId);
    }
  }

  // --- Endpoint selection ---
  // Use profile's editEndpoint when image editing is needed (img2img / erase / outpaint / mask).
  // Each profile declares which endpoint it supports for image edits:
  //   - PROFILE_AUTO / PROFILE_OPENAI: editEndpoint = /images/edits  → image field preserved, AI must process it
  //   - PROFILE_APIMART:             editEndpoint = /images/generations → image/mask/strength preserved for img2img
  // If /images/edits is rejected by the provider at runtime, callers auto-fallback to /images/generations.
  let endpoint: ImageEndpoint;
  if (hasImage || isEditEndpoint) {
    endpoint = profile.editEndpoint;
  } else {
    endpoint = profile.defaultEndpoint;
  }

  // When the edit endpoint is /images/generations AND there is NO image
  // field in the body, strip fields that are only valid on /images/edits.
  // However, when hasImage=true (reference image / img2img / inpaint),
  // Only strip image-edit-specific fields when there are NO reference images
  // at all (neither base64 image nor image_urls).  When reference images exist
  // we KEEP strength so the API can control img2img fidelity.
  if (endpoint === '/images/generations' && !hasImage) {
    delete body.image;
    delete body.mask;
    delete body.strength;
  }

  // --- input_fidelity ---
  if (profile.supportsInputFidelity && hasImage && endpoint === '/images/edits') {
    if (!body.input_fidelity) {
      body.input_fidelity = 'high';
    }
  }
  // ★ 当 input_fidelity 被显式设置但提供商不支持时，转换为 strength 参数
  // input_fidelity='low' → strength=0.85 (大幅变化，如多角度功能)
  // input_fidelity='medium' → strength=0.65 (中等变化)
  // input_fidelity='high' → 不设置 strength (保持默认行为)
  if (!profile.supportsInputFidelity || endpoint !== '/images/edits') {
    const requestedFidelity = body.input_fidelity as string | undefined;
    if (requestedFidelity === 'low' && body.strength === undefined) {
      // 提供商不支持 input_fidelity，但用户需要大幅变化 → 用 strength 控制
      body.strength = 0.85;
    } else if (requestedFidelity === 'medium' && body.strength === undefined) {
      body.strength = 0.65;
    }
    // high 或未设置 → 不添加 strength，保持默认行为
    delete body.input_fidelity;
  }

  return { body, endpoint };
}

/**
 * Strip fields that are only valid on /images/edits so the request body
 * becomes compatible with /images/generations.  Reference images are
 * preserved through `image_urls`.
 */
export function stripEditsOnlyFields(body: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...body };
  delete cleaned.image;
  delete cleaned.mask;
  // 保留 strength: 即使回退到 /images/generations，APImart 等提供商
  // 仍需要 strength 来控制图生图的一致性程度
  return cleaned;
}

/**
 * Check whether an API error response indicates that /images/edits is
 * not supported (generic / universal errors from proxy adapters).
 * This is provider-agnostic — we simply check for common rejection patterns.
 */
export function isEditsEndpointRejected(status: number, errorBody: string): boolean {
  if (status >= 500) return false; // server errors → not an endpoint rejection
  // Common patterns when /images/edits is not supported by the provider
  const lower = errorBody.toLowerCase();
  return (
    lower.includes('not supported') ||
    lower.includes('not found') ||
    lower.includes('not available') ||
    lower.includes('direct image relay') ||
    lower.includes('task submission flow') ||
    lower.includes('routed through') ||
    lower.includes('image relay') ||
    lower.includes('incompatible') ||
    lower.includes('invalid endpoint') ||
    lower.includes('unsupported endpoint') ||
    (status === 404) || // endpoint doesn't exist
    (status === 405) || // method not allowed on this endpoint
    (status === 422)    // unprocessable entity — endpoint doesn't accept this payload
  );
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export interface ParsedImageResponse {
  /** Whether the API returned images directly (no polling needed) */
  mode: ResponseMode;

  /** Direct image URLs (mode='direct') */
  directImageUrls: string[];

  /** Task IDs for polling (mode='polling') */
  taskIds: string[];

  /** The raw API response for debugging */
  raw: Record<string, unknown>;
}

/**
 * Parse an API response according to the compatibility profile.
 *
 * Handles both direct image responses and async task_id responses,
 * regardless of what the profile predicts (the actual response may differ).
 */
export function parseResponseForProfile(
  apiResponse: Record<string, unknown>,
  _profile: ApiCompatProfile,
): ParsedImageResponse {
  const directImageUrls: string[] = [];
  const taskIds: string[] = [];

  // Check for direct image responses: data[].url or data[].b64_json
  const data = apiResponse.data as Array<Record<string, unknown>> | Record<string, unknown> | undefined;
  if (data && Array.isArray(data)) {
    for (const item of data) {
      if (item.url && typeof item.url === 'string') {
        directImageUrls.push(item.url);
      } else if (item.b64_json && typeof item.b64_json === 'string') {
        directImageUrls.push(`data:image/png;base64,${item.b64_json}`);
      } else if (item.task_id && typeof item.task_id === 'string') {
        taskIds.push(item.task_id);
      }
    }
  }

  // ── 额外提取 task_id / id（兼容多种 API 响应格式） ──
  // 1) data 是对象（如 APImart: { data: { task_id: "xxx" } }）
  if (!Array.isArray(data) && data && typeof data === 'object') {
    const dataObj = data as Record<string, unknown>;
    if (dataObj.task_id && typeof dataObj.task_id === 'string') {
      taskIds.push(dataObj.task_id);
    }
    if (dataObj.id && typeof dataObj.id === 'string' && !dataObj.task_id) {
      taskIds.push(dataObj.id);
    }
    // data 对象中可能包含直接图片 URL（非标准但部分 API 使用）
    if (dataObj.url && typeof dataObj.url === 'string') {
      directImageUrls.push(dataObj.url);
    }
    if (dataObj.b64_json && typeof dataObj.b64_json === 'string') {
      directImageUrls.push(`data:image/png;base64,${dataObj.b64_json}`);
    }
    // 嵌套 images 数组（部分 API: { data: { images: [{ url: "..." }] } }）
    const images = dataObj.images as Array<Record<string, unknown>> | undefined;
    if (images && Array.isArray(images)) {
      for (const img of images) {
        if (img.url && typeof img.url === 'string') directImageUrls.push(img.url);
        if (img.b64_json && typeof img.b64_json === 'string') directImageUrls.push(`data:image/png;base64,${img.b64_json}`);
      }
    }
  }

  // 2) task_id / id 在顶层（如某些 OpenAI 兼容: { task_id: "xxx" } 或 { id: "xxx" }）
  if (apiResponse.task_id && typeof apiResponse.task_id === 'string') {
    taskIds.push(apiResponse.task_id as string);
  } else if (apiResponse.id && typeof apiResponse.id === 'string' && !apiResponse.task_id && !apiResponse.data) {
    // 仅当没有 data 和 task_id 时，才将 id 作为 taskId（避免误解析 data 数组中的 id）
    taskIds.push(apiResponse.id as string);
  }

  // Determine actual response mode based on what we found
  // ★ 如果同时有 directImageUrls 和 taskIds，优先认为 direct 模式
  // （有直接图片说明已完成，taskIds 可能是额外信息）
  const mode: ResponseMode = directImageUrls.length > 0 ? 'direct'
    : taskIds.length > 0 ? 'polling'
    : 'direct';

  return { mode, directImageUrls, taskIds, raw: apiResponse };
}

// ---------------------------------------------------------------------------
// Utility: check if a provider likely supports direct responses
// ---------------------------------------------------------------------------

/**
 * Quick check: does this provider's profile indicate direct responses?
 * Useful for front-end to decide whether to set up polling.
 */
export function isLikelyDirectResponse(provider: { compatProfile?: string; baseUrl?: string; requestStyle?: string; advancedParams?: Record<string, string> } | null): boolean {
  const profile = resolveCompatProfile(provider);
  return profile.responseMode === 'direct';
}

// ---------------------------------------------------------------------------
// Profile metadata for admin UI
// ---------------------------------------------------------------------------

export const COMPAT_PROFILE_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  {
    value: 'auto',
    label: '自动检测',
    description: '自动根据 API 地址和响应格式适配，适合大多数 OpenAI 兼容 API',
  },
  {
    value: 'apimart',
    label: '异步轮询 (宽高比)',
    description: '支持宽高比格式（1:1, 16:9等），返回 task_id 需轮询，适合 apimart.ai 等中转站',
  },
  {
    value: 'openai',
    label: 'OpenAI 兼容 (直接返回)',
    description: '标准 OpenAI 格式，需像素尺寸，直接返回图片 URL',
  },
  {
    value: 'openai-async',
    label: 'OpenAI 兼容 (异步轮询)',
    description: 'OpenAI 格式但返回 task_id，需像素尺寸 + 轮询',
  },
];
