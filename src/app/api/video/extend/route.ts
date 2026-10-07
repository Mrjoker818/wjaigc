/**
 * 视频延长 API - 提交视频延长任务
 * POST /api/video/extend
 * 
 * 支持: 可灵V3、Seedance 2.0/2.3、Vidu Q1/Q2、Runway Gen-3/4、Sora 等支持延长的模型
 * 异步提交 + 轮询模式，复用 task-registry
 */

import { lstat, realpath, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getServerDataRoot } from '@/lib/server-data-root';
import { deleteGeneratedMediaFromS3Exact } from '@/lib/s3-storage';
import { logOperation, logError, OP_ACTIONS } from '@/lib/op-log';
import { authorizeGenerationProject, GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
import { prepareVideoCanvasPublication, completeDocumentVideoTask, VideoCompletionUnknownError } from '@/lib/video-document-admission';
import { CanvasOrdinaryAdmissionError } from '@/lib/collaboration/canvas-ordinary-generation-admission';
import { CanvasTaskPublicationError } from '@/lib/collaboration/task-publication';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import { createHash } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, findProviderForModel, findProviderById } from '@/lib/server-api-config';
import {
  registerTask,
  registerTaskAbortController,
  unregisterTaskAbortController,
  isTaskCancelled,
  updateTaskProgress,
} from '@/lib/task-registry';
import { getSessionUser } from '@/lib/server-auth';
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { calculateConfiguredCreditCost } from '@/lib/credits';
import { validateApiInputs } from '@/lib/api-validator';
import {
  buildVideoExtendRequest,
  parseVideoSubmitResponse,
  resolveVideoCompatProfile,
  getVideoModelInfo,
  type VideoGenerateParams,
} from '@/lib/video-api';
import { buildDirectorPrompt, type DirectorStyle } from '@/lib/video-director';
import { recordVideoTaskRemotePolling, recordVideoTaskSubmitted } from '@/lib/cloud-task-persistence';
import {
  chargeCloudTaskCredits,
  getCloudTaskById,
  completeCloudTask,
  terminateCloudTaskAndRefund,
} from '@/lib/cloud-task-storage';
import { getRuntimeSettings } from '@/lib/runtime-settings';
import { getRequestId } from '@/lib/request-id';
import { resolveTaskModelForUser } from '@/lib/task-core/model-catalog';
import { validateTaskModelSelection } from '@/lib/task-core/model-capability-resolution';
import { resolveProviderForTask } from '@/lib/task-core/exact-provider-routing';
import { ModelCapabilityError } from '@/lib/task-core/model-capability-contract';

export const maxDuration = 300; // 5 min timeout

type GeneratedMediaReceipt = { filename: string; s3Key?: string; files: { path: string; identity: string }[] };
async function generatedMediaIdentity(file: string): Promise<string> {
  for (let dir = path.dirname(file);; dir = path.dirname(dir)) {
    const parent = await lstat(dir); if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('GENERATED_MEDIA_PARENT_CHANGED');
    if (dir === path.dirname(dir)) break;
  }
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || path.resolve(await realpath(file)) !== file) throw new Error('GENERATED_MEDIA_PATH_CHANGED');
  const bytes = await readFile(file), after = await lstat(file);
  const fields = (s: typeof stat): number[] => [s.dev, s.ino, s.birthtimeMs, s.mtimeMs, s.size];
  if (!after.isFile() || after.isSymbolicLink() || fields(stat).some((value, index) => value !== fields(after)[index])) throw new Error('GENERATED_MEDIA_CHANGED');
  return [...fields(stat), createHash('sha256').update(bytes).digest('hex')].join(':');
}
async function captureGeneratedMedia(data: Record<string, unknown>, startedAt: number): Promise<GeneratedMediaReceipt> {
  const match = typeof data.filename === 'string' && /^(?:video|gen)-(\d{13})-[a-z0-9]{1,6}\.[a-z0-9]{2,5}$/u.exec(data.filename);
  if (data.success !== true || !match || data.url !== `/api/serve-upload/uploads/${data.filename}`
    || !Number.isSafeInteger(data.size) || Number(data.size) <= 0 || Number(match[1]) < startedAt || Number(match[1]) > Date.now()
    || data.s3Key != null && (typeof data.s3Key !== 'string' || !data.s3Key)) throw new Error('GENERATED_MEDIA_RECEIPT_INVALID');
  const receipt: GeneratedMediaReceipt = { filename: data.filename as string, files: [],
    ...(typeof data.s3Key === 'string' ? { s3Key: data.s3Key } : {}) };
  const dirs = [path.resolve(getServerDataRoot(), 'uploads')];
  if (process.env.COZE_PROJECT_ENV !== 'PROD') dirs.push(path.resolve(process.cwd(), 'public', 'uploads'));
  for (const [index, dir] of dirs.entries()) {
    const file = path.resolve(dir, receipt.filename); if (path.dirname(file) !== dir) throw new Error('GENERATED_MEDIA_PATH_INVALID');
    let stat; try { stat = await lstat(file); } catch (error) {
      if (index > 0 && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error;
    }
    if (stat.size !== data.size || stat.birthtimeMs < startedAt - 1000 || stat.birthtimeMs > Date.now() + 1000) throw new Error('GENERATED_MEDIA_IDENTITY_INVALID');
    const identity = await generatedMediaIdentity(file);
    if (!identity.startsWith([stat.dev, stat.ino, stat.birthtimeMs, stat.mtimeMs, stat.size].join(':') + ':')) throw new Error('GENERATED_MEDIA_CHANGED');
    receipt.files.push({ path: file, identity });
  }
  return receipt;
}
async function cleanupGeneratedMedia(taskId: string, receipts: GeneratedMediaReceipt[]): Promise<void> {
  const task = await getCloudTaskById(taskId);
  if (!task || !['failed', 'cancelled', 'timeout'].includes(task.status)) return;
  const settled = await Promise.allSettled(receipts.map(async receipt => {
    for (const file of receipt.files) if (await generatedMediaIdentity(file.path) !== file.identity) throw new Error('GENERATED_MEDIA_CHANGED');
    if (receipt.s3Key) await deleteGeneratedMediaFromS3Exact(receipt.s3Key, receipt.filename);
    for (const file of receipt.files) {
      if (await generatedMediaIdentity(file.path) !== file.identity) throw new Error('GENERATED_MEDIA_CHANGED');
      await unlink(file.path);
    }
  }));
  const errors = settled.filter((row): row is PromiseRejectedResult => row.status === 'rejected').map(row => row.reason);
  if (errors.length) throw new AggregateError(errors, 'GENERATED_MEDIA_CLEANUP_FAILED');
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function modelCapabilityConfigurationErrorResponse(
  error: ModelCapabilityError,
  requestId: string,
): NextResponse {
  const status = error.code === 'MODEL_NOT_AUTHORIZED' ? 403 : 400;
  return NextResponse.json({
    success: false,
    code: error.code,
    error: error.message,
    retryable: false,
    details: error.details,
    requestId,
  }, { status });
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = getRequestId(request);
  let plannedCreditCost = 0;
  let sessionUser: import('@/lib/user-types').User | null = null;
  const model = '';
  const providerId = '';
  try {
    const body = await request.json();
    const runtimeSettings = await getRuntimeSettings();
    if (!runtimeSettings.videoGenerationEnabled) {
      return NextResponse.json({ error: 'Video generation is currently disabled by the administrator' }, { status: 403 });
    }
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
      prompt: rawPrompt = '',
      model,
      extendDuration = 5,
      generateAudio = false,
      providerId,
      useDirector = true,
      directorStyle,
      directorMode,
      negativePrompt,
      cameraControl,
      seed,
      projectId,
      sessionId,
      messageId,
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

    const parsedExtendDuration = Number(extendDuration);
    if (parsedExtendDuration > runtimeSettings.maxVideoDuration) {
      return NextResponse.json({ error: `Video duration exceeds the ${runtimeSettings.maxVideoDuration}s platform limit` }, { status: 400 });
    }
    // 1. 查找视频 API 提供商
    sessionUser = await getSessionUser(request);
    if (!sessionUser) return NextResponse.json({ error: '请先登录后再延长视频' }, { status: 401 });
    const projectAccess = await authorizeGenerationProject({ actorUserId: sessionUser.id, projectId });
    if (projectAccess.kind === 'document' && request.headers.get('x-wujie-expected-actor-id') !== sessionUser.id) {
      return NextResponse.json({ error: 'ACTOR_CHANGED' }, { status: 403 });
    }
    const canvasPublication = await prepareVideoCanvasPublication(projectAccess, body, request.nextUrl.origin, 'video-extend');
    const effectiveProviderId = extractedProviderId || providerId;
    const provider = await resolveProviderForTask({
      providerId: effectiveProviderId || undefined,
      findById: findProviderById,
      findByModel: () => findProviderForModel(pureModel, 'video'),
      findByFeature: () => findProviderForFeature('video'),
    });
    if (!provider) {
      return NextResponse.json(
        { error: '未找到可用的视频 API 提供商，请先在管理员后台添加视频模型 API' },
        { status: 404 },
      );
    }

    const descriptor = await resolveTaskModelForUser(provider.id, pureModel, sessionUser);
    const videoCapabilityAdmission = validateTaskModelSelection(descriptor, {
      operation: 'video-extend',
      durationSeconds: parsedExtendDuration,
    });
    if (!videoCapabilityAdmission.ok) {
      return NextResponse.json({
        success: false,
        code: 'MODEL_CAPABILITY_MISMATCH',
        error: `所选视频模型不支持当前参数：${videoCapabilityAdmission.error.field}`,
        retryable: false,
        details: {
          providerId: provider.id,
          modelId: pureModel,
          field: videoCapabilityAdmission.error.field,
          received: videoCapabilityAdmission.error.received,
          allowed: videoCapabilityAdmission.error.allowed,
        },
        requestId,
      }, { status: 400 });
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

    // 4. 构建请求参数（接入导演级提示词：本地规则增强，不依赖额外 LLM 调用）
    const safePrompt = rawPrompt && rawPrompt.trim() ? rawPrompt : '请延续视频内容和画面，保持角色和场景一致';
    let finalPrompt = safePrompt;
    let finalNegativePrompt = negativePrompt || '';
    const resolvedStyle = directorStyle || directorMode || 'cinematic';
    if (useDirector !== false) {
      try {
        const directorMsg = buildDirectorPrompt({
          userPrompt: safePrompt,
          mode: 'extend',
          modelId: pureModel,
          model: pureModel,
          duration: extendDuration,
          audio: generateAudio,
          style: resolvedStyle as DirectorStyle,
          camera: typeof cameraControl === 'string' ? cameraControl : cameraControl?.type,
          includeNegative: true,
          verbosity: 'standard',
        });
        const guidance: string[] = ['从上一片段尾帧自然延续，保持角色外观、场景、光线、运动方向一致；避免突然跳切'];
        if (cameraControl && typeof cameraControl !== 'string' && cameraControl.type) {
          const camLabel: Record<string, string> = {
            push_in: '缓慢推进', push_out: '缓慢拉出', pan_left: '左摇', pan_right: '右摇',
            tilt_up: '上仰', tilt_down: '下俯', orbit_left: '左环绕', orbit_right: '右环绕',
            zoom_in: '放大', zoom_out: '缩小', tracking: '跟拍', static: '静止机位',
          };
          guidance.push(`运镜：${camLabel[cameraControl.type] || cameraControl.type}`);
        }
        const directorSection = directorMsg.user || '';
        finalPrompt = [
          directorSection ? `【导演编排】\n${directorSection}` : '',
          `【续写指导】${guidance.join('；')}。`,
          `【内容要求】${safePrompt}`,
        ].filter(Boolean).join('\n\n');
        if (!finalNegativePrompt) {
          finalNegativePrompt = 'blurry, distorted face, morphing identity, watermark, subtitle, text overlay, jitter, glitch, frame skip';
        }
        console.log(`[video/extend] Director enhance applied, style=${resolvedStyle}, promptLen=${finalPrompt.length}`);
      } catch (e) {
        console.warn('[video/extend] Director compile failed, using raw prompt:', e);
      }
    }

    const videoParams: VideoGenerateParams = {
      prompt: finalPrompt,
      negativePrompt: finalNegativePrompt || undefined,
      seed: typeof seed === 'number' ? seed : undefined,
      model: pureModel,
      videoUrl: resolvedVideoUrl,
      action: 'extend',
      extendDuration,
      generateAudio,
      apiKey,
      baseUrl,
      advancedParams,
    };

    // 4.5 只在持久化任务存在后原子扣费，避免提交失败或重启造成
    // 无关联扣费、重复退款或重复调用供应商。
    plannedCreditCost = sessionUser
      ? await calculateConfiguredCreditCost('video_extend', pureModel, {
          durationSeconds: Number(extendDuration),
          providerId: provider.id,
        })
      : 0;

    // 5. 注册任务
    let taskId = `video_extend_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const modelName = modelInfo?.name || pureModel;
    let admittedCreditCost: number | undefined;
    if (canvasPublication) {
      const idempotencyKey = request.headers.get('idempotency-key')?.trim();
      if (!idempotencyKey) throw new CanvasOrdinaryAdmissionError(400, 'CANVAS_VIDEO_IDEMPOTENCY_REQUIRED');
      const now = Date.now();
      const admission = await createBillableTask({
        userId: sessionUser.id, idempotencyKey,
        requestDigest: createHash('sha256').update(JSON.stringify({ route: '/api/video/extend', body, canvasPublication })).digest('hex'),
        creditCost: plannedCreditCost, canvasPublication,
        task: { id: taskId, projectId: canvasPublication.access.projectId,
          sessionId: typeof sessionId === 'string' ? sessionId : undefined,
          messageId: typeof messageId === 'string' ? messageId : undefined,
          type: 'video-extend', status: 'processing', providerId: provider.id, model: pureModel,
          remoteTaskId: taskId, progress: 0, label: `视频延长 - ${modelName}`,
          result: { submissionPayload: { prompt: safePrompt, videoUrl, extendDuration, model: pureModel,
            providerId: provider.id, projectId: canvasPublication.access.projectId,
            sessionId: typeof sessionId === 'string' ? sessionId : undefined,
            messageId: typeof messageId === 'string' ? messageId : undefined,
            generateAudio, negativePrompt, seed,
            assetWorkspace: 'canvas', assetWorkspaceId: canvasPublication.workspaceId,
            assetParentVersionIds: canvasPublication.intent!.parentVersionIds,
            assetSelectedEntityIds: body.assetSelectedEntityIds,
            videoCanvasAdmission: canvasPublication } },
          createdAt: now, updatedAt: now },
      });
      taskId = admission.task.id;
      if (admission.reused) return NextResponse.json({ taskId, status: admission.task.status, reused: true });
      if (!admission.charged && plannedCreditCost > 0) return NextResponse.json({ error: '视频延长扣费未确认' }, { status: 402 });
      admittedCreditCost = admission.task.creditCost || 0;
    }
    registerTask(taskId, 'video', `视频延长 · ${modelName}`, sessionUser?.id);
    if (!canvasPublication) {
    try {
      await recordVideoTaskSubmitted({
        taskId,
        userId: sessionUser?.id,
        projectId: typeof projectId === 'string' ? projectId : undefined,
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
        messageId: typeof messageId === 'string' ? messageId : undefined,
        type: 'video-extend',
        providerId: provider.id,
        model: pureModel,
        label: `视频延长 - ${modelName}`,
        creditCost: plannedCreditCost,
        deferCreditCharge: true,
        submissionPayload: {
          videoUrl,
          prompt: rawPrompt,
          extendDuration,
          generateAudio,
          negativePrompt,
          cameraControl,
          seed,
        },
      });
    } catch (error) {
      console.error('[video/extend] Cloud task submit persistence failed:', error);
      return NextResponse.json({
        error: '任务持久化失败，未向视频供应商提交请求',
        retryable: true,
      }, { status: 503 });
    }
    const charge = await chargeCloudTaskCredits(
      taskId,
      sessionUser?.id || 'anonymous',
      plannedCreditCost,
      `视频延长 - ${modelName}`,
    );
    if (!charge.charged) {
      await terminateCloudTaskAndRefund(taskId, 'cancelled', '视频延长积分扣费未完成，未向供应商提交任务');
      return NextResponse.json({
        error: '积分不足或积分服务暂不可用，未向视频供应商提交请求',
        retryable: true,
      }, { status: 402 });
    }
    updateTaskProgress(taskId, { status: 'processing', progress: 0, creditCost: charge.creditCost });
    } else {
      updateTaskProgress(taskId, { status: 'processing', progress: 0, creditCost: admittedCreditCost });
    }

    // 6. 异步提交到第三方 API
    after(async () => {
      const submitController = new AbortController();
      const generatedMedia: GeneratedMediaReceipt[] = []; let preserveGeneratedMedia = false;
      registerTaskAbortController(taskId, submitController);
      try {
        updateTaskProgress(taskId, { progress: 5, label: `视频延长 · ${modelName} · 提交中...` });

        const req = buildVideoExtendRequest(profile, videoParams);
        const submitSignal = AbortSignal.any([submitController.signal, AbortSignal.timeout(30000)]);

        let response = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          signal: submitSignal,
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
              signal: submitSignal,
            });
            usedImagesEndpoint = true;
          }
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          let errorMessage = `API 请求失败 (${response.status})`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.message || errorJson.error?.message || errorJson.msg || errorMessage;
          } catch { /* ignore */ }
          const settled = await terminateCloudTaskAndRefund(taskId, 'failed', errorMessage);
          if (!settled.transitioned) return;
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
          const videoPersistStartedAt = Date.now();
          try {
            const persistRes = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/save-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(await getInternalRequestHeaders('system-save-image', 'admin')) },
              body: JSON.stringify({ imageUrl: finalVideoUrl, format: 'mp4' }),
              signal: AbortSignal.timeout(30000),
            });
            if (persistRes.ok) {
              const persistData = await persistRes.json();
              if (canvasPublication) generatedMedia.push(await captureGeneratedMedia(persistData, videoPersistStartedAt));
              if (persistData.url) finalVideoUrl = persistData.url;
            }
          } catch (error) { if (canvasPublication) console.error('[video/extend] Media receipt unavailable; retained:', error); /* fallback to original */ }

          // 持久化封面图
          if (finalImageUrl) {
            const coverPersistStartedAt = Date.now();
            try {
              const persistRes = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/save-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await getInternalRequestHeaders('system-save-image', 'admin')) },
                body: JSON.stringify({ imageUrl: finalImageUrl }),
                signal: AbortSignal.timeout(30000),
              });
              if (persistRes.ok) {
                const persistData = await persistRes.json();
                if (canvasPublication) generatedMedia.push(await captureGeneratedMedia(persistData, coverPersistStartedAt));
                if (persistData.url) finalImageUrl = persistData.url;
              }
            } catch (error) { if (canvasPublication) console.error('[video/extend] Cover receipt unavailable; retained:', error); /* fallback to original */ }
          }

          const completedResult = {
            videoUrl: finalVideoUrl,
            imageUrl: finalImageUrl,
            videoDuration: (submitResult as unknown as Record<string, unknown>).videoDuration as number || extendDuration,
          };
          const completed = await (canvasPublication ? completeDocumentVideoTask : completeCloudTask)(taskId, completedResult);
          if (!completed) return;
          updateTaskProgress(taskId, {
            status: 'completed',
            progress: 100,
            result: completedResult,
          });
          return;
        }

        if (!submitResult.taskId) {
          const missingTaskError = '提交视频延长任务失败：未获取到任务ID';
          const settled = await terminateCloudTaskAndRefund(taskId, 'failed', missingTaskError);
          if (!settled.transitioned) return;
          updateTaskProgress(taskId, {
            status: 'failed',
            error: missingTaskError,
            progress: 0,
          });
          return;
        }

        // 存储轮询所需信息到任务结果中
        if (isTaskCancelled(taskId)) return;
        await recordVideoTaskRemotePolling(taskId, {
          remoteTaskId: submitResult.taskId,
          usedImagesEndpoint,
        });
        if (isTaskCancelled(taskId)) return;
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
      } catch (err: unknown) {
        if (err instanceof VideoCompletionUnknownError) {
          preserveGeneratedMedia = true;
          console.error('[video/extend] Completion requires reconciliation:', err.message);
          return;
        }
        const errorMsg = err instanceof Error && err.name === 'AbortError'
          ? '提交超时，请稍后重试'
          : errorMessage(err, '提交视频延长任务失败');
        const settled = await terminateCloudTaskAndRefund(taskId, 'failed', errorMsg);
        if (!settled.transitioned) return;
        updateTaskProgress(taskId, { status: 'failed', error: errorMsg, progress: 0 });
      } finally {
        try { if (canvasPublication && !preserveGeneratedMedia && generatedMedia.length) await cleanupGeneratedMedia(taskId, generatedMedia); }
        finally { unregisterTaskAbortController(taskId, submitController); }
      }
    });

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
  } catch (err: unknown) {
    if (err instanceof CanvasOrdinaryAdmissionError || err instanceof CanvasTaskPublicationError) {
      return NextResponse.json({ success: false, code: err.code, error: err.message, retryable: false }, { status: err.status });
    }
    if (err instanceof IdempotencyConflictError) return NextResponse.json({ success: false, error: err.message }, { status: 409 });
    if (err instanceof GenerationProjectAccessError) {
      return NextResponse.json({ success: false, code: err.code, error: err.message, retryable: false }, { status: err.status });
    }
    if (err instanceof ModelCapabilityError) {
      return modelCapabilityConfigurationErrorResponse(err, requestId);
    }
    console.error('[video/extend] Error:', err);
    // 操作日志记录错误
    logError(OP_ACTIONS.VIDEO_EXTEND, err, {
      userId: sessionUser?.id || 'anonymous',
      userName: sessionUser?.name || '匿名用户',
      model,
      providerId,
      durationMs: Date.now() - startTime,
    });
    return NextResponse.json(
      { error: errorMessage(err, '视频延长请求失败') },
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
