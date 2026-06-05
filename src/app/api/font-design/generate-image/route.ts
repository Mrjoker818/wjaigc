import { NextRequest, NextResponse, after } from 'next/server';
import { findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';
import { buildJimengPrompt, buildBlackOnWhitePrompt, buildTransparentLogoPrompt, FONT_STYLE_CATEGORIES, SCENE_MAP, STROKE_MAP, GRAPHIC_MAP, MATERIAL_MAP } from '../plan/route';

export const maxDuration = 600;
export const dynamic = 'force-dynamic';

/**
 * Resolve a style name (e.g. "竹节笔意") to its visual description prompt from FONT_STYLE_CATEGORIES.
 * Also resolves category IDs (e.g. "oriental") to their category name.
 */
function resolveStyleVisualDesc(styleName: string): string {
  if (!styleName || styleName === '智能推荐') return '';
  // Search through all categories and subStyles
  for (const cat of FONT_STYLE_CATEGORIES) {
    // Match category ID
    if (cat.id === styleName) return cat.name;
    // Match subStyle name
    for (const sub of cat.subStyles) {
      if (sub.name === styleName) return sub.prompt;
      if (sub.id === styleName) return sub.prompt;
    }
  }
  return styleName;
}

/**
 * Build a user-settings enforcement suffix that forces key visual parameters
 * into the prompt even when a prompt override is provided.
 */
function buildUserSettingsSuffix(params: {
  style: string; scene: string; color: string; background: string;
  material: string; strokeOptions: string[]; graphicElements: string[];
}): string {
  const parts: string[] = [];

  // Style: expand from name to visual description
  const styleVisual = resolveStyleVisualDesc(params.style);
  if (styleVisual && params.style !== '智能推荐') {
    parts.push(`【必须严格遵循的字体风格】${params.style}：${styleVisual}，所有文字的笔画、结构和造型必须体现这一风格的核心视觉特征`);
  }

  // Scene
  const sceneDesc = SCENE_MAP[params.scene] || '';
  if (sceneDesc) {
    parts.push(`【使用场景】${params.scene}：${sceneDesc}`);
  }

  // Stroke options
  if (params.strokeOptions.length > 0) {
    const strokeDesc = params.strokeOptions.map(s => STROKE_MAP[s] || s).join('、');
    parts.push(`【笔画处理】${strokeDesc}`);
  }

  // Graphic elements
  if (params.graphicElements.length > 0) {
    const graphicDesc = params.graphicElements.map(g => GRAPHIC_MAP[g] || g).join('、');
    parts.push(`【图形融合】${graphicDesc}，图形元素必须自然融入笔画`);
  }

  // Color & Material
  if (params.color && params.color !== '白色') {
    const matDesc = MATERIAL_MAP[params.material] || params.material;
    parts.push(`【色彩材质】字体颜色${params.color}，质感${matDesc}`);
  } else if (params.material && params.material !== '平面矢量') {
    const matDesc = MATERIAL_MAP[params.material] || params.material;
    parts.push(`【质感】${matDesc}`);
  }

  // Background
  if (params.background && params.background !== '高级留白' && params.background !== '纯色背景') {
    parts.push(`【背景】${params.background}`);
  }

  return parts.length > 0 ? '\n\n' + parts.join('\n') : '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      prompt, model, ratio = '16:9', count = 1,
      text, scene, primaryStyleCategory, secondaryStyle,
      color, background, strokeOptions, graphicElements, material,
      jimengEnhanced = true, mode = 'full', providerId,
    } = body as Record<string, unknown>;

    const textStr = String(text || '');
    const sceneStr = String(scene || 'KV主标题');
    const styleStr = String(secondaryStyle || primaryStyleCategory || '智能推荐');
    const modeStr = String(mode || 'full');
    const colorStr = String(color || '白色');
    const bgStr = String(background || '高级留白');
    const matStr = String(material || '平面矢量');
    const ratioStr = String(ratio || '横版16:9');
    const modelStr = model ? String(model) : '';
    const numCount = Math.min(Number(count) || 1, 4);
    const isJimeng = jimengEnhanced !== false;
    const strokes: string[] = Array.isArray(strokeOptions) ? strokeOptions.map(String) : [];
    const graphics: string[] = Array.isArray(graphicElements) ? graphicElements.map(String) : [];

    // Build user-settings suffix for enforcement
    const userSettingsSuffix = buildUserSettingsSuffix({
      style: styleStr, scene: sceneStr, color: colorStr, background: bgStr,
      material: matStr, strokeOptions: strokes, graphicElements: graphics,
    });

    let finalPrompt = '';
    if (prompt) {
      // When prompt is provided as override, still enforce user settings
      finalPrompt = String(prompt) + userSettingsSuffix;
    } else if (textStr) {
      if (modeStr === 'black-on-white') {
        finalPrompt = buildBlackOnWhitePrompt(textStr) + userSettingsSuffix;
      } else if (modeStr === 'transparent-logo') {
        finalPrompt = buildTransparentLogoPrompt(textStr) + userSettingsSuffix;
      } else {
        finalPrompt = buildJimengPrompt({
          text: textStr, scene: sceneStr, style: styleStr,
          strokeOptions: strokes, graphicElements: graphics,
          color: colorStr, background: bgStr, material: matStr,
          ratio: ratioStr, jimengEnhanced: isJimeng,
        });
      }
    }

    if (!finalPrompt) {
      return NextResponse.json({ error: '缺少提示词或文字输入' }, { status: 400 });
    }

    // 优先使用 providerId 精确匹配，避免多提供商同名模型路由错误
    let provider = null;
    if (providerId) {
      provider = await findProviderById(providerId as string);
      if (provider) {
        console.log(`[font-design/generate-image] 使用 providerId 精确匹配: ${provider.name} (${providerId})`);
      } else {
        console.warn(`[font-design/generate-image] providerId="${providerId}" 未找到匹配提供商，回退到 findProviderForModel`);
      }
    }
    if (!provider) {
      provider = modelStr ? await findProviderForModel(modelStr) : null;
    }
    if (!provider) {
      // Fallback: find any provider with image models
      const { getApiProviders } = await import('@/lib/server-api-config');
      const providers = await getApiProviders();
      provider = providers.filter(p => p.isEnabled).find(p => {
        const mt = p.modelType || '';
        return mt === 'image' || mt === 'universal' || mt === 'general';
      }) || null;
    }
    if (!provider) {
      return NextResponse.json({ error: '未找到可用的图像生成模型，请在管理员后台配置' }, { status: 400 });
    }

    const usedModel = modelStr || (provider.selectedModels?.[0] || '');
    const baseUrl = provider.baseUrl || '';
    const apiKey = provider.apiKey || '';
    const compatProfile = resolveCompatProfile(provider);

    const taskId = `font-design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'font-design', `字体设计: ${textStr || '生成图片'}`);
    updateTaskProgress(taskId, { status: 'processing', progress: 0, label: '正在生成字体设计图片...' });

    // 使用 after() 确保响应返回后 IIFE 仍可运行
    after(async () => {
      try {
        const requestBody: Record<string, unknown> = {
          model: usedModel,
          prompt: finalPrompt,
          n: numCount,
          size: ratioStr,
        };

        const adjustedRequest = adjustRequestForProfile(requestBody, compatProfile);
        const endpoint = adjustedRequest.endpoint || '/images/generations';

        const response = await fetchWithV1Retry(baseUrl, endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(adjustedRequest.body || requestBody),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          updateTaskProgress(taskId, { status: 'failed', error: `API错误 ${response.status}: ${errText.slice(0, 200)}` });
          return;
        }

        const data = await response.json();
        const parsed = parseResponseForProfile(data, compatProfile);

        if (parsed.directImageUrls && parsed.directImageUrls.length > 0) {
          updateTaskProgress(taskId, {
            status: 'completed', progress: 100,
            result: { directImageUrls: parsed.directImageUrls, prompt: finalPrompt, model: usedModel },
          });
        } else if (parsed.taskIds && parsed.taskIds.length > 0) {
          updateTaskProgress(taskId, {
            status: 'processing', progress: 30,
            label: '图片生成中，等待远程API返回...',
            result: {
              remoteTaskId: parsed.taskIds[0],
              apiBaseUrl: baseUrl, apiKey, usedModel, compatProfile, prompt: finalPrompt,
            },
          });
        } else {
          updateTaskProgress(taskId, { status: 'failed', error: 'API未返回有效结果' });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '生成失败';
        if (!isTaskCancelled(taskId)) {
          updateTaskProgress(taskId, { status: 'failed', error: msg });
        }
      }
    });

    return NextResponse.json({ taskId, prompt: finalPrompt, model: usedModel });
  } catch (error: unknown) {
    console.error('[font-design/generate-image] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成图片失败' }, { status: 500 });
  }
}
