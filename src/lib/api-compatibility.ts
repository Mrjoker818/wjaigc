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
  editEndpoint: '/images/edits',
  editEncoding: 'multipart-only',
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
  return `${apiBaseUrl}${path}`;
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
 * Convert an aspect-ratio string ("1:1", "16:9") to a pixel-size string
 * ("1024x1024", "1536x1024") suitable for OpenAI-compatible APIs.
 *
 * For GPT Image 2, quality affects the actual pixel dimensions:
 * - high quality + 16:9 → 3840x2160 (4K)
 * - high quality + 9:16 → 2160x3840 (4K)
 *
 * For ratios not in the lookup table, dynamically calculates based on 2048 max edge.
 */
export function convertAspectRatioToSize(ratio: string, quality?: string, modelId?: string): string {
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
  let body = { ...requestBody };

  // --- Size format conversion ---
  if (profile.sizeFormat === 'pixel' && body.size && typeof body.size === 'string') {
    const sizeStr = body.size as string;
    if (sizeStr.includes(':')) {
      const quality = typeof body.quality === 'string' ? body.quality : undefined;
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
  let endpoint: ImageEndpoint;
  if (isEditEndpoint || hasImage) {
    endpoint = profile.editEndpoint;
  } else {
    endpoint = profile.defaultEndpoint;
  }

  // --- input_fidelity ---
  if (profile.supportsInputFidelity && hasImage && endpoint === '/images/edits') {
    // Add input_fidelity: 'high' for better image fidelity in edits
    if (!body.input_fidelity) {
      body.input_fidelity = 'high';
    }
  } else if (!profile.supportsInputFidelity) {
    // Remove input_fidelity if provider doesn't support it
    delete body.input_fidelity;
  }

  return { body, endpoint };
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
  const data = apiResponse.data as Array<Record<string, unknown>> | undefined;
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

  // Determine actual response mode based on what we found
  const mode: ResponseMode = directImageUrls.length > 0 ? 'direct' : 'polling';

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
