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
    description: '淘宝/京东/拼多多标准主图，纯白背景+阴影优化',
    promptTemplate: '电商主图：{product}，纯白背景(RGB 255,255,255)，专业影棚灯光，居中构图，高清细节，产品阴影自然柔和，符合平台审核规范，适合手机端展示，{brand_color_prompt}{style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, signature, screenshot, compression artifacts, cluttered background, gray edge, shadow on background, text, logo',
    aspectRatio: '1:1',
    category: 'product',
  },
  {
    id: 'detail-page',
    name: '详情页组合图',
    icon: '📋',
    description: '商品详情页三图组合：场景图+细节图+卖点图',
    promptTemplate: '电商详情页：{product}，分为三个层次展示——场景层展示使用场景{scene}，细节层展示材质纹理和工艺细节，卖点层突出核心卖点，专业排版，{brand_color_prompt}{style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, text overflow, messy layout, unprofessional',
    aspectRatio: '3:4',
    category: 'detail',
  },
  {
    id: 'xiaohongshu',
    name: '小红书封面',
    icon: '📕',
    description: '小红书竖版笔记封面，强化标题文字渲染',
    promptTemplate: '小红书爆款封面：{product}，竖版构图，预留顶部20%空白区供APP叠加logo，{brand_color_prompt}强化标题文字渲染，精美排版，种草风格，吸引点击，{style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, ugly, boring, dated, horizontal layout',
    aspectRatio: '3:4',
    category: 'social',
  },
  {
    id: 'douyin',
    name: '抖音橱窗图',
    icon: '🎵',
    description: '抖音横版商品橱窗封面，动态构图引导视线',
    promptTemplate: '抖音商品橱窗封面：{product}，横版构图，动态构图引导视线，重点区域自动提亮，右下角预留行动号召按钮位置，{brand_color_prompt}适合短视频封面展示，{style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, vertical layout, boring, static',
    aspectRatio: '16:9',
    category: 'social',
  },
  {
    id: 'scene-lifestyle',
    name: '场景氛围图',
    icon: '🏞️',
    description: '商品融入生活场景，增强购买欲和代入感',
    promptTemplate: '场景氛围图：{product}，置于{scene}场景中，自然光线，温馨氛围，景深效果，杂志级品质，光影方向与产品高光位置匹配，自然融合不假合成感，{brand_color_prompt}{style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, ugly, unrealistic, cartoon, fake composite, harsh edge',
    aspectRatio: '4:3',
    category: 'scene',
  },
  {
    id: 'model-wear',
    name: '模特展示图',
    icon: '👗',
    description: '模特穿搭/使用展示，突出上身效果',
    promptTemplate: '模特展示图：模特展示{product}，全身/半身照，专业影棚灯光，自然姿态，干净背景，时尚杂志风格，高细节，{brand_color_prompt}{style_extra}',
    negativePrompt: 'low quality, blurry, distorted face, deformed hands, extra limbs, watermark, ugly, unnatural pose, fused fingers, long neck',
    aspectRatio: '3:4',
    category: 'model',
  },
  {
    id: 'detail-closeup',
    name: '细节特写',
    icon: '🔍',
    description: '展示材质纹理和工艺细节，放大产品质感',
    promptTemplate: '细节特写：{product}的细节特写，展示材质纹理和工艺细节，微距摄影，极浅景深，专业影棚灯光，高清锐利，{brand_color_prompt}{style_extra}',
    negativePrompt: 'low quality, blurry, out of focus, distorted, deformed, watermark, noise, grain',
    aspectRatio: '1:1',
    category: 'product',
  },
  {
    id: 'brand-poster',
    name: '品牌海报',
    icon: '🎨',
    description: '品牌视觉延展海报，保持品牌色一致性',
    promptTemplate: '品牌海报：{product}，品牌视觉延展设计，保持品牌色一致性{brand_color_prompt}，专业广告级构图，高级质感，渐变背景，商业摄影风格，{style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, text overflow, messy layout, inconsistent colors',
    aspectRatio: '3:4',
    category: 'promo',
  },
  {
    id: 'creative-composite',
    name: '创意合成图',
    icon: '✨',
    description: '创意视觉合成，打造差异化产品形象',
    promptTemplate: '创意合成：{product}，创意视觉合成，超现实场景，梦幻光影，艺术化呈现，独特视觉语言，差异化产品形象，{brand_color_prompt}{style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, boring, ordinary, plain',
    aspectRatio: '1:1',
    category: 'creative',
  },
  {
    id: 'packaging',
    name: '包装展示图',
    icon: '📦',
    description: '产品包装盒/袋展示，突出品牌视觉',
    promptTemplate: '包装展示：{product}的精美包装展示，包装盒/袋正面朝向镜头，品牌标识清晰可见，{brand_color_prompt}高级质感包装材料，柔和打光，{style_extra}',
    negativePrompt: 'low quality, blurry, distorted, deformed, watermark, damaged packaging, wrinkled',
    aspectRatio: '3:4',
    category: 'product',
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
        ? `主色调${brandColors[0]}${brandColors[1] ? '，辅色' + brandColors[1] : ''}${brandColors[2] ? '，强调色' + brandColors[2] : ''}，严格保持品牌色一致性`
        : '';
      const styleParts = [styleExtra].filter(Boolean).join(', ');

      const tasks = selectedTemplates.map(tpl => {
        const prompt = tpl.promptTemplate
          .replace('{product}', productDesc)
          .replace('{scene}', body.sceneDesc || '现代简约室内场景')
          .replace('{brand_color_prompt}', brandColorPrompt)
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
      // Return available image models from admin config with provider info
      const models = await getPublicModels('image');
      const { getPublicApiProviders } = await import('@/lib/server-api-config');
      const providers = await getPublicApiProviders();
      const imageProviders = providers.filter(p => p.isEnabled && (p.modelType === 'image' || p.modelType === 'universal' || p.modelType === 'general'));
      return NextResponse.json({ success: true, models, providers: imageProviders });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '服务器错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
