import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { buildDisplay3DRenderPrompt } from '@/lib/display3d-prompts';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { calculateActualPixelsFromRatio } from '@/app/api/generate/route';
import { normalizeModelForApi } from '@/lib/model-capabilities';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      brandName = '',
      productName = '',
      sceneType = 'pop_up_store',
      environment = 'mall_atrium',
      dimensions = { length: 9000, width: 6000, height: 4500, unit: 'mm' },
      imageUsageMode = 'texture_mapping',
      materialStyle = '',
      lightingStyle = '',
      brandColor = '',
      focusProduct = '',
      crowdStyle = '',
      budget,
      viewOptions = ['angle_45', 'front'],
      renderStyle = '',
      outputResolution,
      outputFormat,
      outputQuality,
      assets = [],
      model,
      providerId,
      prompt: clientPrompt,
      quality,
      aspectRatio,
    } = body;
    const renderMode = renderStyle || (body as Record<string, unknown>).renderMode as string || '';

    if (!brandName) {
      return NextResponse.json({ error: '请提供品牌名称' }, { status: 400 });
    }

    // Build the prompt (use client-built prompt if provided, otherwise build server-side)
    const prompt = clientPrompt || buildDisplay3DRenderPrompt({
      brandName,
      productName,
      brandColor,
      focusProduct,
      sceneType,
      environment,
      dimensions,
      imageUsageMode,
      materialStyle,
      lightingStyle,
      crowdStyle,
      budget,
      viewOptions,
      renderStyle: renderMode, // renderMode is derived from renderStyle field
      outputResolution,
      outputFormat,
      outputQuality,
    });

    // Find an image model provider (prefer providerId for exact match)
    const provider = providerId
      ? await findProviderById(providerId)
      : await findProviderForModel(model || '', 'image');
    if (!provider) {
      return NextResponse.json({ error: '未找到可用的图像模型，请在管理员后台配置' }, { status: 400 });
    }

    const profile = resolveCompatProfile(provider);
    const rawSelectedModel = provider.selectedModels?.[0] || model || 'gpt-image-2';
    const { apiModelName: selectedModel } = normalizeModelForApi(rawSelectedModel);
    if (selectedModel !== rawSelectedModel) {
      console.log(`[display-3d] Model normalized: ${rawSelectedModel} → ${selectedModel}`);
    }

    // Build request body
    const effectiveQuality = quality || '1K';
    const effectiveAspectRatio = aspectRatio || '1:1';
    const dynamicSize = calculateActualPixelsFromRatio(effectiveAspectRatio, effectiveQuality, selectedModel) || '1024x1024';
    const rawBody: Record<string, unknown> = {
      model: selectedModel,
      prompt,
      n: 1,
      size: dynamicSize,
      quality: effectiveQuality,
    };

    // Add reference images
    if (Array.isArray(assets) && assets.length > 0) {
      const imageUrls = assets.filter((a: { url?: string }) => a.url).map((a: { url: string }) => a.url);
      if (imageUrls.length > 0) {
        rawBody.image = imageUrls[0];
        rawBody.image_urls = imageUrls;
      }
    }

    const { body: adjustedBody } = adjustRequestForProfile(rawBody, profile);

    // Register task
    const sessionUser = await getSessionUser(request).catch(() => null);
    const taskId = `d3d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'display3d', `3D展陈: ${brandName}`, sessionUser?.id);

    // Start async generation
    (async () => {
      try {
        updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '正在生成展陈方案...' });

        // Parse baseUrl and path for fetchWithV1Retry
        let apiBase = provider.baseUrl.replace(/\/+$/, '');
        const apiPath = '/images/generations';
        if (apiBase.endsWith('/v1')) {
          apiBase = apiBase.slice(0, -3);
        }

        const response = await fetchWithV1Retry(apiBase, apiPath, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify(adjustedBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          updateTaskProgress(taskId, { status: 'failed', error: `API错误: ${response.status} ${errorText}` });
          return;
        }

        const apiResponse = await response.json();
        const parsed = parseResponseForProfile(apiResponse, profile);

        if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
          updateTaskProgress(taskId, {
            status: 'completed',
            progress: 100,
            result: {
              imageUrls: parsed.directImageUrls,
              prompt,
              type: 'display3d',
            },
          });
        } else if (parsed.mode === 'polling' && parsed.taskIds.length > 0) {
          // Poll for async results
          const pollTaskId = parsed.taskIds[0];
          let pollCount = 0;
          const maxPolls = 60;
          const pollInterval = setInterval(async () => {
            pollCount++;
            if (pollCount > maxPolls) {
              clearInterval(pollInterval);
              updateTaskProgress(taskId, { status: 'failed', error: '生成超时' });
              return;
            }
            try {
              const pollRes = await fetchWithV1Retry(apiBase, `/tasks/${pollTaskId}`, {
                headers: { 'Authorization': `Bearer ${provider.apiKey}` },
              });
              if (!pollRes.ok) return;
              const pollData = await pollRes.json();
              const pollParsed = parseResponseForProfile(pollData, profile);
              if (pollParsed.mode === 'direct' && pollParsed.directImageUrls.length > 0) {
                clearInterval(pollInterval);
                updateTaskProgress(taskId, {
                  status: 'completed',
                  progress: 100,
                  result: {
                    imageUrls: pollParsed.directImageUrls,
                    prompt,
                    type: 'display3d',
                  },
                });
              }
            } catch {
              // continue polling
            }
          }, 5000);
        } else {
          updateTaskProgress(taskId, { status: 'failed', error: '无法解析API响应' });
        }
      } catch (err) {
        updateTaskProgress(taskId, {
          status: 'failed',
          error: err instanceof Error ? err.message : '生成失败',
        });
      }
    })();

    return NextResponse.json({ success: true, taskId, status: 'running' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '服务器错误' },
      { status: 500 }
    );
  }
}
