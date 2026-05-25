import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getPublicModels } from '@/lib/server-api-config';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';

export const dynamic = 'force-dynamic';

// ─── E-commerce JSON Template Definitions ─────────────────────────

interface EcomTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  promptTemplate: string;
  negativePrompt: string;
  aspectRatio: string;
  category: string;
}

const ECOM_TEMPLATES: EcomTemplate[] = [
  {
    id: 'white-bg',
    name: '白底主图',
    icon: '⬜',
    description: '纯白背景商品展示，电商标准主图',
    promptTemplate: 'Product photography of {product}, placed on pure white background, studio lighting, centered composition, professional product shot, clean and minimal, high resolution, e-commerce style, {style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, text, signature, screenshot, compression artifacts, cluttered background, shadow on background',
    aspectRatio: '1:1',
    category: 'product',
  },
  {
    id: 'scene-lifestyle',
    name: '场景氛围图',
    icon: '🏞️',
    description: '商品融入生活场景，增强购买欲',
    promptTemplate: 'Lifestyle product photography of {product}, placed in {scene}, natural lighting, warm and inviting atmosphere, depth of field, professional interior design, magazine quality, {style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, ugly, unrealistic, cartoon, illustration',
    aspectRatio: '4:3',
    category: 'scene',
  },
  {
    id: 'model-wear',
    name: '模特试穿图',
    icon: '👗',
    description: '模特穿搭展示，突出上身效果',
    promptTemplate: 'Fashion model wearing {product}, full body shot, professional studio lighting, neutral pose, clean background, fashion editorial style, high detail, {style_extra}',
    negativePrompt: 'low quality, blurry, distorted face, deformed hands, extra limbs, watermark, ugly, unnatural pose',
    aspectRatio: '3:4',
    category: 'model',
  },
  {
    id: 'feature-poster',
    name: '卖点海报',
    icon: '📢',
    description: '突出核心卖点，促销活动必备',
    promptTemplate: 'Promotional product poster of {product}, dramatic lighting, vibrant colors, eye-catching composition, commercial advertising style, premium feel, gradient background, {style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, text overflow, messy layout',
    aspectRatio: '3:4',
    category: 'promo',
  },
  {
    id: 'detail-closeup',
    name: '细节特写',
    icon: '🔍',
    description: '展示材质纹理和工艺细节',
    promptTemplate: 'Macro close-up photography of {product}, extreme detail showing texture and craftsmanship, professional studio lighting, shallow depth of field, product detail shot, {style_extra}',
    negativePrompt: 'low quality, blurry, out of focus, distorted, deformed, watermark, noise, grain',
    aspectRatio: '1:1',
    category: 'product',
  },
  {
    id: 'a-plus',
    name: 'A+详情图',
    icon: '📋',
    description: '亚马逊A+页面宽幅展示图',
    promptTemplate: 'Wide banner product showcase of {product}, professional product arrangement, clean layout, e-commerce A+ content style, premium presentation, lifestyle elements, {style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, cluttered, messy, unprofessional',
    aspectRatio: '16:9',
    category: 'detail',
  },
  {
    id: 'social-media',
    name: '社交媒体图',
    icon: '📱',
    description: '适合Instagram/小红书等社交平台',
    promptTemplate: 'Social media product photo of {product}, trendy aesthetic, flat lay or styled shot, pastel or vibrant color palette, Instagram-worthy composition, Gen Z style, {style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, boring, dated, uncool',
    aspectRatio: '4:5',
    category: 'social',
  },
  {
    id: 'tech-minimal',
    name: '科技极简图',
    icon: '💎',
    description: '3C数码产品专用，深色高级质感',
    promptTemplate: 'Premium tech product photography of {product}, dark background with subtle gradient, dramatic rim lighting, floating or angled composition, futuristic feel, CES showcase style, {style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, cheap, toy-like, unprofessional lighting',
    aspectRatio: '1:1',
    category: 'tech',
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

      // Build prompts for each template
      const colorHint = brandColors?.length
        ? `color palette: ${brandColors.join(', ')}`
        : '';
      const styleParts = [styleExtra, colorHint].filter(Boolean).join(', ');

      const tasks = selectedTemplates.map(tpl => {
        const prompt = tpl.promptTemplate
          .replace('{product}', productDesc)
          .replace('{scene}', body.sceneDesc || 'modern minimalist interior')
          .replace('{style_extra}', styleParts);
        const negPrompt = tpl.negativePrompt;
        const dims = resolveDimensions(tpl.aspectRatio);
        return { template: tpl, prompt, negPrompt, dims };
      });

      // Register a task for tracking
      const taskId = `ecom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      registerTask(taskId, 'brand-ecommerce', `品牌电商生成 (${tasks.length}张)`);

      // Start async generation
      (async () => {
        const results: Array<{ templateId: string; templateName: string; imageUrl?: string; error?: string }> = [];

        for (let i = 0; i < tasks.length; i++) {
          if (isTaskCancelled(taskId)) {
            updateTaskProgress(taskId, { status: 'cancelled', progress: i / tasks.length });
            return;
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
            if (referenceImageUrl) {
              reqBody.image_url = referenceImageUrl;
              reqBody.strength = 0.5;
            }

            const { body: apiBody, endpoint: apiEndpoint } = adjustRequestForProfile(reqBody, compatProfile, { hasImage: !!referenceImageUrl });
            const path = apiEndpoint || '/images/generations';

            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`,
            };

            const resp = await fetchWithV1Retry(provider.baseUrl, path, {
              method: 'POST',
              headers,
              body: JSON.stringify(apiBody),
            }, true, 120000);

            if (!resp.ok) {
              const errText = await resp.text().catch(() => '');
              results.push({ templateId: tpl.id, templateName: tpl.name, error: `API错误: ${errText.slice(0, 200)}` });
              continue;
            }

            const respData = await resp.json();
            const parsed = parseResponseForProfile(respData, compatProfile);

            if (parsed.directImageUrls?.length) {
              results.push({ templateId: tpl.id, templateName: tpl.name, imageUrl: parsed.directImageUrls[0] });
            } else if (parsed.taskIds?.length) {
              // Poll for async result
              const pollTaskId = parsed.taskIds[0];
              let pollAttempts = 0;
              const maxPollAttempts = 60;
              while (pollAttempts < maxPollAttempts) {
                if (isTaskCancelled(taskId)) break;
                await new Promise(r => setTimeout(r, 3000));
                pollAttempts++;
                try {
                  const pollResp = await fetchWithV1Retry(provider.baseUrl, `/tasks/${pollTaskId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${provider.apiKey}` },
                  }, true, 15000);
                  if (pollResp.ok) {
                    const pollData = await pollResp.json();
                    // Try to extract image URL from various response formats
                    const imgUrl = pollData?.data?.image_url
                      || pollData?.data?.images?.[0]?.url
                      || pollData?.output?.image_url
                      || pollData?.image_url
                      || pollData?.data?.url;
                    if (imgUrl) {
                      results.push({ templateId: tpl.id, templateName: tpl.name, imageUrl: imgUrl });
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

        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: { results },
        });
      })();

      return NextResponse.json({ success: true, taskId });
    }

    if (action === 'models') {
      // Return available image models from admin config
      const models = await getPublicModels('image');
      return NextResponse.json({ success: true, models });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '服务器错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
