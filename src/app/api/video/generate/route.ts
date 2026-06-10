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
  type VideoGenerateParams,
  type VideoCompatProfile,
} from '@/lib/video-api';
import { fetchWithV1Retry } from '@/lib/api-helpers';

export const maxDuration = 300; // 5 min timeout

export async function POST(request: NextRequest) {
  try {
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
    } = body;

    if (!prompt || !model) {
      return NextResponse.json(
        { error: '缺少必要参数: prompt 和 model 是必填的' },
        { status: 400 },
      );
    }

    // 1. 查找视频 API 提供商
    let provider;
    if (providerId) {
      provider = await findProviderById(providerId);
    }
    if (!provider) {
      provider = await findProviderForModel(model);
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
    const advancedParams = provider.advancedParams ? 
      (typeof provider.advancedParams === 'string' ? JSON.parse(provider.advancedParams) : provider.advancedParams) 
      : {};

    // 2. 推断视频协议
    const profile = resolveVideoCompatProfile(
      model,
      advancedParams?.compatProfile,
      baseUrl,
    );

    // 3. 获取模型特征信息
    const modelInfo = getVideoModelInfo(model);

    // 4. 构建请求参数
    const videoParams: VideoGenerateParams = {
      prompt,
      model,
      imageUrl,
      lastFrameImageUrl,
      referenceImages,
      aspectRatio,
      duration,
      mode,
      generateAudio,
      negativePrompt,
      seed,
      apiKey,
      baseUrl,
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s 提交超时

        const response = await fetchWithV1Retry(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          signal: controller.signal,
        });

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

        if (!submitResult.taskId) {
          updateTaskProgress(taskId, {
            status: 'failed',
            error: '提交视频生成任务失败：未获取到任务ID',
            progress: 0,
          });
          return;
        }

        // 存储轮询所需信息到任务结果中
        updateTaskProgress(taskId, {
          progress: 10,
          label: `${modeLabel} · ${modelName} · 排队中...`,
          result: {
            thirdPartyTaskId: submitResult.taskId,
            profile,
            baseUrl,
            apiKey,
            model,
            providerId: provider.id,
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
