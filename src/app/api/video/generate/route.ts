/**
 * 视频生成 API - 提交视频生成任务
 * POST /api/video/generate
 * 
 * 支持: 文生视频、图生视频（首帧/首尾帧/多参考图）
 * 异步提交 + 轮询模式，复用 task-registry
 */

import { createHash, randomUUID } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, findProviderForModel, findProviderById } from '@/lib/server-api-config';
import {
  registerTask,
  registerTaskAbortController,
  unregisterTaskAbortController,
  isTaskCancelled,
  updateTaskProgress,
} from '@/lib/task-registry';
import {
  buildVideoSubmitRequest,
  parseVideoSubmitResponse,
  resolveVideoCompatProfile,
  getVideoModelInfo,
  ratioToSize,
  type VideoGenerateParams,
} from '@/lib/video-api';
import { buildDirectorPrompt, type VideoDirectorMode } from '@/lib/video-director';
import { getSessionUser } from '@/lib/server-auth';
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { calculateConfiguredCreditCost, InsufficientCreditsError } from '@/lib/credits';
import { logError, OP_ACTIONS, startTimer } from '@/lib/op-log';
import { validateApiInputs } from '@/lib/api-validator';
import { recordVideoTaskRemotePolling, recordVideoTaskSubmitted } from '@/lib/cloud-task-persistence';
import {
  chargeCloudTaskCredits,
  claimCloudTaskLease,
  completeCloudTask,
  getCloudTaskForUser,
  getCloudTaskForUserByIdempotencyKey,
  releaseCloudTaskLease,
  terminateCloudTaskAndRefund,
  updateCloudTask,
} from '@/lib/cloud-task-storage';
import type { User } from '@/lib/user-types';
import type { VideoReferenceBinding } from '@/lib/video-director/prompt-compiler';
import { getRuntimeSettings } from '@/lib/runtime-settings';
import {
  createTaskEntryAudit,
  executeTaskEntryMigration,
  resolveTaskCoreMode,
} from '@/lib/task-core/entry-migration';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import { getRequestId } from '@/lib/request-id';
import { resolveTaskModelForUser } from '@/lib/task-core/model-catalog';
import { validateTaskModelSelection } from '@/lib/task-core/model-capability-resolution';
import {
  ModelCapabilityError,
  type SupportedOperation,
} from '@/lib/task-core/model-capability-contract';
import {
  createSkillPrepaidGeneration,
  inspectSkillPrepaidPoll,
  parseSkillBillingContext,
  SkillBillingAuthorizationError,
  startSkillPrepaidProviderRequest,
  type SkillPrepaidExecutionReference,
} from '@/lib/skill-runtime/prepaid-generation';

export const maxDuration = 300; // 5 min timeout

async function waitForSkillVideoAcceptance(
  taskId: string,
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    signal.throwIfAborted();
    const child = await getCloudTaskForUser(taskId, userId);
    if (!child) throw new SkillBillingAuthorizationError();
    const state = await inspectSkillPrepaidPoll(child);
    if (state.action === 'allow') return;
    if (state.action === 'stop') throw Object.assign(new Error(state.message), { code: 'SKILL_PARENT_ENDED' });
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, 25);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
  throw Object.assign(new Error('Skill video acceptance was not confirmed in time'), {
    code: 'SKILL_ACCEPTANCE_TIMEOUT',
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function toSupportedVideoOperation(
  imageUrl: unknown,
  lastFrameImageUrl: unknown,
  referenceImages: unknown,
  characterReferences: unknown,
): SupportedOperation {
  if (typeof lastFrameImageUrl === 'string' && lastFrameImageUrl.trim()) return 'first-last-frame';
  if (
    (Array.isArray(referenceImages) && referenceImages.length > 0)
    || (Array.isArray(characterReferences) && characterReferences.length > 0)
  ) return 'multi-reference';
  if (typeof imageUrl === 'string' && imageUrl.trim()) return 'image-to-video';
  return 'text-to-video';
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
  const opTimer = startTimer();
  const taskStartedAt = Date.now();
  const requestId = getRequestId(request);
  const taskCoreMode = resolveTaskCoreMode(process.env.WUJIE_TASK_CORE_MODE);
  let plannedCreditCost = 0;
  let sessionUser: User | null = null;
  try {
    // 积分扣除（按模型差异化扣分）
    const body = await request.json();
    const runtimeSettings = await getRuntimeSettings();
    if (!runtimeSettings.videoGenerationEnabled) {
      return NextResponse.json({ error: 'Video generation is currently disabled by the administrator' }, { status: 403 });
    }
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
      resolution,
      duration = 5,
      mode = 'std',
      generateAudio = false,
      negativePrompt,
      seed,
      providerId,
      projectId,
      sessionId,
      messageId,
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
    if (parsedDuration > runtimeSettings.maxVideoDuration) {
      return NextResponse.json({ error: `Video duration exceeds the ${runtimeSettings.maxVideoDuration}s platform limit` }, { status: 400 });
    }

    // 仅确认用户身份。积分在持久化任务创建后以数据库原子语句扣除，
    // 防止任务未落库或并发请求时产生不可追溯的重复扣费。
    sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: '请先登录后再生成视频' }, { status: 401 });
    }
    const skillBillingContext = body.skillBillingContext === undefined
      ? undefined
      : parseSkillBillingContext(body.skillBillingContext);
    const requestedIdempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
    if (skillBillingContext && (
      !requestedIdempotencyKey
      || !effectiveProviderId
      || typeof projectId !== 'string' || !projectId
      || typeof sessionId !== 'string' || !sessionId
    )) {
      throw new SkillBillingAuthorizationError();
    }

    // 1. 查找视频 API 提供商
    let provider;
    if (effectiveProviderId) {
      provider = await findProviderById(effectiveProviderId);
    }
    if (!provider && !skillBillingContext) {
      provider = await findProviderForModel(pureModel, 'video', effectiveProviderId);
    }
    if (!provider && !skillBillingContext) {
      provider = await findProviderForFeature('video');
    }
    if (!provider && !skillBillingContext) {
      // Fallback: 尝试 image 类型提供商（某些提供商同时支持图片和视频）
      provider = await findProviderForFeature('imageEdit');
    }
    if (!provider) {
      return NextResponse.json(
        { error: '未找到可用的视频 API 提供商，请先在管理员后台添加视频模型 API' },
        { status: 404 },
      );
    }

    const descriptor = await resolveTaskModelForUser(provider.id, pureModel, sessionUser);
    const referenceImageCount = [
      imageUrl,
      lastFrameImageUrl,
      ...(Array.isArray(referenceImages) ? referenceImages : []),
      ...(Array.isArray(characterReferences) ? characterReferences : []),
    ].filter(value => typeof value === 'string' && value.trim()).length;
    const videoCapabilityAdmission = validateTaskModelSelection(descriptor, {
      operation: toSupportedVideoOperation(
        imageUrl,
        lastFrameImageUrl,
        referenceImages,
        characterReferences,
      ),
      aspectRatio,
      size: typeof resolution === 'string' && resolution.trim() ? resolution : undefined,
      durationSeconds: parsedDuration,
      referenceImageCount: referenceImageCount,
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
    // 管理员后台标记了 requestStyle=images-generations 表示该提供商应使用 images 端点
    if (provider.requestStyle === 'images-generations') {
      advancedParams = { ...advancedParams, videoEndpoint: 'images' };
    }
    if (typeof resolution === 'string' && resolution.trim()) {
      advancedParams = { ...advancedParams, resolution };
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
              headers: { 'Content-Type': 'application/json', ...(await getInternalRequestHeaders('system-save-image', 'admin')) },
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
        const refs: VideoReferenceBinding[] = [];
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
    plannedCreditCost = skillBillingContext ? 0 : await calculateConfiguredCreditCost(
      'video_generate', pureModel, {
          durationSeconds: Number(duration),
          providerId: provider.id,
      },
    );
    let taskEntryAudit = createTaskEntryAudit({
      entry: 'video',
      mode: taskCoreMode,
      requestId,
      requestedProviderId: effectiveProviderId || undefined,
      requestedModelId: pureModel,
      actualProviderId: provider.id,
      actualModelId: pureModel,
      startedAt: taskStartedAt,
      creditCost: plannedCreditCost,
      creditStatus: plannedCreditCost > 0 ? 'pending' : 'not-applicable',
    });

    // 5. 注册任务
    let taskId = skillBillingContext
      ? `video_skill_${createHash('sha256').update(requestedIdempotencyKey).digest('hex').slice(0, 24)}`
      : `video_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const modeLabel = imageUrl ? '图生视频' : '文生视频';
    const modelName = modelInfo?.name || model;
    const idempotencyKey = requestedIdempotencyKey || taskId;
    const requestDigest = createHash('sha256').update(JSON.stringify({
      providerId: provider.id,
      model: pureModel,
      prompt,
      imageUrl,
      lastFrameImageUrl,
      referenceImages,
      aspectRatio,
      duration,
      mode,
      generateAudio,
      negativePrompt,
      seed,
      projectId,
      sessionId,
      messageId,
    })).digest('hex');
    const submissionPayload = {
      prompt,
      imageUrl,
      lastFrameImageUrl,
      referenceImages,
      aspectRatio,
      duration,
      mode,
      generateAudio,
      negativePrompt,
      seed,
    };
    const migration = skillBillingContext ? await (async () => {
      const childIdempotencyKey = `${idempotencyKey}:0`;
      const now = Date.now();
      const created = await createSkillPrepaidGeneration({
        id: taskId,
        userId: sessionUser.id,
        projectId,
        sessionId,
        messageId: typeof messageId === 'string' ? messageId : undefined,
        type: 'video',
        status: 'processing',
        providerId: provider.id,
        model: pureModel,
        progress: 0,
        label: `${modeLabel} - ${modelName}`,
        result: { taskEntryAudit, submissionPayload },
        creditStatus: 'not-applicable',
        creditCost: 0,
        idempotencyKey: childIdempotencyKey,
        requestDigest,
        createdAt: now,
        updatedAt: now,
      }, skillBillingContext, idempotencyKey);
      if (!created) {
        const existing = await getCloudTaskForUserByIdempotencyKey(sessionUser.id, childIdempotencyKey);
        if (!existing || existing.requestDigest !== requestDigest || existing.type !== 'video'
          || existing.providerId !== provider.id || existing.model !== pureModel) {
          throw new IdempotencyConflictError({
            userId: sessionUser.id,
            idempotencyKey: childIdempotencyKey,
            requestDigest,
            existingDigest: existing?.requestDigest || 'missing',
          });
        }
        taskId = existing.id;
        return { value: {
          taskId: existing.id,
          creditCost: 0,
          accepted: true,
          reused: true,
          status: existing.status,
        }, comparison: undefined };
      }
      return { value: {
        taskId,
        creditCost: 0,
        accepted: true,
        reused: false,
        status: 'processing' as const,
      }, comparison: undefined };
    })() : await executeTaskEntryMigration({
      mode: taskCoreMode,
      legacy: async () => {
        await recordVideoTaskSubmitted({
          taskId,
          userId: sessionUser?.id,
          projectId: typeof projectId === 'string' ? projectId : undefined,
          sessionId: typeof sessionId === 'string' ? sessionId : undefined,
          messageId: typeof messageId === 'string' ? messageId : undefined,
          providerId: provider.id,
          model: pureModel,
          label: `${modeLabel} - ${modelName}`,
          creditCost: plannedCreditCost,
          deferCreditCharge: true,
          taskEntryAudit,
          submissionPayload,
        });
        const charge = await chargeCloudTaskCredits(
          taskId,
          sessionUser?.id || 'anonymous',
          plannedCreditCost,
          `视频生成 - ${modelName}`,
        );
        return {
          taskId,
          creditCost: charge.creditCost,
          accepted: charge.charged,
          reused: false,
          status: 'processing' as const,
        };
      },
      coreV2: async () => {
        const now = Date.now();
        const admission = await createBillableTask({
          userId: sessionUser?.id || 'anonymous',
          idempotencyKey,
          requestDigest,
          creditCost: plannedCreditCost,
          task: {
            id: taskId,
            projectId: typeof projectId === 'string' ? projectId : undefined,
            sessionId: typeof sessionId === 'string' ? sessionId : undefined,
            messageId: typeof messageId === 'string' ? messageId : undefined,
            type: 'video',
            status: 'processing',
            providerId: provider.id,
            model: pureModel,
            remoteTaskId: taskId,
            progress: 0,
            label: `${modeLabel} - ${modelName}`,
            result: { taskEntryAudit, submissionPayload },
            createdAt: now,
            updatedAt: now,
          },
        });
        return {
          taskId: admission.task.id,
          creditCost: admission.task.creditCost || 0,
          accepted: admission.reused || admission.charged || plannedCreditCost === 0,
          reused: admission.reused,
          status: admission.task.status,
        };
      },
      factsFromResult: value => ({
        providerId: provider.id,
        modelId: pureModel,
        creditCost: value.creditCost,
        status: value.status === 'submitting'
          ? 'pending'
          : value.status === 'created' || value.status === 'uploading'
            ? 'processing'
            : value.status,
      }),
      previewCoreFacts: async () => ({
        providerId: provider.id,
        modelId: pureModel,
        creditCost: plannedCreditCost,
        status: 'processing',
      }),
    });
    taskId = migration.value.taskId;
    taskEntryAudit = createTaskEntryAudit({
      entry: 'video',
      mode: taskCoreMode,
      requestId,
      requestedProviderId: effectiveProviderId || undefined,
      requestedModelId: pureModel,
      actualProviderId: provider.id,
      actualModelId: pureModel,
      startedAt: taskStartedAt,
      creditCost: migration.value.creditCost,
      creditStatus: plannedCreditCost > 0 ? 'pending' : 'not-applicable',
      comparison: migration.comparison,
    });
    if (migration.comparison) {
      await updateCloudTask(taskId, { result: { taskEntryAudit } });
    }
    if (!migration.value.accepted) {
      await terminateCloudTaskAndRefund(taskId, 'cancelled', '视频生成积分扣费未完成，未向供应商提交任务');
      return NextResponse.json({
        error: '积分不足或积分服务暂不可用，未向视频供应商提交请求',
        retryable: true,
      }, { status: 402 });
    }
    if (migration.value.reused) {
      return NextResponse.json({
        taskId,
        shotId: shotId || null,
        status: migration.value.status,
        message: '已返回相同请求的现有视频任务',
        requestId,
        handlerVersion: taskEntryAudit.handlerVersion,
      });
    }
    registerTask(taskId, 'video', `${modeLabel} · ${modelName}`, sessionUser?.id);
    try {
      updateTaskProgress(taskId, {
        status: 'processing',
        progress: 0,
        creditCost: migration.value.creditCost,
      });
    } catch (error) {
      console.error('[video/generate] Cloud task submit persistence failed:', error);
      return NextResponse.json({
        error: '任务持久化失败，未向视频供应商提交请求',
        retryable: true,
      }, { status: 503 });
    }
    let skillPrepaidExecution: SkillPrepaidExecutionReference | undefined;
    // 6. 异步提交到第三方 API
    after(async () => {
      const submitController = new AbortController();
      registerTaskAbortController(taskId, submitController);
      try {
        if (skillBillingContext) {
          await waitForSkillVideoAcceptance(taskId, sessionUser!.id, submitController.signal);
          const workerId = randomUUID();
          const lease = await claimCloudTaskLease(taskId, workerId, 120_000);
          if (!lease) throw Object.assign(new Error('Skill video child lease is unavailable'), {
            code: 'SKILL_CHILD_LEASE_UNAVAILABLE',
          });
          skillPrepaidExecution = {
            taskId,
            workerId,
            attemptCount: lease.attemptCount,
            parentGeneration: skillBillingContext.executionFence.generation,
          };
        }
        updateTaskProgress(taskId, { progress: 5, label: `${modeLabel} · ${modelName} · 提交中...` });

        const req = buildVideoSubmitRequest(profile, videoParams);
        console.log(`[video/generate] Submit request: url=${req.url}, method=${req.method}`);
        const submitSignal = AbortSignal.any([submitController.signal, AbortSignal.timeout(30000)]);

        let response = skillPrepaidExecution
          ? await startSkillPrepaidProviderRequest({
              ...skillPrepaidExecution,
              userId: sessionUser!.id,
              providerId: provider.id,
              modelId: pureModel,
              requestBody: submissionPayload,
              signal: submitSignal,
            }, signal => fetch(req.url, {
              method: req.method,
              headers: req.headers,
              body: req.body,
              signal,
            }))
          : await fetch(req.url, {
              method: req.method,
              headers: req.headers,
              body: req.body,
              signal: submitSignal,
            });

        let usedImagesEndpoint = req.url.includes('/v1/images/');
        
        // Auto-fallback: try /v1/images/generations when /v1/video/generations fails
        // Many third-party API proxies only expose video models via the images endpoint
        if (!response.ok && !skillBillingContext && profile === 'rest-generic' && !req.url.includes('/v1/images/')) {
          const errorBody = await response.text().catch(() => '');
          const isModelNotFound = errorBody.includes('model_not_found') || errorBody.includes('Model not found');
          const isEndpointNotFound = response.status === 404;
          
          if (isEndpointNotFound || isModelNotFound || response.status === 503) {
            // Rebuild request body in OpenAI images/generations format
            const fallbackUrl = req.url.replace('/v1/video/generations', '/v1/images/generations');
            const fallbackBody: Record<string, string | number> = {
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
              signal: submitSignal,
            });
            usedImagesEndpoint = true;
          }
        }

        console.log(`[video/generate] Submit response: status=${response.status}, ok=${response.ok}`);

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error(`[video/generate] Submit failed (${response.status}): ${errorText.slice(0, 500)}`);
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
        console.log(`[video/generate] Parse submit result: taskId=${submitResult.taskId}, status=${submitResult.status}, videoUrl=${submitResult.videoUrl ? '(has url)' : '(none)'}, raw keys=${Object.keys(data).join(',')}`);
        console.log(`[video/generate] Raw submit response (first 500 chars): ${JSON.stringify(data).slice(0, 500)}`);

        // 同步返回：API直接返回了视频URL，无需轮询
        if (submitResult.status === 'succeeded' && submitResult.videoUrl) {
          const completedResult = {
            videoUrl: submitResult.videoUrl,
            model,
            modelName,
            providerId: provider.id,
            type: 'video',
          };
          const completed = await completeCloudTask(taskId, completedResult);
          if (!completed) return;
          updateTaskProgress(taskId, {
            status: 'completed',
            progress: 100,
            label: `${modeLabel} · ${modelName} · 已完成`,
            result: completedResult,
          });
          return;
        }

        if (!submitResult.taskId) {
          const missingTaskError = '提交视频生成任务失败：未获取到任务ID';
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
        // 注意：记录提交端点类型，以便轮询时选择正确的端点
        if (isTaskCancelled(taskId)) return;
        await recordVideoTaskRemotePolling(taskId, {
          remoteTaskId: submitResult.taskId,
          usedImagesEndpoint,
        });
        if (isTaskCancelled(taskId)) return;
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
      } catch (err: unknown) {
        const errorMsg = err instanceof Error && err.name === 'AbortError'
          ? '提交超时，请稍后重试'
          : errorMessage(err, '提交视频生成任务失败');
        const settled = await terminateCloudTaskAndRefund(taskId, 'failed', errorMsg);
        if (!settled.transitioned) return;
        updateTaskProgress(taskId, { status: 'failed', error: errorMsg, progress: 0 });
      } finally {
        if (skillPrepaidExecution) {
          await releaseCloudTaskLease(taskId, skillPrepaidExecution.workerId).catch(() => false);
        }
        unregisterTaskAbortController(taskId, submitController);
      }
    });

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
      requestId,
      handlerVersion: taskEntryAudit.handlerVersion,
    });
  } catch (err: unknown) {
    if (err instanceof ModelCapabilityError) {
      return modelCapabilityConfigurationErrorResponse(err, requestId);
    }
    console.error('[video/generate] Error:', err);
    // 记录操作日志 - 视频生成失败
    logError(OP_ACTIONS.VIDEO_GENERATE, err, {
      userId: sessionUser?.id || 'anonymous',
      userName: sessionUser?.name,
      targetType: 'video',
      durationMs: opTimer.end(),
    });
    const status = err instanceof SkillBillingAuthorizationError
      ? 403
      : err instanceof InsufficientCreditsError
      ? 402
      : err instanceof IdempotencyConflictError
        ? 409
        : 500;
    return NextResponse.json(
      { error: errorMessage(err, '视频生成请求失败'), requestId },
      { status },
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
