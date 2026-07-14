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
  validateVideoDuration,
  type VideoGenerateParams,
  type VideoCompatProfile,
} from '@/lib/video-api';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { buildDirectorPrompt, type VideoDirectorMode } from '@/lib/video-director';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { logError, OP_ACTIONS, startTimer } from '@/lib/op-log';
import { validateApiInputs } from '@/lib/api-validator';
import { recordVideoTaskRemotePolling, recordVideoTaskSubmitted, recordVideoTaskTerminal } from '@/lib/cloud-task-persistence';

export const maxDuration = 300; // 5 min timeout

export async function POST(request: NextRequest) {
  const opTimer = startTimer();
  let deductedCredits = 0;
  let sessionUser: any = null;
  try {
    // 积分扣除（按模型差异化扣分）
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        prompt: 'optionalPrompt',
        imageUrl: 'optionalImageUrl',
        videoUrl: 'optionalVideoUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

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
      projectId,
      // === 新增高级参数 ===
      cameraControl,
      motionBrush,
      characterReferences,
      motionStrength,
      useDirector,
      directorMode,
      directorIntent,
      shotId,
    } = body;

    if (!prompt || !model) {
      return NextResponse.json(
        { error: '缺少必要参数: prompt 和 model 是必填的' },
        { status: 400 },
      );
    }

    // ★ 从 model 中提取纯 modelId（前端可能传 providerId::modelId 格式）
    let pureModel = model;
    const extractedProviderId = model.includes('::') ? model.split('::')[0] : '';
    if (model.includes('::')) {
      pureModel = model.split('::').pop()!;
      console.log(`[video/generate] Stripped provider prefix from model: "${model}" → "${pureModel}"`);
    }
    const effectiveProviderId = providerId || extractedProviderId || '';
    const parsedDuration = Number(duration);
    const durationValidation = validateVideoDuration(pureModel, parsedDuration);
    if (!durationValidation.valid) {
      const allowed = durationValidation.allowedDurations;
      return NextResponse.json({
        error: allowed.length > 0
          ? `模型 ${pureModel} 仅支持单段 ${allowed.join('/')} 秒视频`
          : '视频时长必须是大于 0 的整数秒',
        allowedDurations: allowed,
      }, { status: 400 });
    }

    // 积分扣除（登录用户才扣积分，按模型差异化扣分）
    sessionUser = await getSessionUser(request);
    deductedCredits = 0;
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'video_generate', undefined, undefined, model, { durationSeconds: Number(duration) });
      if (!creditResult.success) {
        return NextResponse.json({ error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    // 1. 查找视频 API 提供商
    let provider;
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
      pureModel,
      advancedParams?.compatProfile,
      baseUrl,
    );
    console.log(`[video/generate] model=${pureModel}, providerId=${provider.id}, baseUrl=${baseUrl}, profile=${profile}, compatProfile=${advancedParams?.compatProfile || '(none)'}`);

    // 3. 获取模型特征信息
    const modelInfo = getVideoModelInfo(pureModel);

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
    // 4.1 如果启用导演增强，在服务端本地"增强"提示词（拼合导演风格/参考/负向等，不依赖额外 LLM 调用，避免失败）
    let finalPrompt = prompt;
    let finalNegativePrompt = negativePrompt;
    if (useDirector !== false) { // 默认启用
      try {
        const refs: Array<{ id: string; url: string; role: any; weight?: number }> = [];
        if (resolvedImageUrl) refs.push({ id: 'first', url: resolvedImageUrl, role: 'first-frame' });
        if (resolvedLastFrameUrl) refs.push({ id: 'last', url: resolvedLastFrameUrl, role: 'last-frame' });
        (resolvedRefs || []).forEach((u: string, i: number) => refs.push({ id: `ref${i}`, url: u, role: 'style' }));
        (characterReferences || []).forEach((u: string, i: number) => refs.push({ id: `char${i}`, url: u, role: 'identity' }));
        const compiledMode: VideoDirectorMode = imageUrl
          ? (lastFrameImageUrl ? 'image2video-firstlast' : 'image2video-first')
          : 'text2video';
        const directorMsg = buildDirectorPrompt({
          userPrompt: prompt,
          mode: compiledMode,
          modelId: pureModel,
          model: pureModel,
          style: directorMode || 'cinematic',
          aspectRatio,
          duration,
          firstFrameNote: resolvedImageUrl ? '首帧图片由用户提供' : undefined,
          lastFrameNote: resolvedLastFrameUrl ? '尾帧图片由用户提供' : undefined,
          imageUrl: resolvedImageUrl,
          lastFrameUrl: resolvedLastFrameUrl,
          references: refs,
          audio: generateAudio,
          camera: cameraControl?.type,
          includeNegative: true,
          verbosity: 'standard',
        });
        // 真正把导演编译器输出拼入 prompt（directorMsg.user 是结构化指导段）
        const guidance: string[] = [];
        if (cameraControl?.type) {
          const camLabel: Record<string, string> = {
            push_in: '缓慢推进', push_out: '缓慢拉出', pan_left: '左摇', pan_right: '右摇',
            tilt_up: '上仰', tilt_down: '下俯', orbit_left: '左环绕', orbit_right: '右环绕',
            zoom_in: '放大', zoom_out: '缩小', tracking: '跟拍', static: '静止机位',
            crane_up: '摇臂升起', crane_down: '摇臂降下', handheld: '手持', dolly: '滑轨平移',
          };
          guidance.push(`运镜：${camLabel[cameraControl.type] || cameraControl.type}，强度${cameraControl.intensity || 50}%`);
        }
        if (directorIntent) guidance.push(`镜头意图：${directorIntent}`);
        const directorSection = directorMsg.user || '';
        finalPrompt = [
          directorSection ? `【导演编排】\n${directorSection}` : '',
          guidance.length ? `【导演指导】${guidance.join('；')}。` : '',
          `【画面描述】${prompt}`,
        ].filter(Boolean).join('\n\n');
        // negative 保持原样，模型不支持时适配器会过滤（LLM 增强时由 directorResult.negative 提供，此处本地编译不覆盖）
        finalNegativePrompt = negativePrompt;
        console.log(`[video/generate] Director user-message length=${directorMsg.user.length}, mode=${compiledMode}, finalPrompt length=${finalPrompt.length}`);
      } catch (e) {
        console.warn('[video/generate] Director compile failed, falling back to raw prompt:', e);
      }
    }

    const videoParams: VideoGenerateParams = {
      prompt: finalPrompt,
      model: pureModel,
      imageUrl: resolvedImageUrl,
      lastFrameImageUrl: resolvedLastFrameUrl,
      referenceImages: resolvedRefs.filter(Boolean) as string[],
      aspectRatio,
      duration,
      mode,
      generateAudio,
      negativePrompt: finalNegativePrompt,
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
    registerTask(taskId, 'video', `${modeLabel} · ${modelName}`, sessionUser?.id);
    // Persist before returning the task ID. Cloud function runtimes may stop work
    // scheduled with `void` as soon as this route responds.
    try {
      await recordVideoTaskSubmitted({
        taskId,
        userId: sessionUser?.id,
        projectId: typeof projectId === 'string' ? projectId : undefined,
        providerId: provider.id,
        model: pureModel,
        label: `${modeLabel} - ${modelName}`,
      });
    } catch (error) {
      console.warn('[video/generate] Cloud task submit persistence failed:', error);
    }

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
          void recordVideoTaskTerminal(taskId, { status: 'failed', error: errorMessage })
            .catch((error) => console.warn('[video/generate] Cloud task failure persistence failed:', error));
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
          void recordVideoTaskTerminal(taskId, { status: 'failed', error: '提交视频生成任务失败：未获取到任务ID' })
            .catch((error) => console.warn('[video/generate] Cloud task failure persistence failed:', error));
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
          void recordVideoTaskTerminal(taskId, {
            status: 'completed',
            videoUrl: submitResult.videoUrl,
          }).catch((error) => console.warn('[video/generate] Cloud task completion persistence failed:', error));
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
        void recordVideoTaskRemotePolling(taskId, {
          remoteTaskId: submitResult.taskId,
          usedImagesEndpoint,
        }).catch((error) => console.warn('[video/generate] Cloud task remote ID persistence failed:', error));
      } catch (err: any) {
        const errorMsg = err.name === 'AbortError' ? '提交超时，请稍后重试' : (err.message || '提交视频生成任务失败');
        updateTaskProgress(taskId, { status: 'failed', error: errorMsg, progress: 0 });
        void recordVideoTaskTerminal(taskId, { status: 'failed', error: errorMsg })
          .catch((error) => console.warn('[video/generate] Cloud task failure persistence failed:', error));
      }
    })();

    // 7. 立即返回任务ID
    return NextResponse.json({
      taskId,
      shotId: shotId || null,
      status: 'queued',
      message: '视频生成任务已提交',
      modelInfo: modelInfo ? {
        name: modelInfo.name,
        features: modelInfo.features,
      } : null,
    });
  } catch (err: any) {
    console.error('[video/generate] Error:', err);
    // 记录操作日志 - 视频生成失败
    logError(OP_ACTIONS.VIDEO_GENERATE, err, {
      userId: sessionUser?.id || 'anonymous',
      userName: sessionUser?.name,
      targetType: 'video',
      durationMs: opTimer.end(),
    });
    // 退款：视频生成失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `视频生成失败退款: ${(err.message || '').substring(0, 100)}`);
      } catch (refundErr) { console.error('[video/generate] Refund failed:', refundErr); }
    }
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
  const deductedCredits = 0;
  const sessionUser: any = null;
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
