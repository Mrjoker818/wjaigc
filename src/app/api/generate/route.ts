import { NextRequest, NextResponse, after } from 'next/server';
import { createHash } from 'node:crypto';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, normalizeApiBaseUrl, findAllProvidersForType, findProviderById } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { identifyImageSubject } from '@/lib/identify-subject';
import { logOperation, logError, startTimer, OP_ACTIONS, sanitizeRequestData } from '@/lib/op-log';

import { getInternalRequestHeaders, requireApiAuthOrReject } from '@/lib/api-auth';
import { translateApiError } from '@/lib/api-error-translate';
import { classifyApiError, type ClassifiedError, isCloudflareTimeoutError, translateApiError as translateApiErrorV2 } from '@/lib/api-error-translator';
import { detectInvalidSizeError, repairSize, classifyImageModelFamily } from '@/lib/size-auto-repair';
import { fetchWithSmartRetry } from '@/lib/smart-retry';
import { streamResponsesApiSSE, buildResponsesApiPayload, extractImageUrlFromMarkdown, type ResponsesApiResult, type ResponsesApiSSEEvent } from '@/lib/responses-api-sse';
import { getModelCapabilities, filterRequestForModel, shouldUseResponsesAPI, shouldUseResponsesAPIForProvider, type ModelCapabilities, normalizeModelForApi } from '@/lib/model-capabilities';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { validateImageUrl } from '@/lib/input-validation';
import { calculateConfiguredCreditCost, checkCredits, consumeCredits } from '@/lib/credits';

import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, stripEditsOnlyFields, isEditsEndpointRejected, type ApiCompatProfile, resolveProfileForModel, isGeminiImageModel, isNanoBananaModel, buildGeminiChatImageRequest, parseGeminiChatImageResponse, tryChatCompletionsImageFallback, isChannelUnavailableError } from '@/lib/api-compatibility';
import { registerTask, updateTaskProgress, isTaskCancelled, getTaskInfo } from '@/lib/task-registry';
import { recordImageTaskSubmitted, recordImageTaskTerminal } from '@/lib/cloud-task-persistence';
import {
  exposeDurableDirectTask,
  publishGenerateTaskCandidates,
  publishDurableDirectTask,
} from '@/lib/task-core/task-service';
import {
  chargeCloudTaskCredits,
  getCloudTaskForUserByIdempotencyKey,
  terminateCloudTaskAndRefund,
  updateCloudTask,
} from '@/lib/cloud-task-storage';
import { persistRemoteImage } from '@/lib/s3-storage';
import { calculateActualPixelsFromRatio } from '@/lib/calculate-pixels';
import { RESOLUTION_TIER_MODELS, QUALITY_LEVEL_MODELS, getModelParamType, getProviderAspectRatios, normalizeImageGenerationSelection, ModelParamType } from '@/lib/canvas-generation-group';
import { buildGenerationRouteAudit } from '@/lib/generation-route-audit';
import { buildGenerationBatch } from '@/lib/generation-batch';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import {
  alignReferenceDescriptions,
  compileReferenceConstraints,
} from '@/lib/reference-constraint-compiler';

// 直接模式（OpenAI兼容API返回图片需60-120秒）
// 异步模式（返回task_id只需几秒）两者共存，取较大值
export const maxDuration = 1800; // 30分钟 - 支持apimart等慢速API出图260s+
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// 动态模型配置 - 不再硬编码任何特定提供商的模型信息
// ---------------------------------------------------------------------------

/**
 * 模型能力配置 - 由 API 兼容层和提供商信息动态推断
 * 不再硬编码特定提供商的模型列表，任何管理员添加的 API 都可自动适配
 */
interface ModelConfig {
  name: string;
  modelId: string;
  // 参数类型: resolution=分辨率档位(1K/2K/4K), quality=质量级别(auto/low/medium/high), none=不支持
  paramType: ModelParamType;
  // 该模型支持的尺寸列表（空数组表示支持所有通用尺寸）
  supportedSizes: string[];
  // 是否支持图生图
  supportsImageToImage: boolean;
  // 最大生成数量
  maxN: number;
  // 模型预估生成时间（秒），用于前端轮询策略
  estimatedTime: number;
}

// 通用支持的尺寸列表
/**
 * 根据模型ID和兼容性档案动态推断模型配置
 * - 不依赖任何硬编码的模型列表
 * - 根据模型名称关键词智能推断能力
 * - 所有管理员添加的 API 都可自动适配
 */
function inferModelConfig(modelId: string, profile: ApiCompatProfile, providerName?: string, providerHint = ''): ModelConfig {
  const id = (modelId || '').toLowerCase();

  // ★ 使用核心配置中的模型列表判断参数类型（保持与 UI 一致）
  // 核心改进：不再简单依赖关键词匹配，而是使用规范化的模型能力表
  const paramTypeFromConfig = getModelParamType(modelId, providerHint);
  const paramType: ModelConfig['paramType'] = paramTypeFromConfig;

  // 根据模型名称推断是否支持图生图
  // 大多数现代图像模型都支持图生图，只有极少数纯文生图模型不支持
  const supportsImageToImage = !id.includes('text-only') && !id.includes('txt2img-only');

  // 根据模型名称推断预估时间
  let estimatedTime = 30; // 默认30秒
  if (id.includes('flash')) {
    estimatedTime = 15;
  } else if (id.includes('pro') || id.includes('gpt-image')) {
    estimatedTime = 90;
  } else if (id.includes('flux') && id.includes('schnell')) {
    estimatedTime = 10;
  } else if (id.includes('flux') && id.includes('dev')) {
    estimatedTime = 30;
  } else if (id.includes('dall-e-3') || id.includes('dall-e-4')) {
    estimatedTime = 60;
  }

  // 根据兼容性档案调整
  if (profile.responseMode === 'direct') {
    // 直接返回模式的API通常需要更长的单次请求时间
    estimatedTime = Math.max(estimatedTime, 60);
  }

  return {
    name: providerName || modelId,
    modelId,
    paramType,
    supportedSizes: getProviderAspectRatios(modelId, providerHint),
    supportsImageToImage,
    maxN: 4,
    estimatedTime,
  };
}

export async function POST(request: NextRequest) {
  const opTimer = startTimer();
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    let deductedCredits = 0;
    let sessionUser: import('@/lib/user-types').User | null = null;
    const body = await request.json();
    // quality 需要在后续被模型别名的 resolutionTier 覆盖，所以单独用 let 声明
    const {
      prompt,
      aspectRatio = '1:1',
      size: requestedPixelSize, // 前端传递的像素格式尺寸（如 "4096x2304"），用于验证
      referenceImages,
      referenceMode,
      referenceCategories,
      referenceStrengths,
      referenceCategoryStrengths,
      referenceDescriptions,
      imageCategory, 
      productCategory, 
      stylePreset, 
      outputCount,
      n: requestedN,
      model: rawModel = 'gemini-2.5-flash-image-preview',
      userId: requestUserId,
      strength,
      providerId,
      submitOnly,
      generationChannel,
      projectId,
      sessionId,
      messageId,
      _skipCredits, // 内部标记：后台重试时跳过积分扣除（避免双重扣费）
      _skipCloudTaskPersistence,
      resolution, // GPT-Image系列分辨率档位参数（1K/2K/4K）
    } = body;
    // quality 默认值 '1K'，后续可能被模型别名 resolutionTier 覆盖
    // Canvas-era callers use `n`; the current panels use `outputCount`.
    // Normalize them before task fan-out so every entry point has identical behavior.
    const requestedOutputCount = outputCount ?? requestedN;
    let quality: string = typeof body.quality === 'string' ? body.quality : '1K';
    // resolution 默认值 '2K'（仅GPT-Image系列使用）
    let resolutionTier: string = resolution || '2K';
    // 诊断日志：显示接收到的参考图参数
    console.log(`[generate] model=${rawModel}, providerId=${providerId}, referenceImages.length=${referenceImages?.length || 0}, referenceMode=${referenceMode}`);
    // 必填参数校验
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ success: false, error: '请输入创意描述（prompt）' }, { status: 400 });
    }
    // 尺寸校验（允许像素格式 1024x1024 和宽高比格式 1:1 / 16:9）
    if (requestedPixelSize && requestedPixelSize !== 'auto'
      && !/^\d+x\d+$/.test(requestedPixelSize)
      && !/^\d+:\d+$/.test(requestedPixelSize)) {
      return NextResponse.json({ success: false, error: '尺寸格式无效，应为 宽x高（如 1024x1024）或比例格式（如 1:1）' }, { status: 400 });
    }
    // 参考图URL校验（过滤空字符串元素，避免前端删除后残留空元素）
    if (referenceImages && Array.isArray(referenceImages)) {
      const validRefs = referenceImages.filter(r => r && (typeof r === 'string' ? r.trim() !== '' : r?.url?.trim() !== ''));
      for (const ref of validRefs) {
        const urlErr = validateImageUrl(typeof ref === 'string' ? ref : ref?.url);
        if (urlErr) {
          return NextResponse.json({ success: false, error: `参考图URL无效: ${urlErr}` }, { status: 400 });
        }
      }
      // 更新referenceImages为有效元素（供后续逻辑使用）
      if (validRefs.length !== referenceImages.length) {
        console.log(`[generate] 过滤空参考图元素: ${referenceImages.length} → ${validRefs.length}`);
        // 直接修改body中的referenceImages（已在第197行解析）
      }
    }
    // 防御性处理：确保 model 是字符串（前端可能误传对象）
    let model = typeof rawModel === 'string' ? rawModel : (rawModel as Record<string, unknown>)?.model as string || String(rawModel || '');
    // ★ 从 model 中提取纯 modelId（前端可能传 providerId::modelId 格式）
    //   providerId 已通过独立的 providerId 字段传递，model 中不应包含前缀
    const extractedProviderId = model.includes('::') ? model.split('::')[0] : '';
    if (model.includes('::')) {
      model = model.split('::').pop()!;
      console.log(`[generate] Stripped provider prefix from model: "${rawModel}" → "${model}" (providerId via field: "${providerId || 'none'}")`);
    }
    // 如果 providerId 字段为空但从 model 中提取到了，自动回填
    const effectiveProviderId = providerId || extractedProviderId || '';

    // ★ 模型别名规范化：延迟到找到 provider 后再做精确匹配；初始仅推断 quality/resolution 后缀
    // 保留原始 modelId 用于 provider 匹配和精确比对
    const rawModelId = model;
    // 初次调用仅提取 quality/resolution 等信息，不剥离后缀（传空 providerModels 防止误剥离）
    let normalized = normalizeModelForApi(model, { providerModels: [] });

    // ★ 关键修复：模型别名可能携带分辨率后缀（如 gpt-image-2-4k → resolutionTier='4k'），
    // 需要覆盖默认 quality，否则会用 high/auto 导致分辨率只有1792而非4096
    // 注意：resolutionTier是normalizeModelForApi返回的小写值（如'4k'），需要统一大小写比较
    const tierUpper = normalized.resolutionTier?.toUpperCase();
    if (tierUpper && ['1K', '2K', '4K', '8K'].includes(tierUpper)) {
      if (quality.toUpperCase() === '1K' || quality === 'high' || quality === 'auto' || quality === 'medium' || quality === 'low') {
        console.log(`[generate] 模型别名分辨率覆盖: quality "${quality}" → "${tierUpper}"`);
        quality = tierUpper;
      }
    }

    // Content safety check
    const safetyResult = checkPromptSafety(prompt || '');
    if (safetyResult.level === 'block') {
      return NextResponse.json({ success: false, error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    sessionUser = await getSessionUser(request);
    const userId = sessionUser?.id ?? requestUserId ?? "anonymous";

    // An explicit provider/model pair is a user selection, not a fallback hint.
    // Validate it before task persistence and billing so stale browser state cannot
    // submit an unrelated model to the provider shown in the UI.
    let requestedProvider = null;
    if (effectiveProviderId) {
      requestedProvider = await findProviderById(effectiveProviderId);
      const selectedProviderModels = Array.isArray(requestedProvider?.selectedModels)
        ? requestedProvider.selectedModels
        : [];
      const requestedProviderModels = selectedProviderModels.length > 0
        ? selectedProviderModels
        : (requestedProvider?.discoveredModels || []).map(item => item.id);
      const normalizedRequestedModel = normalizeModelForApi(rawModelId, { providerModels: requestedProviderModels });
      const configuredModel = requestedProviderModels.find((configuredId) => {
        const configured = String(configuredId).toLowerCase();
        return configured === rawModelId.toLowerCase()
          || configured === normalizedRequestedModel.apiModelName.toLowerCase();
      });
      const providerKind = requestedProvider?.modelType || requestedProvider?.type || '';
      const supportsImageGeneration = ['image', 'universal', 'general', 'imageEdit'].includes(providerKind);

      if (!requestedProvider || !supportsImageGeneration || !configuredModel) {
        return NextResponse.json({
          success: false,
          code: 'MODEL_PROVIDER_MISMATCH',
          error: '所选模型已不在当前供应商的可用列表中，请刷新模型列表后重新选择',
          retryable: false,
          providerId: effectiveProviderId,
          model: rawModelId,
        }, { status: 400 });
      }

      // Preserve the configured identifier's casing and accepted alias form.
      model = configuredModel;
      normalized = normalizedRequestedModel;
    }

    // 图像模型权限校验：非管理员用户需检查 imageModels 授权列表
    if (sessionUser && sessionUser.role !== 'admin') {
      const allowed = sessionUser.imageModels;
      if (!isModelAssignedToUser(allowed, effectiveProviderId, model)) {
        return NextResponse.json({ success: false, error: '您没有权限使用此图像模型，请联系管理员' }, { status: 403 });
      }
    }

    // ★ 解析参考图片 URL（转换为 API 可访问的格式）
    // 必须在 submitOnly 检查之前完成，否则后台请求无法获得可访问的参考图 URL
    // 优化：并行处理所有参考图，加速提交
    const accessibleReferenceImages: string[] = [];
    if (referenceImages && Array.isArray(referenceImages)) {
      // 确保域名不重复包含协议：COZE_PROJECT_DOMAIN_DEFAULT 可能已含 https://
      const rawDomain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
      const domainBase = rawDomain.replace(/\/+$/, ''); // 去掉尾部斜杠

      const resolveImage = async (rawImg: unknown): Promise<string | null> => {
        const img = typeof rawImg === 'string' ? rawImg : (rawImg as { url?: string })?.url || String(rawImg);
        if (!img || typeof img !== 'string' || !img.trim()) return null;

        // 1. 相对路径 → 公网 URL 或 base64
        if (img.startsWith('/')) {
          if (domainBase) {
            // 确保不重复添加协议
            const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
            return `${base}${img}`;
          }
          try {
            const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
            const port = process.env.DEPLOY_RUN_PORT || 5000;
            const resp = await fetch(`${proto}://localhost:${port}${img}`, { signal: AbortSignal.timeout(5000) });
            const buf = Buffer.from(await resp.arrayBuffer());
            return `data:image/png;base64,${buf.toString('base64')}`;
          } catch { /* fallback below */ }
        }
        
        // 2. data: URL — 小于 2MB 直接传递（避免不必要的 save-image 网络往返）
        //    大于 2MB 才 save-image（防止请求体过大导致 413）
        if (img.startsWith('data:')) {
          if (img.length <= 2_000_000) {
            return img; // 直接传递，速度快
          }
          try {
            const saveResp = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/save-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(await getInternalRequestHeaders('system-save-image', 'admin')) },
              body: JSON.stringify({ imageData: img }),
            });
            if (saveResp.ok) {
              const saveData = await saveResp.json();
              if (saveData.url) {
                if (domainBase) {
                  const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
                  return `${base}${saveData.url}`;
                }
                return saveData.url;
              }
            }
          } catch { /* S3 not available */ }
        }

        // 3. 外部 URL 直接传递
        if (img.startsWith('http')) return img;

        // 4. 兜底 — 确保 URL 有协议前缀且不重复
        if (domainBase) {
          const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
          const path = img.startsWith('/') ? img : `/${img}`;
          return `${base}${path}`;
        }
        return img;
      };
      
      // 并行处理所有参考图（而非串行）
      const results = await Promise.all(referenceImages.map((ri: unknown) => resolveImage(ri)));
      for (const url of results) {
        if (url) accessibleReferenceImages.push(url);
      }
      console.log(`[generate] 解析参考图完成: ${referenceImages.length} 张输入 → ${accessibleReferenceImages.length} 张可访问`);
    }

    // ★ submitOnly 模式：立即注册任务并返回 taskId，后台执行实际生成
    // 解决 chat-tools 调用 /api/generate 时因第三方 API 响应慢（2-11分钟）导致 120s 超时的问题
    if (
      submitOnly
      && generationChannel !== 'canvas-direct'
      && process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER === 'true'
    ) {
      const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
      if (idempotencyKey) {
        const existing = await getCloudTaskForUserByIdempotencyKey(authResult.userId, idempotencyKey);
        if (existing) {
          return NextResponse.json({ success: true, taskId: existing.id, taskIds: [existing.id], reused: true });
        }
      }
      const asyncTaskId = `async-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // The outer task is the billable request. Charge before persisting it so a
      // resumed cloud worker inherits the exact amount already deducted.
      if (sessionUser && !_skipCredits) {
        const creditResult = await consumeCredits(sessionUser.id, 'image_generate', undefined, undefined, model || '', { quality, resolution, providerId: effectiveProviderId || undefined });
        if (!creditResult.success) {
          return NextResponse.json({ error: creditResult.message || '积分不足' }, { status: 402 });
        }
        deductedCredits = creditResult.cost;
      }
      const refundSubmitOnlyCredits = async (reason: string) => {
        if (deductedCredits <= 0 || !sessionUser) return;
        const { refundCredits } = await import('@/lib/credits');
        await refundCredits(sessionUser.id, deductedCredits, reason, asyncTaskId);
      };
      // Keep only the request fields required to resume provider submission after
      // a cloud runtime releases this request. Provider credentials stay server-side.
      const submissionPayload: Record<string, unknown> = {
        prompt,
        aspectRatio,
        size: requestedPixelSize,
        referenceImages: accessibleReferenceImages,
        referenceMode,
        referenceCategories,
        referenceStrengths,
        referenceCategoryStrengths,
        referenceDescriptions,
        imageCategory,
        productCategory,
        stylePreset,
        outputCount: requestedOutputCount,
        n: requestedN,
        model,
        providerId: effectiveProviderId,
        strength,
        quality,
        resolution: resolutionTier,
        projectId,
        sessionId,
        messageId,
        // 提交者模式：'local' = 本进程 after() 后台 worker 负责向供应商提交；
        // 'recovery' = 由 poll-task 的持久化恢复路径提交（默认，进程崩溃可恢复）。
        // poll-task 据此判断内存中的 pending 任务是否已有活着的提交者，防止重复提交扣费。
        workerMode: process.env.WUJIE_ENABLE_IN_PROCESS_ASYNC_WORKER === 'true' ? 'local' : 'recovery',
      };
      // Persist the client-facing outer task before the background request starts.
      // A provider can fail before it returns a remote task ID.
      try {
        // Return the client task ID only after its recovery record is durable.
        const taskCreated = await recordImageTaskSubmitted({
          taskId: asyncTaskId,
          userId: authResult.userId,
          projectId: typeof projectId === 'string' ? projectId : undefined,
          sessionId: typeof sessionId === 'string' ? sessionId : undefined,
          messageId: typeof messageId === 'string' ? messageId : undefined,
          providerId: effectiveProviderId,
          model,
          type: 'generate-async',
          label: '生成图片',
          idempotencyKey: idempotencyKey || undefined,
          submissionPayload,
          creditCost: deductedCredits,
        });
        if (!taskCreated) {
          const existing = idempotencyKey
            ? await getCloudTaskForUserByIdempotencyKey(authResult.userId, idempotencyKey)
            : null;
          if (existing) {
            await refundSubmitOnlyCredits(`图像生成任务冲突退款 (taskId: ${asyncTaskId})`);
            return NextResponse.json({ success: true, taskId: existing.id, taskIds: [existing.id], reused: true });
          }
          await refundSubmitOnlyCredits(`图像生成任务创建失败退款 (taskId: ${asyncTaskId})`);
          return NextResponse.json({
            success: false,
            error: '任务创建发生冲突，请使用相同请求键重试',
            retryable: true,
          }, { status: 503 });
        }
      } catch (error) {
        console.warn('[generate] submitOnly cloud task creation failed:', error);
        await refundSubmitOnlyCredits(`图像生成任务持久化失败退款 (taskId: ${asyncTaskId})`);
        return NextResponse.json({
          success: false,
          error: '任务暂时无法持久化，请稍后重试',
          retryable: true,
        }, { status: 503 });
      }
      registerTask(asyncTaskId, 'generate-async', '生成图片', userId);
      updateTaskProgress(asyncTaskId, { result: { submissionPayload } });
      const recordSubmitOnlyTerminal = async (
        input: Parameters<typeof recordImageTaskTerminal>[1],
      ) => {
        try {
          return await recordImageTaskTerminal(asyncTaskId, input);
        } catch (error) {
          console.warn('[generate] submitOnly cloud task terminal update failed:', error);
          return undefined;
        }
      };
      // 记录积分成本到任务信息中，用于取消时退款
      if (deductedCredits > 0) {
        updateTaskProgress(asyncTaskId, { creditCost: deductedCredits });
      }
      updateTaskProgress(asyncTaskId, { status: 'processing', progress: 0, label: '准备中...' });
      console.log(`[generate] submitOnly mode: taskId=${asyncTaskId}, returning immediately`);

      // ★ 后台执行生成逻辑（fire-and-forget）
      // 重新构造请求体，去掉 submitOnly 标志，添加 skipCredits（积分已在本次请求中扣除）
      // ★ 关键修复：使用解析后的 accessibleReferenceImages 替换原始 referenceImages
      const backgroundBody = {
        ...body,
        submitOnly: false,
        _skipCredits: true,
        _skipCloudTaskPersistence: true,
        // 使用解析后的可访问参考图 URL（而非原始相对路径或不可访问 URL）
        referenceImages: accessibleReferenceImages.length > 0 ? accessibleReferenceImages : undefined,
      };
      if (process.env.WUJIE_ENABLE_IN_PROCESS_ASYNC_WORKER === 'true') {
        after(async () => {
        try {
          const bgRes = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/generate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(await getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user')),
            },
            body: JSON.stringify(backgroundBody),
            signal: AbortSignal.timeout(600000), // 10分钟超时
          });
          console.log(`[generate] submitOnly bgRes status: ${bgRes.status}, ok: ${bgRes.ok}`);
          const bgData = await bgRes.json();
          const bgGenerationRouteAudit = bgData.generationRouteAudit;
          console.log(`[generate] submitOnly bgData keys: ${Object.keys(bgData).join(',')}, success: ${bgData.success}, taskIds: ${bgData.taskIds?.length || 0}`);

          if (!bgRes.ok || !bgData.success) {
            await recordSubmitOnlyTerminal({
              status: 'failed',
              error: typeof bgData.error === 'string' ? bgData.error : '生成失败',
              creditStatus: deductedCredits > 0 ? 'refunded' : 'not-applicable',
            });
            // 退款：生成失败时退还已扣除的积分
            if (deductedCredits > 0 && sessionUser) {
              try {
                const { refundCredits } = await import('@/lib/credits');
                await refundCredits(sessionUser.id, deductedCredits, `图像生成失败退款 (taskId: ${asyncTaskId})`, asyncTaskId);
                console.log(`[generate] Refunded ${deductedCredits} credits for failed task ${asyncTaskId}`);
              } catch (refundErr) {
                console.error('[generate] Refund failed:', refundErr);
              }
            }
            return;
          }

          // 如果有直接返回的图片URL（直接模式），标记完成
          if (bgData.directImageUrls?.length > 0) {
            const directUrls: string[] = bgData.directImageUrls;
            // ★ 检查是否还有异步 taskIds 需要轮询（混合模式：部分直接返回 + 部分异步）
            const asyncOnlyTaskIds: string[] = (bgData.taskIds || []).filter(
              (id: string) => !id.startsWith('direct-')
            );

            if (asyncOnlyTaskIds.length === 0) {
              // 纯直接模式：所有图片都已返回
              await recordSubmitOnlyTerminal({
                status: 'completed',
                imageUrl: directUrls[0],
                imageUrls: directUrls,
                creditStatus: deductedCredits > 0 ? 'charged' : 'not-applicable',
                generationRouteAudit: bgGenerationRouteAudit,
              });
              console.log(`[generate] submitOnly direct mode: ${directUrls.length} images for ${asyncTaskId}`);
              return;
            }

            // 混合模式：有直接返回的图片 + 还有异步任务需要轮询
            // 先标记已有图片，等异步任务完成后再合并
            console.log(`[generate] submitOnly mixed mode: ${directUrls.length} direct + ${asyncOnlyTaskIds.length} async for ${asyncTaskId}`);
            const mixedCollectedUrls: string[] = [...directUrls];
            updateTaskProgress(asyncTaskId, {
              status: 'processing',
              progress: Math.round((directUrls.length / (directUrls.length + asyncOnlyTaskIds.length)) * 80),
              label: `生成中 (${directUrls.length}/${directUrls.length + asyncOnlyTaskIds.length})`,
              result: {
                submissionPayload,
                usedModel: bgData.model,
                modelName: bgData.modelName,
                providerName: bgData.providerName,
                generationRouteAudit: bgGenerationRouteAudit,
                apiBaseUrl: bgData.apiBaseUrl,
                apiKey: bgData.apiKey,
                providerId: bgData.providerId,
                advancedParams: bgData.advancedParams,
              }
            });

            // 轮询异步任务
            const mixedBgModel = bgData.model || model;
            const mixedBgProviderId = bgData.providerId || effectiveProviderId;
            let mixedAttempts = 0;
            const mixedMaxAttempts = 120;
            const mixedPending = new Set(asyncOnlyTaskIds);
            const mixedResults = new Map<string, string[]>();

            while (mixedAttempts < mixedMaxAttempts && mixedPending.size > 0) {
              mixedAttempts++;
              await new Promise(r => setTimeout(r, mixedAttempts <= 3 ? 2000 : 5000));
              const pendingArr = Array.from(mixedPending);
              const roundResults = await Promise.all(pendingArr.map(async (taskId: string) => {
                try {
                  const pollRes = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/poll-task`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId, model: mixedBgModel, providerId: mixedBgProviderId, apiBaseUrl: bgData.apiBaseUrl, apiKey: bgData.apiKey }),
                  });
                  const pollData = await pollRes.json() as Record<string, unknown>;
                  const urls: string[] = [];
                  const pushValue = (value: unknown): void => {
                    if (typeof value === 'string' && value.length > 0) { urls.push(value); return; }
                    if (Array.isArray(value)) { value.forEach(pushValue); return; }
                    if (value && typeof value === 'object') {
                      const item = value as Record<string, unknown>;
                      pushValue(item.url || item.image_url || item.imageUrl || item.b64_json);
                    }
                  };
                  const resultObj = pollData.result as Record<string, unknown> | undefined;
                  pushValue(pollData.imageUrls);
                  pushValue(resultObj?.imageUrls);
                  pushValue(pollData.imageUrl || resultObj?.imageUrl);
                  if (pollData.status === 'completed' && urls.length > 0) return { completed: true, urls };
                  if (pollData.status === 'failed') return { completed: true, urls: [] };
                  return { completed: false, urls: [] };
                } catch { return { completed: false, urls: [] }; }
              }));
              for (let ri = 0; ri < roundResults.length; ri++) {
                if (roundResults[ri].completed) {
                  mixedResults.set(pendingArr[ri], roundResults[ri].urls);
                  mixedPending.delete(pendingArr[ri]);
                  mixedCollectedUrls.push(...roundResults[ri].urls);
                }
              }
              if (isTaskCancelled(asyncTaskId)) return;
            }

            // 合并所有结果
            const allUrls = Array.from(new Set(mixedCollectedUrls.filter(u => typeof u === 'string' && u.length > 0)));
            if (allUrls.length > 0) {
              await recordSubmitOnlyTerminal({
                status: 'completed',
                imageUrl: allUrls[0],
                imageUrls: allUrls,
                creditStatus: deductedCredits > 0 ? 'charged' : 'not-applicable',
                generationRouteAudit: bgGenerationRouteAudit,
              });
              console.log(`[generate] submitOnly mixed mode completed: ${allUrls.length} images for ${asyncTaskId}`);
            } else {
              await recordSubmitOnlyTerminal({ status: 'failed', error: '生成失败', creditStatus: deductedCredits > 0 ? 'refunded' : 'not-applicable' });
            }
            return;
          }

          // 如果有异步 taskIds，后台轮询直到完成
          const bgTaskIds: string[] = bgData.taskIds || [];
          console.log(`[generate] submitOnly bgTaskIds check: bgTaskIds.length=${bgTaskIds.length}, bgTaskIds=${JSON.stringify(bgTaskIds)}`);

          // ★ 关键修复：direct- 前缀的 taskId 表示生成已同步完成（直接模式），
          // 不需要远端轮询。直接从 task-registry 获取结果并标记 asyncTaskId 为完成。
          const directBgTaskIds = bgTaskIds.filter(id => id.startsWith('direct-'));
          if (directBgTaskIds.length > 0) {
            console.log(`[generate] submitOnly detected direct-mode bgTaskIds: ${JSON.stringify(directBgTaskIds)}`);
            const collectDirectResults = (): { imageUrls: string[]; result?: Record<string, unknown>; failed: boolean } => {
              const imageUrls: string[] = [];
              let result: Record<string, unknown> | undefined;
              let failed = false;
              for (const directTaskId of directBgTaskIds) {
                const directTask = getTaskInfo(directTaskId);
                if (directTask?.status === 'failed') failed = true;
                const directResult = directTask?.result as Record<string, unknown> | undefined;
                if (!result && directResult) result = directResult;
                if (Array.isArray(directResult?.imageUrls)) {
                  imageUrls.push(...directResult.imageUrls.filter((url): url is string => typeof url === 'string' && url.length > 0));
                }
                if (typeof directResult?.imageUrl === 'string' && directResult.imageUrl.length > 0) imageUrls.push(directResult.imageUrl);
              }
              return { imageUrls: Array.from(new Set(imageUrls)), result, failed };
            };
            const completeDirectTasks = async (
              imageUrls: string[],
              directResult?: Record<string, unknown>,
            ): Promise<void> => {
              await recordSubmitOnlyTerminal({ status: 'completed', imageUrl: imageUrls[0], imageUrls, creditStatus: deductedCredits > 0 ? 'charged' : 'not-applicable', generationRouteAudit: bgGenerationRouteAudit || directResult?.generationRouteAudit });
            };
            const immediateDirect = collectDirectResults();
            if (immediateDirect.imageUrls.length > 0) {
              await completeDirectTasks(immediateDirect.imageUrls, immediateDirect.result);
              return;
            }
            console.log('[generate] submitOnly direct tasks not yet completed, waiting...');
            for (let waitI = 0; waitI < 10; waitI++) {
              await new Promise(r => setTimeout(r, 1000));
              const waitedDirect = collectDirectResults();
              if (waitedDirect.imageUrls.length > 0) {
                await completeDirectTasks(waitedDirect.imageUrls, waitedDirect.result);
                return;
              }
              if (waitedDirect.failed) {
                await recordSubmitOnlyTerminal({ status: 'failed', error: '生成失败', creditStatus: deductedCredits > 0 ? 'refunded' : 'not-applicable' });
                return;
              }
            }
            console.warn('[generate] submitOnly direct tasks not completed after 10s, falling through to polling');
          }

          if (bgTaskIds.length > 0) {
            console.log(`[generate] submitOnly entering bgPoll loop for asyncTaskId=${asyncTaskId}, bgTaskId=${bgTaskIds[0]}`);
            updateTaskProgress(asyncTaskId, {
              status: 'processing',
              progress: 10,
              label: '生成中...',
              result: {
                submissionPayload,
                remoteTaskId: bgTaskIds[0],
                remoteTaskIds: bgTaskIds,
                usedModel: bgData.model,
                modelName: bgData.modelName,
                providerName: bgData.providerName,
                generationRouteAudit: bgGenerationRouteAudit,
                apiBaseUrl: bgData.apiBaseUrl,
                apiKey: bgData.apiKey,
                providerId: bgData.providerId,
                advancedParams: bgData.advancedParams,
              }
            });
            void updateCloudTask(asyncTaskId, {
              remoteTaskId: bgTaskIds[0],
              progress: 10,
              result: {
                submissionPayload,
                remoteTaskId: bgTaskIds[0],
                remoteTaskIds: bgTaskIds,
              },
            }).catch(error => console.warn('[generate] submitOnly remote task persistence failed:', error));

            // ★ 后台轮询：等待所有 bgTaskIds 完成，收集全部 imageUrl
            const bgPollModel = bgData.model || model;
            const bgPollProviderId = bgData.providerId || effectiveProviderId;
            let bgPollAttempts = 0;
            const bgMaxPollAttempts = 120;
            const htmlResponseRetryCount = 0;
            const maxHtmlResponseRetries = 5;
            const collectedImageUrls: string[] = [];
            const collectedMaskUrls: string[] = [];
            let allCompleted = false;
            let anyFailed = false;
            let failedError = '';

            // 辅助函数：从不同提供商的 poll 响应中提取全部图片 URL
            const extractImageUrls = (pollData: Record<string, unknown>): string[] => {
              const urls: string[] = [];
              const pushValue = (value: unknown): void => {
                if (typeof value === 'string' && value.length > 0) {
                  urls.push(value.startsWith('data:') || value.startsWith('http') || value.startsWith('/') ? value : `data:image/png;base64,${value}`);
                  return;
                }
                if (Array.isArray(value)) {
                  value.forEach(pushValue);
                  return;
                }
                if (value && typeof value === 'object') {
                  const item = value as Record<string, unknown>;
                  pushValue(item.url || item.image_url || item.imageUrl || item.b64_json);
                }
              };
              const resultObj = pollData.result as Record<string, unknown> | undefined;
              const dataObj = pollData.data as Record<string, unknown> | undefined;
              pushValue(pollData.imageUrls);
              pushValue(resultObj?.imageUrls);
              pushValue(dataObj?.imageUrls);
              pushValue(pollData.image_urls);
              pushValue(resultObj?.image_urls);
              pushValue(pollData.generated_images);
              pushValue(resultObj?.generated_images);
              pushValue(pollData.images);
              pushValue(resultObj?.images);
              pushValue(resultObj?.data);
              pushValue(pollData.output);
              pushValue(resultObj?.output);
              pushValue(pollData.imageUrl || resultObj?.imageUrl || dataObj?.imageUrl || pollData.url || resultObj?.url);
              return Array.from(new Set(urls));
            };

            // 轮询单个 bgTaskId，返回该远程任务的全部图片结果
            const pollSingleBgTask = async (taskId: string): Promise<{ completed: boolean; failed: boolean; imageUrls: string[]; maskUrls: string[]; error: string }> => {
              try {
                const pollRes = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/poll-task`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    taskId,
                    model: bgPollModel,
                    providerId: bgPollProviderId,
                    apiBaseUrl: bgData.apiBaseUrl,
                    apiKey: bgData.apiKey,
                  }),
                });
                const contentType = pollRes.headers.get('content-type') || '';
                const responseText = await pollRes.text();
                if (contentType.includes('text/html') || responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
                  return { completed: false, failed: false, imageUrls: [], maskUrls: [], error: '' };
                }
                const pollData = JSON.parse(responseText) as Record<string, unknown>;
                const imageUrls = extractImageUrls(pollData);
                const maskUrls = Array.from(new Set([
                  ...(Array.isArray(pollData.maskUrls) ? pollData.maskUrls : []),
                  ...(typeof pollData.maskUrl === 'string' ? [pollData.maskUrl] : []),
                ].filter((url): url is string => typeof url === 'string' && url.length > 0)));
                if (pollData.status === 'completed' && imageUrls.length > 0) {
                  return { completed: true, failed: false, imageUrls, maskUrls, error: '' };
                }
                if (pollData.status === 'failed') {
                  return { completed: false, failed: true, imageUrls: [], maskUrls: [], error: (pollData.error as string) || '生成失败' };
                }
                return { completed: false, failed: false, imageUrls: [], maskUrls: [], error: '' };
              } catch {
                return { completed: false, failed: false, imageUrls: [], maskUrls: [], error: '' };
              }
            };

            // 主轮询循环：每轮并行轮询所有未完成的 bgTaskIds
            const pendingSet = new Set(bgTaskIds);
            const collectedResults = new Map<string, { imageUrls: string[]; maskUrls: string[] }>();

            while (bgPollAttempts < bgMaxPollAttempts && pendingSet.size > 0) {
              bgPollAttempts++;
              await new Promise(r => setTimeout(r, bgPollAttempts <= 3 ? 2000 : 5000));

              const pendingArr = Array.from(pendingSet);
              const roundResults = await Promise.all(pendingArr.map(async (taskId) => {
                const r = await pollSingleBgTask(taskId);
                return { taskId, ...r };
              }));

              for (const r of roundResults) {
                if (r.failed) {
                  anyFailed = true;
                  failedError = r.error || failedError || '生成失败';
                  pendingSet.delete(r.taskId);
                } else if (r.completed) {
                  collectedResults.set(r.taskId, { imageUrls: r.imageUrls, maskUrls: r.maskUrls });
                  pendingSet.delete(r.taskId);
                }
              }

              // 更新进度
              const completedCount = bgTaskIds.length - pendingSet.size;
              const progressValue = 10 + Math.round((completedCount / bgTaskIds.length) * 80);
              updateTaskProgress(asyncTaskId, {
                progress: progressValue,
                label: `生成中 (${completedCount}/${bgTaskIds.length})`,
              });

              if (isTaskCancelled(asyncTaskId)) return;
            }

            // 收集结果（按原始顺序）
            for (const taskId of bgTaskIds) {
              const r = collectedResults.get(taskId);
              if (r) {
                collectedImageUrls.push(...r.imageUrls);
                collectedMaskUrls.push(...r.maskUrls);
              }
            }
            const uniqueImageUrls = Array.from(new Set(collectedImageUrls));
            const uniqueMaskUrls = Array.from(new Set(collectedMaskUrls));
            collectedImageUrls.splice(0, collectedImageUrls.length, ...uniqueImageUrls);
            collectedMaskUrls.splice(0, collectedMaskUrls.length, ...uniqueMaskUrls);

            allCompleted = pendingSet.size === 0 && collectedResults.size === bgTaskIds.length;

            if (allCompleted && collectedImageUrls.length > 0) {
              await recordSubmitOnlyTerminal({
                status: 'completed',
                imageUrl: collectedImageUrls[0],
                imageUrls: collectedImageUrls,
                maskUrl: collectedMaskUrls[0] || undefined,
                maskUrls: collectedMaskUrls,
                creditStatus: deductedCredits > 0 ? 'charged' : 'not-applicable',
              });
              console.log(`[generate] submitOnly all ${collectedImageUrls.length}/${bgTaskIds.length} tasks completed for ${asyncTaskId}`);
              return;
            }

            if (anyFailed) {
              await recordSubmitOnlyTerminal({ status: 'failed', error: failedError, creditStatus: deductedCredits > 0 ? 'refunded' : 'not-applicable' });
              if (deductedCredits > 0 && sessionUser) {
                try {
                  const { refundCredits } = await import('@/lib/credits');
                  await refundCredits(sessionUser.id, deductedCredits, `图像生成失败退款 (taskId: ${asyncTaskId})`, asyncTaskId);
                } catch (refundErr) { console.error('[generate] Refund failed:', refundErr); }
              }
              return;
            }

            await recordSubmitOnlyTerminal({ status: 'timeout', error: '生成超时', creditStatus: deductedCredits > 0 ? 'refunded' : 'not-applicable' });
            if (deductedCredits > 0 && sessionUser) {
              try {
                const { refundCredits } = await import('@/lib/credits');
                await refundCredits(sessionUser.id, deductedCredits, `图像生成超时退款 (taskId: ${asyncTaskId})`, asyncTaskId);
              } catch (refundErr) { console.error('[generate] Refund failed:', refundErr); }
            }
            return;
          }

          // 无图片也无 taskIds — 失败
          await recordSubmitOnlyTerminal({
            status: 'failed',
            error: '未获得生成结果',
            creditStatus: deductedCredits > 0 ? 'refunded' : 'not-applicable',
          });
          // 退款：无生成结果
          if (deductedCredits > 0 && sessionUser) {
            try {
              const { refundCredits } = await import('@/lib/credits');
              await refundCredits(sessionUser.id, deductedCredits, `图像生成无结果退款 (taskId: ${asyncTaskId})`, asyncTaskId);
            } catch (refundErr) { console.error('[generate] Refund failed:', refundErr); }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[generate] submitOnly background error for ${asyncTaskId}:`, msg);
          await recordSubmitOnlyTerminal({
            status: 'failed',
            error: msg,
            creditStatus: deductedCredits > 0 ? 'refunded' : 'not-applicable',
          });
          // 退款：异常失败
          if (deductedCredits > 0 && sessionUser) {
            try {
              const { refundCredits } = await import('@/lib/credits');
              await refundCredits(sessionUser.id, deductedCredits, `图像生成异常退款 (taskId: ${asyncTaskId})`, asyncTaskId);
            } catch (refundErr) { console.error('[generate] Refund failed:', refundErr); }
          }
        }
        });
      }

      // 立即返回，不等待后台完成
      return NextResponse.json({
        success: true,
        mode: 'polling',
        taskIds: [asyncTaskId],
        model: model,
        modelName: '',
        providerId: effectiveProviderId,
        estimatedTime: 90,
        submitOnly: true,
      });
    }

    if (submitOnly) {
      const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
      const requestedSlotCount = typeof requestedOutputCount === 'number'
        ? requestedOutputCount
        : Number(requestedOutputCount || 1);
      const batchSeed = idempotencyKey
        ? createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const generationBatch = buildGenerationBatch(`batch-${batchSeed}`, requestedSlotCount);
      const requestDigest = createHash('sha256').update(JSON.stringify({
        prompt,
        aspectRatio,
        size: requestedPixelSize,
        referenceImages: accessibleReferenceImages,
        referenceMode,
        referenceCategories,
        referenceStrengths,
        referenceCategoryStrengths,
        referenceDescriptions,
        imageCategory,
        productCategory,
        stylePreset,
        model,
        providerId: effectiveProviderId,
        strength,
        quality,
        resolution: resolutionTier,
        projectId,
      })).digest('hex');
      const childCreditCost = sessionUser && !_skipCredits
        ? await calculateConfiguredCreditCost(
            'image_generate',
            model || '',
            { quality, resolution: resolutionTier, providerId: effectiveProviderId || undefined },
          )
        : 0;

      if (sessionUser && childCreditCost > 0) {
        const creditCheck = await checkCredits(
          sessionUser.id,
          'image_generate',
          childCreditCost * generationBatch.slots.length,
        );
        if (!creditCheck.sufficient) {
          return NextResponse.json({
            error: `积分不足，需要 ${childCreditCost * generationBatch.slots.length} 积分，当前余额 ${creditCheck.balance} 积分`,
          }, { status: 402 });
        }
      }

      const submissionPayload: Record<string, unknown> = {
        prompt,
        aspectRatio,
        size: requestedPixelSize,
        referenceImages: accessibleReferenceImages,
        referenceMode,
        referenceCategories,
        referenceStrengths,
        referenceCategoryStrengths,
        referenceDescriptions,
        imageCategory,
        productCategory,
        stylePreset,
        outputCount: 1,
        n: 1,
        model,
        providerId: effectiveProviderId,
        strength,
        quality,
        resolution: resolutionTier,
        projectId,
        sessionId,
        messageId,
        requestDigest,
        workerMode: 'recovery',
      };
      const submittedSlots: Array<{
        slotId: string;
        slotIndex: number;
        taskId: string;
        status: 'submitting' | 'queued' | 'processing';
      }> = [];
      const pendingCharges: Array<{ taskId: string; slotId: string; slotIndex: number }> = [];

      for (const slot of generationBatch.slots) {
        const asyncTaskId = `async-${Date.now()}-${slot.index}-${Math.random().toString(36).slice(2, 8)}`;
        const childIdempotencyKey = idempotencyKey ? `${idempotencyKey}:${slot.index}` : undefined;
        const childPayload = {
          ...submissionPayload,
          batchId: generationBatch.batchId,
          slotId: slot.slotId,
          slotIndex: slot.index,
        };
        const taskCreated = await recordImageTaskSubmitted({
          taskId: asyncTaskId,
          userId: authResult.userId,
          projectId: typeof projectId === 'string' ? projectId : undefined,
          sessionId: typeof sessionId === 'string' ? sessionId : undefined,
          messageId: typeof messageId === 'string' ? messageId : undefined,
          providerId: effectiveProviderId,
          model,
          type: 'generate-async',
          label: `生成图片 ${slot.index + 1}/${generationBatch.slots.length}`,
          idempotencyKey: childIdempotencyKey,
          submissionPayload: childPayload,
          batchId: generationBatch.batchId,
          slotId: slot.slotId,
          slotIndex: slot.index,
          deferCreditCharge: true,
        });

        if (taskCreated) {
          submittedSlots.push({
            slotId: slot.slotId,
            slotIndex: slot.index,
            taskId: asyncTaskId,
            status: 'submitting',
          });
          pendingCharges.push({ taskId: asyncTaskId, slotId: slot.slotId, slotIndex: slot.index });
          continue;
        }

        const existing = childIdempotencyKey
          ? await getCloudTaskForUserByIdempotencyKey(authResult.userId, childIdempotencyKey)
          : null;
        const existingPayload = existing?.result?.submissionPayload as Record<string, unknown> | undefined;
        if (!existing || existingPayload?.requestDigest !== requestDigest) {
          await Promise.allSettled(pendingCharges.map(({ taskId }) => (
            terminateCloudTaskAndRefund(taskId, 'cancelled', '图像生成批次创建冲突，已取消未启动子任务')
          )));
          return NextResponse.json({
            success: false,
            error: '任务创建发生冲突，请使用新的请求键重试',
            retryable: true,
          }, { status: 409 });
        }

        submittedSlots.push({
          slotId: String(existingPayload.slotId || slot.slotId),
          slotIndex: typeof existingPayload.slotIndex === 'number' ? existingPayload.slotIndex : slot.index,
          taskId: existing.id,
          status: existing.status === 'pending' || existing.status === 'queued' ? 'submitting' : 'processing',
        });
        if (existing.status === 'pending' && existing.creditStatus === 'not-applicable') {
          pendingCharges.push({
            taskId: existing.id,
            slotId: String(existingPayload.slotId || slot.slotId),
            slotIndex: typeof existingPayload.slotIndex === 'number' ? existingPayload.slotIndex : slot.index,
          });
        }
      }

      for (const pendingCharge of pendingCharges) {
        const charge = await chargeCloudTaskCredits(
          pendingCharge.taskId,
          authResult.userId,
          childCreditCost,
          `图像生成 ${pendingCharge.slotIndex + 1}/${generationBatch.slots.length}`,
        );
        if (!charge.charged) {
          await Promise.allSettled(pendingCharges.map(({ taskId }) => (
            terminateCloudTaskAndRefund(taskId, 'cancelled', '图像生成批次扣费未完成，已取消未启动子任务')
          )));
          return NextResponse.json({
            success: false,
            error: '积分扣除未完成，未向供应商提交任务',
            retryable: true,
          }, { status: 402 });
        }

        registerTask(
          pendingCharge.taskId,
          'generate-async',
          `生成图片 ${pendingCharge.slotIndex + 1}/${generationBatch.slots.length}`,
          userId,
        );
        updateTaskProgress(pendingCharge.taskId, {
          status: 'processing',
          progress: 0,
          creditCost: charge.creditCost,
          result: {
            submissionPayload: {
              ...submissionPayload,
              batchId: generationBatch.batchId,
              slotId: pendingCharge.slotId,
              slotIndex: pendingCharge.slotIndex,
            },
          },
        });
      }

      return NextResponse.json({
        success: true,
        mode: 'polling',
        batchId: generationBatch.batchId,
        slots: submittedSlots,
        taskId: submittedSlots[0]?.taskId,
        taskIds: submittedSlots.map((slot) => slot.taskId),
        model,
        providerId: effectiveProviderId,
        estimatedTime: 90,
        submitOnly: true,
      });
    }

    // 获取所有可用的 image 类型 API 提供商和模型
    const allImageProviders = await findAllProvidersForType('image');
    
    // 尝试找到用户指定模型对应的 provider（优先使用 providerId 精确匹配）
    let provider = requestedProvider || await findProviderForModel(model, 'image', effectiveProviderId || undefined);
    let serverApiKey = provider?.apiKey;
    let apiBaseUrl = normalizeApiBaseUrl(provider?.baseUrl || '');
    
    // ★ 关键日志：记录实际使用的提供商信息，便于追踪
    console.log(`[generate] 提供商选择: model="${model}", requestedProviderId="${effectiveProviderId}", matched="${provider?.displayName || provider?.name || 'none'}", matchedId="${provider?.id || 'none'}", baseUrl="${apiBaseUrl}", hasApiKey=${!!serverApiKey}`);
    
    // 解析兼容性档案 - 决定 API 调用方式
    const initialProfile = resolveCompatProfile(provider);
    
    // ★ 二次精确规范化：使用 provider.selectedModels 列表做精确匹配
    // 关键修复：PearAPI 有独立的 gpt-image-2/gpt-image-2-2k/gpt-image-2-4k 模型，不能统一替换成 gpt-image-2
    // 只有当 provider 模型列表中不存在 exact 模型时，才使用别名映射
    const providerModels = Array.isArray(provider?.selectedModels) ? provider.selectedModels : [];
    normalized = normalizeModelForApi(rawModelId, { providerModels });
    model = normalized.apiModelName;
    if (normalized.wasNormalized) {
      console.log(`[generate] 模型规范化: "${rawModelId}" → "${model}" (在提供商列表中精确匹配: ${providerModels.some(m => String(m).toLowerCase() === rawModelId.toLowerCase()) ? '是' : '否'})`);
    }
    
    const providerHint = `${provider?.id || effectiveProviderId} ${provider?.displayName || provider?.name || ''} ${provider?.baseUrl || apiBaseUrl}`;
    let modelConfig = inferModelConfig(model, initialProfile, provider?.displayName, providerHint);
    const requestedRoute = {
      providerId: effectiveProviderId || provider?.id || 'unresolved-provider',
      providerName: provider?.displayName || provider?.name || effectiveProviderId || '未匹配提供商',
      modelId: rawModelId || model,
      modelName: rawModelId || model,
    };
    let fallbackReason: string | undefined;

    // 构建备选模型列表（排除当前模型，优先管理员配置的模型）
    const candidateModels: { modelId: string; apiKey: string; baseUrl: string; providerId: string; displayName: string; advancedParams?: Record<string, string> }[] = [];
    for (const p of allImageProviders) {
      for (const m of p.models) {
        if (m !== model) {
          candidateModels.push({
            modelId: m,
            apiKey: p.provider.apiKey,
            baseUrl: normalizeApiBaseUrl(p.provider.baseUrl),
            providerId: p.provider.id || 'unknown',
            displayName: p.provider.displayName || m,
            advancedParams: p.provider.advancedParams,
          });
        }
      }
    }

    if (!serverApiKey || !apiBaseUrl) {
      if (effectiveProviderId) {
        return NextResponse.json({
          success: false,
          error: '所选供应商或模型当前不可用，请检查管理员后台的模型配置和凭证后重试',
          requiresApiKey: true,
          providerId: effectiveProviderId,
          modelName: modelConfig.name,
        }, { status: 400 });
      }
      // 没有找到指定模型的凭证，尝试使用第一个可用的备选模型
      if (candidateModels.length > 0) {
        const fallback = candidateModels.shift()!;
        console.log(`指定模型 ${model} 无凭证，自动切换到 ${fallback.modelId}`);
        fallbackReason = `请求的提供商或模型未配置可用凭证，已切换到 ${fallback.displayName} / ${fallback.modelId}`;
        serverApiKey = fallback.apiKey;
        apiBaseUrl = normalizeApiBaseUrl(fallback.baseUrl);
        const fallbackProfile = resolveCompatProfile({ baseUrl: fallback.baseUrl, advancedParams: fallback.advancedParams });
        modelConfig = inferModelConfig(fallback.modelId, fallbackProfile, fallback.displayName, `${fallback.providerId} ${fallback.displayName} ${fallback.baseUrl}`);
        provider = {
          id: fallback.providerId,
          name: fallback.displayName,
          apiKey: fallback.apiKey,
          baseUrl: fallback.baseUrl,
          displayName: fallback.displayName,
          isEnabled: true,
          type: 'image' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      } else {
        return NextResponse.json({
          success: false,
          error: `选择当前模型需要在管理员后台配置可用凭证`,
          requiresApiKey: true,
          modelName: modelConfig.name,
        }, { status: 400 });
      }
    }

    // 积分扣除（移到凭证验证之后，避免凭证无效时误扣积分）
    // _skipCredits: 后台 submitOnly 重试时已扣过积分，跳过
    deductedCredits = 0;
    if (sessionUser && !_skipCredits) {
      const modelId = model || '';
      const creditResult = await consumeCredits(sessionUser.id, 'image_generate', undefined, undefined, modelId, { quality, resolution: resolutionTier, providerId: effectiveProviderId || undefined });
      if (!creditResult.success) {
        return NextResponse.json({ error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    // 构建增强的 prompt
    let enhancedPrompt = prompt;
    
    const categoryHints: Record<string, string> = {
      'general': '通用场景',
      'portrait': '人物肖像，面部细节精细',
      'landscape': '风景摄影，自然光影',
      'architecture': '建筑摄影，透视精准',
      'product': '产品摄影，商业级质感',
      'food': '美食摄影，色彩诱人',
      'fashion': '时尚摄影，杂志质感',
      'animal': '动物摄影，生动自然',
    };
    
    if (imageCategory && categoryHints[imageCategory] && imageCategory !== 'general') {
      enhancedPrompt = `${enhancedPrompt}, ${categoryHints[imageCategory]}`;
    }
    
    if (productCategory && productCategory.trim() && productCategory.trim().toLowerCase() !== 'none') {
      enhancedPrompt = `${enhancedPrompt}, product category: ${productCategory}`;
    }
    
    const styleHints: Record<string, string> = {
      'photography': '摄影质感，专业相机拍摄效果',
      '3d_render': '3D渲染效果，CG质感',
      'anime': '动漫风格，二次元',
      'illustration': '插画风格，手绘质感',
      'watercolor': '水彩画风格，柔和通透',
      'oil_painting': '油画质感，笔触感强',
      'ink_painting': '水墨国风，传统东方美学',
      'cyberpunk': '赛博朋克风格，霓虹科技',
      'minimalist': '极简风格，留白大方',
      'vintage': '复古怀旧，胶片质感',
      'luxury': '高端奢华，金色质感',
      'cartoon': '卡通可爱，萌系风格',
    };
    
    if (stylePreset !== 'auto' && styleHints[stylePreset]) {
      enhancedPrompt = `${enhancedPrompt}，${styleHints[stylePreset]}`;
    }

    // ── Auto-identify reference image subjects via AI vision ──
    // When referenceImages exist but lack descriptions, use AI vision to identify
    // what's in the image, preventing subject misidentification (e.g. medicine→cosmetics)
    const refDescArr = alignReferenceDescriptions(
      Array.isArray(referenceImages) ? referenceImages : [],
      referenceDescriptions,
    );

    if (referenceImages && referenceImages.length > 0) {
      const missingDescriptionIndexes = referenceImages.flatMap((_: string, index: number) => (
        refDescArr[index] ? [] : [index]
      ));
      if (missingDescriptionIndexes.length > 0) {
        console.info(`[generate] Auto-identifying ${missingDescriptionIndexes.length} reference image(s) via AI vision`);
        try {
          const identifyPromises = missingDescriptionIndexes.map(async (index: number) => {
            try {
              const result = await identifyImageSubject(referenceImages[index], 8000);
              return result ? result.en : null;
            } catch (err) {
              console.warn(`[generate] Vision identification failed for image ${index}:`, err);
              return null;
            }
          });
          const identifiedResults = await Promise.all(identifyPromises);

          missingDescriptionIndexes.forEach((referenceIndex: number, resultIndex: number) => {
            const identified = identifiedResults[resultIndex];
            if (identified) {
              refDescArr[referenceIndex] = identified;
            }
          });
          console.info(`[generate] Identified subjects: ${refDescArr.filter(Boolean).join('; ')}`);
        } catch (err) {
          console.warn('[generate] Batch vision identification failed (non-critical):', err);
        }
      }
    }
    const refDescText = refDescArr.filter(Boolean).join('; ');

    // 融合模式增强提示词 - 明确指导模型如何融合参考图
    if (referenceMode === 'fusion' && referenceImages && referenceImages.length > 1) {
      const fusionDescHint = refDescText ? ` The reference images depict: "${refDescText}".` : '';
      enhancedPrompt = `[FUSION MODE] Combine and merge ${referenceImages.length} reference images into a single cohesive composition.${fusionDescHint} ${enhancedPrompt}. Seamlessly blend all visual elements together, maintaining the key characteristics of each reference while creating a unified, natural result.`;
    }

    // 参考图增强：无分类或空分类时，使用描述文本增强；有分类时使用分类增强
    const hasCategories = referenceCategories && (
      (Array.isArray(referenceCategories) && referenceCategories.length > 0) ||
      (!Array.isArray(referenceCategories) && Object.keys(referenceCategories as Record<string, unknown>).length > 0)
    );
    const compiledReferenceConstraints = referenceImages && referenceImages.length > 0 && hasCategories
      ? compileReferenceConstraints({
          providerId: effectiveProviderId,
          providerName: provider?.displayName || provider?.name,
          modelId: modelConfig.modelId,
          referenceImages,
          referenceDescriptions: refDescArr,
          referenceCategories: referenceCategories as Record<string, string[]> | string[][],
          referenceStrengths,
          referenceCategoryStrengths,
        })
      : null;

    if (compiledReferenceConstraints?.hasActiveConstraints) {
      enhancedPrompt = `[REFERENCE MODE] ${compiledReferenceConstraints.prompt} ${enhancedPrompt}`;
    }

    if (referenceImages && referenceImages.length > 0 && !hasCategories && !compiledReferenceConstraints?.hasActiveConstraints) {
      // 无分类模式：使用参考图描述增强提示词
      if (refDescText) {
        enhancedPrompt = `[REFERENCE MODE] The reference image depicts: "${refDescText}". You MUST preserve the main subject identity — do NOT replace it with a different object. ${enhancedPrompt}`;
      } else {
        // 即使没有描述，也必须添加基本参考指令，确保API理解参考意图
        enhancedPrompt = `[REFERENCE MODE] CRITICAL INSTRUCTION — Reference image(s) are provided as the PRIMARY source of truth. You MUST: (1) Identify and preserve the EXACT main subject from the reference — do NOT substitute a different object, person, or scene. (2) Maintain the overall composition and framing. (3) Apply the user's prompt as a MODIFICATION to the reference, not as a replacement. If the prompt is vague, lean toward minimal changes from the reference. ${enhancedPrompt}`;
      }
    }

    // 参考图分类增强 - 基于前端传递的分类和强度，增强提示词让AI正确理解参考意图
    if (referenceImages && referenceImages.length > 0 && hasCategories && !compiledReferenceConstraints?.hasActiveConstraints) {
      // 规范化分类键：中文→英文
      const normalizeCategory = (key: string): string => {
        const cnToEn: Record<string, string> = {
          '风格': 'style', '构图': 'composition', '场景': 'scene',
          '色彩': 'color', '主体': 'subject', '细节': 'detail',
        };
        return cnToEn[key] || key;
      };

      // 英文分类描述
      const categoryDescMap: Record<string, string> = {
        'style': 'artistic style and visual aesthetics',
        'composition': 'composition and layout structure',
        'scene': 'scene and environment setting',
        'color': 'color palette and tone',
        'subject': 'main subject and focal point',
        'detail': 'fine details and textures',
      };

      // 收集所有激活的规范分类及其最大强度
      const activeCatStrengths: Record<string, number> = {};
      const strengths = referenceStrengths as number[] | undefined;
      const categoryStrengthsByImage = referenceCategoryStrengths
        && typeof referenceCategoryStrengths === 'object'
        && !Array.isArray(referenceCategoryStrengths)
        ? referenceCategoryStrengths as Record<string, Record<string, unknown>>
        : undefined;

      for (const [imgIdx, cats] of Object.entries(referenceCategories as Record<string, string[]>)) {
        if (Array.isArray(cats)) {
          for (const cat of cats) {
            const normKey = normalizeCategory(cat);
            const perCategoryStrength = categoryStrengthsByImage?.[imgIdx]?.[cat]
              ?? categoryStrengthsByImage?.[imgIdx]?.[normKey];
            const rawStrength = typeof perCategoryStrength === 'number'
              ? perCategoryStrength
              : strengths?.[Number(imgIdx)] ?? 0;
            const imgStrength = Math.max(0, Math.min(100, rawStrength));
            if (imgStrength <= 0) continue; // 0% strength = not active, skip
            activeCatStrengths[normKey] = Math.max(activeCatStrengths[normKey] || 0, imgStrength);
          }
        }
      }

      const activeKeys = Object.keys(activeCatStrengths);
      if (activeKeys.length > 0) {
        // 构建保留方面的指令
        const preserveParts: string[] = [];
        const freeParts: string[] = [];

        for (const [catKey, catDesc] of Object.entries(categoryDescMap)) {
          if (activeCatStrengths[catKey] !== undefined) {
            const s = activeCatStrengths[catKey];
            if (s >= 80) preserveParts.push(`strictly preserve the ${catDesc} of the reference image`);
            else if (s >= 50) preserveParts.push(`maintain the ${catDesc} of the reference image`);
            else if (s >= 20) preserveParts.push(`subtly reference the ${catDesc} of the reference image`);
            else preserveParts.push(`lightly hint at the ${catDesc} of the reference image`);
          } else {
            freeParts.push(catDesc);
          }
        }

        // 判断是否包含"主体"保留
        const hasSubjectPreserve = activeCatStrengths['subject'] !== undefined;
        // 主体描述锚定：使用AI视觉识别+前端描述的合并结果，防止主体被替换
        const subjectAnchor = refDescText ? ` The reference image depicts: "${refDescText}".` : '';
        const subjectPrefix = hasSubjectPreserve
          ? `CRITICAL: The main subject (product/object/person) must remain EXACTLY the same as in the reference image — it is "${refDescText || 'the depicted item'}", same identity, same appearance. Do NOT replace or change the subject to a different object.${subjectAnchor} `
          : (refDescText ? `The reference image depicts: "${refDescText}". ` : '');

        let categoryEnhancement = '';
        if (preserveParts.length > 0) {
          categoryEnhancement += `${subjectPrefix}You MUST use the provided reference image(s) as the mandatory source. ${preserveParts.join('. ')}.`;
        }
        if (freeParts.length > 0) {
          categoryEnhancement += ` You may reimagine the ${freeParts.join(', ')}.`;
        }

        if (categoryEnhancement) {
          enhancedPrompt = `[REFERENCE MODE] ${categoryEnhancement} ${enhancedPrompt}`;
        }
      } else {
        // 有分类但所有强度为0或分类为空对象 — 使用描述兜底
        if (refDescText) {
          enhancedPrompt = `[REFERENCE MODE] The reference image depicts: "${refDescText}". You MUST preserve the main subject identity — do NOT replace it with a different object. ${enhancedPrompt}`;
        } else {
          enhancedPrompt = `[REFERENCE MODE] Use the provided reference image(s) as the primary guide. Preserve the main subject, style, and composition from the reference. ${enhancedPrompt}`;
        }
      }
    }

    // 验证尺寸是否支持
    // Normalize stale state before a request reaches the provider. This covers
    // old browser state and workflow payloads as well as the current UI.
    const activeProviderHint = `${provider?.id || effectiveProviderId} ${provider?.displayName || provider?.name || ''} ${provider?.baseUrl || apiBaseUrl}`;
    const normalizedSelection = normalizeImageGenerationSelection(modelConfig.modelId, activeProviderHint, {
      aspectRatio: aspectRatio || '1:1',
      quality,
      resolution: resolutionTier,
    });
    const requestedSize = normalizedSelection.aspectRatio;
    quality = normalizedSelection.quality;
    resolutionTier = normalizedSelection.resolution;
    
    // 设置生成数量 - 不受模型maxN限制，因为我们逐个提交任务(n=1)
    const totalCount = typeof requestedOutputCount === "number" && Number.isFinite(requestedOutputCount) && requestedOutputCount >= 1
      ? Math.min(Math.floor(requestedOutputCount), 10)
      : 1;

    // 判断 URL 是否使用私有 IP（10.x / 172.16-31.x / 192.168.x / 127.x）
    const isPrivateIp = (urlStr: string): boolean => {
      try {
        const host = new URL(urlStr).hostname;
        return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(host);
      } catch { return false; }
    };

    // 服务器端代理下载图片并保存为可访问 URL（处理私有 IP 图片 URL 等场景）
    const downloadAndSaveImage = async (imageUrl: string): Promise<string | null> => {
      try {
        const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
        if (!resp.ok) return null;
        const contentType = resp.headers.get('content-type') || '';
        if (!contentType.startsWith('image/') && !contentType.includes('octet-stream')) return null;
        const buffer = Buffer.from(await resp.arrayBuffer());
        if (buffer.length < 100) return null; // 太小，不是有效图片
        // 通过 /api/save-image 持久化
        const saveResp = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/save-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getInternalRequestHeaders('system-save-image', 'admin')) },
          body: JSON.stringify({
            imageData: `data:${contentType.includes('png') ? 'image/png' : contentType.includes('webp') ? 'image/webp' : 'image/jpeg'};base64,${buffer.toString('base64')}`,
          }),
        });
        if (!saveResp.ok) return null;
        const saveData = await saveResp.json();
        return saveData.url || saveData.savedUrl || null;
      } catch (e) {
        console.error('[generate] downloadAndSaveImage failed:', (e as Error).message);
        return null;
      }
    };

    // 构建提交任务的辅助函数 — 单次提交可能返回多张图片/多个taskId
    const submitSingleTask = async (
      currentModelConfig: ModelConfig,
      currentApiKey: string,
      currentApiBaseUrl: string,
      currentProviderId: string,
      requestN: number,
      currentProvider?: { baseUrl?: string; requestStyle?: string; advancedParams?: Record<string, string> } | null,
    ): Promise<{ taskIds: string[]; directImageUrls: string[]; usedModel: string; usedProviderId: string }> => {
      // 解析兼容性档案 - 由提供商配置和模型类型共同决定 API 调用方式
      // 关键改进：对于 Gemini 图像模型，如果提供商不支持 /images/generations，
      // 自动切换到 gemini-image profile（通过 /chat/completions 生图）
      const profile: ApiCompatProfile = resolveProfileForModel(
        currentModelConfig.modelId,
        currentProvider,
      );
      const isGeminiImageRoute = profile.id === 'gemini-image';

      const effectiveSize = currentModelConfig.supportedSizes.includes(requestedSize) 
        ? requestedSize 
        : currentModelConfig.supportedSizes[0] || '1:1';

      // ★ 关键修复：优先使用后端规范表计算像素尺寸（传入 modelId），
      // 确保与 API 官方文档一致；前端传来的 requestedPixelSize 仅作兜底
      const calculatedPixelSize = calculateActualPixelsFromRatio(effectiveSize, quality, currentModelConfig.modelId);
      const pixelSize = calculatedPixelSize || requestedPixelSize;

      // ★ 关键修复：根据 profile.sizeFormat 决定发送哪种格式
      // - 'aspect-ratio' → 发送宽高比格式（如 "16:9"），APImart MJ/SD等模型需要
      // - 'pixel' → 发送像素格式（如 "1024x1024"），OpenAI等模型需要
      const finalSize = profile.sizeFormat === 'aspect-ratio' 
        ? effectiveSize  // MJ等模型使用宽高比
        : (pixelSize || effectiveSize);  // OpenAI等模型使用像素

      const requestBody: Record<string, unknown> = {
        model: currentModelConfig.modelId,
        prompt: enhancedPrompt,
        n: requestN,
        size: finalSize,
      };

      // 像素辅助字段（仅当有像素尺寸时添加）
      if (pixelSize && /^\d+x\d+$/.test(pixelSize)) {
        requestBody.width = parseInt(pixelSize.split('x')[0]);
        requestBody.height = parseInt(pixelSize.split('x')[1]);
        requestBody.size_px = pixelSize;
      }

      // quality / resolution 参数
      if (quality) {
        const qualityMap: Record<string, string> = {
          '1K': 'low', '2K': 'medium', '4K': 'high',
          'standard': 'auto', 'high': 'high', 'auto': 'auto',
          'low': 'low', 'medium': 'medium',
        };

        // ★ resolution参数映射：统一使用大写 '1K/2K/4K' 格式
        // APImart/PearAPI 官方文档明确要求大写（示例：{"resolution":"2K"}），禁止小写
        const resolutionMap: Record<string, string> = {
          'high': '2K', 'medium': '1K', 'low': '1K', 'auto': '2K',
          '4K': '4K', '2K': '2K', '1K': '1K', 'ultra': '4K', 'hd': '4K',
          'standard': '1K',
        };

        if (currentModelConfig.paramType === 'quality') {
          requestBody.quality = qualityMap[quality] || quality;
        } else if (currentModelConfig.paramType === 'resolution') {
          // ★ 将 quality 参数转换为 API 期望的 resolution 格式（大写）
          requestBody.resolution = resolutionMap[quality] || quality;
          requestBody.quality = qualityMap[quality] || quality;
        } else if (currentModelConfig.paramType === 'both') {
          // GPT-Image系列同时支持resolution和quality两种参数
          // resolution控制输出尺寸档位（1K/2K/4K），quality控制生成细节质量
          // ★ 统一使用大写格式，APImart/PearAPI 文档均要求大写
          requestBody.resolution = resolutionTier;
          requestBody.quality = qualityMap[quality] || quality; // 使用前端传递的质量级别
        } else {
          // paramType === 'none' — send both for maximum compatibility
          requestBody.quality = qualityMap[quality] || quality;
        }
      }

      // ★ 诊断日志：记录发送给 API 的关键分辨率参数，便于排查“用户设置4K但实际生成1K”问题
      console.log(`[generate] Resolution params → model: ${currentModelConfig.modelId}, paramType: ${currentModelConfig.paramType}, quality: ${quality}, effectiveSize: ${effectiveSize}, pixelSize: ${pixelSize || 'null'}, finalSize: ${finalSize}, profile.sizeFormat: ${profile.sizeFormat}, requestBody.size: ${requestBody.size}, requestBody.resolution: ${requestBody.resolution || 'N/A'}, requestBody.width: ${requestBody.width || 'N/A'}, requestBody.height: ${requestBody.height || 'N/A'}`);

      // 添加参考图片
      const hasRefImages = accessibleReferenceImages.length > 0 && currentModelConfig.supportsImageToImage;
      // ★ 参考图模式 vs 图片编辑模式的关键区别：
      // - 参考图模式(reference/fusion/style/blend/content)：用户希望基于参考图生成新图，需要设置 image 字段
      //   使用 /images/edits 端点，确保 API 能看到并处理参考图
      // - 图片编辑模式(erase/mask/outpaint)：用户要求在原图基础上修改，必须设置 image 字段
      //   使用 /images/edits 端点，强制 AI 处理源图
      // ★ 重要：之前的实现中参考图模式不设置 image 字段，走 /images/generations 端点，
      //   但该端点不支持图片输入（忽略 image_urls/images[]），导致参考图完全丢失！
      const isReferenceOnly = !referenceMode || ['reference', 'fusion', 'style', 'blend', 'content'].includes(referenceMode);

      // ★ 辅助函数：将图片 URL 转为 base64 data URL（确保第三方 API 一定能收到图片内容）
      // 第三方 API 可能无法访问 coze.site 域名的 URL，转 base64 是最可靠的方式
      const resolveImageToBase64 = async (imgUrl: string): Promise<string | null> => {
        if (imgUrl.startsWith('data:')) return imgUrl;
        try {
          // ★ 关键修复：识别同域名的 /api/serve-upload/ URL，直接读取本地文件（避免通过公网域名fetch自己失败）
          const localPathMatch = imgUrl.match(/\/api\/serve-upload\/(.+)$/);
          if (localPathMatch) {
            const fs = await import('fs/promises');
            const path = await import('path');
            const relativePath = localPathMatch[1];
            const { getServerDataRoot } = await import('@/lib/server-data-root');
            const dataRoot = getServerDataRoot();
            const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
            const publicDir = path.join(workspacePath, 'public');
            // 尝试多个可能的本地路径
            const candidates = [
              path.join(dataRoot, 'uploads', relativePath.replace(/^uploads\//, '')),
              path.join(dataRoot, relativePath),
              path.join(publicDir, relativePath),
              path.join(publicDir, 'uploads', relativePath.replace(/^uploads\//, '')),
            ];
            for (const candidate of candidates) {
              try {
                await fs.access(candidate);
                const resolved = path.resolve(candidate);
                if (resolved.startsWith(publicDir) || resolved.startsWith(dataRoot)) {
                  const imgBuf = await fs.readFile(resolved);
                  const ext = path.extname(resolved).toLowerCase();
                  const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
                  const mime = mimeMap[ext] || 'image/png';
                  console.log('[generate] Resolved serve-upload image locally:', relativePath, '→', candidate, 'size:', imgBuf.length);
                  return `data:${mime};base64,${imgBuf.toString('base64')}`;
                }
              } catch { /* try next */ }
            }
            // 如果本地文件找不到，回退到 localhost fetch
            try {
              const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
              const port = process.env.DEPLOY_RUN_PORT || 5000;
              const localUrl = `${proto}://localhost:${port}/api/serve-upload/${relativePath}`;
              const localResp = await fetch(localUrl, { signal: AbortSignal.timeout(8000) });
              if (localResp.ok) {
                const imgBuf = Buffer.from(await localResp.arrayBuffer());
                const contentType = localResp.headers.get('content-type') || 'image/png';
                console.log('[generate] Resolved serve-upload image via localhost:', relativePath, 'size:', imgBuf.length);
                return `data:${contentType};base64,${imgBuf.toString('base64')}`;
              }
            } catch (e) {
              console.warn('[generate] localhost fetch failed for', relativePath, (e as Error).message);
            }
          }
          if (imgUrl.startsWith('/api/serve-upload/') || imgUrl.startsWith('/uploads/')) {
            const fs = await import('fs/promises');
            const path = await import('path');
            const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
            const publicDir = path.join(workspacePath, 'public');
            let filePath = '';
            if (imgUrl.startsWith('/api/serve-upload/')) {
              const relativePath = imgUrl.replace('/api/serve-upload/', '');
              try {
                const { getServerDataRoot } = await import('@/lib/server-data-root');
                const dataRoot = getServerDataRoot();
                const path1 = path.join(dataRoot, 'uploads', relativePath);
                const path2 = path.join(dataRoot, relativePath);
                try { await fs.access(path1); filePath = path1; } catch {
                  try { await fs.access(path2); filePath = path2; } catch {
                    filePath = path.join(publicDir, relativePath);
                  }
                }
              } catch {
                filePath = path.join(publicDir, relativePath);
              }
            } else {
              const relativePath = imgUrl.replace(/^\//, '');
              filePath = path.join(publicDir, relativePath);
              try { await fs.access(filePath); } catch {
                try {
                  const { getServerDataRoot } = await import('@/lib/server-data-root');
                  const dataRoot = getServerDataRoot();
                  const altPath = path.join(dataRoot, relativePath);
                  await fs.access(altPath);
                  filePath = altPath;
                } catch { /* keep publicDir path */ }
              }
            }
            const resolved = path.resolve(filePath);
            const { getServerDataRoot } = await import('@/lib/server-data-root');
            const dataRoot = getServerDataRoot();
            if (resolved.startsWith(publicDir) || resolved.startsWith(dataRoot)) {
              const imgBuf = await fs.readFile(resolved);
              const ext = path.extname(resolved).toLowerCase();
              const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
              const mime = mimeMap[ext] || 'image/png';
              return `data:${mime};base64,${imgBuf.toString('base64')}`;
            }
          } else if (imgUrl.startsWith('http')) {
            // ★ 关键修复：如果是我们自己的域名（COZE_PROJECT_DOMAIN_DEFAULT），用localhost代替避免公网回环失败
            const domainBase = (process.env.COZE_PROJECT_DOMAIN_DEFAULT || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
            let fetchUrl = imgUrl;
            if (domainBase && imgUrl.includes(domainBase)) {
              const proto = process.env.NODE_ENV === 'production' ? 'http' : 'http';
              const port = process.env.DEPLOY_RUN_PORT || 5000;
              const urlPath = new URL(imgUrl).pathname + new URL(imgUrl).search;
              fetchUrl = `${proto}://localhost:${port}${urlPath}`;
              console.log('[generate] Rewriting self-domain URL to localhost:', imgUrl, '→', fetchUrl);
            }
            const imgResp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
            if (imgResp.ok) {
              const imgBuf = Buffer.from(await imgResp.arrayBuffer());
              const contentType = imgResp.headers.get('content-type') || 'image/png';
              console.log('[generate] Resolved http image to base64, size:', imgBuf.length, 'from:', fetchUrl.substring(0, 100));
              return `data:${contentType};base64,${imgBuf.toString('base64')}`;
            } else {
              console.warn('[generate] HTTP fetch failed for image:', fetchUrl, 'status:', imgResp.status);
            }
          }
        } catch (err) {
          console.warn('[generate] Failed to resolve image to base64:', imgUrl, err);
        }
        return null;
      };

      if (hasRefImages) {
        // ★ 将所有参考图 URL 转为 base64，确保第三方 API 一定能下载到图片
        // 这是最关键的修复：第三方 API 可能无法访问 coze.site 域名的图片 URL
        const base64RefImages: string[] = [];
        for (const refUrl of accessibleReferenceImages) {
          const base64 = await resolveImageToBase64(refUrl);
          base64RefImages.push(base64 || refUrl); // 转换失败时保留原始 URL
        }
        // 始终提供 image_urls（使用 base64 版本，确保 API 可访问）
        requestBody.image_urls = base64RefImages;

        // 图生图 strength 参数
        if (typeof strength === 'number' && strength > 0 && strength <= 1) {
          requestBody.strength = strength;
        } else if (referenceStrengths && Array.isArray(referenceStrengths) && referenceStrengths.length > 0) {
          const maxStrength = Math.max(...referenceStrengths.filter(s => typeof s === 'number' && s > 0));
          if (maxStrength > 0) {
            requestBody.strength = Math.min(maxStrength / 100, 1);
          }
        }
        // ★ 参考图模式下如果没有显式 strength 也没有 referenceStrengths，设置默认值
        if (!requestBody.strength && isReferenceOnly && accessibleReferenceImages.length > 0) {
          requestBody.strength = 0.65;
        }

        // ★ 参考图 + 图生图模式：同时设置 image 和 image_urls
        // image 字段：确保 /images/edits 端点可用（部分 API 代理仅支持此端点处理参考图）
        // image_urls 字段：在 adjustRequestForProfile 中转为 images[] 格式（OpenAI 官方规范）
        // 两者同时存在 → images[] 合并包含所有参考图，最大化兼容性
        if (!requestBody.image) {
          const firstRefBase64 = base64RefImages[0];
          if (firstRefBase64) {
            requestBody.image = firstRefBase64;
          }
        }
      }

      // 压缩参考图：大于800KB的base64图片用sharp压缩到最大1280px + JPEG q85（避免base64过大导致第三方API超时）
      const requestImageStr = requestBody.image as string | undefined;
      if (requestImageStr && requestImageStr.startsWith('data:') && requestImageStr.length > 800_000) {
        try {
          const sharp = (await import('sharp')).default;
          const base64Data = requestImageStr.split(',')[1];
          const imgBuf = Buffer.from(base64Data, 'base64');
          const compressed = await sharp(imgBuf)
            .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
          requestBody.image = `data:image/jpeg;base64,${compressed.toString('base64')}`;
        } catch (compressErr) {
          console.warn('Reference image compression failed:', compressErr);
        }
      }
      // 同步压缩image_urls数组中的其他参考图
      if (Array.isArray(requestBody.image_urls) && requestBody.image_urls.length > 1) {
        for (let i = 1; i < requestBody.image_urls.length; i++) {
          const urlItem = requestBody.image_urls[i];
          const urlStr = typeof urlItem === 'string' ? urlItem : (urlItem as { url?: string })?.url;
          if (urlStr && urlStr.startsWith('data:') && urlStr.length > 800_000) {
            try {
              const sharp = (await import('sharp')).default;
              const base64Data = urlStr.split(',')[1];
              const imgBuf = Buffer.from(base64Data, 'base64');
              const compressed = await sharp(imgBuf)
                .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer();
              const newUrl = `data:image/jpeg;base64,${compressed.toString('base64')}`;
              if (typeof urlItem === 'string') {
                requestBody.image_urls[i] = newUrl;
              } else {
                (urlItem as { url: string }).url = newUrl;
              }
            } catch {}
          }
        }
      }

      // Filter only after reference inputs are present. The filtered object is the
      // exact payload passed to the provider compatibility layer.
      const filteredBody = filterRequestForModel(currentModelConfig.modelId, requestBody);

      // ★ Gemini 图像模型专用路由：通过 /chat/completions 生图
      // 某些中转站（如4SAPI）的 Gemini 图像模型仅支持 /chat/completions 端点，
      // 不支持 /images/generations。此路由将请求转换为 chat 格式，
      // 然后从响应的 content 中提取 base64 图片数据。
      if (isGeminiImageRoute) {
        const chatRequestBody = buildGeminiChatImageRequest(requestBody);
        console.log('Gemini image route: using /chat/completions for model', currentModelConfig.modelId, 'size:', requestBody.size, 'quality:', requestBody.quality || requestBody.resolution);
        const msgs = chatRequestBody.messages as Array<Record<string, unknown>> | undefined;
        console.log('Gemini chatRequestBody messages[0]:', JSON.stringify(msgs?.[0]?.content || '').substring(0, 200));
        console.log('Gemini chatRequestBody generationConfig:', JSON.stringify(chatRequestBody.generationConfig));

        const geminiController = new AbortController();
        const geminiTimeoutId = setTimeout(() => geminiController.abort(), 600000); // 10分钟超时（Gemini生图可能很慢）

        try {
          const chatResponse = await fetchWithV1Retry(
            currentApiBaseUrl,
            '/chat/completions',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${currentApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(chatRequestBody),
              signal: geminiController.signal,
            }
          );

          clearTimeout(geminiTimeoutId);

          if (!chatResponse.ok) {
            const errorText = await chatResponse.text();
            console.error('Gemini chat/completions error:', chatResponse.status, errorText);
            let errorMsg = `Gemini API 请求失败 (${chatResponse.status})`;
            try {
              const errorJson = JSON.parse(errorText);
              // 兼容多种 API 错误格式：{error:{message:...}}, {message:...}, {msg:...}
              if (errorJson.error?.message) errorMsg = errorJson.error.message;
              else if (errorJson.message) errorMsg = errorJson.message;
              else if (errorJson.msg) errorMsg = errorJson.msg;
            } catch { /* ignore */ }
            // 合并 errorMsg + errorText 做可重试检测，兼容各种 API 错误格式
            const combinedErrorText = `${errorMsg} ${errorText}`;
            // ★ 可重试错误检测 — 渠道不可用/模型未找到/上游认证等错误标记为可重试，触发候选模型回退
            // 注意：纯 401 认证失败不应重试（Key 无效换模型也没用），仅 401+bad_response_status_code（上游中转异常）可重试
            const translatedMsg = translateApiError(errorMsg);
            const isRetryableError =
              combinedErrorText.includes('No available channel') || combinedErrorText.includes('no available channel') ||
              combinedErrorText.includes('not configured') || combinedErrorText.includes('model_not_found') || combinedErrorText.includes('model not found') ||
              combinedErrorText.includes('bad_response_status_code') ||
              (chatResponse.status >= 500 && chatResponse.status !== 501) ||
              (chatResponse.status === 401 && combinedErrorText.includes('bad_response_status_code'));
            if (isRetryableError) {
              console.warn('[generate] Gemini image route retryable error, will try fallback models:', errorMsg);
              const retryErr = new Error(`当前模型暂不可用，请稍后重试或更换模型`);
              (retryErr as Error & { retryable?: boolean }).retryable = true;
              throw retryErr;
            }
            throw new Error(translatedMsg);
          }

          const chatResponseText = await chatResponse.text();
          let chatResult: Record<string, unknown>;
          try {
            chatResult = JSON.parse(chatResponseText);
          } catch {
            console.error('[generate] Gemini chat returned non-JSON response, first 200 chars:', chatResponseText.substring(0, 200));
            throw new Error('Gemini API 返回了非 JSON 响应');
          }

          // 从 chat/completions 响应中提取图片
          const extractedImageUrls = parseGeminiChatImageResponse(chatResult);

          if (extractedImageUrls.length > 0) {
            console.log('Gemini image route: extracted', extractedImageUrls.length, 'images from chat response');
            return {
              taskIds: [],
              directImageUrls: extractedImageUrls,
              usedModel: currentModelConfig.modelId,
              usedProviderId: currentProviderId,
            };
          }

          // 如果是流式响应，chatResult 可能包含未完成的 SSE 数据
          // 检查是否有 choices 但 content 中没有图片
          const choices = chatResult.choices as Array<Record<string, unknown>> | undefined;
          if (choices && choices.length > 0) {
            const content = (choices[0].message as Record<string, unknown>)?.content;
            console.error('[generate] Gemini chat response has choices but no extractable image. Content type:', typeof content, 'Content preview:', typeof content === 'string' ? content.substring(0, 200) : JSON.stringify(content).substring(0, 200));
          }

          throw new Error('Gemini 图像模型未返回图片数据，请检查模型是否支持图像生成');
        } finally {
          clearTimeout(geminiTimeoutId);
        }
      }

      // 使用兼容性层自动调整请求（size格式、端点选择等）
      // ★ 参考图模式：同时设置 image + image_urls，hasImageFlag=true → 先尝试 /images/edits
      //   /images/edits 支持更多第三方 API 代理（它们可能不支持 /images/generations 的 images[] 格式）
      //   如果 /images/edits 被拒绝 → 自动回退到 /images/generations + images[] 格式
      // ★ 图片编辑模式(erase/mask/outpaint)：hasImage=true → 使用 editEndpoint(/images/edits)
      const hasImageFlag = !!requestBody.image;
      const hasRefImagesFlag = accessibleReferenceImages.length > 0;
      const { body: adjustedBody, endpoint } = adjustRequestForProfile(filteredBody, profile, {
        hasImage: hasImageFlag,
        hasReferenceImages: hasRefImagesFlag,
      });

      console.log('Submitting image task:', {
        model: currentModelConfig.modelId,
        providerId: currentProviderId,
        providerName: provider?.displayName || provider?.name || 'unknown',
        apiBaseUrl: currentApiBaseUrl,
        prompt: enhancedPrompt.substring(0, 50) + '...',
        size: adjustedBody.size,
        resolution: adjustedBody.resolution || undefined,
        quality: adjustedBody.quality || undefined,
        width: adjustedBody.width || undefined,
        height: adjustedBody.height || undefined,
        size_px: adjustedBody.size_px || undefined,
        aspectRatio,
        requestedPixelSize: requestedPixelSize || undefined,
        paramType: currentModelConfig.paramType,
        endpoint,
        profile: profile.id,
        hasRefImages,
        hasRefImagesFlag,
        hasImageFlag,
        hasImageField: !!adjustedBody.image,
        image_urls_count: Array.isArray(adjustedBody.image_urls) ? adjustedBody.image_urls.length : (adjustedBody.image_urls ? 1 : 0),
        images_count: Array.isArray(adjustedBody.images) ? adjustedBody.images.length : 0,
        inputFidelity: adjustedBody.input_fidelity,
        refImageTypes: accessibleReferenceImages.map(u => u.startsWith('data:') ? 'base64' : u.startsWith('http') ? 'url' : 'other'),
        strength: adjustedBody.strength || undefined,
      });

      // 根据兼容性档案确定超时时间
      // ★ 异步模式提交请求也需要足够时间（部分API提交本身可能耗时长）
      const isDirectMode = profile.responseMode === 'direct';
      const controller = new AbortController();
      const timeoutMs = isDirectMode ? 600000 : 300000; // 直接模式10分钟，异步提交5分钟
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let timeoutCleared = false;
      const clearTimeoutSafely = () => {
        if (!timeoutCleared) { clearTimeout(timeoutId); timeoutCleared = true; }
      };

      // ★ Responses API SSE 流式保活路径 — 对支持 Responses API 的模型启用
      // 通过 Cloudflare 代理的中转站长时间推理容易 524/504 断连，
      // /v1/responses + SSE 心跳保活可避免此问题
      // 模型支持列表由 model-capabilities 注册表统一管理
      const responsesApiEnabled = shouldUseResponsesAPIForProvider(currentModelConfig.modelId, currentApiBaseUrl);


      if (responsesApiEnabled) {
        try {

          // Build Responses API payload
          const payload = buildResponsesApiPayload(
            String(adjustedBody.prompt || enhancedPrompt),
            currentModelConfig.modelId,
            currentModelConfig.modelId, // textModel: use image model as text model for /v1/responses
            {
              size: adjustedBody.size as string | undefined,
              quality: adjustedBody.quality as string | undefined,
              outputFormat: adjustedBody.output_format as string | undefined,
              background: adjustedBody.background as string | undefined,
              negativePrompt: adjustedBody.negative_prompt as string | undefined,
              seed: adjustedBody.seed as number | undefined,
              imageUrls: (adjustedBody.image_urls as string[]) || (adjustedBody.image ? [adjustedBody.image as string] : undefined),
              maskB64: (adjustedBody.mask as string) || undefined,
              noPromptRevision: true,
            },
          );

          // ★ FHL等中转站流式返回私有IP URL，非流式返回外部URL
          // 直接使用非流式请求避免4层降级的60秒延迟
          if (currentApiBaseUrl.includes('fhl.mom') || currentApiBaseUrl.includes('funai.works')) {
            payload.stream = false;
            console.log('[generate] Using non-stream mode for FHL-like provider to avoid private IP URL');
          }

          const respRes = await fetchWithV1Retry(
            currentApiBaseUrl,
            '/v1/responses',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentApiKey}`,
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
              skipV1Retry: true, // path已包含/v1，避免重试时出现/v1/v1/双重路径
            },
          );

          if (!respRes.ok) {
            throw new Error(`Responses API HTTP ${respRes.status}`);
          }

          if (!respRes.body) {
            throw new Error('Responses API returned no body');
          }

          const sseResult = await streamResponsesApiSSE(
            respRes.body.getReader(),
            (event: ResponsesApiSSEEvent) => {
              try { updateTaskProgress(`resp-progress`, { progress: 50, label: event.type }); } catch {}
            },
            controller.signal,
          );

          if (sseResult.imageB64) {

            return {
              taskIds: [],
              directImageUrls: [`data:image/png;base64,${sseResult.imageB64}`],
              usedModel: currentModelConfig.modelId,
              usedProviderId: currentProviderId,
            };
          }
          // SSE returned URL (部分中转站返回 URL 而非 base64)
          if (sseResult.imageUrl) {
            let imageUrl = sseResult.imageUrl;
            let isUrlAccessible = true;
            // 修复私有 IP URL: 部分中转站 (如 FHL) 返回内部 IP 图片 URL
            // 策略: 用提供商域名替换私有 IP → 服务器端代理下载 → /chat/completions 重试获取外部 URL
            const privateIpMatch = imageUrl.match(/^(https?:\/\/)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?\/(.+)$/);
            if (privateIpMatch) {
              isUrlAccessible = false;
              const [, proto, , port, pathRest] = privateIpMatch;
              const providerDomain = currentApiBaseUrl.replace(/^https?:\/\//, '');
              const fixedUrl = `${proto}${providerDomain}${port || ''}/${pathRest}`;
              console.log(`[generate] Private IP image URL detected: ${imageUrl}`);
              // 尝试1: 用提供商域名替换私有 IP
              try {
                const probeResp = await fetch(fixedUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
                const ct = probeResp.headers.get('content-type') || '';
                if (probeResp.ok && (ct.startsWith('image/') || ct.includes('png') || ct.includes('jpeg') || ct.includes('webp'))) {
                  imageUrl = fixedUrl;
                  isUrlAccessible = true;
                  console.log('[generate] Provider domain fix succeeded (image content-type)');
                }
              } catch {
                console.log('[generate] Provider domain fix failed (unreachable)');
              }
              // 尝试2: 服务器端代理下载
              if (!isUrlAccessible) {
                const downloadedUrl = await downloadAndSaveImage(imageUrl);
                if (downloadedUrl) {
                  imageUrl = downloadedUrl;
                  isUrlAccessible = true;
                  console.log('[generate] Server-side proxy download succeeded');
                }
              }
              // 尝试3: 如果私有 IP URL 不可达，用 /chat/completions 获取外部 URL
              // ★ 注意：FHL、AI link、虚宝三个提供商明确不使用 /chat/completions
              const baseUrlLower = currentApiBaseUrl.toLowerCase();
              const providersDisablingChatRetry = ['fhl.mom', 'ai-link.shop', 'rust.cat'];
              const shouldSkipChatRetry = providersDisablingChatRetry.some(p => baseUrlLower.includes(p));
              if (!isUrlAccessible && !shouldSkipChatRetry) {
                console.log('[generate] Private IP URL not accessible, retrying via /chat/completions for external URL...');
                try {
                  const chatResult = await tryChatCompletionsImageFallback({
                    baseUrl: currentApiBaseUrl,
                    apiKey: currentApiKey,
                    model: currentModelConfig.modelId,
                    prompt: String(requestBody.prompt || ''),
                    size: String(requestBody.size || '1024x1024'),
                    originalError: 'Private IP image URL not accessible',
                    skipChannelCheck: true,
                  });
                  if (chatResult && chatResult.length > 0) {
                    imageUrl = chatResult[0];
                    isUrlAccessible = true;
                    console.log('[generate] /chat/completions retry succeeded, got external URL:', imageUrl.substring(0, 100));
                  }
                } catch (chatErr) {
                  console.log('[generate] /chat/completions retry failed:', (chatErr as Error).message?.substring(0, 100));
                }
              } else if (!isUrlAccessible && shouldSkipChatRetry) {
                console.log(`[generate] Provider "${baseUrlLower}" disables /chat/completions, skipping chat retry for private IP URL`);
              }
              // 尝试4: 非流式 Responses API 重试 (部分中转站 stream:true 返回私有 IP，stream:false 返回外部 URL)
              if (!isUrlAccessible) {
                console.log('[generate] Trying non-stream /v1/responses for external image URL...');
                try {
                  const nsPayload = buildResponsesApiPayload(
                    String(requestBody.prompt || ''),
                    currentModelConfig.modelId,
                    currentModelConfig.modelId,
                    { size: String(requestBody.size || '1024x1024'), quality: requestBody.quality as string | undefined, outputFormat: requestBody.output_format as string | undefined }
                  );
                  nsPayload.stream = false;
                  const nsResp = await fetchWithV1Retry(currentApiBaseUrl, '/v1/responses', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentApiKey}` },
                    body: JSON.stringify(nsPayload),
                    signal: AbortSignal.timeout(120000),
                  }, true);
                  if (nsResp.ok) {
                    const nsData = await nsResp.json() as { output?: Array<{ type?: string; result?: string; content?: Array<{ type?: string; text?: string }> }> };
                    if (nsData.output && Array.isArray(nsData.output)) {
                      for (const item of nsData.output) {
                        if (item.result && item.type === 'image_generation_call') {
                          // base64 result
                          const b64Data = item.result;
                          const savedUrl = await downloadAndSaveImage(`data:image/png;base64,${b64Data}`);
                          if (savedUrl) {
                            imageUrl = savedUrl;
                            isUrlAccessible = true;
                            console.log('[generate] Non-stream Responses API got base64, saved as:', savedUrl.substring(0, 80));
                            break;
                          }
                        }
                        if (item.type === 'message' && item.content) {
                          const mdUrl = extractImageUrlFromMarkdown(item.content.map((c: { text?: string }) => c.text || '').join(' '));
                          if (mdUrl && !isPrivateIp(mdUrl)) {
                            imageUrl = mdUrl;
                            isUrlAccessible = true;
                            console.log('[generate] Non-stream Responses API got external URL:', imageUrl.substring(0, 100));
                            break;
                          }
                        }
                      }
                    }
                  }
                } catch (nsErr) {
                  console.log('[generate] Non-stream Responses API retry failed:', (nsErr as Error).message?.substring(0, 100));
                }
              }
              // 所有方法都失败，保留原始 URL (前端可能无法访问)
              if (!isUrlAccessible) {
                console.log('[generate] All URL fix attempts failed, keeping original private IP URL (may not be accessible)');
              }
            }
            console.log('[generate] Responses API SSE succeeded, got image URL:', imageUrl.substring(0, 100));
            return {
              taskIds: [],
              directImageUrls: [imageUrl],
              usedModel: currentModelConfig.modelId,
              usedProviderId: currentProviderId,
            };
          }
          // SSE returned partial image as fallback
          if (sseResult.partialImageB64) {
            console.log('[generate] Responses API SSE got partial image (stream interrupted)');
            return {
              taskIds: [],
              directImageUrls: [`data:image/png;base64,${sseResult.partialImageB64}`],
              usedModel: currentModelConfig.modelId,
              usedProviderId: currentProviderId,
            };
          }
          console.warn('[generate] Responses API SSE returned no image, falling back to standard path');
        } catch (sseErr) {
          console.warn('[generate] Responses API SSE failed, falling back to standard path:', sseErr instanceof Error ? sseErr.message : sseErr);
          // 不抛出错误，降级到标准路径
        }
      }

      // 构建提交请求 - 通用策略，适配所有 API 提供商
      const isEditsEndpoint = endpoint === '/images/edits';
      const hasImageField = !!(adjustedBody.image || (Array.isArray(adjustedBody.images) && adjustedBody.images.length > 0));

      // 辅助函数：解析提交响应
      const parseSubmitResponse = async (resp: Response): Promise<{ taskIds: string[]; directImageUrls: string[]; usedModel: string; usedProviderId: string }> => {
        if (!resp.ok) {
          const errorText = await resp.text();
          console.error('API submit error:', resp.status, errorText);
          
          let errorMsg = `API 请求失败 (${resp.status})`;
          let errorCode = '';
          try {
            const errorJson = JSON.parse(errorText);
            // 兼容多种 API 错误格式：{error:{message:...}}, {message:...}, {msg:...}
            if (errorJson.error?.message) {
              errorMsg = errorJson.error.message;
            } else if (errorJson.message) {
              errorMsg = errorJson.message;
            } else if (errorJson.msg) {
              errorMsg = errorJson.msg;
            }
            if (errorJson.error?.code) {
              errorCode = errorJson.error.code;
            }
          } catch { /* ignore */ }

          // 5xx 服务器错误处理
          // ★ 重要：对 5xx 错误先尝试 /chat/completions 兜底，再决定是否回退候选模型
          // 注意：FHL、AI link、虚宝三个提供商明确不使用 /chat/completions，仅使用 /images/generations 和 /images/edits
          if (resp.status >= 500 && resp.status !== 501) {
            const combinedForCheck = `${errorMsg} ${errorText}`;
            const isChannelError = isChannelUnavailableError(combinedForCheck);
            // Cloudflare/CDN 纯 HTML 错误页（如 "error code: 502"）— 模型上游持续不可用
            const isCloudflareDown = /error code:\s*50[23]/i.test(errorText.substring(0, 500));
            // "No available compatible accounts" — 中转服务渠道完全不可用
            const isNoCompatibleAccount = combinedForCheck.includes('no available compatible account') || combinedForCheck.includes('No available compatible');

            // ★ 检查是否是明确禁用 chat/completions 的提供商（FHL、AI link、虚宝）
            const currentBaseUrlLower = currentApiBaseUrl.toLowerCase();
            const providersDisablingChatFallback = ['fhl.mom', 'ai-link.shop', 'rust.cat'];
            const isProviderDisablingChatFallback = providersDisablingChatFallback.some(p => currentBaseUrlLower.includes(p));

            const shouldTryChatFallback = !isProviderDisablingChatFallback && (isChannelError || isCloudflareDown || isNoCompatibleAccount || resp.status >= 502);

            // ★ 先尝试 /chat/completions 兜底生图（排除禁用的提供商）
            if (shouldTryChatFallback) {
              console.info(`[generate] ${resp.status} error detected (${isChannelError ? 'channel' : isCloudflareDown ? 'cloudflare' : isNoCompatibleAccount ? 'no-compatible-account' : '5xx'}), trying /chat/completions fallback for model "${currentModelConfig.modelId}"...`);
              try {
                const chatImageUrls = await tryChatCompletionsImageFallback({
                  baseUrl: currentApiBaseUrl,
                  apiKey: currentApiKey,
                  model: currentModelConfig.modelId,
                  prompt: enhancedPrompt,
                  imageBase64: (adjustedBody.image as string) || undefined,
                  imageUrls: (adjustedBody.image_urls as string[]) || undefined,
                  size: adjustedBody.size as string | undefined,
                  originalError: combinedForCheck,
                  requestIdPrefix: 'generate',
                  skipChannelCheck: true,
                });
                if (chatImageUrls && chatImageUrls.length > 0) {
                  console.log('[generate] /chat/completions fallback succeeded, got', chatImageUrls.length, 'images');
                  return {
                    taskIds: [],
                    directImageUrls: chatImageUrls,
                    usedModel: currentModelConfig.modelId,
                    usedProviderId: currentProviderId,
                  };
                }
              } catch (chatErr) {
                console.warn('[generate] /chat/completions fallback error:', chatErr);
              }
            } else if (isProviderDisablingChatFallback) {
              console.info(`[generate] Provider "${currentBaseUrlLower}" disables /chat/completions fallback, skipping for ${resp.status} error`);
            }

            // /chat/completions 兜底也失败 → 标记为可重试（触发候选模型回退）
            const isRetryable = isChannelError || isCloudflareDown || isNoCompatibleAccount;
            const retryErr = new Error(
              isRetryable
                ? `当前模型渠道不可用，已尝试其他模型`
                : `API 服务器错误 (${resp.status})，请稍后重试`
            );
            (retryErr as Error & { retryable?: boolean }).retryable = isRetryable;
            throw retryErr;
          }

          // 通用可重试错误检测 - 不针对特定提供商
          const combinedErrorText = `${errorMsg} ${errorText}`;
          if (combinedErrorText.includes('ratio or price') || combinedErrorText.includes('not configured') || combinedErrorText.includes('model_not_found') || combinedErrorText.includes('model not found') || errorCode === 'model_not_found' || combinedErrorText.includes('No available channel') || combinedErrorText.includes('no available channel')) {
            const retryErr = new Error(`当前模型暂不可用，请稍后重试或更换模型`);
            (retryErr as Error & { retryable?: boolean }).retryable = true;
            throw retryErr;
          }
          // ★ 模型名称建议自动重试：某些中转服务（如 FHL）拒绝带后缀的模型名（如 gpt-image-2-4k），
          // 但错误信息中会建议使用正确的模型名（如 "Use gpt-image-2"），自动提取并重试
          const modelSuggestionMatch = combinedErrorText.match(/use\s+([a-z][\w.-]*[a-z0-9])/i);
          if (modelSuggestionMatch && modelSuggestionMatch[1] && modelSuggestionMatch[1] !== currentModelConfig.modelId) {
            const suggestedModel = modelSuggestionMatch[1];
            console.log(`[generate] Model "${currentModelConfig.modelId}" not supported, provider suggests "${suggestedModel}", auto-retrying...`);
            try {
              const suggestedConfig = { ...currentModelConfig, modelId: suggestedModel };
              const result = await submitSingleTask(suggestedConfig, currentApiKey, currentApiBaseUrl, currentProviderId, 1, currentProvider);
              return result; // success with suggested model name
            } catch (suggestedErr) {
              console.warn(`[generate] Retry with suggested model "${suggestedModel}" also failed:`, suggestedErr instanceof Error ? suggestedErr.message : suggestedErr);
              // Fall through to other error handling
            }
          }

          // "No available compatible accounts" - 中转服务的渠道完全不可用
          if (combinedErrorText.includes('no available compatible account') || combinedErrorText.includes('No available compatible')) {
            const retryErr = new Error(`当前模型渠道暂不可用，请稍后重试或更换模型`);
            (retryErr as Error & { retryable?: boolean }).retryable = true;
            throw retryErr;
          }

          if (combinedErrorText.includes('Insufficient balance') || combinedErrorText.includes('insufficient') || combinedErrorText.includes('余额')) {
            throw new Error(`API 余额不足，请联系管理员充值`);
          }
          if (combinedErrorText.includes('Rate limit') || combinedErrorText.includes('rate_limit') || combinedErrorText.includes('Too many requests') || combinedErrorText.includes('请稍等') || combinedErrorText.includes('稍后再试') || combinedErrorText.includes('请求过于频繁')) {
            throw new Error(`请求过于频繁，请稍后再试`);
          }
          if (combinedErrorText.includes('Invalid API key') || combinedErrorText.includes('invalid api_key') || combinedErrorText.includes('Incorrect API key')) {
            throw new Error(`API 密钥无效，请联系管理员检查配置`);
          }
          // 中转服务 401 + bad_response_status_code → 上游错误，可重试
          if (resp.status === 401 && combinedErrorText.includes('bad_response_status_code')) {
            const retryErr = new Error(`API 上游服务认证异常，请稍后重试或更换模型`);
            (retryErr as Error & { retryable?: boolean }).retryable = true;
            throw retryErr;
          }
          
          // ★ 翻译英文错误信息为中文
          throw new Error(translateApiError(errorMsg));

        }

        // 解析响应 — 防止 API 返回 HTML 页面（如 404/502 错误页）导致 JSON 解析失败
        const responseText = await resp.text();
        let submitResult: Record<string, unknown>;
        try {
          submitResult = JSON.parse(responseText);
        } catch (parseErr) {
          console.error('[generate] API returned non-JSON response, first 200 chars:', responseText.substring(0, 200));
          throw new Error('API 返回了非 JSON 响应（可能是端点不存在或服务器错误），请检查 API 地址配置');
        }

        // 使用兼容性层解析响应（自动识别直接返回 vs 异步轮询）
        console.log('[generate] API response for model', currentModelConfig.modelId, ':', JSON.stringify(submitResult).substring(0, 500));
        const parsed = parseResponseForProfile(submitResult, profile);
        console.log('[generate] parsed mode:', parsed.mode, 'taskIds:', parsed.taskIds.length, 'directUrls:', parsed.directImageUrls.length);

        if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
          console.log('Direct image response (no polling needed), profile:', profile.id, 'images:', parsed.directImageUrls.length);
          return {
            taskIds: [],
            directImageUrls: parsed.directImageUrls,
            usedModel: currentModelConfig.modelId,
            usedProviderId: currentProviderId,
          };
        }

        // 异步任务格式 — 返回所有 taskIds
        if (parsed.taskIds.length > 0) {
          console.log('Got task_ids:', parsed.taskIds, 'profile:', profile.id);
          return {
            taskIds: parsed.taskIds,
            directImageUrls: [],
            usedModel: currentModelConfig.modelId,
            usedProviderId: currentProviderId,
          };
        }

        console.error('No task_id or direct image in response:', submitResult);
        throw new Error('未获取到任务ID或图片数据');
      };

      // 辅助函数：构建 multipart/form-data
      const buildMultipartBody = (): FormData => {
        const formData = new FormData();
        for (const [key, value] of Object.entries(adjustedBody)) {
          if (value === undefined || value === null) continue;
          if (key === 'image') {
            const imgVal = String(value);
            if (imgVal.startsWith('data:')) {
              const match = imgVal.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                const binaryData = Buffer.from(base64Data, 'base64');
                const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
                const file = new File([binaryData], `image.${ext}`, { type: mimeType });
                formData.append('image', file);
              }
            } else {
              const binaryData = Buffer.from(imgVal, 'base64');
              const file = new File([binaryData], 'image.png', { type: 'image/png' });
              formData.append('image', file);
            }
          } else if (Array.isArray(value)) {
            for (const item of value) {
              formData.append(key, String(item));
            }
          } else {
            formData.append(key, String(value));
          }
        }
        return formData;
      };

      let submitResponse: Response;

      if (isEditsEndpoint && hasImageField) {
        // /images/edits + image 字段：先尝试 JSON（兼容更多代理），失败后降级到 multipart
        submitResponse = await fetchWithV1Retry(
          currentApiBaseUrl,
          endpoint,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${currentApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(adjustedBody),
            signal: controller.signal,
          }
        );

        if (!submitResponse.ok) {
          const errorText = await submitResponse.text();

          // 检查是否是不支持 /images/edits 端点的错误 → 自动回退到 /images/generations
          if (isEditsEndpointRejected(submitResponse.status, errorText)) {
            console.info('[generate] /images/edits rejected by API, auto-falling back to /images/generations with image_urls only...');
            clearTimeoutSafely();

            // ★ Use shorter timeout (30s) for /images/generations when /images/edits already failed with channel error
            const fallbackTimeoutMs = isChannelUnavailableError(errorText) ? 30000 : timeoutMs;
            const fallbackController = new AbortController();
            const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), fallbackTimeoutMs);

            const fallbackBody = stripEditsOnlyFields(adjustedBody);

            // ★ 回退到 /images/generations 时的图片字段转换
            // 情况1：旧格式 images[] → 提取为 image_urls（兼容某些 API 代理）
            // 情况2：新格式 image_urls（从 /images/edits 保留）→ 转为 images[] 格式
            //        （OpenAI GPT Image 等模型在 /images/generations 上要求 images[] 格式）
            if (Array.isArray(fallbackBody.images) && !fallbackBody.image_urls) {
              // 旧格式：images[] → image_urls
              fallbackBody.image_urls = (fallbackBody.images as Array<{ image_url: { url: string } }>).map(
                (img) => img.image_url?.url || ''
              ).filter(Boolean);
            }
            delete fallbackBody.images;

            // ★ OpenAI 兼容 API (/images/generations) 需要 images[] 格式而非 image_urls
            // 当有 image_urls 且 profile 是 openai/auto/pearapi 时，转换为 images[]
            if (Array.isArray(fallbackBody.image_urls) && (fallbackBody.image_urls as string[]).length > 0 &&
                (profile.id === 'openai' || profile.id === 'auto' || profile.id === 'pearapi')) {
              const imagesArray: Array<{ image_url: { url: string } }> = (fallbackBody.image_urls as string[])
                .filter((url: string) => typeof url === 'string' && url.length > 0)
                .map((url: string) => ({ image_url: { url } }));
              if (imagesArray.length > 0) {
                fallbackBody.images = imagesArray;
                delete fallbackBody.image_urls;
              }
            }

            // 增强 prompt：/images/generations 仅将 images[]/image_urls 视为可选参考，
            // 必须在 prompt 中明确指示 AI 使用参考图作为基础，否则 AI 可能忽略参考图
            const fallbackRefImages = fallbackBody.images || fallbackBody.image_urls;
            if (fallbackRefImages && Array.isArray(fallbackRefImages) && fallbackRefImages.length > 0) {
              const refCount = fallbackRefImages.length;
              const hasImg2ImgHint = String(fallbackBody.prompt || '').includes('[img2img]');
              if (hasImg2ImgHint) {
                // 图生图场景：更强的约束，确保 AI 基于 reference image 生成
                fallbackBody.prompt = `[IMAGE-TO-IMAGE MODE] You MUST use the provided ${refCount > 1 ? `${refCount} reference images` : 'reference image'} as the mandatory source/base for generation. Do NOT generate from scratch. ${String(fallbackBody.prompt || '').replace('[img2img]', '')}`;
              } else {
                // 参考图场景：指示 AI 参考这些图片
                fallbackBody.prompt = `[REFERENCE IMAGE] Use the provided ${refCount > 1 ? `${refCount} reference images` : 'reference image'} as visual reference for generation. ${String(fallbackBody.prompt || '')}`;
              }
            }

            try {
              submitResponse = await fetchWithV1Retry(
                currentApiBaseUrl,
                '/images/generations',
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${currentApiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(fallbackBody),
                  signal: fallbackController.signal,
                }
              );
            } catch (fallbackFetchErr: unknown) {
              // /images/generations timed out → try /chat/completions immediately
              // ★ 注意：FHL、AI link、虚宝三个提供商明确不使用 /chat/completions
              const isTimeout = fallbackFetchErr instanceof Error && (fallbackFetchErr.name === 'AbortError' || /timeout|aborted/i.test(fallbackFetchErr.message));
              const baseUrlLower = currentApiBaseUrl.toLowerCase();
              const providersDisablingChatTimeoutFallback = ['fhl.mom', 'ai-link.shop', 'rust.cat'];
              const shouldSkipChatTimeoutFallback = providersDisablingChatTimeoutFallback.some(p => baseUrlLower.includes(p));
              if (isTimeout && !shouldSkipChatTimeoutFallback) {
                console.info('[generate] /images/generations timed out, trying /chat/completions fallback...');
                try {
                  const chatImageUrls = await tryChatCompletionsImageFallback({
                    baseUrl: currentApiBaseUrl,
                    apiKey: currentApiKey,
                    model: currentModelConfig.modelId,
                    prompt: String(fallbackBody.prompt || enhancedPrompt),
                    imageBase64: (adjustedBody.image as string) || undefined,
                    imageUrls: (adjustedBody.image_urls as string[]) || undefined,
                    size: adjustedBody.size as string | undefined,
                    originalError: 'images/generations timeout',
                    requestIdPrefix: 'generate',
                    skipChannelCheck: true,
                  });
                  if (chatImageUrls && chatImageUrls.length > 0) {
                    console.log('[generate] /chat/completions fallback succeeded (after generations timeout), got', chatImageUrls.length, 'images');
                    return {
                      taskIds: [],
                      directImageUrls: chatImageUrls,
                      usedModel: currentModelConfig.modelId,
                      usedProviderId: currentProviderId,
                    };
                  }
                } catch (chatErr) {
                  console.warn('[generate] /chat/completions fallback error (after generations timeout):', chatErr);
                }
                const retryErr = new Error(`生成请求超时，请稍后重试或更换模型`);
                (retryErr as Error & { retryable?: boolean }).retryable = true;
                throw retryErr;
              } else if (isTimeout && shouldSkipChatTimeoutFallback) {
                console.info(`[generate] Provider "${baseUrlLower}" disables /chat/completions, skipping chat fallback after timeout`);
                const retryErr = new Error(`生成请求超时，请稍后重试或更换模型`);
                (retryErr as Error & { retryable?: boolean }).retryable = true;
                throw retryErr;
              }
              throw fallbackFetchErr;
            }

            clearTimeout(fallbackTimeoutId);
          } else {
            // 检查是否需要 multipart 编码
            const needsMultipart = errorText.includes('multipart') ||
              errorText.includes('form-data') ||
              errorText.includes('Content-Type') ||
              errorText.includes('expected multipart') ||
              errorText.includes('no file') ||
              errorText.includes('file required') ||
              errorText.includes('Missing image') ||
              errorText.includes('image is required');

            if (needsMultipart) {
              console.info('[generate] JSON failed for edits endpoint, retrying with multipart form data...');
              clearTimeoutSafely();

              const multipartController = new AbortController();
              const multipartTimeoutId = setTimeout(() => multipartController.abort(), timeoutMs);

              // 使用 form-data npm 包替代浏览器 FormData，确保 boundary 正确传输
              try {
                const FD = (await import('form-data')).default;
                const fd = new FD();
                for (const [key, value] of Object.entries(adjustedBody)) {
                  if (value === undefined || value === null) continue;
                  if (key === 'image') {
                    const imgVal = String(value);
                    if (imgVal.startsWith('data:')) {
                      const match = imgVal.match(/^data:([^;]+);base64,(.+)$/);
                      if (match) {
                        const mimeType = match[1];
                        const base64Data = match[2];
                        const binaryData = Buffer.from(base64Data, 'base64');
                        const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
                        fd.append('image', binaryData, { filename: `image.${ext}`, contentType: mimeType });
                      }
                    } else {
                      const binaryData = Buffer.from(imgVal, 'base64');
                      fd.append('image', binaryData, { filename: 'image.png', contentType: 'image/png' });
                    }
                  } else if (Array.isArray(value)) {
                    for (const item of value) {
                      fd.append(key, String(item));
                    }
                  } else {
                    fd.append(key, String(value));
                  }
                }
                // form-data 包需转为 Buffer 发送，Node.js fetch 不能正确流式传输
                const fdBuffer = fd.getBuffer();
                submitResponse = await fetchWithV1Retry(
                  currentApiBaseUrl,
                  endpoint,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${currentApiKey}`,
                      ...fd.getHeaders(),
                      'Content-Length': String(fdBuffer.length),
                    },
                    body: fdBuffer as unknown as BodyInit,
                    signal: multipartController.signal,
                  }
                );
              } catch {
                // form-data 包不可用时，回退到浏览器 FormData
                submitResponse = await fetchWithV1Retry(
                  currentApiBaseUrl,
                  endpoint,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${currentApiKey}`,
                    },
                    body: buildMultipartBody(),
                    signal: multipartController.signal,
                  }
                );
              }

              clearTimeout(multipartTimeoutId);
            } else {
              clearTimeoutSafely();
              // 重建 Response，因为 body 已在第594行被 .text() 读取
              submitResponse = new Response(errorText, {
                status: submitResponse.status,
                headers: submitResponse.headers,
              });
            }
          }
        } else {
          clearTimeout(timeoutId);
        }
      } else {
        // /images/generations 或无 image 字段：标准 JSON 编码
        // 当 /images/generations 携带参考图时（image_urls 或 images[]），增强 prompt 以确保 AI 使用参考图
        const hasRefImagesInBody = (Array.isArray(adjustedBody.image_urls) && adjustedBody.image_urls.length > 0) ||
                                    (Array.isArray(adjustedBody.images) && adjustedBody.images.length > 0);
        if (endpoint === '/images/generations' && hasRefImages && hasRefImagesInBody) {
          const p = String(adjustedBody.prompt || '');
          const hasImg2ImgHint = p.includes('[img2img]');
          if (hasImg2ImgHint) {
            // 前端已有图生图指令，只移除标记前缀，保留原始指令
            adjustedBody.prompt = p.replace('[img2img]', '').trim();
          } else if (!p.includes('[IMAGE-TO-IMAGE MODE]') && !p.includes('[REFERENCE IMAGE]')) {
            // 无任何参考图指令时追加简洁一致性指令
            adjustedBody.prompt = `[img2img] Preserve the structure, style and key elements of the reference image. ${p}`;
          }
        }
        submitResponse = await fetchWithV1Retry(
          currentApiBaseUrl,
          endpoint,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${currentApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(adjustedBody),
            signal: controller.signal,
          }
        );

        // ★ Fallback: if /images/generations with images[] nested format fails with
        // "请上传参考图" or "reference #" error, retry with image_urls (flat string array) format.
        // Some providers (e.g. AI Link) don't support the nested images[] format on
        // /images/generations and require the flat image_urls field instead.
        if (!submitResponse.ok && Array.isArray(adjustedBody.images) && adjustedBody.images.length > 0) {
          const refErrorText = await submitResponse.text();
          if (isEditsEndpointRejected(submitResponse.status, refErrorText)) {
            console.info('[generate] /images/generations with images[] format rejected, retrying with image_urls flat format...');
            const flatUrls = (adjustedBody.images as Array<{ image_url: { url: string } }>)
              .map((img) => img.image_url?.url || '')
              .filter(Boolean);
            delete adjustedBody.images;
            adjustedBody.image_urls = flatUrls;

            submitResponse = await fetchWithV1Retry(
              currentApiBaseUrl,
              endpoint,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${currentApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(adjustedBody),
                signal: controller.signal,
              }
            );
          } else {
            // Reconstruct response for parseSubmitResponse (body was consumed by .text())
            submitResponse = new Response(refErrorText, {
              status: submitResponse.status,
              headers: submitResponse.headers,
            });
          }
        }

        clearTimeoutSafely();
      }

      try {
        return parseSubmitResponse(submitResponse);
      } finally {
        clearTimeoutSafely();
      }
    };

    const taskIds: string[] = [];
    const directImageUrls: string[] = [];
    let usedModelName = modelConfig.modelId; // 使用模型ID而非config.name（config.name可能被providerName覆盖）
    let usedModelId = modelConfig.modelId;
    let sizeRepairAttempted = false; // Size Auto-Repair 只重试一次
    let cfRetryAttempted = false;    // CF 524/504 智能重试只触发一次
    let usedProviderId = provider?.id || 'env';
    let usedProviderName = provider?.displayName || provider?.name || '';
    let usedApiBaseUrl = apiBaseUrl || '';

    // 提交所有生成任务（带自动重试逻辑）
    for (let i = 0; i < totalCount; i++) {
      let submitted = false;
      
      // 先用当前模型尝试
      try {
        const result = await submitSingleTask(modelConfig, serverApiKey, apiBaseUrl, provider?.id || 'env', 1, provider);
        if (result.directImageUrls && result.directImageUrls.length > 0) {
          directImageUrls.push(...result.directImageUrls);
        }
        if (result.taskIds && result.taskIds.length > 0) {
          taskIds.push(...result.taskIds);
        }
        usedModelId = result.usedModel;
        usedProviderId = result.usedProviderId;
        // 同步更新 providerName（修复：避免 usedProviderName 使用初始 provider 的过时值）
        const actualProvider = await findProviderById(usedProviderId);
        if (actualProvider) {
          usedProviderName = actualProvider.displayName || actualProvider.name || usedProviderName;
        }
        try {
          await appendUserJsonl(userId, 'images', {
            type: 'submit',
            providerId: usedProviderId,
            model: usedModelId,
            taskId: result.taskIds?.[0] || 'direct',
            prompt: enhancedPrompt,
          });
        } catch (logErr) {
          console.warn('[generate] 日志写入失败', logErr);
        }
        submitted = true;
      } catch (singleError: unknown) {
        const errMsg = singleError instanceof Error ? singleError.message : String(singleError);
        const isRetryable = singleError instanceof Error && (singleError as Error & { retryable?: boolean }).retryable;
        
        // ★ 智能重试: 识别 CF 524/504 超时，同模型重试后再切换备选模型
        const errorStatus = singleError instanceof Error && typeof (singleError as Error & { status?: unknown }).status === 'number'
          ? (singleError as Error & { status: number }).status
          : undefined;
        const errorClassify = classifyApiError(errMsg, errorStatus);
        const isCloudflareTimeout = errorClassify.category === 'cloudflare_timeout';
        const isSizeError = errorClassify.category === 'invalid_size';
        
        // Size Auto-Repair: 检测尺寸错误，自动修正后重试一次
        if (isSizeError && !sizeRepairAttempted) {
          sizeRepairAttempted = true;
          const repairedSize = repairSize(errMsg, modelConfig.modelId);
          if (repairedSize) {
            console.log(`[generate] Size auto-repair: detected invalid size for model ${modelConfig.modelId}, repairing to ${repairedSize}, retrying...`);
            try {
              const repairedConfig = { ...modelConfig, size: repairedSize };
              const result = await submitSingleTask(repairedConfig, serverApiKey, apiBaseUrl, provider?.id || 'env', 1, provider);
              if (result.directImageUrls?.length > 0) directImageUrls.push(...result.directImageUrls);
              if (result.taskIds?.length > 0) taskIds.push(...result.taskIds);
              usedModelId = result.usedModel;
              usedProviderId = result.usedProviderId;
              submitted = true;
              console.log(`[generate] Size auto-repair succeeded with size ${repairedSize}`);
            } catch (repairErr) {
              console.warn(`[generate] Size auto-repair retry failed:`, repairErr instanceof Error ? repairErr.message : repairErr);
            }
          }
        }
        
        // CF 524/504: 同模型重试 2 次（间隔递增），因为可能是临时网络问题
        if (isCloudflareTimeout && !cfRetryAttempted) {
          cfRetryAttempted = true;
          for (let cfRetry = 1; cfRetry <= 2; cfRetry++) {
            const delay = cfRetry * 10000; // 10s, 20s
            console.log(`[generate] CF timeout detected, retry #${cfRetry}/2 after ${delay/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            try {
              const result = await submitSingleTask(modelConfig, serverApiKey, apiBaseUrl, provider?.id || 'env', 1, provider);
              if (result.directImageUrls?.length > 0) directImageUrls.push(...result.directImageUrls);
              if (result.taskIds?.length > 0) taskIds.push(...result.taskIds);
              usedModelId = result.usedModel;
              usedProviderId = result.usedProviderId;
              submitted = true;
              console.log(`[generate] CF timeout retry #${cfRetry} succeeded`);
              break;
            } catch (retryErr) {
              console.warn(`[generate] CF timeout retry #${cfRetry} failed:`, retryErr instanceof Error ? retryErr.message : retryErr);
            }
          }
        }
        
        if (!submitted && isRetryable && candidateModels.length > 0) {
          console.log(`模型 ${modelConfig.modelId} 不可用 (${errMsg})，尝试备选模型...`);
          
          for (let ci = 0; ci < candidateModels.length; ci++) {
            const candidate = candidateModels[ci];
            const candidateProfile = resolveCompatProfile({ baseUrl: candidate.baseUrl, advancedParams: candidate.advancedParams });
            const candidateConfig = inferModelConfig(candidate.modelId, candidateProfile, candidate.displayName, `${candidate.providerId} ${candidate.displayName} ${candidate.baseUrl}`);
            
            try {
              console.log(`尝试备选模型 ${candidate.modelId} (${ci + 1}/${candidateModels.length})...`);
              const result = await submitSingleTask(candidateConfig, candidate.apiKey, candidate.baseUrl, candidate.providerId, 1, { baseUrl: candidate.baseUrl, advancedParams: candidate.advancedParams });
              if (result.directImageUrls && result.directImageUrls.length > 0) {
                directImageUrls.push(...result.directImageUrls);
              }
              if (result.taskIds && result.taskIds.length > 0) {
                taskIds.push(...result.taskIds);
              }
              usedModelId = result.usedModel;
              usedModelName = result.usedModel || candidate.modelId; // 使用实际使用的模型ID
              usedProviderId = result.usedProviderId;
              usedProviderName = candidate.displayName || candidate.modelId;
              usedApiBaseUrl = candidate.baseUrl;
              fallbackReason = `请求路由返回可重试错误：${errMsg}`;
              try {
                await appendUserJsonl(userId, 'images', {
                  type: 'submit',
                  providerId: usedProviderId,
                  model: usedModelId,
                  taskId: result.taskIds?.[0] || 'direct',
                  prompt: enhancedPrompt,
                });
              } catch (logErr) {
                console.warn('[generate] 日志写入失败(fallback)', logErr);
              }
              submitted = true;
              console.log(`备选模型 ${candidate.modelId} 提交成功`);
              break;
            } catch (candidateError: unknown) {
              const cErrMsg = candidateError instanceof Error ? candidateError.message : String(candidateError);
              const cIsRetryable = candidateError instanceof Error && (candidateError as Error & { retryable?: boolean }).retryable;
              console.log(`备选模型 ${candidate.modelId} 也失败: ${cErrMsg}`);
              if (cIsRetryable) {
                continue;
              }
              throw candidateError;
            }
          }
        }
        
        if (!submitted) {
          // ★ 使用增强的错误翻译
          const translatedError = translateApiError(errMsg);
          if (errMsg.includes('abort') || errMsg.includes('timeout') || isCloudflareTimeout) {
            return NextResponse.json({
              success: false,
              error: isCloudflareTimeout 
                ? '网络超时（Cloudflare 524/504），建议稍后重试或在管理员面板配置支持 Responses API 的提供商'
                : translatedError,
              networkError: true,
              errorCategory: errorClassify.category,
            }, { status: 504 });
          }
          
          if (i === 0) {
            return NextResponse.json({
              success: false,
              error: `${usedModelName} 提交失败: ${translatedError}`,
              modelName: usedModelName,
              errorCategory: errorClassify.category,
            }, { status: 500 });
          }
        }
      }
    }

    if (taskIds.length === 0 && directImageUrls.length === 0) {
      return NextResponse.json({
        success: false,
        error: `所有可用模型均提交失败，请稍后重试或联系管理员配置`,
        modelName: usedModelName,
      }, { status: 500 });
    }

    const generationRouteAudit = buildGenerationRouteAudit({
      requested: requestedRoute,
      actual: {
        providerId: usedProviderId || 'unresolved-provider',
        providerName: usedProviderName || usedProviderId || '未识别提供商',
        modelId: usedModelId || model,
        modelName: usedModelName || usedModelId || model,
      },
      fallbackReason,
    });

    // ★ 统一使用 polling 模式返回，避免直接模式导致前端 fetch 长时间等待超时
    // 即使是直接返回的图片 URL，也注册到 task-registry 并返回 taskIds，
    // 让前端通过 poll-task 获取结果，确保请求快速响应
    // ★ 关键优化：persistRemoteImage 不阻塞响应，在后台异步执行
    const publishedDirectImageUrls: string[] = [];
    const authoritativeDirectTaskIds = new Set<string>();
    const prepublishedTaskIds = new Set<string>();
    if (directImageUrls.length > 0) {
      for (let i = 0; i < directImageUrls.length; i++) {
        const rawUrl = directImageUrls[i];
        const directTid = `direct-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        if (_skipCloudTaskPersistence) {
          taskIds.push(directTid);
          prepublishedTaskIds.add(directTid);
          publishedDirectImageUrls.push(rawUrl);
          registerTask(directTid, 'generate', '生成图片', userId);
          updateTaskProgress(directTid, {
            status: 'completed',
            progress: 100,
            result: {
              imageUrl: rawUrl,
              usedModel: usedModelId,
              modelName: usedModelName,
              providerName: usedProviderName,
              generationRouteAudit,
              apiBaseUrl: usedApiBaseUrl,
              apiKey: provider?.apiKey || serverApiKey,
              providerId: usedProviderId,
              advancedParams: provider?.advancedParams,
            }
          });
          const providerInfo = {
            usedModel: usedModelId,
            modelName: usedModelName,
            providerName: usedProviderName,
            generationRouteAudit,
            apiBaseUrl: usedApiBaseUrl,
            apiKey: provider?.apiKey || serverApiKey,
            providerId: usedProviderId,
            advancedParams: provider?.advancedParams,
          };
          persistRemoteImage(rawUrl).then(persistedUrl => {
            if (persistedUrl && persistedUrl !== rawUrl) {
              updateTaskProgress(directTid, {
                status: 'completed',
                progress: 100,
                result: { imageUrl: persistedUrl, ...providerInfo },
              });
            }
          }).catch(error => {
            console.warn(
              '[generate] 后台持久化失败（使用原始URL）:',
              error instanceof Error ? error.message : error,
            );
          });
        } else {
          try {
            const publication = await publishDurableDirectTask({
              taskId: directTid,
              createTask: () => recordImageTaskSubmitted({
                taskId: directTid,
                userId,
                projectId: typeof projectId === 'string' ? projectId : undefined,
                sessionId: typeof sessionId === 'string' ? sessionId : undefined,
                messageId: typeof messageId === 'string' ? messageId : undefined,
                providerId: usedProviderId,
                model: usedModelId,
              }),
              prepareCompletion: async () => {
                try {
                  return {
                    imageUrl: await persistRemoteImage(rawUrl) || rawUrl,
                  };
                } catch (error) {
                  console.warn(
                    '[generate] 云端图片持久化失败（使用原始URL）:',
                    error instanceof Error ? error.message : error,
                  );
                  return { imageUrl: rawUrl };
                }
              },
              completeTask: (prepared) => recordImageTaskTerminal(
                directTid,
                {
                  status: 'completed',
                  imageUrl: typeof prepared.imageUrl === 'string'
                    ? prepared.imageUrl
                    : rawUrl,
                  creditStatus: deductedCredits > 0 ? 'charged' : 'not-applicable',
                  generationRouteAudit,
                },
              ),
            });
            if (publication.published) {
              authoritativeDirectTaskIds.add(publication.taskId);
              exposeDurableDirectTask({
                taskId: publication.taskId,
                task: publication.task,
                taskIds,
                directImageUrls: publishedDirectImageUrls,
                publishRegistry: (task) => {
                  registerTask(
                    directTid,
                    'generate',
                    '生成图片',
                    userId,
                  );
                  updateTaskProgress(directTid, {
                    status: 'completed',
                    progress: task.progress,
                    result: task.result,
                    error: task.error,
                  });
                },
                onPublishError: (error) => {
                  console.warn(
                    '[generate] Durable direct registry publication failed:',
                    directTid,
                    error,
                  );
                },
              });
            } else {
              console.warn(
                '[generate] Durable direct task was not publishable:',
                directTid,
                publication.reason,
                publication.task?.status,
              );
            }
          } catch (error) {
            console.warn('[generate] 云端任务完成记录失败:', error);
          }
        }
      }
    }

    // 返回task_ids给前端，由前端负责轮询
    // ★ 注册异步任务到统一注册中心（SSE推送 + 取消支持 + 存储提供商信息供 poll-task 使用）
    const taskPublication = await publishGenerateTaskCandidates({
      candidateTaskIds: taskIds,
      authoritativeDirectTaskIds,
      prepublishedTaskIds,
      skipCloudTaskPersistence: Boolean(_skipCloudTaskPersistence),
      createDurableTask: (tid) => recordImageTaskSubmitted({
        taskId: tid,
        userId,
        projectId: typeof projectId === 'string' ? projectId : undefined,
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
        messageId: typeof messageId === 'string' ? messageId : undefined,
        providerId: usedProviderId,
        model: usedModelId,
        submissionPayload: generationRouteAudit ? { generationRouteAudit } : undefined,
      }),
      publishProcessing: (tid) => {
        if (!getTaskInfo(tid)) {
          registerTask(tid, 'generate', '生成图片', userId);
        }
        // ★ 存储提供商信息到 task-registry，确保 poll-task 使用提交时的提供商。
        updateTaskProgress(tid, {
          status: 'processing',
          progress: 5,
          result: {
            usedModel: usedModelId,
            modelName: usedModelName,
            providerName: usedProviderName,
            generationRouteAudit,
            apiBaseUrl: usedApiBaseUrl,
            apiKey: provider?.apiKey || serverApiKey,
            providerId: usedProviderId,
            advancedParams: provider?.advancedParams,
          }
        });
      },
      onPersistenceError: (tid, error) => {
        console.error(
          '[generate] Provider task excluded because durable creation failed:',
          tid,
          error,
        );
      },
      onProjectionError: (tid, error) => {
        console.warn(
          '[generate] Durable provider task registry projection failed:',
          tid,
          error,
        );
      },
    });
    const publishedTaskIds = taskPublication.publishedTaskIds;

    if (publishedTaskIds.length === 0) {
      return NextResponse.json({
        success: false,
        error: _skipCloudTaskPersistence
          ? '所有可用模型均提交失败，请稍后重试或联系管理员配置'
          : '生成任务已提交，但未能建立可轮询的持久化记录，请稍后重试',
        modelName: usedModelName,
      }, { status: _skipCloudTaskPersistence ? 500 : 503 });
    }

    return NextResponse.json({
      success: true,
      mode: 'polling',
      taskIds: publishedTaskIds,
      // ★ 关键修复：同时返回 directImageUrls，确保 submitOnly 后台处理器能直接获取所有图片 URL
      // 而不依赖从 task-registry 查找 direct- 任务（可能在 dev 模式或 registry 不共享时失败）
      directImageUrls: publishedDirectImageUrls.length > 0
        ? publishedDirectImageUrls
        : undefined,
      model: usedModelId,
      modelName: usedModelName,
      providerName: usedProviderName,
      providerId: usedProviderId,
      generationRouteAudit,
      apiBaseUrl: usedApiBaseUrl,
      apiKey: provider?.apiKey || serverApiKey,
      estimatedTime: modelConfig.estimatedTime,
      prompt: enhancedPrompt,
      originalPrompt: prompt,
      category: imageCategory,
      style: stylePreset,
      count: publishedTaskIds.length,
    });

  } catch (apiError: unknown) {
    const errMsg = apiError instanceof Error ? apiError.message : String(apiError);
    console.error('Image generation API error:', errMsg);
    
    // 记录操作日志 - 生成失败
    logError(OP_ACTIONS.IMAGE_GENERATE, apiError, {
      userId: 'anonymous',
      targetType: 'image',
      durationMs: opTimer.end(),
    });
    
    if (errMsg.includes('abort') || errMsg.includes('timeout')) {
      return NextResponse.json({
        success: false,
        error: '提交任务超时，请检查网络后重试',
        networkError: true,
      }, { status: 504 });
    }

    if (errMsg.includes('fetch failed') || 
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ENOTFOUND')) {
      return NextResponse.json({
        success: false,
        error: '网络连接失败：无法访问图像生成 API。请检查网络连接或管理员配置。',
        networkError: true,
      }, { status: 503 });
    }
    
    if (errMsg.includes('401') || errMsg.includes('Incorrect API key') || errMsg.includes('authentication')) {
      return NextResponse.json({
        success: false,
        error: '管理员后台配置的模型凭证无效或已过期',
      }, { status: 401 });
    }
    
    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate_limit')) {
      return NextResponse.json({
        success: false,
        error: 'API 调用次数已达上限，请稍后再试',
      }, { status: 429 });
    }

    if (errMsg.includes('402') || errMsg.includes('insufficient') || errMsg.includes('余额')) {
      return NextResponse.json({
        success: false,
        error: 'API 账户余额不足，请联系管理员充值',
      }, { status: 402 });
    }

    return NextResponse.json({
      success: false,
      error: `生成失败: ${errMsg}`,
    }, { status: 500 });
  }
}
