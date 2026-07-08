/**
 * 视频延长 API - 提交视频延长任务
 * POST /api/video/extend
 * 
 * 支持: 可灵V3、Seedance 2.0/2.3、Vidu Q1/Q2、Runway Gen-3/4、Sora 等支持延长的模型
 * 异步提交 + 轮询模式，复用 task-registry
 */

import { logOperation, logError, OP_ACTIONS, startTimer } from '@/lib/op-log';
import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { validateApiInputs } from '@/lib/api-validator';
import {
  buildVideoExtendRequest,
  parseVideoSubmitResponse,
  resolveVideoCompatProfile,
  getVideoModelInfo,
  type VideoGenerateParams,
} from '@/lib/video-api';
import { buildDirectorPrompt } from '@/lib/video-director';

export const maxDuration = 300; // 5 min timeout

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let deductedCredits = 0;
  let sessionUser: any = null;
  let model = '';
  let providerId = '';
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        videoUrl: 'videoUrl',
        prompt: 'optionalPrompt'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const {
      videoUrl,
      prompt,
      model,
      extendDuration = 5,
      generateAudio = false,
      providerId,
    } = body;

    if (!videoUrl || !model) {
      return NextResponse.json(
        { error: '缺少必要参数: videoUrl 和 model 是必填的' },
        { status: 400 },
      );
    }

    // ★ 从 model 中提取纯 modelId（前端可能传 providerId::modelId 格式）
    let pureModel = model;
    const extractedProviderId = model.includes('::') ? model.split('::')[0] : '';
    if (model.includes('::')) {
      pureModel = model.split('::').pop()!;
      console.log(`[video/extend] Stripped provider prefix from model: "${model}" → "${pureModel}"`);
    }

    // 1. 查找视频 API 提供商
    let provider;
    const effectiveProviderId = extractedProviderId || providerId;
    if (effectiveProviderId) {
      provider = await findProviderById(effectiveProviderId);
    }
    if (!provider) {
      provider = await findProviderForModel(pureModel, 'video', effectiveProviderId);
    }
    if (!provider) {
      provider = await findProviderForFeature('video');
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
    if (provider.requestStyle === 'images-generations') {
      advancedParams = { ...advancedParams, videoEndpoint: 'images' };
    }

    // 2. 推断视频协议
    const profile = resolveVideoCompatProfile(
      pureModel,
      advancedParams?.compatProfile,
      baseUrl,
    );

    // 3. 获取模型特征信息
    const modelInfo = getVideoModelInfo(pureModel);

    // 检查模型是否支持延长
    if (modelInfo && !modelInfo.features.videoExtend) {
      return NextResponse.json(
        { error: `模型 ${modelInfo.name} 不支持视频延长功能` },
        { status: 400 },
      );
    }

    // 3.5 解析视频 URL（转换为第三方 API 可访问的格式）
    const rawDomain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
    const domainBase = rawDomain.replace(/\/+$/, '');

    let resolvedVideoUrl = videoUrl;
    if (videoUrl.startsWith('/')) {
      if (domainBase) {
        const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
        resolvedVideoUrl = `${base}${videoUrl}`;
      } else {
        try {
          const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
          const port = process.env.DEPLOY_RUN_PORT || 5000;
          const resp = await fetch(`${proto}://localhost:${port}${videoUrl}`, { signal: AbortSignal.timeout(10000) });
          const buf = Buffer.from(await resp.arrayBuffer());
          resolvedVideoUrl = `data:video/mp4;base64,${buf.toString('base64')}`;
        } catch { /* fallback to original */ }
      }
    }

    // 4. 构建请求参数（接入导演级提示词：本地增强，不依赖额外 LLM 调用）
    const rawPrompt = prompt || '请延续视频内容和画面，保持角色和场景一致';
    let finalPrompt = rawPrompt;
    try {
      const directorMsg = buildDirectorPrompt({
        userPrompt: rawPrompt,
        mode: 'extend',
        modelId: pureModel || '',
        model: pureModel || '',
        duration: extendDuration,
        audio: generateAudio,
        style: 'cinematic',
        includeNegative: true,
        verbosity: 'standard',
      });
      // 本地增强：在 prompt 前拼"保持尾帧一致"指导
      finalPrompt = `【续写指导】从上一片段尾帧自然延续，保持角色外观、场景、光线、运动方向一致；避免突然跳切。\n${rawPrompt}`;
      console.log(`[video/extend] Director user-message length=${directorMsg.user.length}`);
    } catch (e) {
      console.warn('[video/extend] Director compile failed, using raw prompt:', e);
    }

    const videoParams: VideoGenerateParams = {
      prompt: finalPrompt,
      model: pureModel,
      videoUrl: resolvedVideoUrl,
      action: 'extend',
      extendDuration,
      generateAudio,
      apiKey,
      baseUrl,
      advancedParams,
    };

    // 4.5 积分检查与扣除
    sessionUser = await getSessionUser(request);
    deductedCredits = 0;
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'video_extend', undefined, undefined, model, { durationSeconds: Number(extendDuration) });
      if (!creditResult.success) {
        return NextResponse.json({ error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    // 5. 注册任务
    const taskId = `video_extend_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const modelName = modelInfo?.name || pureModel;
    registerTask(taskId, 'video', `视频延长 · ${modelName}`, sessionUser?.id);

    // 6. 异步提交到第三方 API
    (async () => {
      try {
        updateTaskProgress(taskId, { progress: 5, label: `视频延长 · ${modelName} · 提交中...` });

        const req = buildVideoExtendRequest(profile, videoParams);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        let response = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          signal: controller.signal,
        });

        let usedImagesEndpoint = req.url.includes('/v1/images/');

        // Auto-fallback: try /v1/images/generations when /v1/video/generations fails
        if (!response.ok && profile === 'rest-generic' && !req.url.includes('/v1/images/')) {
          const errorBody = await response.text().catch(() => '');
          const isModelNotFound = errorBody.includes('model_not_found') || errorBody.includes('Model not found');
          const isEndpointNotFound = response.status === 404;
          
          if (isEndpointNotFound || isModelNotFound || response.status === 503) {
            const fallbackUrl = req.url.replace('/v1/video/generations', '/v1/images/generations');
            console.log(`[video/extend] Fallback to images endpoint: ${fallbackUrl}`);
            response = await fetch(fallbackUrl, {
              method: req.method,
              headers: req.headers,
              body: req.body,
              signal: controller.signal,
            });
            usedImagesEndpoint = true;
          }
        }

        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
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

        // 同步完成场景：第三方API直接返回了视频URL
        if (submitResult.status === 'succeeded' && submitResult.videoUrl) {
          let finalVideoUrl = submitResult.videoUrl;
          let finalImageUrl = (submitResult as unknown as Record<string, unknown>).imageUrl as string || (submitResult as unknown as Record<string, unknown>).coverUrl as string || '';
          
          // 持久化视频URL
          try {
            const persistRes = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/save-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: finalVideoUrl, format: 'mp4' }),
              signal: AbortSignal.timeout(30000),
            });
            if (persistRes.ok) {
              const persistData = await persistRes.json();
              if (persistData.url) finalVideoUrl = persistData.url;
            }
          } catch { /* fallback to original */ }

          // 持久化封面图
          if (finalImageUrl) {
            try {
              const persistRes = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/save-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: finalImageUrl }),
                signal: AbortSignal.timeout(30000),
              });
              if (persistRes.ok) {
                const persistData = await persistRes.json();
                if (persistData.url) finalImageUrl = persistData.url;
              }
            } catch { /* fallback to original */ }
          }

          updateTaskProgress(taskId, {
            status: 'completed',
            progress: 100,
            result: {
              videoUrl: finalVideoUrl,
              imageUrl: finalImageUrl,
              videoDuration: (submitResult as unknown as Record<string, unknown>).videoDuration as number || extendDuration,
            },
          });
          return;
        }

        if (!submitResult.taskId) {
          updateTaskProgress(taskId, {
            status: 'failed',
            error: '提交视频延长任务失败：未获取到任务ID',
            progress: 0,
          });
          return;
        }

        // 存储轮询所需信息到任务结果中
        updateTaskProgress(taskId, {
          progress: 10,
          label: `视频延长 · ${modelName} · 排队中...`,
          result: {
            thirdPartyTaskId: submitResult.taskId,
            profile,
            baseUrl,
            apiKey,
            model,
            providerId: provider.id,
            advancedParams: provider.advancedParams || undefined,
            usedImagesEndpoint,
          },
        });
      } catch (err: any) {
        const errorMsg = err.name === 'AbortError' ? '提交超时，请稍后重试' : (err.message || '提交视频延长任务失败');
        updateTaskProgress(taskId, { status: 'failed', error: errorMsg, progress: 0 });
      }
    })();

    // 7. 立即返回任务ID（成功）
    logOperation({
      userId: sessionUser?.id || 'anonymous',
      userName: sessionUser?.name || '匿名用户',
      action: OP_ACTIONS.VIDEO_EXTEND,
      level: 'info',
      detail: `视频延长任务已提交: ${taskId}`,
      model,
      providerId,
      durationMs: Date.now() - startTime,
    });
    return NextResponse.json({
      taskId,
      status: 'queued',
      message: '视频延长任务已提交',
      modelInfo: modelInfo ? {
        name: modelInfo.name,
        features: modelInfo.features,
      } : null,
    });
  } catch (err: any) {
    console.error('[video/extend] Error:', err);
    // 操作日志记录错误
    logError(OP_ACTIONS.VIDEO_EXTEND, err, {
      userId: sessionUser?.id || 'anonymous',
      userName: sessionUser?.name || '匿名用户',
      model,
      providerId,
      durationMs: Date.now() - startTime,
    });
    // 退款：视频延长失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `视频延长失败退款: ${(err.message || '').substring(0, 100)}`);
      } catch (refundErr) { console.error('[video/extend] Refund failed:', refundErr); }
    }
    return NextResponse.json(
      { error: err.message || '视频延长请求失败' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    description: '视频延长 API',
    method: 'POST',
    params: {
      videoUrl: 'string (必填) - 原始视频URL',
      prompt: 'string (可选) - 延续内容描述',
      model: 'string (必填) - 视频模型名称',
      extendDuration: 'number (可选, 默认5) - 延长时长(秒)',
      generateAudio: 'boolean (可选, 默认false) - 是否生成音效',
      providerId: 'string (可选) - 指定API提供商ID',
    },
    supportedModels: '支持延长功能的视频模型（如可灵V3、Seedance 2.0+等）',
  });
}
