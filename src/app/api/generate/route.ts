import { NextRequest, NextResponse, after } from 'next/server';
import { createOrdinaryProvider, enhanceOrdinaryPrompt, ordinaryManagedLocalPath } from '@/lib/task-core/ordinary-generation-provider';
import { readImageToolsLocalFile } from '@/lib/image-tools/local-image-reader';
import { inferModelConfig, prepareOrdinaryGenerationRequest } from '@/lib/task-core/ordinary-generation-request';
import { executeOrdinaryGenerationTask, ordinaryTaskResponse, type OrdinaryGenerationDescriptor } from '@/lib/task-core/ordinary-generation-task';
import { canvasOrdinaryRequestDigest, parseCanvasOrdinaryPublication, readCanvasOrdinaryTask,
  validateCanvasOrdinarySources, validateCanvasOrdinaryReplay, CanvasOrdinaryAdmissionError } from '@/lib/collaboration/canvas-ordinary-generation-admission';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { projectPersistedCompletedTask } from '@/lib/cloud-task-persistence';
import { createHash, randomUUID } from 'node:crypto';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, normalizeApiBaseUrl, findAllProvidersForType, findProviderById } from '@/lib/server-api-config';
import { fetchWithV1Retry as fetchProviderRequest } from '@/lib/api-helpers';
import { logOperation, logError, startTimer, OP_ACTIONS, sanitizeRequestData } from '@/lib/op-log';

import { getInternalRequestHeaders, requireApiAuthOrReject } from '@/lib/api-auth';
import { authorizeGenerationProject, GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
import { admitCanvasGenerationBatch, prepareCanvasGenerationPublication, parseCanvasGenerationPublication, normalizeCanvasGenerationReferences, canvasGenerationRequestDigest, readTerminalCanvasGenerationBatch, CanvasGenerationAdmissionError } from '@/lib/collaboration/canvas-generation-batch-admission';
import { translateApiError } from '@/lib/api-error-translate';
import { classifyApiError, type ClassifiedError, isCloudflareTimeoutError, translateApiError as translateApiErrorV2 } from '@/lib/api-error-translator';
import { repairSize } from '@/lib/size-auto-repair';
import { fetchWithSmartRetry } from '@/lib/smart-retry';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { validateImageUrl } from '@/lib/input-validation';
import { calculateConfiguredCreditCost, checkCredits, consumeCredits } from '@/lib/credits';

import { resolveCompatProfile } from '@/lib/api-compatibility';
import { registerTask, updateTaskProgress, isTaskCancelled, getTaskInfo } from '@/lib/task-registry';
import { recordImageTaskSubmitted, recordImageTaskTerminal } from '@/lib/cloud-task-persistence';
import {
  exposeDurableDirectTask,
  publishGenerateTaskCandidates,
  publishDurableDirectTask,
} from '@/lib/task-core/task-service';
import {
  chargeCloudTaskCredits,
  getCloudTaskForUser,
  getCloudTaskForUserByIdempotencyKey,
  terminateCloudTaskAndRefund,
  updateCloudTask,
} from '@/lib/cloud-task-storage';
import { persistRemoteImage } from '@/lib/s3-storage';
import { buildGenerationRouteAudit } from '@/lib/generation-route-audit';
import {
  createDurableGenerationBatch,
  projectCanonicalGenerationSlot,
  type CanonicalGenerationSlot,
} from '@/lib/task-core/generation-batch';
import { normalizeDurableTaskStatus } from '@/lib/task-core/task-state';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import { kickoffDurableGenerationTasks } from '@/lib/task-core/durable-generation-kickoff';
import { STRICT_AGENT_GENERATE_HEADER } from '@/lib/agent-runtime/generate-image-adapter';
import {
  normalizeImageOutputRequestBody,
  UnsupportedTransparentBackgroundError,
} from '@/lib/image-generation-output';
import { resolveTaskModelForUser } from '@/lib/task-core/model-catalog';
import { resolveProviderForTask } from '@/lib/task-core/exact-provider-routing';
import { normalizeProviderModelSelection } from '@/lib/task-core/exact-model-selection';
import {
  admitExactImageCandidate,
  admitImageFallbackCandidates,
} from '@/lib/task-core/candidate-model-admission';
import { planImageOutputFanout } from '@/lib/task-core/image-output-fanout';
import {
  normalizeRequestedPixelSize,
} from '@/lib/task-core/descriptor-image-request-fields';
import {
  ModelCapabilityError,
  type TaskModelDescriptor,
} from '@/lib/task-core/model-capability-contract';
import { trustedGatewayContext } from '@/lib/media-gateway/internal-client';

class OrdinaryReferenceTooLargeError extends Error {}

async function readBoundedOrdinaryReference(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new OrdinaryReferenceTooLargeError();
  }
  if (!response.body) throw new Error('Invalid local image file');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { completed = true; break; }
      total += value.byteLength;
      if (total > maxBytes) throw new OrdinaryReferenceTooLargeError();
      chunks.push(Buffer.from(value));
    }
    if (total === 0) throw new Error('Invalid local image file');
    return Buffer.concat(chunks, total);
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

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

function modelCapabilityConfigurationErrorResponse(
  error: ModelCapabilityError,
  providerId: string,
  modelId: string,
): NextResponse {
  const details = { providerId, modelId };
  if (error.code === 'MODEL_NOT_CONFIGURED') {
    return NextResponse.json({
      success: false,
      code: 'MODEL_NOT_CONFIGURED',
      error: '所选供应商或模型当前未配置，请刷新模型列表后重试',
      retryable: false,
      details,
    }, { status: 400 });
  }
  if (error.code === 'MODEL_NOT_AUTHORIZED') {
    return NextResponse.json({
      success: false,
      code: 'MODEL_NOT_AUTHORIZED',
      error: '当前账号无权使用所选供应商模型',
      retryable: false,
      details,
    }, { status: 403 });
  }
  return NextResponse.json({
    success: false,
    code: 'MODEL_CAPABILITY_UNAVAILABLE',
    error: '所选模型尚无可用的能力目录，请联系管理员完成配置',
    retryable: false,
    details,
  }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const opTimer = startTimer();
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  const gatewayContext = trustedGatewayContext(authResult.source, request.headers);
  const deferAgentExecution = authResult.source === 'internal'
    && request.headers.get('x-wujie-agent-defer-execution') === 'true';
  const strictAgentRouting = authResult.source === 'internal'
    && request.headers.get(STRICT_AGENT_GENERATE_HEADER) === 'true';
  const agentProviderIdempotencyKey = strictAgentRouting
    ? request.headers.get('idempotency-key')?.trim() || ''
    : '';
  try {
    let deductedCredits = 0;
    let sessionUser: import('@/lib/user-types').User | null = null;
    const body = await request.json();
    const internalFlags = [body._skipCredits, body._skipCloudTaskPersistence];
    if (internalFlags.some(flag => flag !== undefined && typeof flag !== 'boolean')) {
      return NextResponse.json({ success: false, code: 'GENERATION_INVALID_INTERNAL_FLAGS',
        error: '内部执行标记必须是布尔值', retryable: false }, { status: 400 });
    }
    if (authResult.source !== 'internal' && internalFlags.some(flag => flag === true)) {
      return NextResponse.json({ success: false, code: 'GENERATION_INTERNAL_FLAGS_FORBIDDEN',
        error: '当前请求不能使用内部执行标记', retryable: false }, { status: 400 });
    }
    const projectAccess = await authorizeGenerationProject({ actorUserId: authResult.userId, projectId: body.projectId });
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
      strength,
      providerId,
      submitOnly,
      generationChannel,
      projectId,
      sessionId,
      messageId,
      assetWorkspace,
      assetWorkspaceId,
      assetSourceEntityId,
      _skipCredits, // 内部标记：后台重试时跳过积分扣除（避免双重扣费）
      _skipCloudTaskPersistence,
      resolution, // GPT-Image系列分辨率档位参数（1K/2K/4K）
    } = body;
    // Canvas-era callers use `n`; the current panels use `outputCount`.
    // Normalize them before task fan-out so every entry point has identical behavior.
    const requestedOutputCount = outputCount ?? requestedN;
    let skillBillingContext: import('@/lib/skill-runtime/billing-authorization').SkillBillingContext | undefined;
    if (body.skillBillingContext !== undefined) {
      const { parseSkillBillingContext, SkillBillingAuthorizationError } = await import('@/lib/skill-runtime/prepaid-generation');
      if (!deferAgentExecution || !strictAgentRouting || submitOnly !== true
        || _skipCredits || _skipCloudTaskPersistence || Number(requestedOutputCount ?? 1) !== 1
        || !agentProviderIdempotencyKey) throw new SkillBillingAuthorizationError();
      skillBillingContext = parseSkillBillingContext(body.skillBillingContext);
    }
    let prepaidExecution: import('@/lib/skill-runtime/prepaid-generation').SkillPrepaidExecutionReference | undefined;
    if (body.skillPrepaidExecution !== undefined) {
      const { parseSkillPrepaidExecutionReference, SkillBillingAuthorizationError } = await import('@/lib/skill-runtime/prepaid-generation');
      if (!strictAgentRouting || deferAgentExecution || submitOnly || !_skipCredits || !_skipCloudTaskPersistence
        || Number(requestedOutputCount ?? 1) !== 1 || typeof rawModel !== 'string' || typeof providerId !== 'string') {
        throw new SkillBillingAuthorizationError();
      }
      prepaidExecution = parseSkillPrepaidExecutionReference(body.skillPrepaidExecution);
    }
    const prepaidRequestBody = prepaidExecution ? structuredClone(body) : undefined;
    const ordinaryCanvas = projectAccess.kind === 'document'
      && (assetWorkspace === undefined || assetWorkspace === 'canvas') && !gatewayContext && !skillBillingContext && !prepaidExecution
      && !(authResult.source === 'internal' && (_skipCredits || _skipCloudTaskPersistence))
      && (!submitOnly || (generationChannel !== 'canvas-direct' && !deferAgentExecution
        && process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER === 'true'));
    if (ordinaryCanvas && projectAccess.kind === 'document') {
      const idempotencyKey = request.headers.get('idempotency-key')?.trim() || randomUUID();
      try {
        const identity = { type: 'generate' as const, idempotencyKey, requestDigest: canvasOrdinaryRequestDigest(body) };
        const publication = parseCanvasOrdinaryPublication(projectAccess, body);
        const existing = await readCanvasOrdinaryTask(publication, identity);
        let taskId: string;
        if (existing) {
          if (['completed', 'failed', 'cancelled', 'timeout'].includes(existing.status)) {
            if (existing.status === 'completed') await projectPersistedCompletedTask(existing.id, authResult.userId);
            return NextResponse.json(ordinaryTaskResponse((await getCloudTaskForUser(existing.id, authResult.userId))!));
          }
          const frozen = existing.result?.ordinaryGeneration as OrdinaryGenerationDescriptor;
          await validateCanvasOrdinaryReplay(frozen.publication, identity, existing.id);
          taskId = existing.id;
        } else {
          await validateCanvasOrdinarySources(publication, body, request.nextUrl.origin);
          const plan = await prepareOrdinaryGenerationRequest(body, authResult.user);
          const descriptor: OrdinaryGenerationDescriptor = { version: 1, route: '/api/generate', requestDigest: identity.requestDigest, plan, publication };
          const now = Date.now();
          const ordinaryId = `ordinary_${randomUUID()}`;
          const admitted = await createBillableTask({ userId: authResult.userId, ...identity,
            creditCost: plan.creditCost, canvasPublication: publication,
            task: { id: ordinaryId, type: 'generate', status: 'processing', projectId: projectAccess.projectId,
              sessionId: typeof sessionId === 'string' ? sessionId : undefined, messageId: typeof messageId === 'string' ? messageId : undefined,
              model: plan.targets[0].modelId, providerId: plan.targets[0].providerId,
              progress: 0, createdAt: now, updatedAt: now, result: { ordinaryGeneration: descriptor,
                outputGroup: { version: 1, kind: 'ordinary-generation', taskId: ordinaryId, requestedCount: plan.requestedCount } } } });
          taskId = admitted.task.id;
        }
        const execution = { taskId, actorUserId: authResult.userId, origin: request.nextUrl.origin, phase: 'submit' as const };
        if (submitOnly) after(() => executeOrdinaryGenerationTask(execution));
        else await executeOrdinaryGenerationTask(execution);
        return NextResponse.json(ordinaryTaskResponse((await getCloudTaskForUser(taskId, authResult.userId))!));
      } catch (error) {
        const status = error instanceof CanvasOrdinaryAdmissionError ? error.status
          : error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 503;
        return NextResponse.json({ success: false, code: error instanceof CanvasOrdinaryAdmissionError ? error.code : 'ORDINARY_ADMISSION_UNAVAILABLE',
          error: status === 503 ? '普通生成准入结果待确认，请使用原请求标识重试' : error instanceof Error ? error.message : '普通生成请求无效',
          idempotencyKey, retryable: status === 503 }, { status });
      }
    }
    let prepaidExecutionFailure: unknown;
    const fetchWithV1Retry: typeof fetchProviderRequest = async (baseUrl, path, options = {}, retryWithV1, timeoutMs) => {
      if (!prepaidExecution || !prepaidRequestBody) return fetchProviderRequest(baseUrl, path, options, retryWithV1, timeoutMs);
      if (prepaidExecutionFailure) throw prepaidExecutionFailure;
      const { startSkillPrepaidProviderRequest } = await import('@/lib/skill-runtime/prepaid-generation');
      try {
        return await startSkillPrepaidProviderRequest({
          ...prepaidExecution, userId: authResult.userId, providerId, modelId: rawModel,
          requestBody: prepaidRequestBody, signal: options.signal || undefined,
        }, signal => fetchProviderRequest(baseUrl, path, { ...options, signal, skipV1Retry: true }, false, timeoutMs));
      } catch (error) {
        prepaidExecutionFailure = error;
        throw error;
      }
    };
    const requestedQuality = typeof body.quality === 'string' ? body.quality : undefined;
    const quality: string | undefined = requestedQuality;
    const resolutionTier: string | undefined = typeof resolution === 'string'
      ? resolution
      : undefined;
    const normalizedRequestedPixelSize = normalizeRequestedPixelSize(requestedPixelSize);
    // 诊断日志：显示接收到的参考图参数
    console.log(`[generate] model=${rawModel}, providerId=${providerId}, referenceImages.length=${referenceImages?.length || 0}, referenceMode=${referenceMode}`);
    // 必填参数校验
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ success: false, error: '请输入创意描述（prompt）' }, { status: 400 });
    }
    // 尺寸校验（允许像素格式 1024x1024 和宽高比格式 1:1 / 16:9）
    if (normalizedRequestedPixelSize && normalizedRequestedPixelSize !== 'auto'
      && !/^\d+x\d+$/.test(normalizedRequestedPixelSize)
      && !/^\d+:\d+$/.test(normalizedRequestedPixelSize)) {
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
    const extractedProviderId = !strictAgentRouting && model.includes('::') ? model.split('::')[0] : '';
    if (!strictAgentRouting && model.includes('::')) {
      model = model.split('::').pop()!;
      console.log(`[generate] Stripped provider prefix from model: "${rawModel}" → "${model}" (providerId via field: "${providerId || 'none'}")`);
    }
    // 如果 providerId 字段为空但从 model 中提取到了，自动回填
    const effectiveProviderId = providerId || extractedProviderId || '';

    if (strictAgentRouting && (!effectiveProviderId || !model || !agentProviderIdempotencyKey)) {
      return NextResponse.json({
        success: false,
        code: 'MODEL_PROVIDER_MISMATCH',
        error: 'Strict Agent generation requires an exact provider, model, and idempotency key',
      }, { status: 400 });
    }

    // Preserve the raw id until the provider's exact model list can normalize it.
    const rawModelId = model;
    try {
      const normalizedOutputBody = normalizeImageOutputRequestBody(body, rawModelId);
      for (const key of ['background', 'backgroundMode', 'output_format', 'outputFormat']) {
        delete body[key];
      }
      Object.assign(body, normalizedOutputBody);
    } catch (error) {
      if (error instanceof UnsupportedTransparentBackgroundError) {
        return NextResponse.json({
          success: false,
          code: 'TRANSPARENT_BACKGROUND_UNSUPPORTED',
          error: error.message,
          retryable: false,
        }, { status: 400 });
      }
      throw error;
    }
    let normalized = normalizeModelForApi(model, { providerModels: [] });

    // Content safety check
    const safetyResult = checkPromptSafety(prompt || '');
    if (safetyResult.level === 'block') {
      return NextResponse.json({ success: false, error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    sessionUser = authResult.user;
    const userId = authResult.userId;

    // An explicit provider/model pair is a user selection, not a fallback hint.
    // Validate it before task persistence and billing so stale browser state cannot
    // submit an unrelated model to the provider shown in the UI.
    let requestedProvider = null;
    if (effectiveProviderId) {
      requestedProvider = await findProviderById(effectiveProviderId);
      const requestedModelSelection = normalizeProviderModelSelection({
        requestedModelId: rawModelId,
        selectedModels: requestedProvider?.selectedModels,
        discoveredModels: requestedProvider?.discoveredModels,
      });
      const configuredModel = strictAgentRouting
        ? requestedModelSelection.availableModelIds.find(configuredId => configuredId === rawModelId)
        : (requestedModelSelection.matched ? requestedModelSelection.modelId : undefined);
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
      normalized = normalizeModelForApi(model, {
        providerModels: requestedModelSelection.availableModelIds,
      });
    }

    // 图像模型权限校验：非管理员用户需检查 imageModels 授权列表
    if (sessionUser && sessionUser.role !== 'admin') {
      const allowed = sessionUser.imageModels;
      if (!isModelAssignedToUser(allowed, effectiveProviderId, model)) {
        return NextResponse.json({ success: false, error: '您没有权限使用此图像模型，请联系管理员' }, { status: 403 });
      }
    }

    const canvasBatchPublication = submitOnly && projectAccess.kind === 'document'
      && (assetWorkspace === undefined || assetWorkspace === 'canvas') && !skillBillingContext
      && !(generationChannel !== 'canvas-direct' && !deferAgentExecution && !gatewayContext
        && process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER === 'true')
      ? parseCanvasGenerationPublication({ access: projectAccess, body })
      : undefined;
    const generationReferenceImages = canvasBatchPublication
      ? normalizeCanvasGenerationReferences(referenceImages, canvasBatchPublication) : referenceImages;
    const canvasRootKey = canvasBatchPublication ? request.headers.get('idempotency-key')?.trim() || randomUUID() : '';
    let canvasRequestDigest: string | undefined;
    if (canvasBatchPublication) {
      const requestedCount = typeof requestedOutputCount === 'number' ? requestedOutputCount : Number(requestedOutputCount || 1);
      canvasRequestDigest = canvasGenerationRequestDigest({
        fields: { prompt, aspectRatio, size: normalizedRequestedPixelSize, referenceMode, referenceCategories,
          referenceStrengths, referenceCategoryStrengths, referenceDescriptions, imageCategory, productCategory,
          stylePreset, model, providerId: effectiveProviderId, strength, quality, resolution: resolutionTier,
          background: body.background, output_format: body.output_format, projectId },
        rawReferences: generationReferenceImages, origin: request.nextUrl.origin, requestedCount, publication: canvasBatchPublication,
      });
      const terminalSlots = await readTerminalCanvasGenerationBatch({ access: canvasBatchPublication.access,
        rootIdempotencyKey: canvasRootKey, requestedCount, requestDigest: canvasRequestDigest, publication: canvasBatchPublication });
      if (terminalSlots) {
        return NextResponse.json({ success: true, mode: 'polling', batchId: terminalSlots[0].batchId, slots: terminalSlots,
          taskId: terminalSlots[0].taskId, taskIds: terminalSlots.map(slot => slot.taskId),
          model, providerId: effectiveProviderId, estimatedTime: 90, submitOnly: true });
      }
      await prepareCanvasGenerationPublication({ access: canvasBatchPublication.access, body, origin: request.nextUrl.origin });
    }

    // ★ 解析参考图片 URL（转换为 API 可访问的格式）
    // 必须在 submitOnly 检查之前完成，否则后台请求无法获得可访问的参考图 URL
    // 优化：并行处理所有参考图，加速提交
    const accessibleReferenceImages: string[] = [];
    if (generationReferenceImages && Array.isArray(generationReferenceImages)) {
      for (const rawReference of generationReferenceImages) {
        const reference = typeof rawReference === 'string' ? rawReference
          : (rawReference as { url?: string })?.url || String(rawReference);
        try {
          ordinaryManagedLocalPath(reference);
        } catch (error) {
          if (error instanceof Error && /Unsafe local media path/.test(error.message)) {
            return NextResponse.json({ success: false, code: 'GENERATION_REFERENCE_INVALID',
              error: '参考图片路径不合法或文件不可用' }, { status: 400 });
          }
          throw error;
        }
      }
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
          // Managed references must reach the bounded local preflight before any
          // localhost recovery can convert them into an unchecked data URL.
          if (ordinaryManagedLocalPath(img)) return img;
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
      const results = await Promise.all(generationReferenceImages.map((ri: unknown) => resolveImage(ri)));
      for (const url of results) {
        if (url) accessibleReferenceImages.push(url);
      }
      console.log(`[generate] 解析参考图完成: ${generationReferenceImages.length} 张输入 → ${accessibleReferenceImages.length} 张可访问`);
    }

    // Reject unsafe managed references before any ordinary/canvas billing path.
    // Keep URLs for source identity and durable payloads, but retain admitted
    // local bytes for this request's immediate provider submission.
    let localReferenceRoots: { data: string; public: string } | null = null;
    const localReferenceSnapshots = new Map<string, string>();
    for (const referenceUrl of accessibleReferenceImages) {
      try {
        const localPath = ordinaryManagedLocalPath(referenceUrl);
        if (!localPath) continue;
        if (!localReferenceRoots) {
          const { getServerDataRoot } = await import('@/lib/server-data-root');
          const path = await import('node:path');
          localReferenceRoots = {
            data: getServerDataRoot(),
            public: path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public'),
          };
        }
        let admittedBytes = await readImageToolsLocalFile(localReferenceRoots.data, localReferenceRoots.public,
          localPath, 20 * 1024 * 1024, 'ordinary');
        if (!admittedBytes && localPath.startsWith('/api/serve-upload/')) {
          const port = process.env.DEPLOY_RUN_PORT || 5000;
          const query = referenceUrl.match(/\?[^#]*/)?.[0] || '';
          let recoveryResponse: Response;
          try {
            recoveryResponse = await fetch(`http://localhost:${port}${localPath}${query}`,
              { signal: AbortSignal.timeout(8000) });
          } catch {
            return NextResponse.json({ success: false, code: 'GENERATION_REFERENCE_UNAVAILABLE',
              error: '参考图片暂时无法恢复，请稍后重试' }, { status: 503 });
          }
          if (!recoveryResponse.ok) {
            const unavailable = recoveryResponse.status >= 500;
            return NextResponse.json({ success: false,
              code: unavailable ? 'GENERATION_REFERENCE_UNAVAILABLE' : 'GENERATION_REFERENCE_INVALID',
              error: unavailable ? '参考图片暂时无法恢复，请稍后重试' : '参考图片路径不合法或文件不可用' },
            { status: unavailable ? 503 : 400 });
          }
          const mime = recoveryResponse.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
          if (!mime?.startsWith('image/')) {
            await recoveryResponse.body?.cancel().catch(() => undefined);
            return NextResponse.json({ success: false, code: 'GENERATION_REFERENCE_INVALID',
              error: '参考图片不是有效图像' }, { status: 400 });
          }
          try {
            admittedBytes = await readBoundedOrdinaryReference(recoveryResponse, 20 * 1024 * 1024);
          } catch (error) {
            if (error instanceof OrdinaryReferenceTooLargeError) {
              return NextResponse.json({ success: false, code: 'GENERATION_REFERENCE_TOO_LARGE',
                error: '参考图片超过大小限制' }, { status: 413 });
            }
            return NextResponse.json({ success: false, code: 'GENERATION_REFERENCE_UNAVAILABLE',
              error: '参考图片暂时无法恢复，请稍后重试' }, { status: 503 });
          }
        }
        if (admittedBytes && !submitOnly) {
          const path = await import('node:path');
          const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.webp': 'image/webp' } as Record<string, string>)[path.extname(localPath).toLowerCase()] || 'image/png';
          localReferenceSnapshots.set(referenceUrl, `data:${mime};base64,${admittedBytes.toString('base64')}`);
        }
      } catch (error) {
        if (error instanceof Error && /Unsafe local media path|Invalid local image file/.test(error.message)) {
          return NextResponse.json({ success: false, code: 'GENERATION_REFERENCE_INVALID',
            error: '参考图片路径不合法或文件不可用' }, { status: 400 });
        }
        throw error;
      }
    }

    const normalizedRequestedOutputCount = requestedOutputCount === undefined
      ? 1
      : Number(requestedOutputCount);
    const requestedTaskModelSelection = {
      operation: accessibleReferenceImages.length > 0 ? 'image-to-image' as const : 'text-to-image' as const,
      aspectRatio,
      size: normalizedRequestedPixelSize,
      quality: requestedQuality,
      outputCount: normalizedRequestedOutputCount,
      referenceImageCount: accessibleReferenceImages.length,
      usesMask: false,
    };
    const admitImageCandidate = (candidateProviderId: string, candidateModelId: string) => (
      admitExactImageCandidate({
        providerId: candidateProviderId,
        modelId: candidateModelId,
        selection: requestedTaskModelSelection,
        resolveTaskModel: (resolvedProviderId, resolvedModelId) => (
          resolveTaskModelForUser(resolvedProviderId, resolvedModelId, sessionUser)
        ),
      })
    );
    const candidateAdmissionErrorResponse = (
      error: ModelCapabilityError | { code: 'MODEL_CAPABILITY_MISMATCH'; field: string; received: unknown; allowed: unknown[] },
      candidateProviderId: string,
      candidateModelId: string,
    ) => {
      if (error instanceof ModelCapabilityError) {
        return modelCapabilityConfigurationErrorResponse(error, candidateProviderId, candidateModelId);
      }
      return NextResponse.json({
        success: false,
        code: 'MODEL_CAPABILITY_MISMATCH',
        error: `所选模型不支持当前参数：${error.field}`,
        retryable: false,
        details: {
          providerId: candidateProviderId,
          modelId: candidateModelId,
          field: error.field,
          received: error.received,
          allowed: error.allowed,
        },
      }, { status: 400 });
    };
    let exactModelDescriptor: TaskModelDescriptor | null = null;
    const modelCapabilityAdmission = effectiveProviderId
      ? await admitImageCandidate(effectiveProviderId, model)
      : null;

    if (modelCapabilityAdmission && !modelCapabilityAdmission.ok) {
      return candidateAdmissionErrorResponse(
        modelCapabilityAdmission.error,
        effectiveProviderId,
        model,
      );
    }
    if (modelCapabilityAdmission?.ok) exactModelDescriptor = modelCapabilityAdmission.descriptor;

    // ★ submitOnly 模式：立即注册任务并返回 taskId，后台执行实际生成
    // 解决 chat-tools 调用 /api/generate 时因第三方 API 响应慢（2-11分钟）导致 120s 超时的问题
    if (
      submitOnly
      && generationChannel !== 'canvas-direct'
      && !deferAgentExecution
      && !gatewayContext
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
        size: normalizedRequestedPixelSize,
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
        background: body.background,
        output_format: body.output_format,
        projectId,
        sessionId,
        messageId,
        assetWorkspace,
        assetWorkspaceId,
        assetSourceEntityId,
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
      const batchSeed = (canvasRootKey || idempotencyKey)
        ? createHash('sha256').update(canvasRootKey || idempotencyKey).digest('hex').slice(0, 24)
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const taskSeed = Date.now();
      const generationBatch = createDurableGenerationBatch({
        batchId: `batch-${batchSeed}`,
        requestedCount: requestedSlotCount,
        createTaskId: (slotIndex) => (
          `async-${taskSeed}-${slotIndex}-${Math.random().toString(36).slice(2, 8)}`
        ),
      });
      const requestDigest = canvasRequestDigest ?? createHash('sha256').update(JSON.stringify({
        prompt,
        aspectRatio,
        size: normalizedRequestedPixelSize,
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
        background: body.background,
        output_format: body.output_format,
        projectId,
      })).digest('hex');
      const childCreditCost = sessionUser && !_skipCredits && !skillBillingContext
        ? await calculateConfiguredCreditCost(
            'image_generate',
            model || '',
            { quality, resolution: resolutionTier, providerId: effectiveProviderId || undefined },
          )
        : 0;

      if (sessionUser && childCreditCost > 0 && !canvasBatchPublication) {
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
        ...gatewayContext,
        prompt,
        aspectRatio,
        size: normalizedRequestedPixelSize,
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
        background: body.background,
        output_format: body.output_format,
        projectId,
        sessionId,
        messageId,
        assetWorkspace,
        assetWorkspaceId,
        assetSourceEntityId,
        requestDigest,
        workerMode: 'recovery',
        ...(strictAgentRouting ? {
          agentStrictRouting: true,
          agentProviderIdempotencyKey,
        } : {}),
      };
      const submittedSlots: CanonicalGenerationSlot[] = canvasBatchPublication
        ? await admitCanvasGenerationBatch({ access: canvasBatchPublication.access, batch: generationBatch,
          rootIdempotencyKey: canvasRootKey, requestDigest, creditCost: childCreditCost,
          publication: canvasBatchPublication, submissionPayload, providerId: effectiveProviderId, model,
          sessionId: typeof sessionId === 'string' ? sessionId : undefined,
          messageId: typeof messageId === 'string' ? messageId : undefined })
        : [];
      const pendingCharges: Array<{ taskId: string; slotId: string; slotIndex: number }> = [];

      if (!canvasBatchPublication) {
      for (const slot of generationBatch.slots) {
        const asyncTaskId = slot.taskId;
        const childIdempotencyKey = idempotencyKey ? `${idempotencyKey}:${slot.slotIndex}` : undefined;
        const childPayload = {
          ...submissionPayload,
          batchId: generationBatch.batchId,
          slotId: slot.slotId,
          slotIndex: slot.slotIndex,
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
          label: `生成图片 ${slot.slotIndex + 1}/${generationBatch.slots.length}`,
          idempotencyKey: childIdempotencyKey,
          submissionPayload: childPayload,
          batchId: generationBatch.batchId,
          slotId: slot.slotId,
          slotIndex: slot.slotIndex,
          deferCreditCharge: true,
          ...(skillBillingContext ? { skillBilling: {
            context: skillBillingContext, idempotencyKey: agentProviderIdempotencyKey,
          } } : {}),
        });

        if (taskCreated) {
          submittedSlots.push({
            ...slot,
            status: 'submitting',
          });
          pendingCharges.push({
            taskId: asyncTaskId,
            slotId: slot.slotId,
            slotIndex: slot.slotIndex,
          });
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

        const canonicalExisting = projectCanonicalGenerationSlot({
          taskId: existing.id,
          status: existing.status,
          result: existing.result,
        });
        submittedSlots.push(canonicalExisting ?? {
          batchId: generationBatch.batchId,
          slotId: String(existingPayload.slotId || slot.slotId),
          slotIndex: typeof existingPayload.slotIndex === 'number'
            ? existingPayload.slotIndex
            : slot.slotIndex,
          taskId: existing.id,
          status: normalizeDurableTaskStatus(existing.status),
        });
        if (existing.status === 'pending' && existing.creditStatus === 'not-applicable') {
          pendingCharges.push({
            taskId: existing.id,
            slotId: String(existingPayload.slotId || slot.slotId),
            slotIndex: typeof existingPayload.slotIndex === 'number'
              ? existingPayload.slotIndex
              : slot.slotIndex,
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
          if (skillBillingContext) {
            const current = await getCloudTaskForUser(pendingCharge.taskId, authResult.userId);
            const provenance = current?.result?.skillBillingProvenance as Record<string, unknown> | undefined;
            if (current && current.creditStatus === 'not-applicable' && current.creditCost === 0
              && ['processing', 'completed', 'failed', 'cancelled', 'timeout'].includes(current.status)
              && provenance?.runId === skillBillingContext.runId
              && provenance.stepId === skillBillingContext.stepId
              && provenance.operationKey === skillBillingContext.operationKey) {
              // A concurrent identical request already activated this prepaid child.
              continue;
            }
          }
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

      }

      const kickoffTaskIds = submittedSlots
        .filter((slot) => !['completed', 'failed', 'cancelled', 'timeout'].includes(slot.status))
        .map((slot) => slot.taskId);
      if (!deferAgentExecution) {
        after(async () => {
          const kickoff = await kickoffDurableGenerationTasks({
            taskIds: kickoffTaskIds,
            userId: authResult.userId,
            userRole: authResult.userRole === 'admin' ? 'admin' : 'user',
          });
          if (kickoff.failed.length > 0) {
            console.warn('[generate] Durable generation kickoff was not accepted for every slot', {
              batchId: generationBatch.batchId,
              attempted: kickoff.attempted,
              accepted: kickoff.accepted,
              failed: kickoff.failed,
            });
          }
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
    let provider = await resolveProviderForTask({
      providerId: effectiveProviderId || undefined,
      findById: findProviderById,
      findByModel: () => findProviderForModel(model, 'image'),
    });
    let serverApiKey = provider?.apiKey;
    let apiBaseUrl = normalizeApiBaseUrl(provider?.baseUrl || '');
    
    // ★ 关键日志：记录实际使用的提供商信息，便于追踪
    console.log(`[generate] 提供商选择: model="${model}", requestedProviderId="${effectiveProviderId}", matched="${provider?.displayName || provider?.name || 'none'}", matchedId="${provider?.id || 'none'}", baseUrl="${apiBaseUrl}", hasApiKey=${!!serverApiKey}`);
    
    // 解析兼容性档案 - 决定 API 调用方式
    const initialProfile = resolveCompatProfile(provider);
    
    // ★ 二次精确规范化：使用 provider.selectedModels 列表做精确匹配
    // 关键修复：PearAPI 有独立的 gpt-image-2/gpt-image-2-2k/gpt-image-2-4k 模型，不能统一替换成 gpt-image-2
    // 只有当 provider 模型列表中不存在 exact 模型时，才使用别名映射
    const providerModelSelection = normalizeProviderModelSelection({
      requestedModelId: rawModelId,
      selectedModels: provider?.selectedModels,
      discoveredModels: provider?.discoveredModels,
    });
    const providerModels = providerModelSelection.availableModelIds;
    normalized = normalizeModelForApi(rawModelId, { providerModels });
    if (!strictAgentRouting) model = providerModelSelection.modelId;
    if (!strictAgentRouting && normalized.wasNormalized) {
      console.log(`[generate] 模型规范化: "${rawModelId}" → "${model}" (在提供商列表中精确匹配: ${providerModels.some(m => String(m).toLowerCase() === rawModelId.toLowerCase()) ? '是' : '否'})`);
    }
    
    if (provider && !exactModelDescriptor) {
      const implicitAdmission = await admitImageCandidate(provider.id, model);
      if (!implicitAdmission.ok) {
        return candidateAdmissionErrorResponse(implicitAdmission.error, provider.id, model);
      }
      exactModelDescriptor = implicitAdmission.descriptor;
    }
    let modelConfig = inferModelConfig(
      model,
      initialProfile,
      provider?.displayName,
      exactModelDescriptor,
    );
    const requestedRoute = {
      providerId: effectiveProviderId || provider?.id || 'unresolved-provider',
      providerName: provider?.displayName || provider?.name || effectiveProviderId || '未匹配提供商',
      modelId: rawModelId || model,
      modelName: rawModelId || model,
    };
    let fallbackReason: string | undefined;

    // 构建备选模型列表（排除当前模型，优先管理员配置的模型）
    const rawCandidateModels: { modelId: string; apiKey: string; baseUrl: string; providerId: string; displayName: string; advancedParams?: Record<string, string> }[] = [];
    if (!effectiveProviderId) {
      for (const p of allImageProviders) {
        for (const m of p.models) {
          if (m !== model) {
            rawCandidateModels.push({
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
    }
    const admittedCandidateModels = await admitImageFallbackCandidates({
      candidates: rawCandidateModels,
      admit: candidate => admitImageCandidate(candidate.providerId, candidate.modelId),
    });
    const candidateModels = admittedCandidateModels.candidates;

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
        modelConfig = inferModelConfig(
          fallback.modelId,
          fallbackProfile,
          fallback.displayName,
          fallback.descriptor,
        );
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
      } else if (admittedCandidateModels.firstRejection) {
        return candidateAdmissionErrorResponse(
          admittedCandidateModels.firstRejection.error,
          admittedCandidateModels.firstRejection.candidate.providerId,
          admittedCandidateModels.firstRejection.candidate.modelId,
        );
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

    const immediateReferenceImages = accessibleReferenceImages.map(url => localReferenceSnapshots.get(url) || url);
    const { enhancedPrompt } = await enhanceOrdinaryPrompt({
      prompt, imageCategory, productCategory, stylePreset, referenceImages, referenceDescriptions,
      referenceMode, referenceCategories, referenceStrengths, referenceCategoryStrengths,
      accessibleReferenceImages: immediateReferenceImages, effectiveProviderId, provider, modelConfig,
    });

    const requestedSize = aspectRatio || '1:1';
    
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
    const submitSingleTask = createOrdinaryProvider({
      requestedSize, normalizedRequestedPixelSize, quality, resolutionTier, enhancedPrompt,
      agentProviderIdempotencyKey,
      accessibleReferenceImages: immediateReferenceImages,
      referenceMode, referenceStrengths,
      strength, aspectRatio, strictAgentRouting, provider, downloadAndSaveImage, isPrivateIp,
      providerFetch: fetchWithV1Retry,
    });

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
    for (const [i, requestN] of planImageOutputFanout(totalCount).entries()) {
      let submitted = false;
      
      // 先用当前模型尝试
      try {
        const result = await submitSingleTask(modelConfig, serverApiKey, apiBaseUrl, provider?.id || 'env', requestN, provider);
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
        if (prepaidExecutionFailure) throw prepaidExecutionFailure;
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
        if (!strictAgentRouting && isSizeError && !sizeRepairAttempted) {
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
        if (!strictAgentRouting && isCloudflareTimeout && !cfRetryAttempted) {
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
        
        if (!strictAgentRouting && !effectiveProviderId && !submitted && isRetryable && candidateModels.length > 0) {
          console.log(`模型 ${modelConfig.modelId} 不可用 (${errMsg})，尝试备选模型...`);
          for (let ci = 0; ci < candidateModels.length; ci++) {
            const candidate = candidateModels[ci];
            const candidateProfile = resolveCompatProfile({ baseUrl: candidate.baseUrl, advancedParams: candidate.advancedParams });
            const candidateConfig = inferModelConfig(
              candidate.modelId,
              candidateProfile,
              candidate.displayName,
              candidate.descriptor,
            );
            
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
            const parameterRejected = strictAgentRouting && errorStatus === 400;
            return NextResponse.json({
              success: false,
              error: `${usedModelName} 提交失败: ${translatedError}`,
              modelName: usedModelName,
              errorCategory: errorClassify.category,
              ...(parameterRejected ? {
                providerStatus: 400,
                providerCode: (singleError as Error & { providerCode?: string }).providerCode || 'request_rejected',
                retryable: false,
              } : {}),
            }, { status: parameterRejected ? 400 : 500 });
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
                creditCost: deductedCredits,
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
        creditCost: deductedCredits,
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
    if (apiError instanceof CanvasGenerationAdmissionError) {
      return NextResponse.json({ success: false, code: apiError.code, error: apiError.message,
        taskIds: apiError.partialTaskIds }, { status: apiError.status });
    }
    if (apiError instanceof GenerationProjectAccessError) {
      return NextResponse.json({ success: false, code: apiError.code, error: apiError.message }, { status: apiError.status });
    }
    const executionCode = apiError && typeof apiError === 'object' && 'code' in apiError ? apiError.code : undefined;
    if (executionCode === 'SKILL_PARENT_CANCELLED' || executionCode === 'SKILL_EXECUTION_SUSPENDED'
      || executionCode === 'SKILL_SUBMISSION_ALREADY_CLAIMED') {
      const messages = {
        SKILL_PARENT_CANCELLED: '父 Skill 已取消，未继续提交图像任务',
        SKILL_EXECUTION_SUSPENDED: '父 Skill 已暂停或执行实例已变化，等待恢复',
        SKILL_SUBMISSION_ALREADY_CLAIMED: '该图像任务已领取派发，正在核对提交结果，请勿重复生成',
      };
      return NextResponse.json({ success: false, code: executionCode, error: messages[executionCode],
        retryable: executionCode === 'SKILL_EXECUTION_SUSPENDED' }, { status: 409 });
    }
    if (apiError instanceof Error && apiError.message === 'SKILL_BILLING_NOT_AUTHORIZED') {
      return NextResponse.json({
        success: false, code: 'SKILL_BILLING_NOT_AUTHORIZED',
        error: 'Skill 费用授权无效或执行状态已变化，请检查任务记录', retryable: false,
      }, { status: 403 });
    }
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
