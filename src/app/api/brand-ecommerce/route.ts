import { NextRequest, NextResponse, after } from 'next/server';
import { createHash } from 'node:crypto';
import { findProviderForModel, findProviderById, getPublicModels } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, buildPollUrl, extractImageUrl } from '@/lib/api-compatibility';
import { fetchWithV1Retry, getInternalApiUrl } from '@/lib/api-helpers';
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';
import { getSessionUser } from '@/lib/server-auth';
import { calculateConfiguredCreditCost, InsufficientCreditsError } from '@/lib/credits';
import { createBillableTask, settleFailedTask } from '@/lib/task-core/billing-service';
import { completeCloudTask, updateCloudTask } from '@/lib/cloud-task-storage';
import {
  IdempotencyConflictError,
  isIdempotencyValidationError,
  validateIdempotencyIdentity,
} from '@/lib/task-core/idempotency';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { normalizeProviderModelSelection } from '@/lib/task-core/exact-model-selection';
import sharp from 'sharp';
import { validateApiInputs } from '@/lib/api-validator';
import { logOperation, logError, OP_ACTIONS, startTimer } from '@/lib/op-log';
import { setBrandResult } from './result-store';
import type { BrandGenerationResult } from '@/types/brand-ecommerce';

export const dynamic = 'force-dynamic';

// ─── Persist result image to local server ────
async function persistResultImage(imageUrl: string): Promise<string> {
  try {
    if (imageUrl.startsWith('/api/serve-upload/') || imageUrl.startsWith('/uploads/')) return imageUrl;
    if (imageUrl.startsWith('data:')) {
      const resp = await fetch(getInternalApiUrl('/api/save-image'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getInternalRequestHeaders('system-save-image', 'admin')) },
        body: JSON.stringify({ imageUrl }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.url) return data.url;
      }
      return imageUrl;
    }
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
      if (imgResp.ok) {
        const contentType = imgResp.headers.get('content-type') || 'image/png';
        const buffer = Buffer.from(await imgResp.arrayBuffer());
        const base64 = `data:${contentType};base64,${buffer.toString('base64')}`;
        const resp = await fetch(getInternalApiUrl('/api/save-image'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getInternalRequestHeaders('system-save-image', 'admin')) },
          body: JSON.stringify({ imageUrl: base64 }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.url) return data.url;
        }
      }
      return imageUrl;
    }
    return imageUrl;
  } catch (err) {
    console.warn('[brand-ecommerce] Failed to persist result image:', err);
    return imageUrl;
  }
}

// ─── Product Consistency: Mask Generation & Compositing ─────────

type ProductConsistencyMode = 'text-only' | 'img2img-fusion' | 'mask-composite';

interface ProductMaskResult {
  maskBuffer: Buffer;   // RGBA Buffer, white=product region, black=background
  width: number;
  height: number;
}

/**
 * Generate a product mask from the product image using RemoveBG.
 * Falls back to a simple alpha-based mask if RemoveBG is unavailable.
 */
async function generateProductMask(productImageUrl: string): Promise<ProductMaskResult | null> {
  try {
    const { fetchImageBuffer } = await import('@/lib/fetch-image-buffer');
    const { generateRembgMask } = await import('@/lib/image-tools/rembg-client');
    const sourceBuffer = await fetchImageBuffer(productImageUrl);
    const result = await generateRembgMask(sourceBuffer, 'birefnet-general');
    if (result.success && result.maskBase64) {
      const maskBuffer = Buffer.from(result.maskBase64, 'base64');
      const meta = await sharp(maskBuffer).metadata();
      return { maskBuffer, width: meta.width || 512, height: meta.height || 512 };
    }

    // Fallback: generate mask from image alpha or luminance
    return await generateSimpleMask(productImageUrl);
  } catch (err) {
    console.warn('[brand-ecommerce] Mask generation failed, falling back to simple mask:', err);
    return await generateSimpleMask(productImageUrl);
  }
}

/**
 * Simple mask generation: load image, convert to grayscale, threshold.
 * Bright areas are assumed to be product, dark areas are background.
 * Also uses alpha channel if available.
 */
async function generateSimpleMask(imageUrl: string): Promise<ProductMaskResult | null> {
  try {
    let imageBuffer: Buffer;

    if (imageUrl.startsWith('data:')) {
      const base64Data = imageUrl.split(',')[1];
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else if (imageUrl.startsWith('http')) {
      const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) return null;
      imageBuffer = Buffer.from(await resp.arrayBuffer());
    } else if (imageUrl.startsWith('/api/serve-upload/')) {
      const resp = await fetch(getInternalApiUrl(imageUrl), { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) return null;
      imageBuffer = Buffer.from(await resp.arrayBuffer());
    } else {
      return null;
    }

    // Use sharp to create a mask: extract alpha + luminance, threshold
    const meta = await sharp(imageBuffer).metadata();
    const w = meta.width || 512;
    const h = meta.height || 512;

    // If the image has alpha, use it; otherwise use luminance threshold
    const hasAlpha = meta.channels === 4;
    let maskPipeline = sharp(imageBuffer).resize(w, h);

    if (hasAlpha) {
      // Extract alpha channel as mask
      maskPipeline = maskPipeline.extractChannel('alpha').threshold(128).toColorspace('srgb');
    } else {
      // Use luminance: assume product is brighter than background
      maskPipeline = maskPipeline.grayscale().threshold(30).toColorspace('srgb');
    }

    const maskBuffer = await maskPipeline.png().toBuffer();
    return { maskBuffer, width: w, height: h };
  } catch (err) {
    console.warn('[brand-ecommerce] Simple mask generation failed:', err);
    return null;
  }
}

/**
 * Load image buffer from URL (data:, http, or relative path)
 */
async function loadImageBuffer(imageUrl: string): Promise<Buffer | null> {
  try {
    if (imageUrl.startsWith('data:')) {
      const base64Data = imageUrl.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    }
    if (imageUrl.startsWith('http')) {
      const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) return null;
      return Buffer.from(await resp.arrayBuffer());
    }
    if (imageUrl.startsWith('/api/serve-upload/')) {
      const resp = await fetch(getInternalApiUrl(imageUrl), { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) return null;
      return Buffer.from(await resp.arrayBuffer());
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Mask compositing: overlay the original product onto the generated scene
 * using the product mask to precisely preserve product details.
 *
 * @param sceneBuffer - Generated scene image (full size)
 * @param productBuffer - Original product image
 * @param productMask - Product mask (white=product, black=background)
 * @param strength - Blend strength 0-1 (1=full product overlay, 0=no overlay)
 * @param featherRadius - Edge feathering in pixels for smooth blending
 */
async function compositeProductToScene(
  sceneBuffer: Buffer,
  productBuffer: Buffer,
  productMask: Buffer,
  strength: number = 0.85,
  featherRadius: number = 8,
): Promise<Buffer> {
  // Ensure all images are the same size
  const sceneMeta = await sharp(sceneBuffer).metadata();
  const targetW = sceneMeta.width || 1024;
  const targetH = sceneMeta.height || 1024;

  const resizedProduct = await sharp(productBuffer).resize(targetW, targetH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer();
  const resizedMask = await sharp(productMask).resize(targetW, targetH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer();
  const sceneRaw = await sharp(sceneBuffer).resize(targetW, targetH).ensureAlpha().raw().toBuffer();

  // Apply Gaussian blur to mask for feathering
  const featheredMask = await sharp(productMask)
    .resize(targetW, targetH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(featherRadius)
    .ensureAlpha()
    .raw()
    .toBuffer();

  const result = Buffer.from(sceneRaw);
  const pixels = targetW * targetH;

  for (let i = 0; i < pixels; i++) {
    const idx = i * 4;
    // Mask brightness (0=background, 255=product)
    const maskVal = (featheredMask[idx] + featheredMask[idx + 1] + featheredMask[idx + 2]) / 3 / 255;
    // Also check if product pixel has content (alpha > 0)
    const productAlpha = resizedProduct[idx + 3] / 255;

    const alpha = Math.min(maskVal, productAlpha) * strength;
    if (alpha < 0.01) continue; // Skip background pixels

    // Blend: alpha composite
    const invAlpha = 1 - alpha;
    result[idx]     = Math.round(resizedProduct[idx]     * alpha + sceneRaw[idx]     * invAlpha);
    result[idx + 1] = Math.round(resizedProduct[idx + 1] * alpha + sceneRaw[idx + 1] * invAlpha);
    result[idx + 2] = Math.round(resizedProduct[idx + 2] * alpha + sceneRaw[idx + 2] * invAlpha);
    result[idx + 3] = 255; // Full opacity
  }

  return await sharp(result, { raw: { width: targetW, height: targetH, channels: 4 } })
    .png({ quality: 95 })
    .toBuffer();
}

// ─── E-commerce JSON Template Definitions ─────────────────────────

// ─── Style Fidelity Anchors (风格保真锚点) ──────────────────────────
// 这些锚点确保跨模板生成时视觉一致性，不随模板变化而丢失核心风格

const STYLE_FIDELITY_ANCHORS = {
  commercial: '[Style Fidelity Anchor: lens distortion remains centered and radial — never asymmetrical. Color temperature is warm amber across all zones. Text is always crisp with no anti-aliasing artifacts. Lighting always originates from upper-left 45°, casting natural directional shadows. Composition follows rule of thirds with product at intersection points. Negative space is intentional, never accidental.]',
  product: '[Style Fidelity Anchor: pure white background RGB(255,255,255) with no gray edges. Product shadow is soft, natural, and directionally consistent. Product is centered with even breathing room on all sides. Studio lighting from top creates soft highlights without harsh specular. All product details are tack-sharp. No text or watermark overlays.]',
  lifestyle: '[Style Fidelity Anchor: natural ambient lighting matches real-world scene. Product integrates seamlessly — no floating or composite feel. Depth of field creates natural bokeh. Warm tones evoke aspiration. Color palette is cohesive and brand-consistent. Human elements (if any) have natural proportions and skin tones.]',
};

interface EcomTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  promptTemplate: string;
  negativePrompt: string;
  aspectRatio: string;
  category: string;
  fidelityAnchor?: string;
}

const ECOM_TEMPLATES: EcomTemplate[] = [
  // ──── 主图系列 ────
  {
    id: 'white-bg',
    name: '白底主图',
    icon: '⬜',
    description: '淘宝/京东/拼多多标准主图，纯白背景+自然阴影，平台审核无忧',
    promptTemplate: `Commercial product photography, {SUBJECT}, placed on pure white background RGB(255,255,255), professional studio lighting from upper-left 45°, centered composition with breathing room, tack-sharp product details, soft natural drop shadow, e-commerce standard main image, high resolution suitable for mobile display. {brand_color_prompt}{style_extra}
{SUBJECT_ACTION}
{BACKGROUND_ELEMENTS}
{STYLE_FIDELITY_PRODUCT}`,
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, signature, screenshot, compression artifacts, cluttered background, gray edge, shadow on background, text, logo, harsh shadow, asymmetric shadow, colored background, noise, grain, overexposed',
    aspectRatio: '1:1',
    category: 'product',
    fidelityAnchor: 'product',
  },
  {
    id: 'banner-horizontal',
    name: '横版Banner图',
    icon: '🖼️',
    description: '横版广告Banner，冲击力构图+品牌文案，适合首页/活动页',
    promptTemplate: `Commercial banner advertisement, {ASPECT_RATIO} format, {SUBJECT} as hero element, {SUBJECT_ACTION}, dynamic wide-angle composition with lens distortion effect for visual impact, {BACKGROUND_ELEMENTS}, bold typography layout — {MAIN_TEXT} as primary headline in large bold font, {SECONDARY_TEXT} as supporting copy, {ACCENT_SYMBOL} as decorative accent, warm amber color temperature, professional advertising photography quality. {brand_color_prompt}{style_extra}
{STYLE_FIDELITY_COMMERCIAL}`,
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, text overflow, messy layout, unprofessional, boring, static, plain, low resolution, overexposed, underexposed, wrong aspect ratio',
    aspectRatio: '16:9',
    category: 'banner',
    fidelityAnchor: 'commercial',
  },
  {
    id: 'detail-vertical',
    name: '竖版详情页',
    icon: '📱',
    description: '竖版详情页长图，多区段结构：英雄区+卖点+细节+CTA',
    promptTemplate: `E-commerce product detail page, vertical {ASPECT_RATIO} format, {SUBJECT} as hero product, multi-section layout — hero banner section at top with {SUBJECT} and {MAIN_TEXT} headline, value proposition section with {SECONDARY_TEXT}, core benefit section highlighting {PRODUCT_OR_PROP}, flavor/detail section showcasing material and craftsmanship, CTA section at bottom with {ACCENT_SYMBOL}, professional typography hierarchy, warm amber tones, premium commercial feel. {brand_color_prompt}{style_extra}
{STYLE_FIDELITY_COMMERCIAL}`,
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, text overflow, messy layout, unprofessional, cluttered, inconsistent sections, wrong aspect ratio, horizontal layout',
    aspectRatio: '3:4',
    category: 'detail',
    fidelityAnchor: 'commercial',
  },
  {
    id: 'xiaohongshu',
    name: '小红书封面',
    icon: '📕',
    description: '小红书竖版笔记封面，强化标题文字渲染+种草风格',
    promptTemplate: `Xiaohongshu (RED) cover image, vertical {ASPECT_RATIO} format, {SUBJECT} as eye-catching focal point, {SUBJECT_ACTION}, lifestyle aesthetic with warm natural lighting, top 20% reserved for app overlay logo, bold and crisp Chinese text rendering — {MAIN_TEXT} as attention-grabbing headline in stylish font, {SECONDARY_TEXT} as supporting tagline, {ACCENT_SYMBOL} as decorative element, aspirational and shareable vibe, depth of field bokeh background, {brand_color_prompt}{style_extra}
{STYLE_FIDELITY_LIFESTYLE}`,
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, ugly, boring, dated, horizontal layout, harsh text, aliased text, misspelled characters, cluttered, unappealing',
    aspectRatio: '3:4',
    category: 'social',
    fidelityAnchor: 'lifestyle',
  },
  {
    id: 'douyin',
    name: '抖音橱窗图',
    icon: '🎵',
    description: '抖音横版商品橱窗封面，动态构图+行动号召按钮位',
    promptTemplate: `Douyin product showcase cover, horizontal {ASPECT_RATIO} format, {SUBJECT} as hero product, {SUBJECT_ACTION}, dynamic wide-angle composition guiding eyes to product, key highlight areas auto-brightened, bottom-right reserved for CTA button overlay, bold headline text — {MAIN_TEXT}, supporting copy — {SECONDARY_TEXT}, {ACCENT_SYMBOL} as visual accent, energetic and engaging vibe, professional commercial photography quality, {brand_color_prompt}{style_extra}
{STYLE_FIDELITY_COMMERCIAL}`,
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, vertical layout, boring, static, plain, text overflow, messy layout, unprofessional',
    aspectRatio: '16:9',
    category: 'social',
    fidelityAnchor: 'commercial',
  },
  {
    id: 'scene-lifestyle',
    name: '场景氛围图',
    icon: '🏞️',
    description: '商品融入生活场景，自然光影+景深氛围，增强购买代入感',
    promptTemplate: `Lifestyle product photography, {SUBJECT} placed in {LOCATION} setting, {SUBJECT_ACTION}, natural ambient lighting matching real-world scene, warm and inviting atmosphere, professional depth of field with natural bokeh, {BACKGROUND_ELEMENTS}, product seamlessly integrated — no floating or composite feel, magazine editorial quality, aspirational mood. {brand_color_prompt}{style_extra}
{STYLE_FIDELITY_LIFESTYLE}`,
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, ugly, unrealistic, cartoon, fake composite, harsh edge, floating product, mismatched lighting, unnatural shadow, CGI look',
    aspectRatio: '4:3',
    category: 'scene',
    fidelityAnchor: 'lifestyle',
  },
  {
    id: 'model-wear',
    name: '模特展示图',
    icon: '👗',
    description: '模特穿搭/使用展示，自然姿态+时尚杂志风格',
    promptTemplate: `Fashion model photography, model showcasing {SUBJECT}, {SUBJECT_ACTION}, full-body to half-body shot, professional studio lighting, natural and confident pose, clean background with subtle gradient, fashion magazine editorial style, high-resolution skin and fabric detail, {BACKGROUND_ELEMENTS}, {brand_color_prompt}{style_extra}
{STYLE_FIDELITY_LIFESTYLE}`,
    negativePrompt: 'low quality, blurry, distorted face, deformed hands, extra limbs, watermark, ugly, unnatural pose, fused fingers, long neck, bad anatomy, disfigured, extra fingers, mutated hands',
    aspectRatio: '3:4',
    category: 'model',
    fidelityAnchor: 'lifestyle',
  },
  {
    id: 'detail-closeup',
    name: '细节特写',
    icon: '🔍',
    description: '微距展示材质纹理和工艺细节，放大产品质感',
    promptTemplate: `Macro product photography, extreme close-up detail shot of {SUBJECT}, showcasing {PRODUCT_OR_PROP} — material texture, craftsmanship, and fine details, ultra-shallow depth of field, professional studio ring lighting, tack-sharp focus on detail area, {BACKGROUND_ELEMENTS} as soft bokeh, high-resolution sensor quality capture. {brand_color_prompt}{style_extra}
{STYLE_FIDELITY_PRODUCT}`,
    negativePrompt: 'low quality, blurry, out of focus, distorted, deformed, watermark, noise, grain, overexposed, underexposed, depth of field too deep, lack of detail, soft focus',
    aspectRatio: '1:1',
    category: 'product',
    fidelityAnchor: 'product',
  },
  {
    id: 'brand-poster',
    name: '品牌海报',
    icon: '🎨',
    description: '品牌视觉延展海报，渐变背景+品牌色锁定+高级质感',
    promptTemplate: `Brand visual extension poster, {SUBJECT} as central element, {SUBJECT_ACTION}, premium gradient background with brand color consistency, {brand_color_prompt} professional advertising composition, {MAIN_TEXT} as brand headline in elegant typography, {SECONDARY_TEXT} as tagline, {ACCENT_SYMBOL} as brand mark, luxury commercial photography style, high-end material feel. {style_extra}
{STYLE_FIDELITY_COMMERCIAL}`,
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, text overflow, messy layout, inconsistent colors, cheap feel, amateur, plain background',
    aspectRatio: '3:4',
    category: 'promo',
    fidelityAnchor: 'commercial',
  },
  {
    id: 'creative-composite',
    name: '创意合成图',
    icon: '✨',
    description: '创意视觉合成，超现实场景+梦幻光影，打造差异化产品形象',
    promptTemplate: `Creative composite product photography, {SUBJECT} in surreal dreamlike scene, {SUBJECT_ACTION}, {BACKGROUND_ELEMENTS} with fantastical elements, ethereal and dreamy lighting effects, artistic presentation with unique visual language, {MAIN_TEXT} as creative headline, {ACCENT_SYMBOL} as mystical accent, {brand_color_prompt} differentiated product imagery, professional retouching quality. {style_extra}
{STYLE_FIDELITY_COMMERCIAL}`,
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, boring, ordinary, plain, messy composite, harsh edges, unnatural blend, cheap CGI',
    aspectRatio: '1:1',
    category: 'creative',
    fidelityAnchor: 'commercial',
  },
  {
    id: 'packaging',
    name: '包装展示图',
    icon: '📦',
    description: '产品包装盒/袋展示，品牌标识清晰+高级包装质感',
    promptTemplate: `Product packaging photography, {SUBJECT} packaging box/bag facing camera, {SUBJECT_ACTION}, brand identity and logo clearly visible on packaging, {MAIN_TEXT} printed on packaging surface, {brand_color_prompt} premium packaging material texture, soft professional lighting, {BACKGROUND_ELEMENTS}, high-end unboxing feel. {style_extra}
{STYLE_FIDELITY_PRODUCT}`,
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, damaged packaging, wrinkled, misprinted text, cheap material, flat lighting, unappealing',
    aspectRatio: '3:4',
    category: 'product',
    fidelityAnchor: 'product',
  },
  {
    id: 'multi-size-batch',
    name: '多尺寸批量图',
    icon: '📐',
    description: '同一商品生成多种尺寸，全渠道分发覆盖（1:1+3:4+16:9）',
    promptTemplate: `Multi-purpose product photography, {SUBJECT}, versatile composition that works in multiple aspect ratios, {SUBJECT_ACTION}, professional studio lighting, clean background suitable for cropping, {MAIN_TEXT} as flexible headline, {brand_color_prompt} consistent visual identity across sizes, {style_extra}
{STYLE_FIDELITY_PRODUCT}`,
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, cluttered, tight composition, elements cut off, inconsistent style',
    aspectRatio: '1:1',
    category: 'product',
    fidelityAnchor: 'product',
  },
];

// ─── Helper: Get image provider ────────────────────────────────────

async function getImageProvider(model?: string) {
  if (model) {
    const p = await findProviderForModel(model, 'image');
    if (p) return p;
  }
  // fallback: find any image provider
  const p = await findProviderForModel('', 'image');
  return p;
}

// ─── Helper: Resolve aspect ratio to dimensions ───────────────────

function resolveDimensions(aspectRatio: string): { width: number; height: number } {
  const map: Record<string, { width: number; height: number }> = {
    '1:1': { width: 1024, height: 1024 },
    '4:3': { width: 1024, height: 768 },
    '3:4': { width: 768, height: 1024 },
    '16:9': { width: 1024, height: 576 },
    '9:16': { width: 576, height: 1024 },
    '4:5': { width: 896, height: 1120 },
    '3:2': { width: 1024, height: 683 },
    '2:3': { width: 683, height: 1024 },
  };
  return map[aspectRatio] || { width: 1024, height: 1024 };
}

// ─── POST Handler ──────────────────────────────────────────────────

function unwrapAssistPayload(value: unknown): Record<string, unknown> {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return {};
    const record = current as Record<string, unknown>;
    if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) return record;
    current = record.data;
  }
  return current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
}

function extractAssistContent(value: unknown): string {
  const payload = unwrapAssistPayload(value);
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object'
    ? choices[0] as Record<string, unknown>
    : {};
  const delta = firstChoice.delta && typeof firstChoice.delta === 'object'
    ? firstChoice.delta as Record<string, unknown>
    : {};
  const message = firstChoice.message && typeof firstChoice.message === 'object'
    ? firstChoice.message as Record<string, unknown>
    : {};
  if (typeof delta.content === 'string') return delta.content;
  if (typeof message.content === 'string') return message.content;

  const output = payload.output && typeof payload.output === 'object'
    ? payload.output as Record<string, unknown>
    : {};
  if (typeof output.text === 'string') return output.text;

  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const candidate = candidates[0] && typeof candidates[0] === 'object'
    ? candidates[0] as Record<string, unknown>
    : {};
  const candidateContent = candidate.content && typeof candidate.content === 'object'
    ? candidate.content as Record<string, unknown>
    : {};
  const parts = Array.isArray(candidateContent.parts) ? candidateContent.parts : [];
  const part = parts[0] && typeof parts[0] === 'object' ? parts[0] as Record<string, unknown> : {};
  if (typeof part.text === 'string') return part.text;
  return typeof payload.result === 'string' ? payload.result : '';
}

async function parseAssistResponse(response: Response): Promise<string> {
  const text = await response.text();
  const responsePreview = text.trim().replace(/\s+/g, ' ').slice(0, 200);
  const isSse = response.headers.get('content-type')?.includes('text/event-stream')
    || text.trimStart().startsWith('data:');
  if (!isSse) {
    try {
      const content = extractAssistContent(JSON.parse(text));
      if (content) return content;
    } catch {
      // Report the bounded upstream body below so the caller can distinguish provider data from transport failure.
    }
    throw new Error(`LLM API 响应无法解析: ${responsePreview || '(empty response)'}`);
  }

  let content = '';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      content += extractAssistContent(JSON.parse(data));
    } catch {
      // Ignore malformed provider heartbeat chunks; valid content chunks still complete the response.
    }
  }
  if (content) return content;
  throw new Error(`LLM API 响应无法解析: ${responsePreview || '(empty response)'}`);
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let durableTaskId: string | undefined;
  let sessionUser: import('@/lib/user-types').User | null = null;
  const selectedModel = '';
  const providerIdUsed = '';
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        prompt: 'optionalPrompt',
        imageUrl: 'optionalImageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const { action } = body;

    if (action === 'templates') {
      // ★ Dynamic templates: load from database first, fallback to built-in
      try {
        const { dbGetEcomTemplates } = await import('@/lib/db-storage');
        const dbTemplates = await dbGetEcomTemplates(true); // enabled only
        if (dbTemplates.length > 0) {
          // Map DB fields to frontend format
          const templates = dbTemplates.map(t => ({
            id: t.id,
            name: t.name,
            icon: t.icon,
            description: t.description,
            promptTemplate: t.prompt_template,
            negativePrompt: t.negative_prompt,
            aspectRatio: t.aspect_ratio,
            category: t.category,
            fidelityAnchor: t.fidelity_anchor,
          }));
          return NextResponse.json({ success: true, templates });
        }
      } catch {
        // DB not available, fall through to built-in
      }
      return NextResponse.json({ success: true, templates: ECOM_TEMPLATES });
    }

    if (action === 'generate') {
      const { templateIds, productDesc, styleExtra, model, providerId, referenceImageUrl, productImageUrl, brandColors, variantCount, productConsistencyMode, productConsistencyStrength } = body;
      if (!templateIds?.length) {
        return NextResponse.json({ error: '请至少选择一个模板' }, { status: 400 });
      }
      if (!productDesc?.trim()) {
        return NextResponse.json({ error: '请输入商品描述' }, { status: 400 });
      }

      const rawModelId = String(model || '');
      const embeddedProviderId = rawModelId.includes('::') ? rawModelId.split('::')[0] : '';
      const requestedModelId = rawModelId.includes('::') ? rawModelId.split('::').pop()! : rawModelId;
      const effectiveProviderId = String(providerId || embeddedProviderId || '');
      if (providerId && embeddedProviderId && providerId !== embeddedProviderId) {
        return NextResponse.json({
          success: false,
          code: 'MODEL_PROVIDER_MISMATCH',
          error: '模型所属供应商与当前选择的供应商不一致，请刷新模型列表后重新选择',
          retryable: false,
          providerId,
          model,
        }, { status: 400 });
      }

      let provider: ApiProvider | null = null;
      let exactModelId = '';
      if (effectiveProviderId) {
        provider = await findProviderById(effectiveProviderId);
        const providerDefaultModel = provider?.selectedModels?.[0] || provider?.discoveredModels?.[0]?.id || '';
        const selection = normalizeProviderModelSelection({
          requestedModelId: requestedModelId || providerDefaultModel,
          selectedModels: provider?.selectedModels,
          discoveredModels: provider?.discoveredModels,
        });
        const providerKind = provider?.modelType || provider?.type || '';
        const supportsImage = ['image', 'universal', 'general', 'imageEdit'].includes(providerKind);
        if (!provider || !supportsImage || !selection.matched) {
          return NextResponse.json({
            success: false,
            code: 'MODEL_PROVIDER_MISMATCH',
            error: '所选模型已不在当前供应商的可用列表中，请刷新模型列表后重新选择',
            retryable: false,
            providerId: effectiveProviderId,
            model,
          }, { status: 400 });
        }
        exactModelId = selection.modelId;
      } else {
        provider = await getImageProvider(requestedModelId);
      }
      if (!provider) {
        return NextResponse.json({ error: '未找到可用的图像模型，请在管理员后台配置' }, { status: 400 });
      }

      const rawSelectedModel = exactModelId || requestedModelId || provider.selectedModels?.[0];
      if (!rawSelectedModel) {
        return NextResponse.json({ error: '未指定模型' }, { status: 400 });
      }
      const { apiModelName: selectedModel } = normalizeModelForApi(rawSelectedModel);
      const resultIdentity = {
        providerId: provider.id,
        providerName: provider.displayName || provider.name,
        modelName: selectedModel,
      };
      if (selectedModel !== rawSelectedModel) {
        console.log(`[brand-ecommerce] Model normalized: ${rawSelectedModel} → ${selectedModel}`);
      }

      // ★ Dynamic template resolution: DB first, then fallback to built-in
      // Support suffixed IDs like "detail-vertical-2" → base "detail-vertical"
      const resolveBaseTemplateId = (id: string): string => {
        const suffixMatch = id.match(/^(.+)-(\d+)$/);
        if (suffixMatch) {
          const [, baseId] = suffixMatch;
          // Check if baseId matches a known template
          if (ECOM_TEMPLATES.some(t => t.id === baseId)) return baseId;
        }
        return id;
      };

      let selectedTemplates: EcomTemplate[];
      try {
        const { dbGetEcomTemplate } = await import('@/lib/db-storage');
        const dbResults = await Promise.all(templateIds.map((tid: string) => {
          const baseId = resolveBaseTemplateId(tid);
          return dbGetEcomTemplate(baseId);
        }));
        const found = dbResults.filter(Boolean);
        if (found.length > 0) {
          selectedTemplates = found.map((t, i) => {
            const originalId = templateIds[i];
            const suffixMatch = originalId.match(/^.+-(\d+)$/);
            const displayName = suffixMatch ? `${t!.name} ${suffixMatch[1]}` : t!.name;
            return {
            id: originalId, // Keep original ID (may have suffix) for result tracking
            name: displayName,
            icon: t!.icon,
            description: t!.description,
            promptTemplate: t!.prompt_template,
            negativePrompt: t!.negative_prompt,
            aspectRatio: t!.aspect_ratio,
            category: t!.category,
            fidelityAnchor: t!.fidelity_anchor,
          }});
        } else {
          selectedTemplates = templateIds.map((tid: string) => {
            const baseId = resolveBaseTemplateId(tid);
            const tpl = ECOM_TEMPLATES.find(t => t.id === baseId);
            return tpl ? { ...tpl, id: tid } : null;
          }).filter(Boolean) as EcomTemplate[];
        }
      } catch {
        selectedTemplates = templateIds.map((tid: string) => {
          const baseId = resolveBaseTemplateId(tid);
          const tpl = ECOM_TEMPLATES.find(t => t.id === baseId);
          if (!tpl) return null;
          const suffixMatch = tid.match(/^.+-(\d+)$/);
          const displayName = suffixMatch ? `${tpl.name} ${suffixMatch[1]}` : tpl.name;
          return { ...tpl, id: tid, name: displayName };
        }).filter(Boolean) as EcomTemplate[];
      }

      if (!selectedTemplates.length) {
        return NextResponse.json({ error: '未找到选中的模板' }, { status: 400 });
      }

      // Build brand color prompt (文章强调品牌色一致性，支持HEX色值注入)
      const brandColorPrompt = brandColors?.length
        ? `Primary color ${brandColors[0]}${brandColors[1] ? ', secondary color ' + brandColors[1] : ''}${brandColors[2] ? ', accent color ' + brandColors[2] : ''}. Strictly maintain brand color consistency across all elements.`
        : '';
      const styleParts = [styleExtra].filter(Boolean).join(', ');

      // Build template variables (JSON模板结构变量映射)
      const mainText = body.mainText || productDesc;
      const secondaryText = body.secondaryText || '';
      const subjectAction = body.subjectAction || '';
      const backgroundElements = body.backgroundElements || '';
      const location = body.location || '';
      const productOrProp = body.productOrProp || productDesc;
      const accentSymbol = body.accentSymbol || '';

      // Resolve fidelity anchors
      const fidelityMap: Record<string, string> = {
        commercial: STYLE_FIDELITY_ANCHORS.commercial,
        product: STYLE_FIDELITY_ANCHORS.product,
        lifestyle: STYLE_FIDELITY_ANCHORS.lifestyle,
      };

      // Build template variables — templateFieldValues per-template overrides take priority
      const tfv = (body.templateFieldValues || {}) as Record<string, Record<string, string>>;
      const getTplField = (tplId: string, field: string, fallback: string = ''): string => {
        const tplFields = tfv[tplId];
        if (tplFields && tplFields[field] !== undefined && tplFields[field] !== '') return tplFields[field];
        return fallback;
      };

      const tasks = selectedTemplates.map(tpl => {
        const fidelity = tpl.fidelityAnchor ? fidelityMap[tpl.fidelityAnchor] || '' : '';
        // Per-template field values override global values
        const tplMainText = getTplField(tpl.id, 'mainText', mainText);
        const tplSecondaryText = getTplField(tpl.id, 'secondaryText', secondaryText);
        const tplSubjectAction = getTplField(tpl.id, 'subjectAction', subjectAction);
        const tplBackgroundElements = getTplField(tpl.id, 'backgroundElements', backgroundElements);
        const tplLocation = getTplField(tpl.id, 'location', location);
        const tplProductOrProp = getTplField(tpl.id, 'productOrProp', productOrProp);
        const tplAccentSymbol = getTplField(tpl.id, 'accentSymbol', accentSymbol);
        const tplSellingPoints = getTplField(tpl.id, 'sellingPoints', '');
        const tplDetailDesc = getTplField(tpl.id, 'detailDescription', '');
        const tplUsageScene = getTplField(tpl.id, 'usageScene', '');
        const tplMoodKeywords = getTplField(tpl.id, 'moodKeywords', '');
        const tplPromotionInfo = getTplField(tpl.id, 'promotionInfo', '');
        const tplTargetAudience = getTplField(tpl.id, 'targetAudience', '');
        const tplCompositionNotes = getTplField(tpl.id, 'compositionNotes', '');
        const tplCopywriting = getTplField(tpl.id, 'copywriting', '');

        // Build extra prompt parts from template-specific fields
        const extraParts: string[] = [];
        if (tplSellingPoints) extraParts.push(`Key selling points: ${tplSellingPoints}`);
        if (tplDetailDesc) extraParts.push(`Detail description: ${tplDetailDesc}`);
        if (tplUsageScene) extraParts.push(`Usage scenario: ${tplUsageScene}`);
        if (tplMoodKeywords) extraParts.push(`Mood/atmosphere: ${tplMoodKeywords}`);
        if (tplPromotionInfo) extraParts.push(`Promotion info: ${tplPromotionInfo}`);
        if (tplTargetAudience) extraParts.push(`Target audience: ${tplTargetAudience}`);
        if (tplCompositionNotes) extraParts.push(`Composition notes: ${tplCompositionNotes}`);
        if (tplCopywriting) extraParts.push(`Copy for image: ${tplCopywriting}`);
        const extraPromptSuffix = extraParts.length > 0 ? '\n' + extraParts.join('. ') + '.' : '';

        const prompt = tpl.promptTemplate
          .replace(/\{SUBJECT\}/g, productDesc)
          .replace(/\{SUBJECT_ACTION\}/g, tplSubjectAction ? `\nSubject action: ${tplSubjectAction}` : '')
          .replace(/\{PRODUCT_OR_PROP\}/g, tplProductOrProp)
          .replace(/\{LOCATION\}/g, tplLocation || 'modern minimalist interior')
          .replace(/\{BACKGROUND_ELEMENTS\}/g, tplBackgroundElements ? `Background: ${tplBackgroundElements}` : '')
          .replace(/\{MAIN_TEXT\}/g, tplMainText)
          .replace(/\{SECONDARY_TEXT\}/g, tplSecondaryText)
          .replace(/\{ACCENT_SYMBOL\}/g, tplAccentSymbol)
          .replace(/\{ASPECT_RATIO\}/g, tpl.aspectRatio)
          .replace(/\{brand_color_prompt\}/g, brandColorPrompt)
          .replace(/\{style_extra\}/g, styleParts)
          .replace(/\{STYLE_FIDELITY_COMMERCIAL\}/g, fidelity === STYLE_FIDELITY_ANCHORS.commercial ? fidelity : '')
          .replace(/\{STYLE_FIDELITY_PRODUCT\}/g, fidelity === STYLE_FIDELITY_ANCHORS.product ? fidelity : '')
          .replace(/\{STYLE_FIDELITY_LIFESTYLE\}/g, fidelity === STYLE_FIDELITY_ANCHORS.lifestyle ? fidelity : '')
          .replace(/\n{3,}/g, '\n\n')
          .trim() + extraPromptSuffix;
        const negPrompt = tpl.negativePrompt;
        const dims = resolveDimensions(tpl.aspectRatio);
        return { template: tpl, prompt, negPrompt, dims };
      });

      // ★ variantCount: how many variants per template (default 2)
      const variantsPerTemplate = Math.max(1, Math.min(variantCount || 2, 4));
      const totalTasks = selectedTemplates.length * variantsPerTemplate;

      // ★ Product consistency configuration
      const consistencyMode: ProductConsistencyMode = productConsistencyMode || 'text-only';
      const consistencyStrength = typeof productConsistencyStrength === 'number'
        ? Math.max(0, Math.min(1, productConsistencyStrength))
        : consistencyMode === 'text-only' ? 0 : consistencyMode === 'img2img-fusion' ? 0.5 : 0.85;

      // 无副作用预检完成后，以同一数据库事务创建任务并扣费。
      sessionUser = await getSessionUser(request).catch(() => null);
      if (!sessionUser) return NextResponse.json({ success: false, error: '未登录，请先登录' }, { status: 401 });

      const candidateTaskId = `ecom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const idempotencyKey = request.headers.get('idempotency-key')?.trim()
        || request.headers.get('x-idempotency-key')?.trim()
        || candidateTaskId;
      const requestDigest = createHash('sha256').update(JSON.stringify({
        action: 'generate',
        tasks: tasks.map(task => ({
          templateId: task.template.id,
          prompt: task.prompt,
          negativePrompt: task.negPrompt,
          dimensions: task.dims,
        })),
        requestedModel: rawModelId || rawSelectedModel,
        mainText,
        secondaryText,
        subjectAction,
        backgroundElements,
        location,
        productOrProp,
        accentSymbol,
        templateFieldValues: tfv,
        providerId: provider.id, referenceImageUrl, productImageUrl, brandColors,
        variantsPerTemplate, consistencyMode, consistencyStrength,
      })).digest('hex');
      const billableIdentity = validateIdempotencyIdentity({
        userId: sessionUser.id,
        idempotencyKey,
        requestDigest,
      });
      const pricingModel = rawModelId || rawSelectedModel;
      const creditCost = await calculateConfiguredCreditCost('image_generate', pricingModel, {
        providerId: provider.id,
      });
      const label = `品牌电商生成 (${selectedTemplates.length}模板×${variantsPerTemplate}变体)`;
      const admission = await createBillableTask({
        ...billableIdentity,
        creditCost,
        task: {
          id: candidateTaskId,
          type: 'brand-ecommerce',
          status: 'processing',
          progress: 0,
          providerId: provider.id,
          model: selectedModel,
          label,
          result: {
            submissionPayload: {
              workerMode: 'local',
              taskKind: 'brand-ecommerce',
              totalTasks,
            },
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      const taskId = admission.task.id;
      durableTaskId = taskId;
      if (admission.reused) {
        return NextResponse.json({
          success: true,
          taskId,
          reused: true,
          status: admission.task.status,
          message: '已恢复同一生成请求',
        });
      }
      registerTask(taskId, 'brand-ecommerce', label, sessionUser.id, 'durable');
      updateTaskProgress(taskId, {
        creditCost: admission.task.creditCost || 0,
        result: admission.task.result,
      });

      // ★ Async mode: return taskId immediately, process in background
      // 使用 after() 确保响应返回后 IIFE 仍可运行
      after(async () => {
        try {
          const results: BrandGenerationResult[] = [];
          let completedCount = 0;

          // Pre-compute product mask for mask-composite mode (inside async so POST returns immediately)
          let productMaskResult: ProductMaskResult | null = null;
          let productBuffer: Buffer | null = null;
          if (productImageUrl && consistencyMode === 'mask-composite') {
            updateTaskProgress(taskId, { status: 'processing', progress: 0, label: '正在提取产品蒙版...' });
            const [maskResult, prodBuf] = await Promise.all([
              generateProductMask(productImageUrl),
              loadImageBuffer(productImageUrl),
            ]);
            productMaskResult = maskResult;
            productBuffer = prodBuf;
            if (!productMaskResult) {
              console.warn('[brand-ecommerce] Mask generation failed, falling back to img2img-fusion mode');
            }
          }

          for (let t = 0; t < selectedTemplates.length; t++) {
            for (let v = 0; v < variantsPerTemplate; v++) {
              if (isTaskCancelled(taskId)) {
                await settleFailedTask({
                  taskId,
                  status: 'cancelled',
                  error: { code: 'USER_CANCELLED', message: '用户已取消品牌电商生成任务' },
                  result: { partialResults: results },
                });
                return;
              }

              const tpl = selectedTemplates[t];
              const taskInfo = tasks[t];
              updateTaskProgress(taskId, {
                status: 'processing',
                progress: Math.round((completedCount / totalTasks) * 100),
                label: `生成中: ${tpl.name} 变体${v + 1} (${completedCount + 1}/${totalTasks})`,
              });

              try {
                const compatProfile = resolveCompatProfile(provider);
                const reqBody: Record<string, unknown> = {
                  model: selectedModel,
                  prompt: taskInfo.prompt,
                  negative_prompt: taskInfo.negPrompt,
                  n: 1,
                  size: `${taskInfo.dims.width}x${taskInfo.dims.height}`,
                };

                // ★ Product consistency mode handling
                const allImageUrls: string[] = [];

                // Reference image (style/layout reference) — always added in all modes
                if (referenceImageUrl) {
                  if (referenceImageUrl.startsWith('http')) {
                    reqBody.image = referenceImageUrl;
                    allImageUrls.push(referenceImageUrl);
                  } else {
                    reqBody.image = referenceImageUrl;
                    if (referenceImageUrl.startsWith('data:')) {
                      allImageUrls.push(referenceImageUrl);
                    }
                  }
                  reqBody.strength = 0.5;
                }

                // Product image — handled differently per consistency mode
                if (productImageUrl) {
                  if (consistencyMode === 'text-only') {
                    // Mode 1: Text-only — just add product image to image_urls + prompt instruction
                    if (productImageUrl.startsWith('http')) {
                      allImageUrls.push(productImageUrl);
                    } else if (productImageUrl.startsWith('data:')) {
                      allImageUrls.push(productImageUrl);
                    }
                    reqBody.prompt = `[PRODUCT CONSISTENCY: The product in the generated image must exactly match the product shown in the product reference image — same shape, color, texture, proportions, and details. Do not alter or reinterpret the product design.]\n${reqBody.prompt || taskInfo.prompt}`;

                  } else if (consistencyMode === 'img2img-fusion') {
                    // Mode 2: img2img fusion — use product image as img2img input with strength
                    if (productImageUrl.startsWith('http')) {
                      reqBody.image = productImageUrl;
                      allImageUrls.push(productImageUrl);
                    } else if (productImageUrl.startsWith('data:')) {
                      reqBody.image = productImageUrl;
                      allImageUrls.push(productImageUrl);
                    }
                    reqBody.strength = consistencyStrength;
                    // Also add text instruction for double reinforcement
                    reqBody.prompt = `[PRODUCT CONSISTENCY: Maintain the exact product from the input image — same shape, color, texture, proportions. Scene/style should change but product must remain identical.]\n${reqBody.prompt || taskInfo.prompt}`;

                  } else if (consistencyMode === 'mask-composite') {
                    // Mode 3: Mask composite — generate scene WITHOUT product image in API,
                    // then composite original product back using mask
                    // Scene prompt: describe the scene/background but not the product
                    reqBody.prompt = `[SCENE ONLY: Generate a product photography scene/background without the product itself. Leave the center area empty for product placement. The scene should have natural lighting and appropriate background for: ${productDesc}]\n${reqBody.prompt || taskInfo.prompt}`;
                    // Don't add productImageUrl to image_urls — we'll composite after
                  }
                }

                if (allImageUrls.length > 0) {
                  reqBody.image_urls = allImageUrls;
                }

                const { body: apiBody, endpoint: apiEndpoint } = adjustRequestForProfile(reqBody, compatProfile, { hasImage: allImageUrls.length > 0 });
                const path = apiEndpoint || '/images/generations';

                const headers: Record<string, string> = {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${provider.apiKey}`,
                };

                let resp = await fetchWithV1Retry(provider.baseUrl, path, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify(apiBody),
                }, true, 120000);

                if (!resp.ok && path === '/images/edits') {
                  const { body: fallbackBody, endpoint: fallbackEndpoint } = adjustRequestForProfile(reqBody, compatProfile, { hasImage: false });
                  const fallbackPath = fallbackEndpoint || '/images/generations';
                  resp = await fetchWithV1Retry(provider.baseUrl, fallbackPath, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(fallbackBody),
                  }, true, 120000);
                }

                if (!resp.ok) {
                  const errText = await resp.text().catch(() => '');
                  results.push({ ...resultIdentity, templateId: tpl.id, templateName: `${tpl.name} V${v + 1}`, error: `API错误: ${errText.slice(0, 200)}`, variantIndex: v, aspectRatio: tpl.aspectRatio });
                  completedCount++;
                  continue;
                }

                const respData = await resp.json();
                const parsed = parseResponseForProfile(respData, compatProfile);

                if (parsed.directImageUrls?.length) {
                  let resultImageUrl = parsed.directImageUrls[0];

                  // ★ Mask composite: overlay original product onto generated scene
                  if (consistencyMode === 'mask-composite' && productImageUrl && productMaskResult && productBuffer) {
                    try {
                      const sceneBuffer = await loadImageBuffer(resultImageUrl);
                      if (sceneBuffer) {
                        const composited = await compositeProductToScene(
                          sceneBuffer, productBuffer, productMaskResult.maskBuffer, consistencyStrength,
                        );
                        // Persist composited result
                        const base64Result = `data:image/png;base64,${composited.toString('base64')}`;
                        const persistedComposited = await persistResultImage(base64Result);
                        if (persistedComposited) resultImageUrl = persistedComposited;
                      }
                    } catch (compErr) {
                      console.warn('[brand-ecommerce] Mask composite failed, using original result:', compErr);
                    }
                  }

                  const persistedUrl = await persistResultImage(resultImageUrl);
                  results.push({ ...resultIdentity, templateId: tpl.id, templateName: `${tpl.name} V${v + 1}`, imageUrl: persistedUrl || resultImageUrl, variantIndex: v, aspectRatio: tpl.aspectRatio });
                } else if (parsed.taskIds?.length) {
                  const remoteTaskId = parsed.taskIds[0];
                  let pollAttempts = 0;
                  const maxPollAttempts = 80;
                  while (pollAttempts < maxPollAttempts) {
                    if (isTaskCancelled(taskId)) break;
                    await new Promise(r => setTimeout(r, 3000));
                    pollAttempts++;
                    try {
                      const pollUrl = buildPollUrl(provider.baseUrl, remoteTaskId, compatProfile);
                      if (!pollUrl) { results.push({ ...resultIdentity, templateId: tpl.id, templateName: `${tpl.name} V${v + 1}`, error: '无法构建轮询URL', variantIndex: v }); break; }
                      const pollResp = await fetch(pollUrl, {
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${provider.apiKey}` },
                        signal: AbortSignal.timeout(30000),
                      });
                      if (pollResp.ok) {
                        const pollData = await pollResp.json();
                        const imgUrl = extractImageUrl(pollData);
                        if (imgUrl) {
                          let resultImageUrl = imgUrl;

                          // ★ Mask composite for async results too
                          if (consistencyMode === 'mask-composite' && productImageUrl && productMaskResult && productBuffer) {
                            try {
                              const sceneBuffer = await loadImageBuffer(imgUrl);
                              if (sceneBuffer) {
                                const composited = await compositeProductToScene(
                                  sceneBuffer, productBuffer, productMaskResult.maskBuffer, consistencyStrength,
                                );
                                const base64Result = `data:image/png;base64,${composited.toString('base64')}`;
                                const persistedComposited = await persistResultImage(base64Result);
                                if (persistedComposited) resultImageUrl = persistedComposited;
                              }
                            } catch (compErr) {
                              console.warn('[brand-ecommerce] Mask composite failed for async result:', compErr);
                            }
                          }

                          const persistedUrl = await persistResultImage(resultImageUrl);
                          results.push({ ...resultIdentity, templateId: tpl.id, templateName: `${tpl.name} V${v + 1}`, imageUrl: persistedUrl || resultImageUrl, variantIndex: v, aspectRatio: tpl.aspectRatio });
                          break;
                        }
                        const status = pollData?.status || pollData?.data?.status;
                        if (status === 'failed' || status === 'error') {
                          results.push({ ...resultIdentity, templateId: tpl.id, templateName: `${tpl.name} V${v + 1}`, error: '异步任务失败', variantIndex: v });
                          break;
                        }
                      }
                    } catch {
                      // Continue polling
                    }
                  }
                  if (pollAttempts >= maxPollAttempts) {
                    results.push({ ...resultIdentity, templateId: tpl.id, templateName: `${tpl.name} V${v + 1}`, error: '生成超时', variantIndex: v });
                  }
                } else {
                  results.push({ ...resultIdentity, templateId: tpl.id, templateName: `${tpl.name} V${v + 1}`, error: 'API未返回图片', variantIndex: v });
                }
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : '未知错误';
                results.push({ ...resultIdentity, templateId: selectedTemplates[t].id, templateName: `${selectedTemplates[t].name} V${v + 1}`, error: msg, variantIndex: v });
              }

              completedCount++;

              // ★ Incremental: push partial results via task-registry after each variant
              updateTaskProgress(taskId, {
                progress: Math.round((completedCount / totalTasks) * 100),
                label: `已完成 ${completedCount}/${totalTasks}`,
                partialResults: [...results], // ★ Frontend can read partial results via poll-task
              });
              await updateCloudTask(taskId, {
                progress: Math.round((completedCount / totalTasks) * 100),
                label: `已完成 ${completedCount}/${totalTasks}`,
                result: { partialResults: [...results] },
                mergeResult: true,
                expectedStatuses: ['processing'],
              });
            }
          }

          const taskResult = { results };
          const successfulResults = results.filter(result => Boolean(result.imageUrl));
          if (successfulResults.length === 0) {
            const timedOut = results.length > 0 && results.every(result => /超时|timeout/i.test(result.error || ''));
            const message = results.find(result => result.error)?.error || '所有品牌电商生成变体均失败';
            await settleFailedTask({
              taskId,
              status: timedOut ? 'timeout' : 'failed',
              error: {
                code: timedOut ? 'MODEL_TIMEOUT' : 'ALL_VARIANTS_FAILED',
                message,
              },
              result: taskResult,
            });
            return;
          }
          const completedResult = {
            ...taskResult,
            imageUrl: successfulResults[0].imageUrl,
            imageUrls: successfulResults.map(result => result.imageUrl).filter((url): url is string => Boolean(url)),
            providerId: provider.id,
            providerName: provider.displayName || provider.name,
            usedModel: selectedModel,
            modelName: selectedModel,
          };
          const committed = await completeCloudTask(taskId, completedResult);
          if (!committed) {
            console.info('[brand-ecommerce] Late completion ignored', { taskId });
            return;
          }
          updateTaskProgress(taskId, {
            status: 'completed',
            progress: 100,
            result: completedResult,
          });
          setBrandResult(taskId, taskResult);
          console.log(`[brand-ecommerce] Background task completed taskId=${taskId}, results=${results.length}, success=${results.filter(r => r.imageUrl).length}`);
        } catch (procErr) {
          const errMsg = procErr instanceof Error ? procErr.message : String(procErr);
          console.error(`[brand-ecommerce] Background task FAILED taskId=${taskId}:`, errMsg);
          try {
            await settleFailedTask({
              taskId,
              status: 'failed',
              error: { code: 'BACKGROUND_EXECUTION_FAILED', message: errMsg },
            });
          } catch (settlementError) {
            console.error('[brand-ecommerce] Durable settlement failed:', settlementError);
          }
        }
      });
      // Return taskId immediately for frontend polling
      return NextResponse.json({
        success: true,
        taskId,
        message: `已提交 ${selectedTemplates.length} 个模板 × ${variantsPerTemplate} 变体 = ${totalTasks} 张生成任务`,
      });
    }

    if (action === 'models') {
      // Return available image models from admin config with provider info
      const models = await getPublicModels('image');
      const { getPublicApiProviders } = await import('@/lib/server-api-config');
      const providers = await getPublicApiProviders();
      const imageProviders = providers.filter(p => p.isEnabled && p.baseUrl && (p.modelType === 'image' || p.modelType === 'universal' || p.modelType === 'general'));
      return NextResponse.json({ success: true, models, providers: imageProviders });
    }

    if (action === 'llm-models') {
      // Return available LLM models for assist design
      const models = await getPublicModels('chat');
      const { getPublicApiProviders } = await import('@/lib/server-api-config');
      const providers = await getPublicApiProviders();
      const chatProviders = providers.filter(p => p.isEnabled && p.baseUrl && (p.modelType === 'chat' || p.modelType === 'universal' || p.modelType === 'general'));
      return NextResponse.json({ success: true, models, providers: chatProviders });
    }

    if (action === 'assist') {
      // LLM-assisted design: generate optimized prompts and style suggestions
      const { productDesc, style, sceneDesc, templateId, assistType, llmModel, llmProviderId } = body;
      const effectiveStyle = style || sceneDesc || '';
      if (!productDesc) return NextResponse.json({ error: '请提供商品描述' }, { status: 400 });
      if (!llmModel) return NextResponse.json({ error: '请选择LLM模型' }, { status: 400 });

      // 优先使用前端传递的 llmProviderId 精确匹配
      let provider: ApiProvider | null = null;
      if (llmProviderId) {
        provider = await findProviderById(llmProviderId);
        if (!provider) {
          return NextResponse.json({ error: '所选LLM提供商不存在或已停用' }, { status: 400 });
        }
        const authorizedModels = new Set([
          ...(provider.selectedModels || []),
          ...(provider.selectedModel ? [provider.selectedModel] : []),
        ]);
        if (!authorizedModels.has(llmModel)) {
          return NextResponse.json({ error: '所选LLM模型未获得该提供商授权' }, { status: 400 });
        }
        console.log(`[brand-ecommerce] assist: 通过 llmProviderId="${llmProviderId}" 匹配到LLM提供商 "${provider.name}"`);
      } else {
        provider = await findProviderForModel(llmModel);
      }
      if (!provider) return NextResponse.json({ error: '未找到该模型的API提供商配置' }, { status: 400 });

      // ★ Dynamic template for assist (resolve suffixed IDs like detail-vertical-2)
      const baseTemplateId = (() => {
        if (!templateId) return templateId || '';
        const m = templateId.match(/^(.+)-(\d+)$/);
        if (m && ECOM_TEMPLATES.some(t => t.id === m[1])) return m[1];
        return templateId;
      })();
      let template: EcomTemplate | undefined;
      try {
        const { dbGetEcomTemplate } = await import('@/lib/db-storage');
        const dbTpl = await dbGetEcomTemplate(baseTemplateId);
        if (dbTpl) {
          template = {
            id: dbTpl.id, name: dbTpl.name, icon: dbTpl.icon,
            description: dbTpl.description, promptTemplate: dbTpl.prompt_template,
            negativePrompt: dbTpl.negative_prompt, aspectRatio: dbTpl.aspect_ratio,
            category: dbTpl.category, fidelityAnchor: dbTpl.fidelity_anchor,
          };
        }
      } catch { /* ignore */ }
      if (!template) {
        template = ECOM_TEMPLATES.find((t: EcomTemplate) => t.id === baseTemplateId);
      }
      const templateInfo = template ? `模板名称: ${template.name}, 模板描述: ${template.description}` : '未指定模板';

      const assistPrompts: Record<string, string> = {
        'optimize-prompt': `你是一位专业的电商视觉设计师和AI提示词工程师。请根据以下商品信息，优化生成电商配图的提示词。

商品描述: ${productDesc}
${effectiveStyle ? `风格修饰: ${effectiveStyle}` : ''}
目标模板: ${templateInfo}

请输出优化后的提示词，要求：
1. 用运营语言描述，不是技术参数
2. 明确描述商品外观、材质、颜色、使用场景
3. 指定文字内容和位置（如有品牌名/文案）
4. 指定品牌色值（如有）
5. 符合中国电商平台审美和审核规范

请直接输出优化后的中文提示词，不要解释。`,

        'suggest-style': `你是一位电商品牌视觉顾问。请根据以下商品信息，推荐最适合的电商配图风格。

商品描述: ${productDesc}

请推荐3种不同风格方案，每种方案包含：
1. 风格名称（如"高端简约"、"国潮风"、"日系清新"等）
2. 风格描述（2-3句话）
3. 推荐色彩搭配（主色+辅色+强调色，给出HEX值）
4. 适合的电商平台和场景

请以JSON数组格式输出，例如：
[{"name":"风格名","description":"描述","colors":{"primary":"#HEX","secondary":"#HEX","accent":"#HEX"},"platform":"适合平台"}]`,

        'suggest-text': `你是一位电商文案策划师。请根据以下商品信息，为电商配图推荐文字内容。

商品描述: ${productDesc}

请推荐3组文字方案，每组包含：
1. 主标题（4-8字，大字醒目）
2. 副标题/卖点（8-15字，补充说明）
3. 行动号召（2-4字，如"立即抢购""限时特惠"）

请以JSON数组格式输出，例如：
[{"mainTitle":"主标题","subtitle":"副标题","cta":"行动号召"}]`,
      };

      const prompt = assistPrompts[assistType] || assistPrompts['optimize-prompt'];

      // Call LLM API
      const chatBody: Record<string, unknown> = {
        model: llmModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2000,
      };

      const chatResp = await fetchWithV1Retry(provider.baseUrl, '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(chatBody),
      }, true, 30000);

      if (!chatResp.ok) {
        const errText = await chatResp.text().catch(() => '');
        return NextResponse.json({ error: `LLM API 错误 (${chatResp.status}): ${errText.slice(0, 200)}` }, { status: 500 });
      }

      const content = await parseAssistResponse(chatResp);

      return NextResponse.json({ success: true, content, assistType });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : '服务器错误';
    console.error('[brand-ecommerce] Error:', err);
    logError(OP_ACTIONS.BRAND_ECOMMERCE, err, {
      userId: sessionUser?.id || 'unknown',
      userName: sessionUser?.name || 'unknown',
      model: selectedModel,
      providerId: providerIdUsed,
      durationMs,
      detail: `品牌电商图片生成失败: ${msg.substring(0, 100)}`,
    });
    if (durableTaskId) {
      try {
        await settleFailedTask({
          taskId: durableTaskId,
          status: 'failed',
          error: { code: 'REQUEST_SETUP_FAILED', message: msg },
        });
      } catch (settlementError) { console.error('[brand-ecommerce] Durable settlement failed:', settlementError); }
    }
    if (isIdempotencyValidationError(err)) {
      return NextResponse.json({ success: false, code: 'INVALID_IDEMPOTENCY_KEY', error: err.message }, { status: 400 });
    }
    if (err instanceof InsufficientCreditsError || err instanceof IdempotencyConflictError) {
      return NextResponse.json({ success: false, code: err.code, error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: msg, ...(durableTaskId ? { taskId: durableTaskId } : {}) }, { status: 500 });
  }
}
