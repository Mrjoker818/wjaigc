/**
 * AI Vision Image Subject Identifier
 *
 * Uses a chat/vision model to identify the main subject in an image.
 * Used by refine-engine, generate (IMG2IMG), and other routes to anchor
 * subject identity before image generation, preventing misidentification
 * (e.g. medicine bottle → cosmetics).
 *
 * The function finds an available VISION-capABLE chat model from admin-configured
 * providers and sends the image with a focused identification prompt.
 */
import { findProviderForFeature, getApiProviders } from './server-api-config';
import { fetchWithV1Retry } from './api-helpers';
import type { ModelInfo } from './universal-api-types';
import sharp from 'sharp';

import type { AnnotationRegion } from '@/features/annotations/annotation-types';
import { loadAnnotationImageBuffer } from '@/lib/annotation-mask';
import { parseIdentifiedImageTargetPayload } from '@/lib/annotation-target-parser';
import { dbGetUserById } from '@/lib/db-storage';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';

const IDENTIFY_PROMPT = `Identify the main product/object in this image. Focus on: what is it exactly (product type, specific category), NOT what it resembles. For example: "a white medicine bottle with blue label", NOT "a cosmetic container". Be precise about the product category — distinguish between medicine, cosmetics, food, beverages, chemicals, etc.

Reply in this exact format:
EN: [English identification phrase, 5-15 words]
ZH: [Chinese identification phrase, 5-20 characters]

Example:
EN: a white medicine bottle with blue label
ZH: 白色药瓶带蓝色标签`;

interface IdentifyResult {
  /** English subject description */
  en: string;
  /** Chinese subject description */
  zh: string;
}

export interface IdentifiedImageTarget {
  label: string;
  confidence: number;
  region: AnnotationRegion;
}

/** Extract model ID strings from provider's model lists */
function getModelIds(provider: { selectedModels?: string[]; discoveredModels?: ModelInfo[] }): string[] {
  const selected = (provider.selectedModels || []) as string[];
  const discovered = (provider.discoveredModels || []).map((m: ModelInfo) => m.id);
  // Merge and deduplicate
  return [...new Set([...selected, ...discovered])];
}

/**
 * Extract only admin-selected model IDs (excludes discoveredModels).
 * ★ selectedModels are explicitly enabled by the admin and are guaranteed to work,
 *   whereas discoveredModels may include models that exist on the API but aren't
 *   authorized or may fail when called.
 */
function getSelectedModelIds(provider: { selectedModels?: string[] }): string[] {
  return (provider.selectedModels || []) as string[];
}

/**
 * Check if a model ID is likely to support vision/image input
 * ★ 关键改进：优先选择支持视觉的模型，避免发送图片到纯文本模型导致静默失败
 */
function isVisionModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();

  // Known non-vision models — explicitly exclude
  const nonVisionKeywords = [
    'dall-e', 'flux', 'stable-diffusion', 'midjourney', 'sd3', 'sdxl',
    'kandinsky', 'playground', 'ideogram', 'whisper', 'tts', 'embedding',
    'dall-e-2', 'dall-e-3',
    'gpt-3.5-turbo',           // ★ gpt-3.5 不支持视觉
    'gpt-3.5-turbo-16k',
    'gpt-3.5-turbo-instruct',
    'text-',                    // text-embedding, text-davinci 等
    'babbage', 'davinci', 'curie', 'ada',  // 旧版模型
    'o1-mini', 'o1-preview',   // o1 不支持视觉
    'deepseek-r1',             // deepseek-r1 推理模型不支持视觉
    'deepseek-chat',           // deepseek-chat 部分不支持视觉
  ];
  if (nonVisionKeywords.some(kw => lower.includes(kw))) return false;

  // Known vision-capable models — explicitly include
  const visionKeywords = [
    'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision', 'gpt-4-1106', 'gpt-4-0125',
    'gpt-4.1', 'gpt-4.5',
    'gemini', 'claude-3', 'claude-4', 'qwen-vl', 'qwen2-vl', 'qwen2.5-vl',
    'glm-4v', 'internvl', 'llava', 'cogvlm',
    'vision',
  ];
  if (visionKeywords.some(kw => lower.includes(kw))) return true;

  // Default: GPT-4 class and above are likely vision-capable
  // But unknown models are treated as non-vision to be safe
  return false;
}

/** Check if a model ID is a chat model (not image generation or embedding) */
function isChatModel(modelId: string): boolean {
  const imageKeywords = ['dall-e', 'flux', 'stable-diffusion', 'midjourney', 'sd3', 'sdxl', 'kandinsky', 'playground', 'ideogram'];
  return !imageKeywords.some(kw => modelId.toLowerCase().includes(kw));
}

/**
 * Find an available vision-capable chat model provider
 * ★ 核心改进：优先选择支持视觉的模型，确保图片能被正确识别
 */
async function findVisionProvider(): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
  const providers = await getApiProviders();

  // Strategy 1: Find provider with explicitly vision-capable models
  // 优先级：vlm类型 > chat类型中的视觉模型 > 任意提供商中的视觉模型
  for (const featureType of ['vlm', 'chat'] as const) {
    const featureProvider = await findProviderForFeature(featureType);
    if (featureProvider?.apiKey) {
      // ★ 优先使用 selectedModels（管理员明确启用的模型），避免使用 discoveredModels 中未授权的模型
      const selectedModels = getSelectedModelIds(featureProvider);
      const visionModelsSelected = selectedModels.filter(isVisionModel);
      if (visionModelsSelected.length > 0) {
        const preferred = visionModelsSelected.find(m =>
          m.toLowerCase().includes('gpt-4o') ||
          m.toLowerCase().includes('gemini') ||
          m.toLowerCase().includes('claude-3') ||
          m.toLowerCase().includes('claude-4') ||
          m.toLowerCase().includes('gpt-5')
        );
        return {
          baseUrl: featureProvider.baseUrl,
          apiKey: featureProvider.apiKey,
          model: preferred || visionModelsSelected[0],
        };
      }
      // 如果 selectedModels 中没有视觉模型，尝试使用所有模型（含 discoveredModels）
      const allModels = getModelIds(featureProvider);
      const visionModels = allModels.filter(isVisionModel);
      if (visionModels.length > 0) {
        // 优先选 gpt-4o / gemini 系列
        const preferred = visionModels.find(m =>
          m.toLowerCase().includes('gpt-4o') ||
          m.toLowerCase().includes('gemini') ||
          m.toLowerCase().includes('claude-3') ||
          m.toLowerCase().includes('claude-4') ||
          m.toLowerCase().includes('gpt-5') ||
          m.toLowerCase().includes('qwen-vl')
        );
        return {
          baseUrl: featureProvider.baseUrl,
          apiKey: featureProvider.apiKey,
          model: preferred || visionModels[0],
        };
      }
      // 如果没有已知视觉模型，尝试使用 chat 模型（可能是未知但支持视觉的模型）
      const chatModels = allModels.filter(isChatModel);
      if (chatModels.length > 0 && featureType === 'chat') {
        return {
          baseUrl: featureProvider.baseUrl,
          apiKey: featureProvider.apiKey,
          model: chatModels[0],
        };
      }
    }
  }

  // Strategy 2: Scan all providers for vision models (prefer selectedModels)
  for (const p of providers) {
    if (!p.apiKey || !p.isEnabled) continue;
    const selectedModels = getSelectedModelIds(p);
    const visionModelsSelected = selectedModels.filter(isVisionModel);
    if (visionModelsSelected.length > 0) {
      return {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        model: visionModelsSelected[0],
      };
    }
  }
  // Strategy 2b: Fall back to discoveredModels if no selectedModels matched
  for (const p of providers) {
    if (!p.apiKey || !p.isEnabled) continue;
    const models = getModelIds(p);
    const visionModels = models.filter(isVisionModel);
    if (visionModels.length > 0) {
      return {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        model: visionModels[0],
      };
    }
  }

  // Strategy 3: Fallback — use any chat model from selectedModels (may not support vision)
  for (const p of providers) {
    if (!p.apiKey || !p.isEnabled) continue;
    const selectedModels = getSelectedModelIds(p).filter(isChatModel);
    if (selectedModels.length > 0) {
      console.warn(`[identify-subject] No vision model found, falling back to chat model: ${selectedModels[0]}`);
      return {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        model: selectedModels[0],
      };
    }
  }
  // Strategy 3b: Fall back to any chat model from all models
  for (const p of providers) {
    if (!p.apiKey || !p.isEnabled) continue;
    const models = getModelIds(p).filter(isChatModel);
    if (models.length > 0) {
      console.warn(`[identify-subject] No vision model found, falling back to chat model: ${models[0]}`);
      return {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        model: models[0],
      };
    }
  }

  return null;
}

/**
 * Find ALL available vision-capable providers, ordered by priority.
 * Used by identifyImageSubject for multi-provider fallback.
 */
async function findAllVisionProviders(): Promise<Array<{ baseUrl: string; apiKey: string; model: string; providerId: string }>> {
  const providers = await getApiProviders();
  const result: Array<{ baseUrl: string; apiKey: string; model: string; providerId: string }> = [];
  const seen = new Set<string>();

  const PREFERRED_KEYWORDS = ['gpt-4o', 'gemini', 'claude-3', 'claude-4', 'gpt-5'];

  // Helper: add a provider+model to results if not already seen
  const tryAdd = (p: { baseUrl: string; apiKey: string; id?: string }, model: string, providerId: string) => {
    const key = `${providerId}::${model}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ baseUrl: p.baseUrl, apiKey: p.apiKey, model, providerId });
  };

  // Phase 1: VLM and Chat providers — preferred models from selectedModels
  for (const featureType of ['vlm', 'chat'] as const) {
    const featureProvider = await findProviderForFeature(featureType);
    if (!featureProvider?.apiKey) continue;

    const selectedModels = getSelectedModelIds(featureProvider);
    const visionModelsSelected = selectedModels.filter(isVisionModel);

    // Preferred models first (gpt-4o / gemini / claude / gpt-5)
    const preferred = visionModelsSelected.filter(m =>
      PREFERRED_KEYWORDS.some(kw => m.toLowerCase().includes(kw))
    );
    for (const m of preferred) {
      tryAdd(featureProvider, m, featureProvider.id || featureType);
    }

    // Then other vision models from selectedModels
    const others = visionModelsSelected.filter(m =>
      !PREFERRED_KEYWORDS.some(kw => m.toLowerCase().includes(kw))
    );
    for (const m of others) {
      tryAdd(featureProvider, m, featureProvider.id || featureType);
    }
  }

  // Phase 2: Scan ALL providers for vision models in selectedModels
  for (const p of providers) {
    if (!p.apiKey || !p.isEnabled) continue;
    const selectedModels = getSelectedModelIds(p);
    const visionModelsSelected = selectedModels.filter(isVisionModel);
    for (const m of visionModelsSelected) {
      tryAdd(p, m, p.id || 'unknown');
    }
  }

  // Phase 3: Fall back to discoveredModels (less reliable)
  for (const p of providers) {
    if (!p.apiKey || !p.isEnabled) continue;
    const allModels = getModelIds(p);
    const visionModels = allModels.filter(isVisionModel);
    for (const m of visionModels) {
      tryAdd(p, m, p.id || 'unknown');
    }
  }

  return result;
}

async function findStrictVisionProvider(identity?: {
  userId: string;
  userRole: string;
}): Promise<{
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
} | null> {
  const providers = await getApiProviders();
  const enabled = providers.filter((provider) => provider.isEnabled && provider.apiKey);
  const user = identity && identity.userRole !== 'admin'
    ? await dbGetUserById(identity.userId)
    : null;
  const chatModels = (user as (typeof user & { chat_models?: string[] }) | null)
    ?.chat_models;

  // Pass 1: Prefer selectedModels only (admin-authorized models)
  for (const provider of enabled) {
    const selectedModels = getSelectedModelIds(provider);
    const model = selectedModels.find((modelId) =>
      isVisionModel(modelId)
      && (
        !identity
        || identity.userRole === 'admin'
        || isModelAssignedToUser(
          chatModels,
          provider.id,
          modelId,
        )
      )
    );
    if (model) {
      return {
        providerId: provider.id,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model,
      };
    }
  }
  // Pass 2: Fall back to all models (including discoveredModels)
  for (const provider of enabled) {
    const model = getModelIds(provider).find((modelId) =>
      isVisionModel(modelId)
      && (
        !identity
        || identity.userRole === 'admin'
        || isModelAssignedToUser(
          chatModels,
          provider.id,
          modelId,
        )
      )
    );
    if (model) {
      return {
        providerId: provider.id,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model,
      };
    }
  }
  return null;
}

function parseVisionContent(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
  } catch {
    // Continue with SSE parsing.
  }

  let content = '';
  for (const line of responseText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') continue;
    try {
      const chunk = JSON.parse(trimmed.slice(5).trim()) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') content += delta;
    } catch {
      // Ignore malformed stream fragments; the final strict schema still applies.
    }
  }
  return content;
}

export async function identifyImageTargetAtPoint(
  imageUrl: string,
  point: { x: number; y: number },
  timeoutMs = 30_000,
  identity?: { userId: string; userRole: string },
): Promise<IdentifiedImageTarget | null> {
  if (
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || point.x < 0
    || point.x > 1
    || point.y < 0
    || point.y > 1
  ) {
    return null;
  }

  const provider = await findStrictVisionProvider(identity);
  if (!provider) return null;

  try {
    const source = await loadAnnotationImageBuffer(imageUrl);
    const normalized = await safeSharp(source)
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });
    const markerX = Math.round(point.x * normalized.info.width);
    const markerY = Math.round(point.y * normalized.info.height);
    const markerSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${normalized.info.width}" height="${normalized.info.height}">`
      + `<circle cx="${markerX}" cy="${markerY}" r="22" fill="none" stroke="#ff2d55" stroke-width="7"/>`
      + `<line x1="${markerX - 30}" y1="${markerY}" x2="${markerX + 30}" y2="${markerY}" stroke="#ff2d55" stroke-width="5"/>`
      + `<line x1="${markerX}" y1="${markerY - 30}" x2="${markerX}" y2="${markerY + 30}" stroke="#ff2d55" stroke-width="5"/>`
      + '</svg>',
    );
    const markedImage = await sharp(normalized.data)
      .composite([{ input: markerSvg }])
      .png()
      .toBuffer();
    const markedDataUrl = `data:image/png;base64,${markedImage.toString('base64')}`;
    const prompt = [
      'Identify the single visible object directly under the red crosshair.',
      'Return exactly one JSON object and no markdown or explanation.',
      '{"label":"short object name","confidence":0.0,"region":{"x":0.0,"y":0.0,"w":0.0,"h":0.0}}',
      'region must be the tight normalized bounding box of that object in the full image.',
      `The clicked normalized point is x=${point.x.toFixed(4)}, y=${point.y.toFixed(4)}.`,
      'If no coherent object is under the crosshair, return confidence below 0.3.',
    ].join('\n');

    const response = await fetchWithV1Retry(
      provider.baseUrl,
      '/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: markedDataUrl, detail: 'high' } },
            ],
          }],
          response_format: { type: 'json_object' },
          max_tokens: 400,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
      true,
      timeoutMs,
    );
    if (!response.ok) return null;

    const content = parseVisionContent(await response.text());
    if (!content) return null;
    return parseIdentifiedImageTargetPayload(content);
  } catch (error) {
    console.warn(
      '[identify-subject] Target-at-point resolution failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Convert an image URL to base64 data URL for vision API
 */
async function imageToBase64(imageUrl: string): Promise<string | null> {
  try {
    const image = await loadSafeImageInput(imageUrl, {
      maxBytes: 25 * 1024 * 1024,
    });
    return `data:${image.mimeType};base64,${image.buffer.toString('base64')}`;
  } catch (err) {
    console.warn('[identify-subject] Failed to convert image to base64:', err);
    return null;
  }
}

/**
 * Identify the main subject in an image using AI vision
 *
 * @param imageUrl - URL or path of the image to identify
 * @param timeoutMs - Timeout in milliseconds (default 30s)
 * @returns Subject description in English and Chinese, or null if identification fails
 */
export async function identifyImageSubject(
  imageUrl: string,
  timeoutMs: number = 8000,
): Promise<IdentifyResult | null> {
  // Collect ALL available vision providers for multi-provider fallback
  const allProviders = await findAllVisionProviders();
  if (allProviders.length === 0) {
    console.warn('[identify-subject] No vision-capable model provider available for identification');
    return null;
  }

  console.info(`[identify-subject] Found ${allProviders.length} vision provider(s): ${allProviders.map(p => p.model).join(', ')}`);

  // Pre-convert image to base64 once (reuse across all provider attempts)
  const base64 = await imageToBase64(imageUrl);
  if (!base64) {
    console.warn('[identify-subject] Failed to convert image to base64');
    return null;
  }

  // Try each provider in priority order until one succeeds
  // Limit to first 8 providers to avoid excessive API calls when all fail
  const maxAttempts = Math.min(allProviders.length, 8);
  for (let i = 0; i < maxAttempts; i++) {
    const provider = allProviders[i];
    try {
      console.info(`[identify-subject] Trying provider ${i + 1}/${maxAttempts}: model=${provider.model}`);

      const requestBody = {
        model: provider.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: IDENTIFY_PROMPT },
              {
                type: 'image_url',
                image_url: {
                  url: base64,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0.1,
        stream: false,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchWithV1Retry(
          provider.baseUrl,
          '/chat/completions',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${provider.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          },
          true,
          timeoutMs,
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.warn(`[identify-subject] Provider ${i + 1} (${provider.model}) API error: ${response.status} ${errorText.slice(0, 200)}`);
          continue; // Try next provider
        }

        // Handle both streaming and non-streaming responses
        const responseText = await response.text();

        // Try parsing as JSON first
        let content = '';
        try {
          const json = JSON.parse(responseText);
          content = json.choices?.[0]?.message?.content || '';
        } catch {
          // Try parsing as SSE stream
          const lines = responseText.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const chunk = JSON.parse(line.slice(6));
                const delta = chunk.choices?.[0]?.delta?.content || '';
                content += delta;
              } catch { /* skip */ }
            }
          }
        }

        if (!content) {
          console.warn(`[identify-subject] Provider ${i + 1} (${provider.model}) returned empty content`);
          continue; // Try next provider
        }

        // Clean up the content - remove quotes, extra whitespace
        content = content.trim().replace(/^["']|["']$/g, '');

        // Parse bilingual response (EN: xxx / ZH: xxx format)
        let enDesc = content;
        let zhDesc = content;

        const enMatch = content.match(/EN:\s*(.+?)(?:\n|ZH:|$)/i);
        const zhMatch = content.match(/ZH:\s*(.+?)$/im);
        if (enMatch) enDesc = enMatch[1].trim();
        if (zhMatch) zhDesc = zhMatch[1].trim();

        console.info(`[identify-subject] Identified (provider ${i + 1}, model=${provider.model}): en="${enDesc}", zh="${zhDesc}"`);
        return {
          en: enDesc,
          zh: zhDesc || enDesc,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      console.warn(`[identify-subject] Provider ${i + 1} (${provider.model}) failed:`, err instanceof Error ? err.message : String(err));
      // Continue to next provider
    }
  }

  console.warn(`[identify-subject] All ${maxAttempts} vision provider attempts exhausted, identification failed`);
  return null;
}
