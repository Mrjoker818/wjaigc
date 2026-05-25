import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getPublicModels } from '@/lib/server-api-config';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, buildPollUrl, extractImageUrl } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';

export const dynamic = 'force-dynamic';

// ─── Global Result Cache (survives module re-instantiation in dev mode) ────
function getBrandResultStore(): Map<string, Record<string, unknown>> {
  const g = globalThis as Record<string, unknown>;
  if (!g.__wujie_brand_results) g.__wujie_brand_results = new Map<string, Record<string, unknown>>();
  return g.__wujie_brand_results as Map<string, Record<string, unknown>>;
}
function setBrandResult(taskId: string, result: Record<string, unknown>) {
  getBrandResultStore().set(taskId, { ...result, _cachedAt: Date.now() });
}
export function getBrandResult(taskId: string): Record<string, unknown> | undefined {
  const store = getBrandResultStore();
  const r = store.get(taskId);
  // Expire after 30 minutes
  if (r && Date.now() - ((r as Record<string, unknown>)._cachedAt as number) > 30 * 60 * 1000) {
    store.delete(taskId);
    return undefined;
  }
  return r;
}

// ─── Persist result image to local server ────
async function persistResultImage(imageUrl: string): Promise<string> {
  try {
    if (imageUrl.startsWith('/api/serve-upload/') || imageUrl.startsWith('/uploads/')) return imageUrl;
    if (imageUrl.startsWith('data:')) {
      const resp = await fetch('http://localhost:5000/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        const resp = await fetch('http://localhost:5000/api/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
    const p = await findProviderForModel(model);
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'templates') {
      return NextResponse.json({ success: true, templates: ECOM_TEMPLATES });
    }

    if (action === 'generate') {
      const { templateIds, productDesc, styleExtra, model, referenceImageUrl, brandColors } = body;
      if (!templateIds?.length) {
        return NextResponse.json({ error: '请至少选择一个模板' }, { status: 400 });
      }
      if (!productDesc?.trim()) {
        return NextResponse.json({ error: '请输入商品描述' }, { status: 400 });
      }

      const provider = await getImageProvider(model);
      if (!provider) {
        return NextResponse.json({ error: '未找到可用的图像模型，请在管理员后台配置' }, { status: 400 });
      }

      const selectedModel = model || provider.selectedModels?.[0];
      if (!selectedModel) {
        return NextResponse.json({ error: '未指定模型' }, { status: 400 });
      }

      const selectedTemplates = ECOM_TEMPLATES.filter(t => templateIds.includes(t.id));
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

      const tasks = selectedTemplates.map(tpl => {
        const fidelity = tpl.fidelityAnchor ? fidelityMap[tpl.fidelityAnchor] || '' : '';
        const prompt = tpl.promptTemplate
          .replace(/\{SUBJECT\}/g, productDesc)
          .replace(/\{SUBJECT_ACTION\}/g, subjectAction ? `\nSubject action: ${subjectAction}` : '')
          .replace(/\{PRODUCT_OR_PROP\}/g, productOrProp)
          .replace(/\{LOCATION\}/g, location || 'modern minimalist interior')
          .replace(/\{BACKGROUND_ELEMENTS\}/g, backgroundElements ? `Background: ${backgroundElements}` : '')
          .replace(/\{MAIN_TEXT\}/g, mainText)
          .replace(/\{SECONDARY_TEXT\}/g, secondaryText)
          .replace(/\{ACCENT_SYMBOL\}/g, accentSymbol)
          .replace(/\{ASPECT_RATIO\}/g, tpl.aspectRatio)
          .replace(/\{brand_color_prompt\}/g, brandColorPrompt)
          .replace(/\{style_extra\}/g, styleParts)
          .replace(/\{STYLE_FIDELITY_COMMERCIAL\}/g, fidelity === STYLE_FIDELITY_ANCHORS.commercial ? fidelity : '')
          .replace(/\{STYLE_FIDELITY_PRODUCT\}/g, fidelity === STYLE_FIDELITY_ANCHORS.product ? fidelity : '')
          .replace(/\{STYLE_FIDELITY_LIFESTYLE\}/g, fidelity === STYLE_FIDELITY_ANCHORS.lifestyle ? fidelity : '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        const negPrompt = tpl.negativePrompt;
        const dims = resolveDimensions(tpl.aspectRatio);
        return { template: tpl, prompt, negPrompt, dims };
      });

      // Register a task for tracking
      const taskId = `ecom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      registerTask(taskId, 'brand-ecommerce', `品牌电商生成 (${tasks.length}张)`);

      // ★ Synchronous mode: process all tasks and return results directly
      // This avoids cross-module task-registry issues in Next.js dev mode
      try {
        const results: Array<{ templateId: string; templateName: string; imageUrl?: string; error?: string }> = [];

        for (let i = 0; i < tasks.length; i++) {
          if (isTaskCancelled(taskId)) {
            updateTaskProgress(taskId, { status: 'cancelled', progress: i / tasks.length });
            break;
          }

          const { template: tpl, prompt, negPrompt, dims } = tasks[i];
          updateTaskProgress(taskId, {
            status: 'processing',
            progress: (i / tasks.length) * 100,
            label: `生成中: ${tpl.name} (${i + 1}/${tasks.length})`,
          });

          try {
            const compatProfile = resolveCompatProfile(provider);
            const reqBody: Record<string, unknown> = {
              model: selectedModel,
              prompt,
              negative_prompt: negPrompt,
              n: 1,
              size: `${dims.width}x${dims.height}`,
            };

            // Add reference image if provided (img2img)
            // Resolve image URL: data URLs need to be uploaded first
            let accessibleImageUrl = referenceImageUrl;
            if (referenceImageUrl && referenceImageUrl.startsWith('data:')) {
              try {
                const saveResp = await fetch(new URL('/api/save-image', request.url).href, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageUrl: referenceImageUrl }),
                });
                if (saveResp.ok) {
                  const saveData = await saveResp.json();
                  if (saveData.url) accessibleImageUrl = saveData.url;
                }
              } catch { /* fallback to original */ }
            }

            if (accessibleImageUrl) {
              reqBody.image = accessibleImageUrl;
              reqBody.image_urls = [accessibleImageUrl];
              reqBody.strength = 0.5;
            }

            const { body: apiBody, endpoint: apiEndpoint } = adjustRequestForProfile(reqBody, compatProfile, { hasImage: !!accessibleImageUrl });
            let path = apiEndpoint || '/images/generations';

            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`,
            };

            let resp = await fetchWithV1Retry(provider.baseUrl, path, {
              method: 'POST',
              headers,
              body: JSON.stringify(apiBody),
            }, true, 120000);

            // Fallback: /images/edits → /images/generations
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
              results.push({ templateId: tpl.id, templateName: tpl.name, error: `API错误: ${errText.slice(0, 200)}` });
              continue;
            }

            const respData = await resp.json();
            const parsed = parseResponseForProfile(respData, compatProfile);

            if (parsed.directImageUrls?.length) {
              const persistedUrl = await persistResultImage(parsed.directImageUrls[0]);
              results.push({ templateId: tpl.id, templateName: tpl.name, imageUrl: persistedUrl || parsed.directImageUrls[0] });
            } else if (parsed.taskIds?.length) {
              // Poll for async result — use same robust parsing as /api/poll-task
              const remoteTaskId = parsed.taskIds[0];
              let pollAttempts = 0;
              const maxPollAttempts = 80;
              while (pollAttempts < maxPollAttempts) {
                if (isTaskCancelled(taskId)) break;
                await new Promise(r => setTimeout(r, 3000));
                pollAttempts++;
                try {
                  const pollUrl = buildPollUrl(provider.baseUrl, remoteTaskId, compatProfile);
                  if (!pollUrl) { results.push({ templateId: tpl.id, templateName: tpl.name, error: '无法构建轮询URL' }); break; }
                  // ★ buildPollUrl returns a FULL URL — use fetch() directly, NOT fetchWithV1Retry
                  const pollResp = await fetch(pollUrl, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${provider.apiKey}` },
                    signal: AbortSignal.timeout(30000),
                  });
                  if (pollResp.ok) {
                    const pollData = await pollResp.json();
                    // ★ Robust 5-path image URL extraction (same as poll-task route)
                    const imgUrl = extractImageUrl(pollData);
                    if (imgUrl) {
                      const persistedUrl = await persistResultImage(imgUrl);
                      results.push({ templateId: tpl.id, templateName: tpl.name, imageUrl: persistedUrl || imgUrl });
                      break;
                    }
                    const status = pollData?.status || pollData?.data?.status;
                    if (status === 'failed' || status === 'error') {
                      results.push({ templateId: tpl.id, templateName: tpl.name, error: '异步任务失败' });
                      break;
                    }
                  }
                } catch {
                  // Continue polling
                }
              }
              if (pollAttempts >= maxPollAttempts) {
                results.push({ templateId: tpl.id, templateName: tpl.name, error: '生成超时' });
              }
            } else {
              results.push({ templateId: tpl.id, templateName: tpl.name, error: 'API未返回图片' });
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : '未知错误';
            results.push({ templateId: tpl.id, templateName: tpl.name, error: msg });
          }
        }

        const taskResult = { results };
        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: taskResult,
        });
        setBrandResult(taskId, taskResult);
        console.log(`[brand-ecommerce] Sync completed taskId=${taskId}, results=${results.length}`);

        // ★ Return results directly (sync mode)
        return NextResponse.json({
          success: true,
          taskId,
          results: taskResult.results,
        });
      } catch (procErr) {
        const errMsg = procErr instanceof Error ? procErr.message : String(procErr);
        console.error(`[brand-ecommerce] processBrand FAILED taskId=${taskId}:`, errMsg);
        return NextResponse.json({
          success: false,
          taskId,
          error: errMsg,
        });
      }
    }

    if (action === 'models') {
      // Return available image models from admin config with provider info
      const models = await getPublicModels('image');
      const { getPublicApiProviders } = await import('@/lib/server-api-config');
      const providers = await getPublicApiProviders();
      const imageProviders = providers.filter(p => p.isEnabled && (p.modelType === 'image' || p.modelType === 'universal' || p.modelType === 'general'));
      return NextResponse.json({ success: true, models, providers: imageProviders });
    }

    if (action === 'llm-models') {
      // Return available LLM models for assist design
      const models = await getPublicModels('chat');
      const { getPublicApiProviders } = await import('@/lib/server-api-config');
      const providers = await getPublicApiProviders();
      const chatProviders = providers.filter(p => p.isEnabled && (p.modelType === 'chat' || p.modelType === 'universal' || p.modelType === 'general'));
      return NextResponse.json({ success: true, models, providers: chatProviders });
    }

    if (action === 'assist') {
      // LLM-assisted design: generate optimized prompts and style suggestions
      const { productDesc, style, templateId, assistType, llmModel } = body;
      if (!productDesc) return NextResponse.json({ error: '请提供商品描述' }, { status: 400 });
      if (!llmModel) return NextResponse.json({ error: '请选择LLM模型' }, { status: 400 });

      const provider = await findProviderForModel(llmModel);
      if (!provider) return NextResponse.json({ error: '未找到该模型的API提供商配置' }, { status: 400 });

      const template = ECOM_TEMPLATES.find((t: EcomTemplate) => t.id === templateId);
      const templateInfo = template ? `模板名称: ${template.name}, 模板描述: ${template.description}` : '未指定模板';

      const assistPrompts: Record<string, string> = {
        'optimize-prompt': `你是一位专业的电商视觉设计师和AI提示词工程师。请根据以下商品信息，优化生成电商配图的提示词。

商品描述: ${productDesc}
${style ? `风格修饰: ${style}` : ''}
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

      const profile = resolveCompatProfile(provider as Parameters<typeof resolveCompatProfile>[0]);
      const adjusted = adjustRequestForProfile(chatBody, profile, { hasImage: false });
      const finalBody = adjusted.body;

      const chatResp = await fetchWithV1Retry(provider.baseUrl, adjusted.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(finalBody),
      }, true, 30000);

      if (!chatResp.ok) {
        const errText = await chatResp.text().catch(() => '');
        return NextResponse.json({ error: `LLM API 错误 (${chatResp.status}): ${errText.slice(0, 200)}` }, { status: 500 });
      }

      const chatData = await chatResp.json();
      const content = chatData?.choices?.[0]?.message?.content
        || chatData?.output?.text
        || chatData?.candidates?.[0]?.content?.parts?.[0]?.text
        || chatData?.result
        || '';

      return NextResponse.json({ success: true, content, assistType });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '服务器错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
