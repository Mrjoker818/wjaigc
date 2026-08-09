import { NextRequest, NextResponse, after } from 'next/server';
import sharp from 'sharp';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl, getApiProviders } from '@/lib/server-api-config';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/server-auth';
import {
  calculateConfiguredCreditCost,
  consumeCredits,
  refundCredits,
  InsufficientCreditsError,
} from '@/lib/credits';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { validateImageUrl, validatePrompt } from '@/lib/input-validation';
import type { ApiProvider } from '@/lib/universal-api-types';
import { getEditTask, deleteEditTask, setEditTask, updateTaskStage, failEditTask } from '@/lib/edit-task-store';
import { calculateActualPixelsFromRatio } from '@/lib/calculate-pixels';
import type { EditTask } from '@/lib/edit-task-store';
import {
  isTaskCancelled,
  registerTask,
  registerTaskAbortController,
  unregisterTaskAbortController,
  updateTaskProgress,
} from '@/lib/task-registry';
import { logError, OP_ACTIONS, startTimer } from '@/lib/op-log';
import { translateApiError } from '@/lib/api-error-translate';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, buildPollUrl, isEditsEndpointRejected, stripEditsOnlyFields, extractImageUrl } from '@/lib/api-compatibility';
import {
  AnnotationIdempotencyConflictError,
  claimAnnotationEditTask,
  createAnnotationRequestHash,
} from '@/lib/annotation-idempotency';
import {
  chargeCloudTaskCredits,
  completeCloudTask,
  terminateCloudTaskAndRefund,
  updateCloudTask,
} from '@/lib/cloud-task-storage';
import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';
import {
  createTaskEntryAudit,
  executeTaskEntryMigration,
  resolveTaskCoreMode,
} from '@/lib/task-core/entry-migration';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import type { DurableTaskStatus } from '@/lib/task-core/task-state';
import { getRequestId } from '@/lib/request-id';

// 允许大请求体（base64图片可能很大，50MB限制）
export const runtime = 'nodejs';
export const maxDuration = 600;

// ============================================================
// 本地任务存储已迁移到 @/lib/edit-task-store（避免 HMR 隔离）
// ============================================================
interface EditTaskResult {
  success: boolean;
  image?: { url: string; revisedPrompt?: string };
  images?: Array<{ url: string; revisedPrompt?: string }>;
  model?: string;
  provider?: string;
  llmInstruction?: string;
  editRegions?: Array<{ label: string; bounds: { x: number; y: number; width: number; height: number } }>;
  autoMaskGenerated?: boolean;
  error?: string;
  networkError?: boolean;
  requiresApiKey?: boolean;
  status?: number;
}

interface EditRequestBody {
  image?: string;
  prompt?: string;
  mask?: string;
  size?: string;
  quality?: string;
  apiKey?: string;
  model?: string;
  providerId?: string;
  count?: number;
  llmModelId?: string;
  llmProviderId?: string;
  referenceImages?: Array<string | { url?: string }>;
}

// 重新导出供 poll-task 使用（保持兼容）
// Re-exports removed - import directly from '@/lib/edit-task-store' instead
// export { getEditTask, deleteEditTask };

/** 本地便捷：失败任务 */
function failTask(taskId: string, error: string, networkError = false) {
  failEditTask(taskId, error, networkError);
  // ★ 同步更新任务注册中心
  updateTaskProgress(taskId, { status: 'failed', error });
}

async function reportEditTaskProgress(
  taskId: string,
  progress: number,
  stage: string,
  persistCloud: boolean,
): Promise<void> {
  updateTaskStage(taskId, stage, progress);
  updateTaskProgress(taskId, { status: 'processing', progress, label: stage });
  if (persistCloud) {
    await updateCloudTask(taskId, { status: 'processing', progress, label: stage });
  }
}

// 支持编辑的模型列表（用于降级静态列表）
const EDITABLE_MODELS = [
  'gpt-image-2',
  'dall-e-3',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview',
];

/** 将图片 URL/data 转换为 Buffer + mimeType */
async function resolveImageToBuffer(
  imageSrc: string,
  signal: AbortSignal,
): Promise<{ buffer: Buffer; mimeType: string }> {
  return loadSafeImageInput(imageSrc, {
    allowRawBase64: true,
    signal,
  });
}

/**
 * 判断模型是否为图像生成/编辑类模型（非纯聊天模型）
 * 第三方代理上同一个模型可能有不同命名，需要宽松匹配
 */
function isImageEditModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('image') ||
    id.includes('dall-e') ||
    id.includes('gpt-image') ||
    id === 'gpt-image-2'
  );
}

/**
 * 解析 SSE 流式响应，拼接所有 delta content 为完整 JSON 结构
 * 兼容第三方代理忽略 stream:false 强制流式返回的情况
 */
function parseSSEToJSON(sseText: string): Record<string, unknown> {
  const lines = sseText.split('\n');
  let fullContent = '';
  // 保留多模态内容数组（图片等非文本部件）
  const multimodalParts: Array<Record<string, unknown>> = [];
  let lastChunk: Record<string, unknown> | null = null;
  let hasMultimodalContent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) continue;

    try {
      const chunk = JSON.parse(trimmed.slice(6));
      lastChunk = chunk;
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content && typeof delta.content === 'string') {
        fullContent += delta.content;
      }
      // 检查多模态内容（部分代理直接在 delta 中返回图片）
      if (delta?.content && Array.isArray(delta.content)) {
        hasMultimodalContent = true;
        for (const part of delta.content) {
          if (typeof part === 'string') fullContent += part;
          else if (typeof part === 'object' && part !== null) {
            // 保留原始对象结构，不序列化成字符串
            multimodalParts.push(part as Record<string, unknown>);
            // 同时也拼接文本摘要到 fullContent 作为 fallback
            if ('text' in part && typeof (part as Record<string, unknown>).text === 'string') {
              fullContent += (part as Record<string, unknown>).text as string;
            }
          }
        }
      }
    } catch {
      // 跳过无法解析的行
    }
  }

  // 构建与标准 chat/completions 非流式响应一致的 JSON 结构
  // 关键：如果有图片等多模态内容，必须保留数组结构
  const contentValue = hasMultimodalContent && multimodalParts.length > 0
    ? [
        ...(fullContent ? [{ type: 'text', text: fullContent }] : []),
        ...multimodalParts,
      ]
    : (fullContent || '');

  if (lastChunk) {
    return {
      ...lastChunk,
      choices: [{
        ...((lastChunk as Record<string, unknown>).choices as Array<Record<string, unknown>>)?.[0],
        message: { role: 'assistant', content: contentValue },
        finish_reason: 'stop',
      }],
    };
  }

  return { choices: [{ message: { role: 'assistant', content: contentValue } }] };
}

/**
 * 从第三方 API 响应中提取图片 URL/base64
 * 支持多种返回格式，确保兼容各种代理
 */
function extractImageFromResponse(responseData: Record<string, unknown>): string {
  // 格式1: OpenAI images 标准格式 { data: [{ url, b64_json }] }
  const data = responseData.data as Array<Record<string, unknown>> | undefined;
  if (data && Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first?.b64_json) {
      return `data:image/png;base64,${first.b64_json}`;
    }
    if (first?.url) {
      return first.url as string;
    }
  }

  // 格式2: chat/completions 多模态响应 - content 是数组
  const choices = responseData.choices as Array<Record<string, unknown>> | undefined;
  if (choices && Array.isArray(choices) && choices.length > 0) {
    const message = choices[0].message as Record<string, unknown> | undefined;
    if (message) {
      const content = message.content;

      // content 是数组（多模态响应）
      if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part === 'object' && part !== null) {
            // { type: 'image_url', image_url: { url: 'data:...' } }
            if (part.type === 'image_url' && (part as Record<string, unknown>).image_url) {
              const imageUrl = (part as Record<string, Record<string, string>>).image_url;
              if (imageUrl?.url) return imageUrl.url;
            }
            // { type: 'image', source: { data: '...' } } (Anthropic 风格)
            if (part.type === 'image' && (part as Record<string, unknown>).source) {
              const source = (part as Record<string, Record<string, string>>).source;
              if (source?.data) return `data:${source.media_type || 'image/png'};base64,${source.data}`;
            }
            // inline_data 格式
            if ((part as Record<string, unknown>).inline_data) {
              const inlineData = (part as Record<string, Record<string, string>>).inline_data;
              if (inlineData?.data) return `data:${inlineData.mime_type || 'image/png'};base64,${inlineData.data}`;
            }
          }
        }
      }

      // content 是字符串
      if (typeof content === 'string') {
        // 包含 data:image base64
        const base64Match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
        if (base64Match) return base64Match[0];

        // 包含 markdown 图片链接
        const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
        if (mdMatch) return mdMatch[1];

        // 包含纯 URL
        const urlMatch = content.match(/(https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|webp|gif)[^\s"'<>]*)/i);
        if (urlMatch) return urlMatch[1];
      }
    }
  }

  // 格式3: 直接返回 url 字段
  if (responseData.url && typeof responseData.url === 'string') {
    return responseData.url;
  }

  // 格式4: 直接返回 b64_json 字段
  if (responseData.b64_json && typeof responseData.b64_json === 'string') {
    return `data:image/png;base64,${responseData.b64_json}`;
  }

  return '';
}

/** 从 API 响应中提取所有图片（支持 images/edits 返回多张） */
function extractAllImagesFromResponse(responseData: Record<string, unknown>, fallbackPrompt: string): Array<{ url: string; revisedPrompt: string }> {
  const images: Array<{ url: string; revisedPrompt: string }> = [];

  // 格式1: OpenAI images/edits 标准响应 { data: [{ url, b64_json, revised_prompt }] }
  if (responseData.data && Array.isArray(responseData.data)) {
    for (const item of responseData.data as Array<Record<string, unknown>>) {
      const url = item.url as string || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
      if (url) {
        images.push({ url, revisedPrompt: (item.revised_prompt as string) || fallbackPrompt });
      }
    }
  }

  // 格式2: 单张图片响应
  if (images.length === 0) {
    const singleUrl = extractImageFromResponse(responseData);
    if (singleUrl) {
      images.push({ url: singleUrl, revisedPrompt: fallbackPrompt });
    }
  }

  return images;
}

// ============================================================
// POST: 执行语言修图
// ============================================================
export async function POST(request: NextRequest) {
  const opTimer = startTimer();
  const taskStartedAt = Date.now();
  const requestId = getRequestId(request);
  const taskCoreMode = resolveTaskCoreMode(process.env.WUJIE_TASK_CORE_MODE);
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  const annotationIdempotencyKey = request.headers.get('x-idempotency-key')?.trim() || '';
  if (annotationIdempotencyKey.length > 256) {
    return NextResponse.json({
      success: false,
      code: 'ANNOTATION_COMPLEXITY_INVALID',
      error: 'Annotation idempotency key exceeds 256 characters',
    }, { status: 400 });
  }
  let deductedCredits = 0;
  let usesAtomicBilling = false;
  let sessionUser: import('@/lib/user-types').User | null = null;
  let annotationTaskId = '';
  try {
    const annotationBodyLimit = 64 * 1024 * 1024;
    const declaredBodySize = Number(request.headers.get('content-length') || 0);
    if (annotationIdempotencyKey && declaredBodySize > annotationBodyLimit) {
      return NextResponse.json({
        success: false,
        code: 'ANNOTATION_COMPLEXITY_INVALID',
        error: 'Annotation edit request body exceeds 64 MB',
      }, { status: 413 });
    }
    let parsedRequestBody: EditRequestBody;
    if (annotationIdempotencyKey) {
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody, 'utf8') > annotationBodyLimit) {
        return NextResponse.json({
          success: false,
          code: 'ANNOTATION_COMPLEXITY_INVALID',
          error: 'Annotation edit request body exceeds 64 MB',
        }, { status: 413 });
      }
      parsedRequestBody = JSON.parse(rawBody) as EditRequestBody;
    } else {
      parsedRequestBody = await request.json() as EditRequestBody;
    }
    const {
      image,         // base64 data URL（客户端已转换）
      prompt,        // 编辑指令（自然语言）
      mask,          // 可选，mask图片 base64（涂抹区域，所有模型均支持，AI理解蒙版语义）
      size = '1:1',  // 画面比例或像素尺寸
      quality = 'high',
      apiKey,        // 可选，用户提供的 API Key
      model = 'gpt-image-2',
      providerId,    // 管理员系统提供商ID
      count = 1,     // 生图数量
      llmModelId,    // 可选，LLM辅助模型ID
      llmProviderId, // 可选，LLM辅助模型提供商ID
      referenceImages, // 可选，参考图URL数组（多图模式）
    } = parsedRequestBody;
    const usableReferenceImages = (referenceImages || [])
      .map((reference) => typeof reference === 'string' ? reference : reference.url || '')
      .filter(Boolean);

    if (!image) {
      return NextResponse.json({ success: false, error: '请先添加图片' }, { status: 400 });
    }
    const imageUrlError = validateImageUrl(image);
    if (imageUrlError) {
      return NextResponse.json({ success: false, error: imageUrlError }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json({ success: false, error: '请输入编辑指令' }, { status: 400 });
    }
    const promptError = validatePrompt(prompt);
    if (promptError) {
      return NextResponse.json({ success: false, error: promptError }, { status: 400 });
    }

    // ★ 从 model 中提取纯 modelId（前端可能传 providerId::modelId 格式）
    let pureModel = model;
    const extractedProviderId = model.includes('::') ? model.split('::')[0] : '';
    if (model.includes('::')) {
      pureModel = model.split('::').pop()!;
      console.log(`[edit] Stripped provider prefix from model: "${model}" → "${pureModel}"`);
    }

    // ========== 0.5 预获取 provider 用于模型后缀精确匹配 ==========
    let previewProvider: ApiProvider | null = null;
    if (extractedProviderId || providerId) {
      try {
        previewProvider = await findProviderById(extractedProviderId || providerId || '');
      } catch {}
    }
    // 候选API模型名初始为pureModel，provider精确匹配后保留原始名（如PearAPI的gpt-image-2-4k）
    const providerModelsForNorm = previewProvider?.selectedModels || [];

    // ★ 规范化模型名：使用 providerModels 精确匹配判断是否需要剥离 -4k/-2k 后缀
    const modelNorm = normalizeModelForApi(pureModel, { providerModels: providerModelsForNorm });
    let apiModelName = pureModel;
    if (modelNorm.wasNormalized) {
      // 如果提供商模型列表中包含原始名，则保持原始名（不剥离后缀）
      if (!providerModelsForNorm.includes(pureModel)) {
        // 提供商没有该精确模型名时，使用归一化后的 API 模型名
        apiModelName = modelNorm.apiModelName;
        console.log(`[edit] Normalized model name: "${pureModel}" → "${apiModelName}" (stripped suffix: ${modelNorm.strippedSuffix || 'unknown'})`);
      } else {
        console.log(`[edit] Provider has exact model "${pureModel}", keeping original name (not stripping suffix)`);
      }
    }

    // Content safety check
    const safetyResult = checkPromptSafety(prompt);
    if (safetyResult.level === 'block') {
      return NextResponse.json({ success: false, error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    // 积分检查与扣除
    sessionUser = await getSessionUser(request);
    deductedCredits = 0; // 跟踪已扣积分，用于失败退款
    // 积分扣除移到凭证验证之后（第345行之后）

    // ========== 1. 获取 API 凭证（与 /api/generate 一致） ==========
    let effectiveApiKey = apiKey || '';
    let effectiveBaseUrl = '';
    let imageProvider: ApiProvider | null = null; // 保留 provider 对象用于 API 兼容层

    if (!effectiveApiKey && (extractedProviderId || providerId)) {
      try {
        imageProvider = await findProviderById(extractedProviderId || providerId || '');
        if (imageProvider?.apiKey) {
          effectiveApiKey = imageProvider.apiKey;
          effectiveBaseUrl = normalizeApiBaseUrl(imageProvider.baseUrl || '');
        }
      } catch { /* 忽略 */ }
    }

    if (!effectiveApiKey) {
      try {
        imageProvider = await findProviderForModel(pureModel, 'image', extractedProviderId || providerId);
        if (imageProvider?.apiKey) {
          effectiveApiKey = imageProvider.apiKey;
          effectiveBaseUrl = normalizeApiBaseUrl(imageProvider.baseUrl || '');
        }
      } catch { /* 忽略 */ }
    }

    if (!effectiveApiKey) {
      return NextResponse.json({
        success: false,
        error: '需要在管理员系统中配置 API Key',
        requiresApiKey: true,
      }, { status: 400 });
    }

    type EditAdmission = {
      taskId: string | null;
      creditCost: number;
      reused: boolean;
      status: DurableTaskStatus;
    };
    const requestHash = createAnnotationRequestHash(parsedRequestBody);
    const actualProviderId = extractedProviderId || providerId || imageProvider?.id || '';
    const plannedCreditCost = sessionUser
      ? await calculateConfiguredCreditCost(
          'image_retouch',
          model,
          { quality, providerId: providerId || undefined },
        )
      : 0;
    const admission = await executeTaskEntryMigration<EditAdmission>({
      mode: taskCoreMode,
      legacy: async () => {
        let claimedTaskId: string | null = null;
        let reused = false;
        if (annotationIdempotencyKey) {
          const claim = await claimAnnotationEditTask({
            userId: authResult.userId,
            idempotencyKey: annotationIdempotencyKey,
            requestHash,
            providerId: actualProviderId,
            model: pureModel,
          });
          claimedTaskId = claim.taskId;
          reused = !claim.owner;
        }
        if (reused) {
          return { taskId: claimedTaskId, creditCost: 0, reused, status: 'processing' };
        }
        if (!sessionUser) {
          return { taskId: claimedTaskId, creditCost: 0, reused: false, status: 'processing' };
        }
        const creditResult = claimedTaskId
          ? await chargeCloudTaskCredits(
              claimedTaskId,
              sessionUser.id,
              plannedCreditCost,
              `Annotation edit [${pureModel}]`,
            )
          : await consumeCredits(sessionUser.id, 'image_retouch', undefined, undefined, model, { quality, providerId: providerId || undefined });
        const creditAccepted = 'success' in creditResult
          ? creditResult.success
          : creditResult.charged;
        if (!creditAccepted) {
          if (claimedTaskId) {
            await updateCloudTask(claimedTaskId, {
              status: 'failed',
              error: 'Insufficient credits',
              creditStatus: 'not-applicable',
            });
          }
          const balance = 'balance' in creditResult ? creditResult.balance || 0 : 0;
          throw new InsufficientCreditsError(
            sessionUser.id,
            plannedCreditCost,
            balance,
          );
        }
        return {
          taskId: claimedTaskId,
          creditCost: 'cost' in creditResult ? creditResult.cost : creditResult.creditCost,
          reused: false,
          status: 'processing',
        };
      },
      coreV2: async () => {
        const now = Date.now();
        const result = await createBillableTask({
          userId: authResult.userId,
          idempotencyKey: annotationIdempotencyKey || requestId,
          requestDigest: requestHash,
          creditCost: plannedCreditCost,
          task: {
            id: `edit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            type: 'edit',
            status: 'processing',
            providerId: actualProviderId || undefined,
            model: pureModel,
            progress: 0,
            label: '语言修图',
            result: { requestHash },
            createdAt: now,
            updatedAt: now,
          },
        });
        return {
          taskId: result.task.id,
          creditCost: result.task.creditCost || 0,
          reused: result.reused,
          status: result.task.status,
        };
      },
      factsFromResult: value => ({
        providerId: actualProviderId || undefined,
        modelId: pureModel,
        creditCost: value.creditCost,
        status: value.status === 'completed'
          || value.status === 'failed'
          || value.status === 'cancelled'
          || value.status === 'timeout'
          ? value.status
          : 'processing',
      }),
      previewCoreFacts: async () => ({
        providerId: actualProviderId || undefined,
        modelId: pureModel,
        creditCost: plannedCreditCost,
        status: 'processing',
      }),
    });
    usesAtomicBilling = admission.mode === 'core-v2';
    annotationTaskId = admission.value.taskId || '';
    deductedCredits = admission.value.creditCost;
    if (admission.value.reused && admission.value.taskId) {
      return NextResponse.json({
        success: true,
        mode: 'polling',
        taskId: admission.value.taskId,
        replayed: true,
      });
    }

    const taskEntryAudit = createTaskEntryAudit({
      entry: 'edit',
      mode: taskCoreMode,
      requestId,
      requestedProviderId: extractedProviderId || providerId || undefined,
      requestedModelId: model,
      actualProviderId: imageProvider?.id || extractedProviderId || providerId || undefined,
      actualModelId: pureModel,
      startedAt: taskStartedAt,
      creditCost: deductedCredits,
      creditStatus: deductedCredits > 0 ? 'charged' : 'not-applicable',
    });

    // ========== 1.5 创建异步任务（提交+轮询模式，避免CDN/FaaS代理超时） ==========
    const taskId = annotationTaskId || `edit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    if (annotationTaskId) {
      await updateCloudTask(taskId, {
        status: 'processing',
        progress: 0,
        result: {
          requestHash: createAnnotationRequestHash(parsedRequestBody),
          taskEntryAudit,
        },
      });
    }
    setEditTask(taskId, { id: taskId, status: 'processing', progress: 0, stage: '初始化', createdAt: Date.now() });
    // ★ 注册到统一任务中心（SSE推送 + 取消支持）
    registerTask(taskId, 'edit', '语言修图', sessionUser?.id);
    const taskController = new AbortController();
    const taskSignal = taskController.signal;
    registerTaskAbortController(taskId, taskController);
    console.info(`[edit] ★ taskId=${taskId} 创建成功, model=${pureModel}, providerId=${providerId || 'auto'}`);

    // 后台异步执行编辑流程（5分钟全局超时兜底）
    // ★ 使用 after() 确保 Next.js 不会在响应返回后终止 IIFE
    const EDIT_GLOBAL_TIMEOUT_MS = 5 * 60 * 1000;
    after(async () => {
      const timeoutId = setTimeout(() => {
        if (!taskSignal.aborted) {
          const timeoutError = new Error('编辑超时，请稍后重试');
          timeoutError.name = 'TimeoutError';
          taskController.abort(timeoutError);
        }
      }, EDIT_GLOBAL_TIMEOUT_MS);

      const finishTask = async (result: Record<string, unknown>): Promise<boolean> => {
        taskSignal.throwIfAborted();
        await reportEditTaskProgress(
          taskId,
          90,
          '正在保存结果',
          Boolean(annotationTaskId),
        );
        if (annotationTaskId) {
          const committed = await completeCloudTask(taskId, {
            requestHash: createAnnotationRequestHash(parsedRequestBody),
            taskEntryAudit: createTaskEntryAudit({
              ...taskEntryAudit,
              updatedAt: Date.now(),
              creditStatus: deductedCredits > 0 ? 'charged' : 'not-applicable',
            }),
            ...result,
          });
          if (!committed) return false;
        }
        updateTaskProgress(taskId, { status: 'completed', progress: 100 });
        setEditTask(taskId, {
          id: taskId,
          status: 'completed',
          progress: 100,
          stage: '完成',
          result,
          createdAt: getEditTask(taskId)?.createdAt || Date.now(),
          completedAt: Date.now(),
        });
        return true;
      };

      try {
        taskSignal.throwIfAborted();
        // ★ 检查任务是否已被取消
        if (isTaskCancelled(taskId)) {
          failTask(taskId, '任务已被取消');
          return;
        }
        // ========== 2. 解析原图为 Buffer ==========
    await reportEditTaskProgress(
      taskId,
      15,
      '正在准备图片和蒙版',
      Boolean(annotationTaskId),
    );
    const loadedImage = await loadSafeImageInput(image, {
      allowRawBase64: true,
      signal: taskSignal,
    });
    const imageBuffer = loadedImage.buffer;
    const mimeType = loadedImage.mimeType;

    // ========== 3. 解析 mask ==========
    let maskBuffer: Buffer | undefined;
    if (mask) {
      maskBuffer = (await loadSafeImageInput(mask, {
        allowRawBase64: true,
        signal: taskSignal,
      })).buffer;
    }

    // ========== 3.5 画面比例拓展提示 ==========
    // 语言修图：不裁切原图、不加黑边，而是通过提示词引导 AI 在原图基础上自然拓展画面，
    // 生成与原图风格和内容连贯的新区域
    let aspectRatioExtendHint = '';
    if (size && size !== '1:1') {
      try {
        const sharpImg = safeSharp(imageBuffer, { signal: taskSignal });
        const meta = await sharpImg.metadata();
        const origW = meta.width || 1;
        const origH = meta.height || 1;
        const origRatio = origW / origH;

        // 解析目标比例
        const parts = size.split(':').map(Number);
        const targetRatio = parts.length === 2 && parts[0] > 0 && parts[1] > 0
          ? parts[0] / parts[1] : origRatio;

        // 比例差异超过 5% 时，需要拓展画面
        if (Math.abs(origRatio - targetRatio) / Math.max(origRatio, targetRatio) > 0.05) {
          if (origRatio > targetRatio) {
            // 原图更宽 → 目标更高，AI 需要在上下拓展画面
            aspectRatioExtendHint = 'The output aspect ratio is taller than the original image. Naturally extend the scene by adding content above and below, maintaining the original image content in the center and generating coherent new content for the extended areas that matches the original style, lighting, and scene.';
          } else {
            // 原图更高 → 目标更宽，AI 需要在左右拓展画面
            aspectRatioExtendHint = 'The output aspect ratio is wider than the original image. Naturally extend the scene by adding content to the left and right, maintaining the original image content in the center and generating coherent new content for the extended areas that matches the original style, lighting, and scene.';
          }
          console.log(`[edit] Aspect ratio change detected: orig=${origRatio.toFixed(2)} target=${targetRatio.toFixed(2)}, will prompt AI to extend scene`);
        }
      } catch (ratioErr) {
        // 比例检测失败不影响后续流程
        console.warn('[edit] Failed to detect aspect ratio change, skipping extend hint:', ratioErr);
      }
    }

    // ========== 4. 判断调用路径 ==========
    // ★ 不针对特定模型/供应商判断路径，统一优先尝试 images.edit
    // 如果提供商不支持 images.edit，请求会失败并自动 fallback 到其他路径

    // ========== 5. LLM 协作：分析原图 + 优化 prompt + 蒙版语义 ==========
    // 核心思路：LLM 是"大脑"理解意图，图像模型是"手"执行修改
    // 协作流程：LLM 分析原图内容 → 理解用户意图 → 结合蒙版区域 → 生成精准编辑指令
    // ★ 优化：如果 prompt 已经足够详细（>40字符），跳过 LLM 协作以节省时间
    let effectivePrompt = prompt;
    let llmInstruction = prompt; // LLM 生成的精准指令，无 LLM 参与时等于原始 prompt
    let llmEditRegions: Array<{ label: string; bounds: { x: number; y: number; width: number; height: number } }> = []; // LLM 识别的编辑区域
    const llmStartTime = Date.now();

    // ★ 预处理：将前端黑白mask转换为API所需格式（必须在 LLM 协作之前，因为 LLM 也需要看蒙版）
    // 前端发送通用黑白格式（白色=编辑, 黑色=保留）
    // 关键：mask 必须与 image 尺寸完全一致，否则 API 无法正确对齐编辑区域
    let openaiMaskBuffer: Buffer | null = null;
    let maskImageUrl: string | null = null; // 用于非 images.edit 路径的视觉参考
    if (maskBuffer) {
      try {
        // 先获取原图尺寸
        const imageMeta = await safeSharp(imageBuffer, { signal: taskSignal }).metadata();
        const imgW = imageMeta.width || 1;
        const imgH = imageMeta.height || 1;

        // ★ 将 mask resize 到与 image 完全一致的尺寸
        const resizedMaskBuffer = await safeSharp(maskBuffer, { signal: taskSignal })
          .resize(imgW, imgH, { fit: 'fill', kernel: 'nearest' })
          .ensureAlpha()
          .raw()
          .toBuffer();

        // 转换为 OpenAI 格式：白色(luminance>128)→透明=编辑, 黑色→不透明=保留
        const converted = Buffer.alloc(imgW * imgH * 4);
        for (let i = 0; i < imgW * imgH; i++) {
          const r = resizedMaskBuffer[i * 4], g = resizedMaskBuffer[i * 4 + 1], b = resizedMaskBuffer[i * 4 + 2];
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          if (luminance > 128) {
            // 白色→透明（编辑区域）
            converted[i * 4] = 0; converted[i * 4 + 1] = 0; converted[i * 4 + 2] = 0; converted[i * 4 + 3] = 0;
          } else {
            // 黑色→不透明（保留区域）
            converted[i * 4] = 255; converted[i * 4 + 1] = 255; converted[i * 4 + 2] = 255; converted[i * 4 + 3] = 255;
          }
        }
        openaiMaskBuffer = await sharp(converted, { raw: { width: imgW, height: imgH, channels: 4 } }).png().toBuffer();
        console.info(`[edit] taskId=${taskId} mask已转换, 尺寸=${imgW}x${imgH}(与原图一致), OpenAI格式=透明编辑`);

        // 同时生成一个带标注的蒙版参考图（红色高亮编辑区域），用于 LLM 协作和非 images.edit 路径的视觉参考
        const annotatedMask = await safeSharp(maskBuffer, { signal: taskSignal })
          .resize(imgW, imgH, { fit: 'fill', kernel: 'nearest' })
          .ensureAlpha()
          .raw()
          .toBuffer();
        // 在蒙版上叠加红色高亮编辑区域，使AI更容易理解
        const highlightedMask = Buffer.alloc(imgW * imgH * 4);
        for (let i = 0; i < imgW * imgH; i++) {
          const r = annotatedMask[i * 4], g = annotatedMask[i * 4 + 1], b = annotatedMask[i * 4 + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum > 128) {
            // 编辑区域：红色高亮
            highlightedMask[i * 4] = 255; highlightedMask[i * 4 + 1] = 60; highlightedMask[i * 4 + 2] = 60; highlightedMask[i * 4 + 3] = 255;
          } else {
            // 保留区域：深灰
            highlightedMask[i * 4] = 40; highlightedMask[i * 4 + 1] = 40; highlightedMask[i * 4 + 2] = 40; highlightedMask[i * 4 + 3] = 255;
          }
        }
        const highlightedMaskBuf = await sharp(highlightedMask, { raw: { width: imgW, height: imgH, channels: 4 } }).png().toBuffer();
        maskImageUrl = `data:image/png;base64,${highlightedMaskBuf.toString('base64')}`;
      } catch (maskConvErr) {
        console.warn('[edit] mask格式转换失败:', maskConvErr instanceof Error ? maskConvErr.message : maskConvErr);
      }
    }

    // ★ 跳过 LLM 协作的条件：prompt 足够详细（用户自己写了好的 prompt）
    // 短 prompt（如"把背景换成蓝色"）由 LLM 扩展成详细指令价值更大
    // 长 prompt（如详细描述）跳过 LLM 可节省 5-20 秒
    const shouldSkipLlmCollaboration = prompt.length > 80;

    if (shouldSkipLlmCollaboration) {
      console.info(`[edit] taskId=${taskId} 跳过LLM协作 (prompt长度=${prompt.length} > 80), 节省 ${Date.now() - llmStartTime}ms`);
    }

    // ===== 单次 LLM 协作：合并分析+指令生成为1次调用 =====
    if (!shouldSkipLlmCollaboration) {
    try {
      // ★ 检查任务是否已被取消
      if (isTaskCancelled(taskId)) {
        failTask(taskId, '任务已被取消');
        return;
      }
      updateTaskStage(taskId, '分析中');
      console.info(`[edit] taskId=${taskId} 开始LLM协作, prompt="${prompt.substring(0, 60)}..."`);
      // 查找 LLM 提供商：优先使用 llmProviderId，否则查找 chat 类型提供商
      let llmProvider: Awaited<ReturnType<typeof findProviderById>> = null;
      if (llmModelId && llmProviderId) {
        llmProvider = await findProviderById(llmProviderId);
      }
      if (!llmProvider) {
        // fallback: 查找有 chat 能力的提供商
        const allProviders = await getApiProviders();
        const chatProvider = allProviders.find((p: ApiProvider) =>
          p.modelType === 'chat' || (p.selectedModels as string[])?.some((m: string) => m.includes('gemini') || m.includes('gpt'))
        );
        if (chatProvider) llmProvider = chatProvider;
      }
      if (llmProvider) {
        const llmBaseUrl = normalizeApiBaseUrl(llmProvider.baseUrl);
        const llmHeaders = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${llmProvider.apiKey}`,
        };
        const llmModel = llmModelId || (llmProvider.selectedModels as string[])?.[0] || llmProvider.selectedModel || '';

        const collaborationMessages: Array<Record<string, unknown>> = [];
        const contentParts: Array<Record<string, unknown>> = [];

        // 构建多模态消息（原图 + 蒙版参考图 + 参考图）
        const promptText = `You are an expert image editing assistant. Analyze the provided image(s) and generate optimal editing instructions.

TASK: User wants to "${prompt}" the image.
${maskBuffer ? '\nMASK INFO: The user has painted a mask on the image to indicate the SPECIFIC REGION they want to modify. The red-highlighted area in the mask reference image shows where changes should be applied. You MUST focus your editInstruction on modifying ONLY the masked region, keeping everything else unchanged.' : ''}

INSTRUCTIONS:
1. Analyze the original image: describe its content, composition, style, colors, and key elements
2. ${maskBuffer ? 'Analyze the mask: identify what is in the red-highlighted (masked) region that needs to be modified. Describe what content is currently there and what should replace it.' : 'No mask provided - the edit applies to the entire image or the AI should determine the best region.'}
3. ${usableReferenceImages.length > 0 ? 'Analyze the reference image(s): describe how they relate to the editing goal and what aspects should be referenced (style, composition, character, etc.)' : 'No reference image provided.'}
4. Generate a detailed editing instruction that will produce the best result for the user's request

OUTPUT FORMAT (respond with ONLY a JSON object, no markdown):
{
  "originalAnalysis": "Brief description of the original image",
  "maskAnalysis": ${maskBuffer ? '"What is in the masked region and what should change there"' : 'null'},
  "referenceAnalysis": ${usableReferenceImages.length > 0 ? '"Brief description of reference image aspects to apply"' : 'null'},
  "editInstruction": "Detailed editing instruction optimized for image generation AI${maskBuffer ? ', explicitly describing what to change in the masked region only' : ''}",
  "suggestedRegions": ["optional: regions that should be modified"],
  "autoMaskPrompt": "optional: description of regions to mask for precise editing"
}

Make the editInstruction specific, detailed, and optimized for AI image editing. Include style, composition, and quality guidance.`;

        contentParts.push({ type: 'text', text: promptText });

        // 添加原图到消息
        if (imageBuffer) {
          const imageBase64 = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
          contentParts.push({
            type: 'image_url',
            image_url: { url: imageBase64, detail: 'high' }
          });
        }

        // ★ 添加蒙版参考图到消息（红色高亮编辑区域，让LLM理解蒙版位置）
        if (maskImageUrl) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: maskImageUrl, detail: 'high' }
          });
        }

        // 添加参考图到消息
        if (usableReferenceImages.length > 0) {
          for (const refImg of usableReferenceImages.slice(0, 3)) {
            try {
              const refImgUrl = refImg;
              if (!refImgUrl) continue;
              const ref = await resolveImageToBuffer(refImgUrl, taskSignal);
              const refBase64 = `data:${ref.mimeType};base64,${ref.buffer.toString('base64')}`;
              contentParts.push({
                type: 'image_url',
                image_url: { url: refBase64, detail: 'high' }
              });
            } catch (refErr) {
              console.warn('[edit] Failed to load reference image for collaboration:', refErr);
            }
          }
        }

        collaborationMessages.push({ role: 'user', content: contentParts });

        const collabResp = await fetchWithV1Retry(llmBaseUrl, '/chat/completions', {
          method: 'POST',
          headers: llmHeaders,
          body: JSON.stringify({
            model: llmModel,
            messages: collaborationMessages,
            max_tokens: 2000,
            temperature: 0.7,
          }),
          signal: AbortSignal.any([taskSignal, AbortSignal.timeout(20000)]),
        });

        // ★ 403 时自动降级到 /responses 端点（部分提供商仅支持 Responses API）
        let actualCollabResp = collabResp;
        if (collabResp.status === 403) {
          const errBody = await collabResp.text().catch(() => '');
          if (errBody.includes('/responses')) {
            console.info(`[edit] LLM协作 /chat/completions 403, 降级到 /responses`);
            const respBody = {
              model: llmModel,
              input: collaborationMessages.map((m: Record<string, unknown>) => ({
                role: (m.role as string) || 'user',
                content: m.content,
              })),
              stream: false,
            };
            actualCollabResp = await fetchWithV1Retry(llmBaseUrl, '/responses', {
              method: 'POST',
              headers: llmHeaders,
              body: JSON.stringify(respBody),
              signal: AbortSignal.any([taskSignal, AbortSignal.timeout(20000)]),
            });
          }
        }

        if (actualCollabResp.ok) {
          // 兼容 SSE 和非 SSE 响应格式
          const collabText = await actualCollabResp.text();
          let collabData: Record<string, unknown>;
          if (collabText.trimStart().startsWith('data:')) {
            collabData = parseSSEToJSON(collabText);
          } else {
            try {
              collabData = JSON.parse(collabText);
            } catch {
              console.warn('[edit] LLM collaboration response parse failed, skipping LLM enhancement');
              collabData = {};
            }
          }
          const llmResponse = (collabData.choices as Array<Record<string, unknown>>)?.[0]?.message
            ? ((collabData.choices as Array<Record<string, unknown>>)[0].message as Record<string, unknown>).content as string
            : // ★ 兼容 Responses API 格式: output[0].content[0].text
              (collabData.output as Array<Record<string, unknown>>)?.[0]?.content
                ? (((collabData.output as Array<Record<string, unknown>>)[0].content as Array<Record<string, unknown>>)?.[0]?.text as string) || ''
                : '';
          updateTaskStage(taskId, '优化指令中');

          // 尝试解析 JSON 响应
          let parsed: Record<string, unknown> | null = null;
          try {
            const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            }
          } catch {}

          if (typeof parsed?.editInstruction === 'string' && parsed.editInstruction) {
            effectivePrompt = parsed.editInstruction;
            llmInstruction = parsed.editInstruction;
            if (parsed?.suggestedRegions && Array.isArray(parsed.suggestedRegions)) {
              llmEditRegions = parsed.suggestedRegions.map((r: string) => ({
                label: r,
                bounds: { x: 0, y: 0, width: 100, height: 100 }
              }));
            }
            console.log('[edit] LLM generated edit instruction:', effectivePrompt.substring(0, 100));
          } else {
            // 如果 JSON 解析失败，尝试使用 LLM 原始响应
            const cleanedResponse = llmResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/^[\s\S]*?\{/m, '{').replace(/\}[\s\S]*$/m, '}');
            if (cleanedResponse.length > 20) {
              try {
                const retryParsed = JSON.parse(cleanedResponse);
                if (retryParsed?.editInstruction) {
                  effectivePrompt = retryParsed.editInstruction;
                  llmInstruction = retryParsed.editInstruction;
                }
              } catch {
                if (llmResponse.length > prompt.length) {
                  effectivePrompt = llmResponse.substring(0, 1000);
                  llmInstruction = effectivePrompt;
                }
              }
            } else if (llmResponse.length > prompt.length) {
              effectivePrompt = llmResponse.substring(0, 1000);
              llmInstruction = effectivePrompt;
            }
          }
        } else {
          console.warn('[edit] LLM collaboration request failed:', collabResp.status);
        }
      }
    } catch (llmErr) {
      console.warn('LLM collaboration failed, using original prompt:', llmErr);
    }
    } // end of if (!shouldSkipLlmCollaboration)

    console.info(`[edit] taskId=${taskId} LLM协作阶段耗时=${Date.now() - llmStartTime}ms, effectivePrompt长度=${effectivePrompt.length}`);

    await reportEditTaskProgress(
      taskId,
      30,
      '正在提交模型',
      Boolean(annotationTaskId),
    );
    let editInstruction = `Edit this image according to the following instruction: ${effectivePrompt}. Maintain the overall composition and style while making the requested changes.${aspectRatioExtendHint ? ` ${aspectRatioExtendHint}` : ''}${size ? ` Output image size: ${size}.` : ''}${quality ? ` Output quality: ${quality}.` : ''}`;
    // 蒙版语义增强：所有路径统一添加蒙版描述
    if (maskBuffer) {
      editInstruction += ' IMPORTANT: A mask image is provided that indicates the specific area to edit. The mask highlights the region where changes should be applied. You MUST focus your edits on the masked area and keep everything outside the mask unchanged.';
    }

    // ========== 6. 调用 API（全兼容模式） ==========
    // ★ 检查任务是否已被取消
    if (isTaskCancelled(taskId)) {
      failTask(taskId, '任务已被取消');
      return;
    }
    await reportEditTaskProgress(
      taskId,
      45,
      '模型正在处理',
      Boolean(annotationTaskId),
    );
    const editStartTime = Date.now();

    // ★ mask 预处理已在 LLM 协作之前完成（openaiMaskBuffer / maskImageUrl 已就绪）

    console.info(`[edit] taskId=${taskId} 开始图像编辑, model=${pureModel}, hasMask=${!!maskBuffer}, count=${count}`);

    // 路径选择策略（通用，不针对任何模型或供应商）：
    // - 有mask时：直接走images/generations（mask作为视觉参考图+prompt语义描述），
    //   因为第三方代理可能不正确转发images.edit的mask参数
    // - 无mask时：优先images.edit → fallback images/generations → chat/completions
    // - 所有路径都在 prompt 中描述蒙版语义（通用增强）
    const skipImagesEdit = !!maskBuffer; // 有mask时跳过images.edit，走视觉参考路径

    // ★ 路径A: images/edits 端点（仅无mask时尝试）
    if (!skipImagesEdit) {
    try {
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('model', apiModelName);
        form.append('image', imageBuffer, { filename: 'image.png', contentType: mimeType });
        form.append('prompt', editInstruction);

        // 根据用户选择的分辨率动态计算像素尺寸
        let outputSize = size;
        if (size.includes(':')) {
          // 比例格式（如 "1:1", "16:9"）→ 根据质量转换为像素
          const pixelSize = calculateActualPixelsFromRatio(size, quality, pureModel);
          if (pixelSize) {
            outputSize = pixelSize; // 已经是 "WxH" 格式
          } else {
            // Fallback: 1K 默认映射
            const fallbackMap: Record<string, string> = { '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792', '4:3': '1536x1024', '3:4': '1024x1536' };
            outputSize = fallbackMap[size] || '1024x1024';
          }
        } else if (size === '1024' || size === '1536' || size === '2048') {
          outputSize = `${size}x${size}`;
        } else if (!size.includes('x')) {
          outputSize = `${size}x${size}`;
        }

        // ★ 安全限制：如果 outputSize 是 "WxH" 格式且最长边超过 2048，等比缩小到 2048 以内
        const sizeMatch = outputSize.match(/^(\d+)x(\d+)$/);
        if (sizeMatch) {
          const sw = parseInt(sizeMatch[1], 10);
          const sh = parseInt(sizeMatch[2], 10);
          const maxDim = Math.max(sw, sh);
          if (maxDim > 2048) {
            const downScale = 2048 / maxDim;
            outputSize = `${Math.round(sw * downScale)}x${Math.round(sh * downScale)}`;
            console.debug(`[edit] size ${sw}x${sh} exceeds 2048 limit, capping to ${outputSize}`);
          }
        }

        form.append('size', outputSize);
        form.append('quality', quality);
        form.append('n', String(Math.min(count, 4)));

        // Node.js 原生 fetch 不能正确流式传输 form-data，
        // 需要将 form 转为 Buffer 发送，确保 boundary 完整传输
        const formBuffer = form.getBuffer();
        const formHeaders = form.getHeaders();

        const editResponse = await fetchWithV1Retry(
          effectiveBaseUrl,
          '/images/edits',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveApiKey}`,
              ...formHeaders,
              'Content-Length': String(formBuffer.length),
            },
            body: formBuffer as unknown as BodyInit,
            signal: AbortSignal.any([taskSignal, AbortSignal.timeout(30000)]),
          },
        );

        console.info(`[edit] taskId=${taskId} images.edit响应, 状态=${editResponse.status}, 耗时=${Date.now() - editStartTime}ms`);

        if (!editResponse.ok) {
          const errText = await editResponse.text().catch(() => '');
          console.warn(`images.edit failed (${editResponse.status}), falling back to chat/completions: ${errText.substring(0, 200)}`);
        } else {
          const editData = await editResponse.json();
          const images = extractAllImagesFromResponse(editData, effectivePrompt);
          if (images.length > 0) {
            // ★ count > 1 时，如果 API 返回的图片不够，额外并行生成
            if (count > 1 && images.length < count) {
              console.info(`[edit] taskId=${taskId} images.edit返回${images.length}张, 需要额外生成${count - images.length}张`);
              const extraPromises = Array.from({ length: count - images.length }, () => {
                const extraForm = new FormData();
                extraForm.append('model', model);
                extraForm.append('image', imageBuffer, { filename: 'image.png', contentType: mimeType });
                extraForm.append('prompt', editInstruction);
                if (openaiMaskBuffer) {
                  extraForm.append('mask', openaiMaskBuffer, { filename: 'mask.png', contentType: 'image/png' });
                }
                extraForm.append('size', outputSize);
                extraForm.append('quality', quality);
                const extraFormBuffer = extraForm.getBuffer();
                const extraFormHeaders = extraForm.getHeaders();
                return fetchWithV1Retry(effectiveBaseUrl, '/images/edits', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${effectiveApiKey}`,
                    ...extraFormHeaders,
                    'Content-Length': String(extraFormBuffer.length),
                  },
                  body: extraFormBuffer as unknown as BodyInit,
                  signal: AbortSignal.any([taskSignal, AbortSignal.timeout(30000)]),
                })
                .then(async r => {
                  if (!r.ok) return null;
                  const d = await r.json();
                  const extra = extractAllImagesFromResponse(d, effectivePrompt);
                  return extra[0] || null;
                })
                .catch(() => null);
              });
              const extraResults = await Promise.all(extraPromises);
              for (const r of extraResults) { if (r) images.push(r); }
            }
            await finishTask({
              success: true,
              image: images[0],
              images,
              model: pureModel,
              provider: 'openai-images-edit',
              llmInstruction,
              editRegions: llmEditRegions,
              autoMaskGenerated: llmEditRegions.length > 0,
            });
            return;
          }
          }
      } catch (editErr) {
        console.warn('images.edit error, falling back to images/generations:', editErr instanceof Error ? editErr.message : editErr);
      }
    } // end if (!skipImagesEdit)

    // ★ 检查任务是否已被取消（images.edit 之后）
    if (isTaskCancelled(taskId)) {
      failTask(taskId, '任务已被取消');
      return;
    }

    // 路径B: images/generations 端点
    // - 有mask时：直接走此路径（mask作为视觉参考图+prompt语义描述，通用不针对供应商）
    // - 无mask+images/edit成功时：不会到达这里（已 return）
    // - 无mask+images/edit失败时：必须走此路径 fallback
    const compatProfile = resolveCompatProfile(imageProvider);
    // ★ 关键修复：images/edits 失败后也必须走 images/generations
    // 如果代码执行到这里且 !skipImagesEdit，说明 images/edits 已经失败（成功已 return）
    // 之前只判断 skipImagesEdit || editEndpoint==='/images/generations'，
    // 导致 images/edits 失败后直接跳到 chat/completions（路径C），绕过了 images/generations
    const useGenerationsPath = true; // ★ 始终尝试 images/generations
    if (useGenerationsPath) {
      try {
        console.info(`[edit] taskId=${taskId} 使用images/generations路径, 原因: ${skipImagesEdit ? '有mask走视觉参考' : 'editEndpoint=/images/generations'}, model=${pureModel}`);

        // 先将原图保存为可访问的 URL（images/generations 需要 URL，不支持 base64）
        let imageUrlForApi = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
        // 如果原图太大，先压缩
        if (imageBuffer.length > 4 * 1024 * 1024) {
          try {
            const compressed = await safeSharp(imageBuffer, { signal: taskSignal })
              .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toBuffer();
            imageUrlForApi = `data:image/jpeg;base64,${compressed.toString('base64')}`;
          } catch { /* 压缩失败就用原图 */ }
        }

        // 先构建 image_urls 数组（需要在 adjustRequestForProfile 之前，这样兼容层才能转换为 images[] 格式）
        const imageUrls: string[] = [imageUrlForApi];
        // ★ 蒙版参考图：红色高亮标注编辑区域，让AI理解蒙版位置
        if (maskImageUrl) {
          imageUrls.push(maskImageUrl);
          console.info(`[edit] taskId=${taskId} images/generations: 蒙版参考图已添加到image_urls`);
        }
        if (usableReferenceImages.length > 0) {
          for (const refUrl of usableReferenceImages) {
            try {
              const ref = await resolveImageToBuffer(refUrl, taskSignal);
              let refDataUrl = `data:${ref.mimeType};base64,${ref.buffer.toString('base64')}`;
              if (ref.buffer.length > 4 * 1024 * 1024) {
                try {
                  const compressed = await safeSharp(ref.buffer, { signal: taskSignal })
                    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                  refDataUrl = `data:image/jpeg;base64,${compressed.toString('base64')}`;
                } catch { /* 压缩失败就用原图 */ }
              }
              imageUrls.push(refDataUrl);
            } catch { /* 参考图获取失败，跳过 */ }
          }
        }
        // ★ 蒙版作为视觉参考图发送（黑白格式：白色=编辑区域, 黑色=保留区域）
        if (maskBuffer) {
          imageUrls.push(`data:image/png;base64,${maskBuffer.toString('base64')}`);
        }

        // 构建 images/generations 请求体（image_urls 在此放入，兼容层才能正确转换）
        const genRequestBody: Record<string, unknown> = {
          model: apiModelName,
          prompt: editInstruction,
          // 根据质量参数动态计算默认尺寸
          ...((() => {
            const ps = calculateActualPixelsFromRatio('1:1', quality || 'auto', modelNorm.apiModelName);
            return { size: size || ps || '1024x1024', quality: quality || 'auto' };
          })()),
          n: Math.min(count, 4),
          image_urls: imageUrls,
        };

        // 使用 adjustRequestForProfile 自动调整请求体（images[] 格式转换、size 格式转换等）
        const { body: adjustedBody, endpoint: resolvedEndpoint } = adjustRequestForProfile(genRequestBody, compatProfile, {
          hasImage: true,  // 有参考图，让兼容层正确转换为 images[] 格式
          isEditEndpoint: false,
          forceGenerationsEndpoint: true,  // 强制使用 /images/generations 端点
        });

        // 增强 prompt：确保 AI 将参考图作为编辑基础
        if (imageUrls.length > 0) {
          let promptPrefix = `[IMAGE-TO-IMAGE MODE] You MUST use the provided reference image as the mandatory source/base for editing. Do NOT generate from scratch. `;
          if (maskBuffer) {
            promptPrefix += `The LAST image is a mask overlay: WHITE areas indicate regions to modify/edit, BLACK areas must remain unchanged. Only apply changes within the white mask regions. Preserve all details outside the mask precisely. `;
          }
          adjustedBody.prompt = `${promptPrefix}${String(adjustedBody.prompt || '')}`;
        }

        console.info(`[edit] taskId=${taskId} images/generations 请求: endpoint=${resolvedEndpoint}, body keys=${Object.keys(adjustedBody).join(',')}, has_images=${!!adjustedBody.images}, has_image_urls=${!!adjustedBody.image_urls}, has_image=${!!adjustedBody.image}, prompt_len=${String(adjustedBody.prompt||'').length}`);

        const genResponse = await fetchWithV1Retry(
          effectiveBaseUrl,
          resolvedEndpoint,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(adjustedBody),
            signal: taskSignal,
          },
        );

        if (genResponse.ok) {
          const responseText = await genResponse.text();
          let responseData: Record<string, unknown>;

          // 处理 SSE 流式响应
          if (responseText.trimStart().startsWith('data:')) {
            responseData = parseSSEToJSON(responseText);
          } else {
            try { responseData = JSON.parse(responseText); } catch {
              throw new Error('API 响应解析失败');
            }
          }

          // 使用 parseResponseForProfile 解析响应
          const parsed = parseResponseForProfile(responseData, compatProfile);

          if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
            // 直接返回图片 URL
            const images: Array<{ url: string; revisedPrompt: string }> = parsed.directImageUrls.map(url => ({
              url,
              revisedPrompt: effectivePrompt,
            }));

            // count > 1 时额外并行生成
            if (count > 1) {
              const extraPromises = Array.from({ length: count - 1 }, () =>
                fetchWithV1Retry(effectiveBaseUrl, resolvedEndpoint, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${effectiveApiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ ...adjustedBody, n: 1 }),
                  signal: AbortSignal.any([taskSignal, AbortSignal.timeout(120000)]),
                })
                .then(async r => {
                  if (!r.ok) return null;
                  const t = await r.text();
                  let d: Record<string, unknown>;
                  if (t.trimStart().startsWith('data:')) d = parseSSEToJSON(t);
                  else try { d = JSON.parse(t); } catch { return null; }
                  const p = parseResponseForProfile(d, compatProfile);
                  return p.mode === 'direct' && p.directImageUrls[0]
                    ? { url: p.directImageUrls[0], revisedPrompt: effectivePrompt }
                    : null;
                })
                .catch(() => null)
              );
              const extraResults = await Promise.all(extraPromises);
              for (const r of extraResults) { if (r) images.push(r); }
            }

            await finishTask({
              success: true,
              image: images[0],
              images,
              model: pureModel,
              provider: effectiveBaseUrl || 'unknown',
              llmInstruction,
              editRegions: llmEditRegions,
              autoMaskGenerated: llmEditRegions.length > 0,
            });
            return; // 成功，退出
          }

          if (parsed.mode === 'polling' && parsed.taskIds.length > 0) {
            // 异步轮询模式：将 taskIds 存储到任务中，由 poll-task 路由处理
            const remoteTaskId = parsed.taskIds[0];
            console.info(`[edit] images/generations returned task_id: ${remoteTaskId}, delegating to poll-task`);

            // 将远程 taskId 写入 editTask，让 /api/poll-task 的远程轮询逻辑接管
            updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '已提交，等待生成' });
            // ★ 关键修复: 如果API返回了task_id（异步模式），但compatProfile是pollMode:'none'，
            // 说明该提供商实际上支持异步轮询，需要升级compatProfile以确保poll-task能正确轮询
            let effectiveCompatProfile = compatProfile;
            if (compatProfile && compatProfile.pollMode === 'none' && parsed.taskIds?.length) {
              effectiveCompatProfile = { ...compatProfile, pollMode: 'path', pollPathTemplate: '/tasks/{taskId}' };
              console.info(`[edit] Upgrading compatProfile from pollMode:'none' to 'path' (API returned task_id=${remoteTaskId})`);
            }

            setEditTask(taskId, {
              id: taskId,
              status: 'processing',
              progress: 10,
              stage: '已提交',
              result: undefined,
              createdAt: getEditTask(taskId)?.createdAt || Date.now(),
              // 附加远程轮询信息
              remotePollInfo: {
                taskId: remoteTaskId,
                apiBaseUrl: effectiveBaseUrl,
                providerId: providerId || '',
                model: apiModelName,                prompt: effectivePrompt,
                allTaskIds: parsed.taskIds,
                compatProfile: effectiveCompatProfile,
              },
            } as EditTask);
            return; // 轮询将由前端驱动
          }

          // 响应中既没有图片也没有 task_id
          console.warn('[edit] images/generations response has no images or task_ids, falling back to chat/completions');
        } else {
          // images/generations 失败
          const errText = await genResponse.text().catch(() => '');
          console.warn(`[edit] images/generations failed (${genResponse.status}): ${errText.substring(0, 200)}`);

          // ★ Fallback: if images[] nested format was rejected, retry with image_urls flat format
          // Some providers (e.g. AI Link) don't support nested images[] on /images/generations
          if (Array.isArray(adjustedBody.images) && adjustedBody.images.length > 0
              && isEditsEndpointRejected(genResponse.status, errText)) {
            console.info('[edit] /images/generations with images[] format rejected, retrying with image_urls flat format...');
            const flatUrls = (adjustedBody.images as Array<{ image_url: { url: string } }>)
              .map((img) => img.image_url?.url || '')
              .filter(Boolean);
            const flatBody = { ...adjustedBody };
            delete flatBody.images;
            flatBody.image_urls = flatUrls;

            try {
              const flatResponse = await fetchWithV1Retry(
                effectiveBaseUrl,
                resolvedEndpoint,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${effectiveApiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(flatBody),
                  signal: AbortSignal.any([taskSignal, AbortSignal.timeout(120000)]),
                },
              );
              if (flatResponse.ok) {
                const flatResponseText = await flatResponse.text();
                let flatData: Record<string, unknown>;
                if (flatResponseText.trimStart().startsWith('data:')) {
                  flatData = parseSSEToJSON(flatResponseText);
                } else {
                  try { flatData = JSON.parse(flatResponseText); } catch {
                    throw new Error('API 响应解析失败');
                  }
                }
                const flatParsed = parseResponseForProfile(flatData, compatProfile);
                if (flatParsed.mode === 'direct' && flatParsed.directImageUrls.length > 0) {
                  const flatImages: Array<{ url: string; revisedPrompt: string }> = flatParsed.directImageUrls.map(url => ({
                    url,
                    revisedPrompt: effectivePrompt,
                  }));
                  await finishTask({
                    success: true,
                    image: flatImages[0],
                    images: flatImages,
                    model: pureModel,
                    provider: effectiveBaseUrl || 'unknown',
                    llmInstruction,
                    editRegions: llmEditRegions,
                    autoMaskGenerated: llmEditRegions.length > 0,
                  });
                  return;
                }
              } else {
                const flatErrText = await flatResponse.text().catch(() => '');
                console.warn(`[edit] retry with image_urls also failed (${flatResponse.status}): ${flatErrText.substring(0, 200)}, falling back to chat/completions`);
              }
            } catch (flatRetryErr) {
              console.warn('[edit] retry with image_urls error, falling back to chat/completions:', flatRetryErr instanceof Error ? flatRetryErr.message : flatRetryErr);
            }
          } else {
            console.warn('[edit] falling back to chat/completions');
          }
        }
      } catch (genErr) {
        console.warn('[edit] images/generations error, falling back to chat/completions:', genErr instanceof Error ? genErr.message : genErr);
      }
    }

    // ★ 检查任务是否已被取消（images/generations 之后）
    if (isTaskCancelled(taskId)) {
      failTask(taskId, '任务已被取消');
      return;
    }

    // 路径B: chat/completions 多模态端点（兜底，适用于支持图片输出的 LLM）
    // 仅在 images/generations 不可用或失败时使用
    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

    // 主图
    contentParts.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` },
    });

    // 参考图
    if (usableReferenceImages.length > 0) {
      for (const refUrl of usableReferenceImages) {
        try {
          const ref = await resolveImageToBuffer(refUrl, taskSignal);
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${ref.mimeType};base64,${ref.buffer.toString('base64')}` },
          });
        } catch (refErr) {
          console.warn('Failed to load reference image, skipping:', refErr);
        }
      }
      contentParts.push({
        type: 'text',
        text: `[System: There are ${usableReferenceImages.length} reference image(s) above. Use them as style/composition/subject references when editing the main image.]`,
      });
    }

    // ★ 蒙版参考图
    if (maskImageUrl) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: maskImageUrl },
      });
      contentParts.push({
        type: 'text',
        text: '[System: The image above is a MASK overlay. The RED-highlighted area indicates the region you MUST modify. Only change content within the red/masked region, keep everything else identical.]',
      });
    }

    // 蒙版参考图（将蒙版作为参考图发送给AI）
    if (maskBuffer) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${maskBuffer.toString('base64')}` },
      });
      contentParts.push({
        type: 'text',
        text: `[System: The last image is a mask overlay. The WHITE areas indicate the regions you should modify/edit. The BLACK areas must remain unchanged. Only apply changes within the white mask regions. Preserve all details outside the mask precisely.]`,
      });
    }

    // 编辑指令
    contentParts.push({ type: 'text', text: editInstruction });

    // 根据质量参数动态计算像素尺寸
    const outputSize = (() => {
      if (size && /^\d+x\d+$/.test(size)) return size; // 已经是像素格式
      const ratio = size || '1:1';
      return calculateActualPixelsFromRatio(ratio, quality || 'auto', modelNorm.apiModelName) || '1024x1024';
    })();

// 构建 chat/completions 请求体
    const chatRequestBody: Record<string, unknown> = {
      model: apiModelName,
      messages: [{
        role: 'user',
        content: contentParts,
      }],
      max_tokens: 4096,
      stream: false,
    };

    // ★ 将 size、quality、n 参数传递给 chat/completions（兼容提供商如 apimart 等会使用这些参数）
    if (outputSize) chatRequestBody.size = outputSize;
    if (quality) chatRequestBody.quality = quality;
    if (count > 1) chatRequestBody.n = count;

    const chatResponse = await fetchWithV1Retry(
      effectiveBaseUrl,
      '/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${effectiveApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chatRequestBody),
        signal: AbortSignal.any([taskSignal, AbortSignal.timeout(120000)]),
      },
    );

    console.info(`[edit] taskId=${taskId} chat/completions响应, 状态=${chatResponse.status}, 耗时=${Date.now() - editStartTime}ms`);

    if (!chatResponse.ok) {
      const errText = await chatResponse.text().catch(() => '');
      let errorMsg = `API 调用失败 (${chatResponse.status})`;

      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) {
          errorMsg = errJson.error.message;
        } else if (errJson.message) {
          errorMsg = errJson.message;
        }
      } catch {
        if (errText) errorMsg += `: ${errText.substring(0, 200)}`;
      }

      // ★ 清理常见 API 错误信息，提供更友好的中文提示
      const translatedMsg = translateApiError(errorMsg);

      // ★ 渠道不可用 / 模型未找到 — 直接失败，提示用户检查配置
      if (errorMsg.includes('No available channel') || errorMsg.includes('not configured') || errorMsg.includes('model_not_found') || errorMsg.includes('model not found') || errorMsg.includes('failover groups exhausted') || errorMsg.includes('可用渠道失败') || errorMsg.includes('No healthy upstream') || errorMsg.includes('channel not found')) {
        failTask(taskId, `当前 API 提供商渠道不可用: ${translatedMsg}。请尝试更换提供商或稍后重试`);
        return;
      } else if (chatResponse.status === 401 || chatResponse.status === 403) {
        failTask(taskId, `API Key 无效或权限不足: ${translatedMsg}`);
        return;
      } else if (chatResponse.status === 429) {
        failTask(taskId, '请求频率超限，请稍后再试');
        return;
      } else if (chatResponse.status === 404) {
        failTask(taskId, `模型 ${pureModel} 在当前 API 端点不可用，请检查模型名称或更换 API 提供商`);
        return;
      } else if (chatResponse.status === 400) {
        // 400 可能是模型不支持图片输入，尝试降级到 /images/generations
        if (isImageEditModel(pureModel)) {
          try {
            const genUrl = await tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, apiModelName, effectivePrompt, size, quality, 1, taskSignal);
            if (genUrl) {
              const images: Array<{ url: string; revisedPrompt: string }> = [{ url: genUrl, revisedPrompt: effectivePrompt }];
              // count > 1 时额外并行生成
              if (count > 1) {
                const extraPromises = Array.from({ length: count - 1 }, () =>
                  tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, apiModelName, effectivePrompt, size, quality, 1, taskSignal)
                    .then(url => url ? { url, revisedPrompt: effectivePrompt } : null)
                    .catch(() => null)
                );
                const extraResults = await Promise.all(extraPromises);
                for (const r of extraResults) { if (r) images.push(r); }
              }
              await finishTask({
                success: true,
                image: images[0],
                images,
                model: pureModel,
                provider: 'images-generations-fallback',
                llmInstruction,
                editRegions: llmEditRegions,
                autoMaskGenerated: false,
              });
              return;
            }
          } catch { /* 忽略 */ }
        }
        failTask(taskId, `请求参数错误: ${translatedMsg}`);
        return;
      }

      // ★ 5xx 服务端错误 — 直接失败
      if (chatResponse.status >= 500) {
        failTask(taskId, `API 服务端错误 (${chatResponse.status}): ${translatedMsg}。请尝试更换提供商或稍后重试`);
        return;
      } else {
        failTask(taskId, translatedMsg);
        return;
      }
    }

    // 解析响应（兼容流式和非流式）
    const chatText = await chatResponse.text();
    let chatData: Record<string, unknown>;

    if (chatText.trimStart().startsWith('data:')) {
      console.info('[edit] API returned SSE stream despite stream:false, parsing SSE events');
      chatData = parseSSEToJSON(chatText);
    } else {
      try {
        chatData = JSON.parse(chatText);
      } catch {
        failTask(taskId, `API 响应解析失败: ${chatText.substring(0, 200)}`);
        return;
      }
    }

    let resultImageUrl = extractImageFromResponse(chatData);
    console.info(`[edit] taskId=${taskId} chat/completions图片提取: ${resultImageUrl ? '成功' : '未找到'}, 耗时=${Date.now() - editStartTime}ms`);

    // chat/completions 未提取到图片，尝试降级到 images/generations（★ 限时30秒，避免长时间等待）
    if (!resultImageUrl && isImageEditModel(pureModel)) {
      try {
        console.info(`[edit] taskId=${taskId} chat/completions未返回图片, 尝试images/generations降级`);
        const fallbackStart = Date.now();
        const genUrl = await tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, apiModelName, effectivePrompt, size, quality, 1, taskSignal);
        if (genUrl) resultImageUrl = genUrl;
        console.info(`[edit] taskId=${taskId} images/generations降级: ${genUrl ? '成功' : '失败'}, 耗时=${Date.now() - fallbackStart}ms`);
      } catch { /* 忽略 */ }
    }

    if (!resultImageUrl) {
        const chatChoices = (chatData as Record<string, unknown>).choices as Array<Record<string, unknown>> | undefined;
        const textContent = chatChoices?.[0]?.message
          ? ((chatChoices[0].message as Record<string, unknown>).content as string)
          : undefined;
        if (typeof textContent === 'string' && textContent.length > 0 && !textContent.includes('data:image')) {
          failTask(taskId, '模型未返回编辑后的图片，仅返回了文本描述。请尝试更换模型或 API 提供商');
          return;
        }

        failTask(taskId, '图片编辑失败，未返回有效结果。请检查 API 配置或稍后重试');
        return;
      }

    // ★ count > 1 时，多次图像生成（并行调用，节省LLM开销）
    const images: Array<{ url: string; revisedPrompt: string }> = [{ url: resultImageUrl, revisedPrompt: effectivePrompt }];
    if (count > 1) {
      // 对于 Gemini 模型，重复调用 chat/completions（无需 LLM 协作，直接使用优化后的 prompt）
      // 对于 OpenAI 模型，使用 images/generations
      const extraCount = count - 1;
      const extraPromises = Array.from({ length: extraCount }, async () => {
        try {
          if (isImageEditModel(pureModel)) {
            // Gemini 模型：再次调用 chat/completions（不带 LLM 协作）
            const extraResp = await fetchWithV1Retry(effectiveBaseUrl, '/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${effectiveApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: apiModelName,                messages: [{ role: 'user', content: contentParts }],
                max_tokens: 4096,
                stream: false,
                ...(outputSize ? { size: outputSize } : {}),
                ...(quality ? { quality } : {}),
              }),
              signal: AbortSignal.any([taskSignal, AbortSignal.timeout(60000)]),
            });
            if (extraResp.ok) {
              const extraText = await extraResp.text();
              let extraData: Record<string, unknown>;
              if (extraText.trimStart().startsWith('data:')) {
                extraData = parseSSEToJSON(extraText);
              } else {
                try { extraData = JSON.parse(extraText); } catch { return null; }
              }
              const extraUrl = extractImageFromResponse(extraData);
              return extraUrl ? { url: extraUrl, revisedPrompt: effectivePrompt } : null;
            }
            return null;
          } else {
            // OpenAI 模型：使用 images/generations
            const genUrl = await tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, apiModelName, effectivePrompt, size, quality, 1, taskSignal);
            return genUrl ? { url: genUrl, revisedPrompt: effectivePrompt } : null;
          }
        } catch { return null; }
      });
      const extraResults = await Promise.all(extraPromises);
      for (const r of extraResults) {
        if (r) images.push(r);
      }
    }

    // 存储成功结果到任务
    // ★ 更新任务注册中心
    const elapsedSec = Math.round((Date.now() - (getEditTask(taskId)?.createdAt || Date.now())) / 1000);
    console.info(`[edit] taskId=${taskId} 编辑完成, 耗时=${elapsedSec}s, images=${images.length}`);
    await finishTask({
      success: true,
      image: images[0],
      images,
      model: pureModel,
      provider: effectiveBaseUrl || 'unknown',
      llmInstruction,
      editRegions: llmEditRegions,
      autoMaskGenerated: llmEditRegions.length > 0,
    });
    console.info(`[edit] ★ taskId=${taskId} 结果已存储到 edit-task-store, image[0]=${images[0]?.url?.substring(0, 80)}`);

    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[edit] ★ taskId=${taskId} IIFE异常: ${errMsg}`, error);
      const stack = error instanceof Error ? error.stack : '';
      if (stack) console.error(`[edit] Stack: ${stack}`);

      const isNetworkError = errMsg.includes('fetch failed') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND');
      if (!isTaskCancelled(taskId)) {
        failTask(taskId, isNetworkError ? '网络连接失败：无法访问 API 服务' : (errMsg || '图片编辑失败'), isNetworkError);
      }
    } finally {
      const finalTask = getEditTask(taskId);
      if (annotationTaskId) {
        const timeoutAborted = taskSignal.aborted
          && taskSignal.reason instanceof Error
          && taskSignal.reason.name === 'TimeoutError';
        const terminalStatus = timeoutAborted
          ? 'timeout'
          : (isTaskCancelled(taskId) || finalTask?.status === 'cancelled')
            ? 'cancelled'
            : finalTask?.status === 'failed'
              ? 'failed'
              : null;
        if (terminalStatus) {
          await terminateCloudTaskAndRefund(
            taskId,
            terminalStatus,
            finalTask?.error
              || (taskSignal.reason instanceof Error ? taskSignal.reason.message : '')
              || 'Annotation edit failed',
          );
        }
      }
      clearTimeout(timeoutId);
      unregisterTaskAbortController(taskId, taskController);
    }
  });

  // ========== 立即返回 taskId（提交+轮询模式） ==========
   return NextResponse.json({
     success: true,
     mode: 'polling',
     taskId,
     estimatedTime: 30,
     requestId,
     handlerVersion: taskEntryAudit.handlerVersion,
   });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[edit] Task creation error: ${message}`);
    // 记录操作日志 - 语言修图失败
    logError(OP_ACTIONS.LANG_EDIT, error, {
      userId: sessionUser?.id || 'anonymous',
      userName: sessionUser?.name,
      targetType: 'image',
      durationMs: opTimer.end(),
    });
    // 退款：任务创建失败时退还积分
    if (usesAtomicBilling && annotationTaskId) {
      try {
        await terminateCloudTaskAndRefund(
          annotationTaskId,
          'failed',
          message.substring(0, 100),
        );
      } catch (refundErr) {
        console.error('[edit] Atomic annotation refund failed:', refundErr);
      }
    } else if (!usesAtomicBilling && annotationTaskId) {
      try {
        await terminateCloudTaskAndRefund(
          annotationTaskId,
          'failed',
          message.substring(0, 100),
        );
      } catch (refundErr) {
        console.error('[edit] Atomic annotation refund failed:', refundErr);
      }
    } else if (!usesAtomicBilling && deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `语言修图任务创建失败退款: ${message.substring(0, 100)}`);
      } catch (refundErr) { console.error('[edit] Refund failed:', refundErr); }
    }
    if (error instanceof AnnotationIdempotencyConflictError) {
      return NextResponse.json({
        success: false,
        code: error.code,
        error: error.message,
      }, { status: 409 });
    }
    if (error instanceof InsufficientCreditsError || error instanceof IdempotencyConflictError) {
      return NextResponse.json({
        success: false,
        code: error.code,
        error: error.message,
      }, { status: error.statusCode });
    }
    return NextResponse.json({ success: false, error: `任务创建失败: ${message}` }, { status: 500 });
  }
} // end POST

/**
 * 降级：尝试 /images/generations 端点
 * 部分 OpenAI 兼容代理不支持 chat/completions 图片编辑，但支持 images/generations
 */
async function tryImagesGenerations(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
  quality: string,
  count: number,
  signal: AbortSignal,
): Promise<string | null> {
  // 根据质量参数动态计算像素尺寸
  const outputSize = (() => {
    if (size && /^\d+x\d+$/.test(size)) return size; // 已经是像素格式
    const ratio = size || '1:1';
    return calculateActualPixelsFromRatio(ratio, quality || '1K', model) || '1024x1024';
  })();

  const genResponse = await fetchWithV1Retry(
    baseUrl,
    '/images/generations',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        size: outputSize,
        quality,
        n: Math.min(count, 4),
        response_format: 'url',
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    },
  );

  if (!genResponse.ok) return null;

  const genData = await genResponse.json();
  return extractImageFromResponse(genData) || null;
}

// ============================================================
// GET: 获取支持的编辑模型列表（从管理员系统获取）
// ============================================================
export async function GET(_request: NextRequest) {
  try {
    const { getApiProviders } = await import('@/lib/server-api-config');
    const providers = await getApiProviders();

    const editModels: { id: string; name: string; providerId: string; providerName: string; supportsMask: boolean }[] = [];

    for (const provider of providers) {
      // 仅获取图像类型的提供商
      if (provider.modelType && provider.modelType !== 'image') continue;

      const models = provider.selectedModels || (provider.discoveredModels || []).map((m: { id: string }) => m.id);
      for (const rawModelId of models) {
        const modelId: string = typeof rawModelId === 'string' ? rawModelId : (rawModelId as { id: string }).id;
        const id = (modelId || '').toLowerCase();
        // 排除不支持编辑的模型类型
        if (id.includes('3d') || id.includes('vectoriz') || id.includes('layer') || id.includes('segment')) continue;

        // 涂抹支持判断（通用，不针对特定供应商）：
        // 后端统一使用 images/generations + 视觉参考蒙版路径，不依赖 images.edit 原生 mask 参数
        // - 绝大多数图像模型：支持涂抹（蒙版作为视觉参考图 + prompt 语义描述，通用方案）
        // - Gemini 系列：不支持涂抹（AI 无法可靠理解蒙版参考图语义，仅文字修图）
        let supportsMask = true; // ★ 默认支持（通用视觉参考蒙版方案）
        if (id.includes('gemini')) {
          supportsMask = false; // Gemini 系列无法可靠理解蒙版语义
        }

        // 优先使用提供商的模型显示名称
        const discoveredModel = (provider.discoveredModels || []).find((m: { id: string; name?: string }) => m.id === modelId);
        const displayName = discoveredModel?.name || modelId;

        editModels.push({
          id: modelId,
          name: displayName,
          providerId: provider.id,
          providerName: provider.name || provider.id,
          supportsMask,
        });
      }
    }

    return NextResponse.json({
      supportedModels: editModels.map(m => m.id),
      models: editModels,
    });
  } catch {
    // 降级：返回静态列表
    return NextResponse.json({
      supportedModels: EDITABLE_MODELS,
      models: EDITABLE_MODELS.map(model => ({
        id: model,
        name: model,
        providerId: '',
        providerName: '',
        supportsMask: !model.toLowerCase().includes('gemini'),
      })),
    });
  }
}
