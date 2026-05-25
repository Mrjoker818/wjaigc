import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';
import { buildJimengPrompt, buildBlackOnWhitePrompt, buildTransparentLogoPrompt } from '../plan/route';

export const maxDuration = 600;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      prompt, model, ratio = '16:9', count = 1,
      text, scene, primaryStyleCategory, secondaryStyle,
      color, background, strokeOptions, graphicElements, material,
      jimengEnhanced = true, mode = 'full',
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

    let finalPrompt = prompt ? String(prompt) : '';
    if (!finalPrompt && textStr) {
      if (modeStr === 'black-on-white') {
        finalPrompt = buildBlackOnWhitePrompt(textStr);
      } else if (modeStr === 'transparent-logo') {
        finalPrompt = buildTransparentLogoPrompt(textStr);
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

    let provider = modelStr ? await findProviderForModel(modelStr) : null;
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

    (async () => {
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
    })();

    return NextResponse.json({ taskId, prompt: finalPrompt, model: usedModel });
  } catch (error: unknown) {
    console.error('[font-design/generate-image] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成图片失败' }, { status: 500 });
  }
}
