/**
 * 视频生成 API - 提交视频生成任务
 * POST /api/video/generate
 * 
 * 支持: 文生视频、图生视频（首帧/首尾帧/多参考图）
 * 异步提交 + 轮询模式，复用 task-registry
 */

import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import {
  buildVideoSubmitRequest,
  parseVideoSubmitResponse,
  resolveVideoCompatProfile,
  getVideoModelInfo,
  ratioToSize,
  type VideoGenerateParams,
  type VideoCompatProfile,
} from '@/lib/video-api';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits } from '@/lib/credits';

export const maxDuration = 300; // 5 min timeout

export async function POST(request: NextRequest) {
  try {
    // 积分扣除（按模型差异化扣分）
    const body = await request.json();
    const {
      prompt,
      model,
      imageUrl,
      lastFrameImageUrl,
      referenceImages,
      aspectRatio = '16:9',
      duration = 5,
      mode = 'std',
      generateAudio = false,
      negativePrompt,
      seed,
      providerId,
      // === 新增高级参数 ===
      cameraControl,
      motionBrush,
      characterReferences,
      motionStrength,
    } = body;

    if (!prompt || !model) {
      return NextResponse.json(
        { error: '缺少必要参数: prompt 和 model 是必填的' },
        { status: 400 },
      );
    }

    // 积分扣除（登录用户才扣积分，按模型差异化扣分）
    const sessionUser = await getSessionUser(request);
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'video_generate', undefined, undefined, model, { durationSeconds: Number(duration) });
      if (!creditResult.success) {
        return NextResponse.json({ error: creditResult.message || '积分不足' }, { status: 402 });
      }
    }

    // 1. 查找视频 API 提供商
    let provider;
    if (providerId) {
      provider = await findProviderById(providerId);
    }
    if (!provider) {
      provider = await findProviderForModel(model, 'video');
    }
    if (!provider) {
      provider = await findProviderForFeature('video');
    }
    if (!provider) {
      // Fallback: 尝试 image 类型提供商（某些提供商同时支持图片和视频）
      provider = await findProviderForFeature('imageEdit');
    }
    if (!provider) {
      return NextResponse.json(
        { error: '未找到可用的视频 API 提供商，请先在管理员后台添加视频模型 API' },
        { status: 404 },
      );
    }

    const apiKey = provider.apiKey;
    const baseUrl = provider.baseUrl;
    let advancedParams = provider.advancedParams 
      ? (typeof provider.advancedParams === 'string' ? JSON.parse(provider.advancedParams) : provider.advancedParams) 
      : {};
    
    // 关键：将 requestStyle 转化为 advancedParams 中的端点指示
    // 管理员后台标记了 requestStyle=images-generations 表示该提供商应使用 images 端点
    if (provider.requestStyle === 'images-generations') {
      advancedParams = { ...advancedParams, videoEndpoint: 'images' };
    }

    // 2. 推断视频协议
    const profile = resolveVideoCompatProfile(
      model,
      advancedParams?.compatProfile,
      baseUrl,
    );
    console.log(`[video/generate] model=${model}, providerId=${provider.id}, baseUrl=${baseUrl}, profile=${profile}, compatProfile=${advancedParams?.compatProfile || '(none)'}`);

    // 3. 获取模型特征信息
    const modelInfo = getVideoModelInfo(model);

    // 3.5 解析图片 URL（转换为第三方 API 可访问的格式）
    const rawDomain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
    const domainBase = rawDomain.replace(/\/+$/, '');

    const resolveImageUrl = async (imgUrl: string | undefined | null): Promise<string | undefined> => {
      if (!imgUrl || typeof imgUrl !== 'string' || !imgUrl.trim()) return undefined;

      // 1. 相对路径 → 公网 URL 或 base64
      if (imgUrl.startsWith('/')) {
        if (domainBase) {
          const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
          return `${base}${imgUrl}`;
        }
        // 无公网域名时，fetch 转为 base64
        try {
          const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
          const port = process.env.DEPLOY_RUN_PORT || 5000;
          const resp = await fetch(`${proto}://localhost:${port}${imgUrl}`, { signal: AbortSignal.timeout(10000) });
          const buf = Buffer.from(await resp.arrayBuffer());
          return `data:image/png;base64,${buf.toString('base64')}`;
        } catch {
          return undefined;
        }
      }

      // 2. data: URL — 直接传递（视频 API 通常不支持，但保留原值）
      if (imgUrl.startsWith('data:')) {
        // 视频 API 大多不支持 base64，尝试先 save-image 再转公网 URL
        if (domainBase) {
          try {
            const saveResp = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/save-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageData: imgUrl }),
            });
            if (saveResp.ok) {
              const saveData = await saveResp.json();
              if (saveData.url) {
                const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
                return `${base}${saveData.url}`;
              }
            }
          } catch { /* save-image failed */ }
        }
        return imgUrl; // 兜底：直接传 base64
      }

      // 3. 外部 URL 直接传递
      if (imgUrl.startsWith('http')) return imgUrl;

      // 4. 兜底 — 补全为公网 URL
      if (domainBase) {
        const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
        const path = imgUrl.startsWith('/') ? imgUrl : `/${imgUrl}`;
        return `${base}${path}`;
      }

      return imgUrl;
    };

    const [resolvedImageUrl, resolvedLastFrameUrl, ...resolvedRefs] = await Promise.all([
      resolveImageUrl(imageUrl),
      resolveImageUrl(lastFrameImageUrl),
      ...(referenceImages || []).map((img: string) => resolveImageUrl(img)),
    ]);

    // 4. 构建请求参数
    const videoParams: VideoGenerateParams = {
      prompt,
      model,
      imageUrl: resolvedImageUrl,
      lastFrameImageUrl: resolvedLastFrameUrl,
      referenceImages: resolvedRefs.filter(Boolean) as string[],
      aspectRatio,
      duration,
      mode,
      generateAudio,
      negativePrompt,
      seed,
      apiKey,
      baseUrl,
      advancedParams,
      // === 新增高级参数 ===
      cameraControl,
      motionBrush,
      characterReferences,
      motionStrength,
    };

    // 5. 注册任务
    const taskId = `video_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const modeLabel = imageUrl ? '图生视频' : '文生视频';
    const modelName = modelInfo?.name || model;
    registerTask(taskId, 'video', `${modeLabel} · ${modelName}`);

    // 6. 异步提交到第三方 API
    // 使用 IIFE 异步执行，不阻塞响应
    (async () => {
      try {
        updateTaskProgress(taskId, { progress: 5, label: `${modeLabel} · ${modelName} · 提交中...` });

        const req = buildVideoSubmitRequest(profile, videoParams);
        console.log(`[video/generate] Submit request: url=${req.url}, method=${req.method}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s 提交超时

        let response = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          signal: controller.signal,
        });

        let usedImagesEndpoint = req.url.includes('/v1/images/');
        
        // Auto-fallback: try /v1/images/generations when /v1/video/generations fails
        // Many third-party API proxies only expose video models via the images endpoint
        if (!response.ok && profile === 'rest-generic' && !req.url.includes('/v1/images/')) {
          const errorBody = await response.text().catch(() => '');
          const isModelNotFound = errorBody.includes('model_not_found') || errorBody.includes('Model not found');
          const isEndpointNotFound = response.status === 404;
          
          if (isEndpointNotFound || isModelNotFound || response.status === 503) {
            // Rebuild request body in OpenAI images/generations format
            const fallbackUrl = req.url.replace('/v1/video/generations', '/v1/images/generations');
            const fallbackBody: Record<string, any> = {
              model,
              prompt,
              n: 1,
              response_format: 'url',
              ...(resolvedImageUrl ? { image: resolvedImageUrl } : {}),
              ...(aspectRatio ? { size: ratioToSize(aspectRatio) } : {}),
            };
            console.log(`[video/generate] Fallback from video to images endpoint: ${fallbackUrl}, reason: status=${response.status}, modelNotFound=${isModelNotFound}`);
            updateTaskProgress(taskId, { progress: 8, label: `${modeLabel} · ${modelName} · 重试备用端点...` });
            response = await fetch(fallbackUrl, {
              method: req.method,
              headers: req.headers,
              body: JSON.stringify(fallbackBody),
              signal: controller.signal,
            });
            usedImagesEndpoint = true;
          }
        }

        clearTimeout(timeout);

        console.log(`[video/generate] Submit response: status=${response.status}, ok=${response.ok}`);

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error(`[video/generate] Submit failed (${response.status}): ${errorText.slice(0, 500)}`);
          let errorMessage = `API 请求失败 (${response.status})`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.message || errorJson.error?.message || errorJson.msg || errorMessage;
          } catch { /* ignore */ }
          updateTaskProgress(taskId, { status: 'failed', error: errorMessage, progress: 0 });
          return;
        }

        const data = await response.json();
        const submitResult = parseVideoSubmitResponse(profile, data);
        console.log(`[video/generate] Parse submit result: taskId=${submitResult.taskId}, status=${submitResult.status}, videoUrl=${submitResult.videoUrl ? '(has url)' : '(none)'}, raw keys=${Object.keys(data).join(',')}`);
        console.log(`[video/generate] Raw submit response (first 500 chars): ${JSON.stringify(data).slice(0, 500)}`);

        if (!submitResult.taskId) {
          updateTaskProgress(taskId, {
            status: 'failed',
            error: '提交视频生成任务失败：未获取到任务ID',
            progress: 0,
          });
          return;
        }

        // 同步返回：API直接返回了视频URL，无需轮询
        if (submitResult.status === 'succeeded' && submitResult.videoUrl) {
          updateTaskProgress(taskId, {
            status: 'completed',
            progress: 100,
            label: `${modeLabel} · ${modelName} · 已完成`,
            result: {
              videoUrl: submitResult.videoUrl,
              model,
              modelName,
              providerId: provider.id,
              type: 'video',
            },
          });
          return;
        }

        // 存储轮询所需信息到任务结果中
        // 注意：记录提交端点类型，以便轮询时选择正确的端点
        updateTaskProgress(taskId, {
          progress: 10,
          label: `${modeLabel} · ${modelName} · 排队中...`,
          result: {
            thirdPartyTaskId: submitResult.taskId,
            profile,
            baseUrl,
            apiKey,
            advancedParams,
            model,
            providerId: provider.id,
            usedImagesEndpoint,
          },
        });
      } catch (err: any) {
        const errorMsg = err.name === 'AbortError' ? '提交超时，请稍后重试' : (err.message || '提交视频生成任务失败');
        updateTaskProgress(taskId, { status: 'failed', error: errorMsg, progress: 0 });
      }
    })();

    // 7. 立即返回任务ID
    return NextResponse.json({
      taskId,
      status: 'queued',
      message: '视频生成任务已提交',
      modelInfo: modelInfo ? {
        name: modelInfo.name,
        features: modelInfo.features,
      } : null,
    });
  } catch (err: any) {
    console.error('[video/generate] Error:', err);
    return NextResponse.json(
      { error: err.message || '视频生成请求失败' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/video/generate - 获取支持的视频模型列表信息
 */
export async function GET() {
  try {
    return NextResponse.json({
      defaultRatios: ['1:1', '4:3', '16:9', '9:16', '21:9'],
      defaultDurations: [5, 10],
      defaultModes: [
        { value: 'text2video', label: '文生视频' },
        { value: 'image2video', label: '图生视频（首帧）' },
        { value: 'image2video_both', label: '图生视频（首尾帧）' },
      ],
    });
  } catch {
    return NextResponse.json({ error: 'Failed to get video model info' }, { status: 500 });
  }
}
