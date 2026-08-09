import { NextRequest, NextResponse, after } from 'next/server';

export const maxDuration = 1800; // 30分钟 - 支持长时间轮询慢速API（apimart等需要260s+任务）

import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { resolveCompatProfile, buildPollUrl, extractImageUrl, type ApiCompatProfile } from '@/lib/api-compatibility';
import { postProcessAIRemoveBG } from '@/lib/remove-bg-postprocess';
import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { compositeMaskedEdit } from '@/lib/image-tools/masked-edit-composite';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { getEditTask, deleteEditTask, setEditTask, failEditTask } from '@/lib/edit-task-store';
import {
  getTaskInfo,
  isTaskCancelled,
  registerTask,
  registerTaskAbortController,
  releaseQueueSlot,
  unregisterTaskAbortController,
  updateTaskProgress,
  type TaskType,
} from '@/lib/task-registry';
import { translateApiError } from '@/lib/api-error-translate';
import { classifyApiError, type ClassifiedError, isCloudflareTimeoutError } from '@/lib/api-error-translator';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getRefineResult } from '@/app/api/refine-engine/route';
import { getBrandResult } from '@/app/api/brand-ecommerce/route';
import { getFontDesignResult } from '@/app/api/font-design/generate-image/route';
import { unwrapFontDesignTaskResult } from '@/lib/font-design-task-result';
import { isPendingLocalAsyncGenerateTask, isRecoverableSubmitOnlySubmission, shouldPollRemoteAsyncGenerateTask } from '@/lib/async-generate-task';
import { enhanceViaAI } from '@/lib/quality-enhance';
import { buildRecoveredTaskContext, recordImageTaskTerminal, recordVideoTaskTerminal } from '@/lib/cloud-task-persistence';
import {
  claimCloudTaskLease,
  completeCloudTask,
  deferCloudTaskRecovery,
  getCloudTaskForUser,
  refundCloudTaskCredits,
  terminateCloudTaskAndRefund,
  updateCloudTask,
} from '@/lib/cloud-task-storage';
import { getCompletedVideoTaskResult } from '@/lib/video-task-result';
import { resolveVideoCompatProfile } from '@/lib/video-api';
import { resolveTaskProviderDisplayName } from '@/lib/task-provider-display';
import { getLayerTaskStatus } from '@/lib/layer-decomposition/service';
import { projectCanonicalGenerationSlot } from '@/lib/task-core/generation-batch';
import { createTaskAbortScope, getTaskRecoveryBackoff } from '@/lib/task-core/task-abort';
import { classifyRecoverySubmissionFailure } from '@/lib/task-core/recovery-submission';
import {
  normalizeTaskError,
} from '@/lib/task-core/task-error';
import { getRequestId } from '@/lib/request-id';

export const dynamic = 'force-dynamic';

// ★ 本地完成缓存：避免同一任务重复查远端API和重复持久化
// （Next.js dev模式下不同路由可能使用不同的 task-registry 实例，
//   所以在 poll-task 内部维护自己的缓存更可靠）
const completedTaskCache = new Map<string, {
  userId: string;
  imageUrl: string;
  imageUrls?: string[];
  maskUrl?: string;
  maskUrls?: string[];
  gridImageUrl?: string;
  buttons?: unknown[];
  modelName?: string;
  providerName?: string;
  taskResult?: Record<string, unknown>;
  timestamp: number;
}>();
const FAILED_CACHE = Symbol('failed');
const failedTaskCache = new Map<string, {
  userId: string;
  error: string;
  taskResult?: Record<string, unknown>;
  timestamp: number;
}>();
const TASK_RECOVERY_LEASE_MS = 10 * 60_000;
const TASK_RECOVERY_WORKER_ID = process.env.WUJIE_WORKER_ID || `poll-task-${process.pid}`;
// A pending submitOnly wrapper whose background worker keeps updating progress is
// alive and must NEVER be re-submitted — every duplicate submission bills the
// provider again. Only a worker that stopped updating for longer than the 600s
// background submission timeout is considered dead and eligible for recovery.
const SUBMISSION_STALE_MS = 12 * 60_000;

async function refundTaskCredits(
  taskId: string,
  creditCost: number | undefined,
  reason: string,
): Promise<'pending' | 'refunded' | 'not-applicable'> {
  if (!creditCost || creditCost <= 0) return 'not-applicable';

  try {
    const refund = await refundCloudTaskCredits(taskId, reason);
    return refund.refunded ? 'refunded' : 'pending';
  } catch (error) {
    console.error('[poll-task] Credit refund failed:', error);
    return 'pending';
  }
}

function withGenerationSlotMetadata<T extends Record<string, unknown>>(
  payload: T,
  taskResult: Record<string, unknown> | undefined,
  taskId: string,
): T {
  const canonical = projectCanonicalGenerationSlot({
    taskId,
    status: typeof payload.status === 'string' ? payload.status : 'processing',
    result: taskResult,
    ...(typeof payload.error === 'string'
      ? { error: { code: 'TASK_FAILED', message: payload.error } }
      : {}),
  });
  if (!canonical) return payload;

  return {
    ...payload,
    batchId: canonical.batchId,
    slotId: canonical.slotId,
    slotIndex: canonical.slotIndex,
    taskId: canonical.taskId,
  };
}

async function resolveCanonicalTaskProviderName(
  providerId: unknown,
  legacyName: unknown,
): Promise<string> {
  const normalizedProviderId = typeof providerId === 'string' ? providerId.trim() : '';
  if (!normalizedProviderId) {
    return resolveTaskProviderDisplayName('', null, legacyName);
  }

  try {
    const provider = await findProviderById(normalizedProviderId);
    return resolveTaskProviderDisplayName(normalizedProviderId, provider, legacyName);
  } catch (error) {
    console.warn('[poll-task] Failed to resolve canonical provider display name:', error);
    return resolveTaskProviderDisplayName(normalizedProviderId, null, legacyName);
  }
}

// 定期清理过期缓存（5分钟以上的缓存清除）
function isDurableGenerationSlot(taskResult: Record<string, unknown>): boolean {
  const submissionPayload = taskResult.submissionPayload as Record<string, unknown> | undefined;
  return Boolean(
    submissionPayload
    && typeof submissionPayload.batchId === 'string'
    && typeof submissionPayload.slotId === 'string'
    && typeof submissionPayload.slotIndex === 'number',
  );
}

async function getDurableGenerationSlotResponse(
  taskId: string,
  userId: string,
): Promise<NextResponse | null> {
  const persistedTask = await getCloudTaskForUser(taskId, userId);
  if (!persistedTask) return null;

  const result = (persistedTask.result as Record<string, unknown>) || {};
  if (persistedTask.status === 'completed' && typeof result.imageUrl === 'string' && result.imageUrl) {
    const providerName = await resolveCanonicalTaskProviderName(
      persistedTask.providerId,
      result.providerName,
    );
    return NextResponse.json(withGenerationSlotMetadata({
      success: true,
      status: 'completed',
      progress: 100,
      imageUrl: result.imageUrl,
      imageUrls: Array.isArray(result.imageUrls) ? result.imageUrls : [result.imageUrl],
      maskUrl: typeof result.maskUrl === 'string' ? result.maskUrl : '',
      maskUrls: Array.isArray(result.maskUrls) ? result.maskUrls : [],
      modelName: typeof result.modelName === 'string' ? result.modelName : '',
      providerName,
      generationRouteAudit: result.generationRouteAudit,
    }, result, taskId));
  }

  if (['failed', 'cancelled', 'timeout'].includes(persistedTask.status)) {
    return NextResponse.json(withGenerationSlotMetadata({
      success: false,
      status: persistedTask.status,
      progress: persistedTask.progress,
      error: persistedTask.error || '任务未完成',
      retryable: persistedTask.status === 'failed',
    }, result, taskId));
  }

  return NextResponse.json(withGenerationSlotMetadata({
    success: true,
    status: 'processing',
    progress: persistedTask.progress,
    label: persistedTask.label || '正在生成图片',
  }, result, taskId));
}

const MAX_CACHE_SIZE = 1000;

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of completedTaskCache) {
      if (now - v.timestamp > 5 * 60 * 1000) completedTaskCache.delete(k);
    }
    for (const [k, v] of failedTaskCache) {
      if (now - v.timestamp > 5 * 60 * 1000) failedTaskCache.delete(k);
    }
    // BE-08: 限制缓存大小，避免无限增长
    if (completedTaskCache.size > MAX_CACHE_SIZE) {
      const entries = [...completedTaskCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, completedTaskCache.size - MAX_CACHE_SIZE);
      for (const [k] of toDelete) completedTaskCache.delete(k);
    }
    if (failedTaskCache.size > MAX_CACHE_SIZE) {
      const entries = [...failedTaskCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, failedTaskCache.size - MAX_CACHE_SIZE);
      for (const [k] of toDelete) failedTaskCache.delete(k);
    }
  }, 60_000).unref?.();
}

// 轮询异步任务状态 - 由前端调用
// 通用化设计：支持不同提供商的任务状态查询格式
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const { taskId, model: rawModel, userId: requestUserId, providerId, engine: requestEngine, apiKey: bodyApiKey, apiBaseUrl: bodyApiBaseUrl } = await request.json();
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json({
        success: false,
        status: 'error',
        error: '缺少 taskId 参数',
        retryable: false,
      }, { status: 400 });
    }
    let model = typeof rawModel === 'string' ? rawModel : (rawModel as Record<string, unknown>)?.model as string || String(rawModel || '');
    // ★ 从 model 中提取纯 modelId（前端可能传 providerId::modelId 格式）
    const extractedProviderId = model.includes('::') ? model.split('::')[0] : '';
    if (model.includes('::')) {
      model = model.split('::').pop()!;
    }
    const effectiveProviderId = providerId || extractedProviderId || '';
    // ★ 模型别名规范化
    const normalized = normalizeModelForApi(model);
    if (normalized.wasNormalized) {
      console.log(`[poll-task] 模型别名规范化: "${model}" → "${normalized.apiModelName}"`);
      model = normalized.apiModelName;
    }
    // ★ engine 参数：前端传递的任务引擎类型（用于 AI RemoveBG 后处理等场景）
    // 优先使用请求参数，因为 Next.js dev 模式下 task-registry 可能不共享
    const requestEngineStr = typeof requestEngine === 'string' ? requestEngine : '';
    const sessionUser = await getSessionUser(request);
    // ★ 安全：已登录用户必须使用 session 中的 userId，忽略客户端传入值（防止伪造）
    const userId = sessionUser?.id || "anonymous";

    // ★ 第一优先：检查任务是否已被取消，避免已取消任务继续远程轮询浪费资源
    if (taskId && isTaskCancelled(taskId)) {
      return NextResponse.json({
        success: false,
        status: 'cancelled',
        error: '任务已被取消',
        retryable: false,
      }, { status: 200 });
    }

    // 检查是否为本地语言修图任务
    if (taskId.startsWith('edit_')) {
      const task = getEditTask(taskId);
      const persistedEditTask = sessionUser
        ? await getCloudTaskForUser(taskId, sessionUser.id)
        : null;
      const isAnnotationEdit = persistedEditTask?.type === 'annotation-edit';
      console.info(`[poll-task] edit任务查询: taskId=${taskId}, status=${task?.status}, stage=${task?.stage}, hasRemotePoll=${!!task?.remotePollInfo}`);
      if (!task) {
        return NextResponse.json({
          success: false,
          status: 'error',
          error: '任务不存在或已过期',
          retryable: false,
        }, { status: 200 });
      }

      if (task.status === 'completed') {
        setTimeout(() => deleteEditTask(taskId), 5 * 60 * 1000);
        // ★ 过滤敏感字段
        const { apiKey: _ak, apiBaseUrl: _abu, advancedParams: _ap, ...safeResult } = (task.result as Record<string, unknown>) || {};
        return NextResponse.json({
          success: true,
          status: 'completed',
          stage: task.stage,
          result: safeResult,
        }, { status: 200 });
      }

      if (task.status === 'failed') {
        setTimeout(() => deleteEditTask(taskId), 5 * 60 * 1000);
        return NextResponse.json({
          success: false,
          status: 'failed',
          stage: task.stage,
          error: translateApiError(task.error || '处理失败'),
          retryable: false,
        }, { status: 200 });
      }

      // ★ 远程轮询支持：当 edit 任务包含 remotePollInfo 时，查询远程 API 获取状态
      const remotePollInfo = task.remotePollInfo;

      if (remotePollInfo && task.status === 'processing') {
        const remotePollController = new AbortController();
        registerTaskAbortController(taskId, remotePollController);
        try {
          const { taskId: remoteTaskId, apiBaseUrl, model: remoteModel, compatProfile: remoteCompat } = remotePollInfo;
          // 从服务端配置查找 API Key（不再从前端传入的 remotePollInfo 获取）
          const remoteProvider = remotePollInfo.providerId
            ? await findProviderById(remotePollInfo.providerId)
            : remoteModel ? await findProviderForModel(remoteModel) : null;
          const pollApiKey = remoteProvider?.apiKey || '';
          
          // 使用 compatProfile 构建正确的轮询 URL（而非硬编码 /tasks/{id}）
          let pollUrl: string;
          let pollBaseUrl = apiBaseUrl;
          let pollPath = `/tasks/${remoteTaskId}`;
          
          console.info(`[poll-task] edit remote poll: taskId=${taskId}, remoteTaskId=${remoteTaskId}, apiBaseUrl=${apiBaseUrl}, hasCompat=${!!remoteCompat}, compatId=${remoteCompat ? (remoteCompat as ApiCompatProfile).id : 'none'}`);
          
          if (remoteCompat) {
            const profile = remoteCompat as ApiCompatProfile;
            const built = buildPollUrl(apiBaseUrl, remoteTaskId, profile);
            console.info(`[poll-task] buildPollUrl result: built=${built}, profile.pollMode=${profile.pollMode}, profile.pollPathTemplate=${profile.pollPathTemplate}`);
            if (built) {
              pollUrl = built;
              // 从 pollUrl 提取 baseUrl 和 path 供 fetchWithV1Retry 使用
              try {
                const u = new URL(pollUrl);
                pollBaseUrl = `${u.protocol}//${u.host}`;
                pollPath = u.pathname + u.search;
              } catch { /* fallback to defaults */ }
            } else {
              pollUrl = `${apiBaseUrl}/tasks/${remoteTaskId}`;
            }
          } else {
            pollUrl = `${apiBaseUrl}/tasks/${remoteTaskId}`;
          }
          
          console.info(`[poll-task] remote poll request: pollBaseUrl=${pollBaseUrl}, pollPath=${pollPath}, fullUrl=${pollUrl}`);
          
          const pollResp = await fetchWithV1Retry(
            pollBaseUrl,
            pollPath,
            {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${pollApiKey}` },
              signal: AbortSignal.any([request.signal, remotePollController.signal, AbortSignal.timeout(30000)]),
            },
          );

          console.info(`[poll-task] remote poll response: status=${pollResp.status}, ok=${pollResp.ok}`);

          if (pollResp.ok) {
            const pollData = await pollResp.json() as Record<string, unknown>;
            // 递归解包嵌套的 data 字段 (APImart 等API可能多层嵌套: {code,data:{code,data:{status,images}}})
            let taskData: Record<string, unknown> = pollData;
            let unwrapDepth = 0;
            while (taskData.data && typeof taskData.data === 'object' && !Array.isArray(taskData.data) && unwrapDepth < 3) {
              const innerData = taskData.data as Record<string, unknown>;
              // 只有当内层有 status/images/results/result 等任务字段时才解包
              if (innerData.status || innerData.images || innerData.results || innerData.result || innerData.output || innerData.image_urls || innerData.image_urls_list || innerData.generated_images || innerData.url || innerData.image_url) {
                taskData = innerData;
                unwrapDepth++;
              } else if (innerData.data && typeof innerData.data === 'object') {
                // 内层还有嵌套 data，继续解包
                taskData = innerData;
                unwrapDepth++;
              } else {
                break;
              }
            }
            const taskStatus = String(taskData.status || '').toLowerCase();
            
            console.info(`[poll-task] remote poll data: taskStatus=${taskStatus}, unwrapDepth=${unwrapDepth}, hasImages=${!!taskData.images}, hasResults=${!!taskData.results}, hasOutput=${!!taskData.output}, hasImageUrls=${!!taskData.image_urls}, pollDataKeys=${Object.keys(pollData).join(',')}, taskDataKeys=${Object.keys(taskData).join(',')}`);

            if (taskStatus === 'succeeded' || taskStatus === 'completed' || taskStatus === 'success' || taskStatus === 'done') {
              // 远程任务完成，提取图片
              const images: Array<{ url: string }> = [];

              // ★ PearAPI 格式: { status: 'succeeded', data: [{ url: "..." }] } (顶层 data 数组)
              if (Array.isArray(taskData.data)) {
                for (const item of taskData.data as unknown[]) {
                  if (item && typeof item === 'object') {
                    const obj = item as Record<string, unknown>;
                    const url = obj.url || obj.image_url || obj.b64_json;
                    if (typeof url === 'string') {
                      if (url.startsWith('http') || url.startsWith('/')) {
                        images.push({ url: url.startsWith('/') ? `${apiBaseUrl}${url}` : url });
                      } else if (/^[A-Za-z0-9+/=]+$/.test(url)) {
                        images.push({ url: `data:image/png;base64,${url}` });
                      }
                    }
                  } else if (typeof item === 'string') {
                    const s = item as string;
                    if (s.startsWith('http') || s.startsWith('/')) {
                      images.push({ url: s.startsWith('/') ? `${apiBaseUrl}${s}` : s });
                    }
                  }
                }
              }

              // 尝试多种数据字段名提取图片列表 (仅当上面没取到时)
              if (images.length === 0) {
                const dataItems = taskData.images || taskData.results || taskData.output || taskData.image_urls || taskData.image_urls_list || taskData.generated_images;
                if (Array.isArray(dataItems)) {
                  for (const item of dataItems) {
                    const url = item.url || item.image_url || item.image_url_optimized || item;
                    if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('/'))) {
                      images.push({ url: url.startsWith('/') ? `${apiBaseUrl}${url}` : url });
                    }
                  }
                }
              }
              // 单个图片字段
              if (images.length === 0) {
                const singleUrl = taskData.image_url || taskData.url || taskData.image_url_optimized
                  || (taskData.result as Record<string, unknown>)?.url
                  || (taskData.result as Record<string, unknown>)?.image_url;
                if (typeof singleUrl === 'string' && (singleUrl.startsWith('http') || singleUrl.startsWith('/'))) {
                  images.push({ url: singleUrl.startsWith('/') ? `${apiBaseUrl}${singleUrl}` : singleUrl });
                }
              }
              // 从 result 对象中提取图片数组
              if (images.length === 0 && taskData.result && typeof taskData.result === 'object') {
                const resultObj = taskData.result as Record<string, unknown>;
                const resultImages = resultObj.images || resultObj.results || resultObj.output || resultObj.image_urls || resultObj.generated_images;
                if (Array.isArray(resultImages)) {
                  for (const item of resultImages) {
                    // ★ APImart 格式: images:[{url:[...], expires_at}] — url字段是数组
                    let url: unknown;
                    if (item && typeof item === 'object') {
                      const obj = item as Record<string, unknown>;
                      if (Array.isArray(obj.url) && obj.url.length > 0) {
                        url = obj.url[0];
                      } else {
                        url = obj.url || obj.image_url || obj.image_url_optimized || obj;
                      }
                    } else {
                      url = item;
                    }
                    if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('/'))) {
                      images.push({ url: url.startsWith('/') ? `${apiBaseUrl}${url}` : url });
                    }
                  }
                }
              }
              // ★ APImart result.images[].url 是数组格式: result:{images:[{url:["https://..."]}]}
              // 从嵌套的 data.data 提取
              if (images.length === 0 && taskData.data && typeof taskData.data === 'object') {
                const innerData = taskData.data as Record<string, unknown>;
                console.info(`[poll-task] edit remote trying nested taskData.data, keys=${Object.keys(innerData).join(',')}`);
                const innerImages = innerData.images || innerData.results || innerData.output || innerData.image_urls || innerData.generated_images;
                if (Array.isArray(innerImages)) {
                  for (const item of innerImages) {
                    let url: unknown;
                    if (item && typeof item === 'object') {
                      const obj = item as Record<string, unknown>;
                      if (Array.isArray(obj.url) && obj.url.length > 0) {
                        url = obj.url[0];
                      } else {
                        url = obj.url || obj.image_url || obj.image_url_optimized || obj;
                      }
                    } else {
                      url = item;
                    }
                    if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('/'))) {
                      images.push({ url: url.startsWith('/') ? `${apiBaseUrl}${url}` : url });
                    }
                  }
                }
                // 嵌套data的单图片字段
                if (images.length === 0) {
                  const innerSingleUrl = innerData.image_url || innerData.url || innerData.image_url_optimized;
                  if (typeof innerSingleUrl === 'string' && (innerSingleUrl.startsWith('http') || innerSingleUrl.startsWith('/'))) {
                    images.push({ url: innerSingleUrl.startsWith('/') ? `${apiBaseUrl}${innerSingleUrl}` : innerSingleUrl });
                  }
                }
              }
              // 从 data.images 提取 (APImart格式: {code, data:{result:{images:[{url:["..."]}]}}})
              if (images.length === 0 && pollData.images && Array.isArray(pollData.images)) {
                for (const item of pollData.images) {
                  let url: unknown;
                  if (item && typeof item === 'object') {
                    const obj = item as Record<string, unknown>;
                    if (Array.isArray(obj.url) && obj.url.length > 0) {
                      url = obj.url[0];
                    } else {
                      url = obj.url || obj.image_url || obj.image_url_optimized || obj;
                    }
                  } else {
                    url = item;
                  }
                  if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('/'))) {
                    images.push({ url: url.startsWith('/') ? `${apiBaseUrl}${url}` : url });
                  }
                }
              }
              // 从 data.output 提取 (某些API格式)
              if (images.length === 0 && pollData.output && typeof pollData.output === 'string' && pollData.output.startsWith('http')) {
                images.push({ url: pollData.output });
              }
              // 最终兜底: 深度搜索整个响应中所有以http开头且包含图片扩展名的URL
              if (images.length === 0) {
                const fullJson = JSON.stringify(pollData);
                const urlMatches = fullJson.match(/https?:\/\/[^\s"\\]+\.(png|jpg|jpeg|webp|gif)/gi);
                if (urlMatches && urlMatches.length > 0) {
                  console.info(`[poll-task] edit deep search found image URLs: ${urlMatches.slice(0, 3).join(', ')}`);
                  for (const url of urlMatches.slice(0, 4)) {
                    images.push({ url: url.replace(/[^a-zA-Z0-9+/.:_@&?=-]$/, '') });
                  }
                }
              }

              if (images.length > 0) {
                console.info(`[poll-task] edit remote completed! images=${images.length}, firstUrl=${images[0].url?.substring(0, 80)}...`);
                const completedResult = {
                  success: true,
                  image: images[0],
                  images,
                  model: remoteModel,
                  provider: apiBaseUrl || 'unknown',
                  llmInstruction: remotePollInfo.prompt,
                  editRegions: [],
                  autoMaskGenerated: false,
                };
                if (isAnnotationEdit) {
                  const committed = await completeCloudTask(taskId, completedResult);
                  if (!committed) {
                    const current = await getCloudTaskForUser(taskId, sessionUser!.id);
                    if (current?.status === 'completed') {
                      return NextResponse.json({
                        success: true,
                        status: 'completed',
                        stage: '完成',
                        result: current.result,
                      }, { status: 200 });
                    }
                    return NextResponse.json({
                      success: false,
                      status: current?.status || 'failed',
                      error: current?.error || '批注任务终态已由其他请求更新',
                      retryable: false,
                    }, { status: 200 });
                  }
                }
                updateTaskProgress(taskId, { status: 'completed', progress: 100 });
                setEditTask(taskId, {
                  id: taskId,
                  status: 'completed',
                  progress: 100,
                  stage: '完成',
                  result: completedResult,
                  createdAt: task.createdAt || Date.now(),
                  completedAt: Date.now(),
                });
                return NextResponse.json({
                  success: true,
                  status: 'completed',
                  stage: '完成',
                  result: {
                    success: true,
                    image: images[0],
                    images,
                    model: remoteModel,
                    provider: apiBaseUrl || 'unknown',
                  },
                }, { status: 200 });
              }
              // 状态成功但未能提取图片 — 尝试深度搜索
              const isSuccessStatus = taskStatus === 'succeeded' || taskStatus === 'success' || taskStatus === 'completed';
              if (isSuccessStatus && images.length === 0) {
                console.warn(`[poll-task] edit remote SUCCESS but no images extracted, trying deep search. keys=${Object.keys(taskData).join(',')}`);
                const { extractImageUrl: deepExtract } = await import('@/lib/api-compatibility');
                const deepUrl = deepExtract(pollData) || deepExtract(taskData);
                if (deepUrl) {
                  console.info(`[poll-task] edit deep search found image: ${deepUrl.substring(0, 100)}...`);
                  const existingTask = getEditTask(taskId);
                  const completedResult = {
                    success: true,
                    image: { url: deepUrl },
                    images: [{ url: deepUrl }],
                    model: remotePollInfo.model || model,
                    provider: remotePollInfo.apiBaseUrl || 'unknown',
                  };
                  if (isAnnotationEdit) {
                    const committed = await completeCloudTask(taskId, completedResult);
                    if (!committed) {
                      const current = await getCloudTaskForUser(taskId, sessionUser!.id);
                      if (current?.status === 'completed') {
                        return NextResponse.json({
                          success: true,
                          status: 'completed',
                          stage: '完成',
                          result: current.result,
                        }, { status: 200 });
                      }
                      return NextResponse.json({
                        success: false,
                        status: current?.status || 'failed',
                        error: current?.error || '批注任务终态已由其他请求更新',
                        retryable: false,
                      }, { status: 200 });
                    }
                  }
                  setEditTask(taskId, {
                    ...(existingTask || { id: taskId, progress: 0, createdAt: Date.now() }),
                    status: 'completed',
                    stage: '完成',
                    result: completedResult,
                    completedAt: Date.now(),
                  });
                  return NextResponse.json({
                    success: true,
                    status: 'completed',
                    stage: '完成',
                    result: {
                      success: true,
                      image: { url: deepUrl },
                      images: [{ url: deepUrl }],
                      model: remotePollInfo.model || model,
                      provider: remotePollInfo.apiBaseUrl || 'unknown',
                    },
                  }, { status: 200 });
                }
                // 深度搜索也没找到 — 标记失败避免无限轮询
                console.error(`[poll-task] edit remote SUCCESS but NO image found anywhere. rawResponse=${JSON.stringify(pollData).substring(0, 500)}`);
                if (isAnnotationEdit) {
                  await terminateCloudTaskAndRefund(
                    taskId,
                    'failed',
                    '远程任务成功但未找到图片结果',
                  );
                }
                failEditTask(taskId, '远程任务成功但未找到图片结果');
                return NextResponse.json({
                  success: false,
                  status: 'failed',
                  error: '远程任务成功但未找到图片结果',
                  retryable: false,
                }, { status: 200 });
              }
            } else if (taskStatus === 'failed' || taskStatus === 'error') {
              console.warn(`[poll-task] edit remote task FAILED: taskStatus=${taskStatus}, error=${JSON.stringify(taskData.error || taskData.error_message || taskData.message)}`);
              const taskError = (taskData.error as Record<string, unknown>) || {};
              const rawError = (typeof taskError === 'object' && taskError.message)
                ? String(taskError.message)
                : String(taskData.error_message || taskData.message || '远程任务失败');
              const classifiedErr = classifyApiError(rawError);
              const translatedErrMsg = classifiedErr.friendlyMessage + (classifiedErr.suggestion ? ' — ' + classifiedErr.suggestion : '');
              const isCfTimeout = isCloudflareTimeoutError(rawError);
              if (isAnnotationEdit) {
                await terminateCloudTaskAndRefund(taskId, 'failed', translatedErrMsg);
              }
              failEditTask(taskId, translatedErrMsg);
              return NextResponse.json({
                success: false,
                status: 'failed',
                error: translatedErrMsg,
                errorCategory: classifiedErr.category,
                isRetryable: classifiedErr.isRetryable,
                isCfTimeout,
                retryable: classifiedErr.isRetryable,
              }, { status: 200 });
            } else {
              // 仍在处理中
              console.info(`[poll-task] edit remote still processing: taskStatus=${taskStatus}, progress=${taskData.progress}`);
              const progress = typeof taskData.progress === 'number' ? taskData.progress : task.progress;
              return NextResponse.json({
                success: true,
                status: 'processing',
                stage: task.stage,
                progress: Math.max(progress, 15),
              }, { status: 200 });
            }
          } else {
            const errorText = await pollResp.text().catch(() => '');
            console.warn(`[poll-task] edit remote poll HTTP error: status=${pollResp.status}, body=${errorText.substring(0, 200)}`);
            // 4xx 客户端错误（API Key 无效/无权限/任务不存在）为永久性错误，标记失败避免无限轮询
            if (pollResp.status >= 400 && pollResp.status < 500) {
              const isAuthError = pollResp.status === 401 || pollResp.status === 403;
              const isGoneError = pollResp.status === 404 || pollResp.status === 410;
              const errorMsg = isAuthError
                ? '远程编辑任务鉴权失败：API Key 无效或已过期，请检查该模型对应的 API 凭证'
                : isGoneError
                  ? '远程编辑任务不存在或已过期'
                  : `远程编辑任务返回错误: ${errorText.substring(0, 200)}`;
              console.warn(`[poll-task] edit remote poll ${pollResp.status} -> marking failed: ${errorMsg}`);
              if (isAnnotationEdit) {
                await terminateCloudTaskAndRefund(taskId, 'failed', errorMsg);
              }
              failEditTask(taskId, errorMsg);
              failedTaskCache.set(taskId, { userId, error: errorMsg, timestamp: Date.now() });
              return NextResponse.json({
                success: false,
                status: 'failed',
                error: errorMsg,
                retryable: false,
              }, { status: 200 });
            }
            // 429/5xx/网络层临时故障 → 保持 processing 让前端继续轮询
          }
        } catch (remoteErr) {
          console.warn('[poll-task] edit remote poll error:', remoteErr instanceof Error ? remoteErr.message : remoteErr);
          // 远程轮询失败，返回当前本地状态
        } finally {
          unregisterTaskAbortController(taskId, remotePollController);
        }
      }

      return NextResponse.json({
        success: true,
        status: 'processing',
        stage: task.stage,
        progress: task.progress,
      }, { status: 200 });
    }

    // ★ Layer decomposition tasks (segment-elements) use independent cloud_tasks table,
    // not registered in task-registry. Must check BEFORE the cloud task recovery logic
    // to avoid the recovery code from mis-registering layer tasks into task-registry.
    if (taskId.startsWith('layer_') && sessionUser) {
      try {
        const layerTask = await getLayerTaskStatus({
          taskId,
          userId: sessionUser.id,
          userRole: sessionUser.role || 'user',
        });
        console.log(`[poll-task] layer task found: taskId=${taskId}, status=${layerTask.status}, progress=${layerTask.progress}`);
        if (layerTask.status === 'completed' && layerTask.result) {
          return NextResponse.json({
            success: true,
            status: 'completed',
            progress: 100,
            result: { decomposition: layerTask.result, type: 'layer-decomposition' },
          }, { status: 200 });
        }
        if (layerTask.status === 'failed' || layerTask.status === 'cancelled' || layerTask.status === 'timeout') {
          return NextResponse.json({
            success: false,
            status: layerTask.status,
            progress: layerTask.progress,
            error: layerTask.error?.message || '图片分层任务失败',
            retryable: layerTask.error?.retryable || false,
          }, { status: 200 });
        }
        // pending / processing
        return NextResponse.json({
          success: true,
          status: 'processing',
          progress: layerTask.progress,
          label: layerTask.phase || '正在处理图片分层...',
        }, { status: 200 });
      } catch (layerErr) {
        // Fallback: directly query cloud_tasks table for layer task status
        // (avoids lease/heartbeat complexity of getLayerTaskStatus)
        try {
          const cloudTask = await getCloudTaskForUser(taskId, sessionUser.id);
          if (cloudTask) {
            console.log(`[poll-task] layer task (fallback): taskId=${taskId}, status=${cloudTask.status}, progress=${cloudTask.progress}`);
            if (cloudTask.status === 'completed') {
              return NextResponse.json({
                success: true,
                status: 'completed',
                progress: 100,
                result: { decomposition: cloudTask.result, type: 'layer-decomposition' },
              }, { status: 200 });
            }
            if (['failed', 'cancelled', 'timeout'].includes(cloudTask.status)) {
              return NextResponse.json({
                success: false,
                status: cloudTask.status,
                progress: cloudTask.progress,
                error: cloudTask.error || '图片分层任务失败',
                retryable: false,
              }, { status: 200 });
            }
            return NextResponse.json({
              success: true,
              status: 'processing',
              progress: cloudTask.progress,
              label: cloudTask.label || '正在处理图片分层...',
            }, { status: 200 });
          }
        } catch {
          // Both methods failed — fall through to normal flow
        }
      }
    }

    // ★ 优先检查本地完成缓存（避免重复查远端API和重复持久化）
    const cachedCompleted = completedTaskCache.get(taskId);
    if (cachedCompleted) {
      if (sessionUser?.role !== 'admin' && cachedCompleted.userId !== userId) {
        return NextResponse.json({ success: false, status: 'error', error: '任务不存在' }, { status: 404 });
      }
      return NextResponse.json(withGenerationSlotMetadata({
        success: true,
        status: 'completed',
        progress: 100,
        imageUrl: cachedCompleted.imageUrl,
        imageUrls: cachedCompleted.imageUrls || [cachedCompleted.imageUrl],
        maskUrl: cachedCompleted.maskUrl || '',
        maskUrls: cachedCompleted.maskUrls || (cachedCompleted.maskUrl ? [cachedCompleted.maskUrl] : []),
        gridImageUrl: cachedCompleted.gridImageUrl || '',
        buttons: cachedCompleted.buttons || [],
        modelName: cachedCompleted.modelName || '',
        providerName: cachedCompleted.providerName || '',
      }, cachedCompleted.taskResult, taskId), { status: 200 });
    }
    const cachedFailed = failedTaskCache.get(taskId);
    if (cachedFailed) {
      if (sessionUser?.role !== 'admin' && cachedFailed.userId !== userId) {
        return NextResponse.json({ success: false, status: 'error', error: '任务不存在' }, { status: 404 });
      }
      return NextResponse.json(withGenerationSlotMetadata({
        success: false,
        status: 'failed',
        error: translateApiError(cachedFailed.error),
        retryable: true,
      }, cachedFailed.taskResult, taskId), { status: 200 });
    }

    // ★ 检查 task-registry 中的任务
    let registryTask = getTaskInfo(taskId);
    if (
      registryTask
      && sessionUser
      && sessionUser.role !== 'admin'
      && registryTask.userId !== sessionUser.id
    ) {
      return NextResponse.json({ success: false, status: 'error', error: '任务不存在' }, { status: 404 });
    }
    if (registryTask && !sessionUser && registryTask.userId !== 'anonymous') {
      return NextResponse.json({ success: false, status: 'error', error: '任务不存在' }, { status: 404 });
    }
    // ★ 防重复扣费：按 submissionPayload.workerMode 判断任务是否已有活着的提交者。
    // - 'recovery'（默认）：本进程没有后台提交者，poll-task 就是唯一提交方，立即恢复提交；
    //   租约（不允许 owner 自匹配重复 claim）保证租约期内只提交一次。
    // - 'local'：after() 后台 worker 正在向供应商提交（同步模型可能需数十秒到数分钟），
    //   窗口期内绝不能"恢复提交"——否则每次轮询都会重复发任务并真实扣费。
    //   只有 worker 卡死（updatedAt 超过 SUBMISSION_STALE_MS 无更新，该阈值大于后台
    //   提交 600s 超时）才允许恢复提交兜底。
    const pendingLocalAsyncTask = Boolean(
      registryTask
      && isPendingLocalAsyncGenerateTask(registryTask)
      && (registryTask.result as Record<string, unknown> | undefined)?.submissionPayload,
    );
    const pendingSubmissionPayload = pendingLocalAsyncTask && registryTask
      ? (registryTask.result as Record<string, unknown>).submissionPayload
      : undefined;
    const isLocalWorkerMode = Boolean(
      pendingSubmissionPayload
      && typeof pendingSubmissionPayload === 'object'
      && (pendingSubmissionPayload as Record<string, unknown>).workerMode === 'local',
    );
    const shouldResumeExistingAsync = Boolean(
      pendingLocalAsyncTask
      && registryTask
      && (!isLocalWorkerMode || Date.now() - registryTask.updatedAt > SUBMISSION_STALE_MS),
    );
    if ((!registryTask || shouldResumeExistingAsync) && sessionUser) {
      const persistedTask = await getCloudTaskForUser(taskId, sessionUser.id);
      if (persistedTask) {
        if (persistedTask.status === 'completed' && persistedTask.result?.imageUrl) {
          const providerName = await resolveCanonicalTaskProviderName(
            persistedTask.providerId,
            persistedTask.result.providerName,
          );
          return NextResponse.json(withGenerationSlotMetadata({
            success: true,
            status: 'completed',
            progress: 100,
            imageUrl: persistedTask.result.imageUrl,
            imageUrls: Array.isArray(persistedTask.result.imageUrls)
              ? persistedTask.result.imageUrls
              : [persistedTask.result.imageUrl],
            maskUrl: persistedTask.result.maskUrl || '',
            maskUrls: Array.isArray(persistedTask.result.maskUrls)
              ? persistedTask.result.maskUrls
              : (persistedTask.result.maskUrl ? [persistedTask.result.maskUrl] : []),
            providerName,
          }, persistedTask.result, taskId), { status: 200 });
        }
        if (persistedTask.status === 'completed' && persistedTask.result?.videoUrl) {
          return NextResponse.json({
            success: true,
            status: 'completed',
            progress: 100,
            mediaType: 'video',
            videoUrl: persistedTask.result.videoUrl,
            imageUrl: persistedTask.result.videoUrl,
          }, { status: 200 });
        }
        if (['failed', 'cancelled', 'timeout'].includes(persistedTask.status)) {
          return NextResponse.json(withGenerationSlotMetadata({
            success: false,
            status: persistedTask.status,
            error: persistedTask.error || '任务未完成',
            retryable: persistedTask.status === 'failed',
          }, persistedTask.result, taskId), { status: 200 });
        }

        const recovery = buildRecoveredTaskContext(persistedTask);
        const persistedResult = (persistedTask.result as Record<string, unknown>) || {};
        const submissionPayload = persistedResult.submissionPayload;
        const remoteTaskId = recovery.remoteTaskId;
        const requiresSubmissionRecovery = isRecoverableSubmitOnlySubmission({
          taskId: persistedTask.id,
          status: persistedTask.status,
          remoteTaskId,
          result: { submissionPayload },
        });
        const lostVideoSubmissionBeforeRemoteId = recovery.type.startsWith('video')
          && remoteTaskId === persistedTask.id;
        if (lostVideoSubmissionBeforeRemoteId) {
          const error = '视频任务在服务重启前未取得供应商任务标识，已自动退款，请重新提交';
          const settled = await terminateCloudTaskAndRefund(recovery.taskId, 'failed', error);
          if (!settled.transitioned) {
            return NextResponse.json({
              success: false,
              status: 'failed',
              error,
              retryable: true,
            }, { status: 200 });
          }
          failedTaskCache.set(recovery.taskId, { userId: recovery.userId, error, timestamp: Date.now() });
          return NextResponse.json({
            success: false,
            status: 'failed',
            error,
            retryable: true,
          }, { status: 200 });
        }
        const recoveryBackoff = getTaskRecoveryBackoff(persistedTask);
        if (!recoveryBackoff.recoveryAllowed) {
          return NextResponse.json(withGenerationSlotMetadata({
            success: true,
            status: persistedTask.status,
            progress: Math.max(persistedTask.progress, 1),
            label: persistedTask.label || '任务正在等待恢复',
            recoveryPending: true,
            retryAfterMs: recoveryBackoff.retryAfterMs,
          }, persistedTask.result, taskId), { status: 200 });
        }
        const lease = await claimCloudTaskLease(
          recovery.taskId,
          TASK_RECOVERY_WORKER_ID,
          TASK_RECOVERY_LEASE_MS,
        );
        if (!lease) {
          return NextResponse.json({
            success: true,
            status: persistedTask.status,
            progress: persistedTask.progress,
            label: persistedTask.label || '任务正由其他实例恢复',
            recoveryPending: true,
          }, { status: 200 });
        }
        const recovered = registerTask(
          recovery.taskId,
          (requiresSubmissionRecovery
            ? 'generate-async'
            : recovery.type.startsWith('video')
              ? 'video'
              : recovery.type) as TaskType,
          recovery.label,
          recovery.userId,
          'durable',
        );
        const recoveredProvider = recovery.providerId
          ? await findProviderById(recovery.providerId)
          : recovery.model ? await findProviderForModel(recovery.model) : null;
        const recoveredVideoProfile = recovery.type.startsWith('video') && recoveredProvider
          ? resolveVideoCompatProfile(
              recovery.model || '',
              recoveredProvider.advancedParams?.compatProfile,
              normalizeApiBaseUrl(recoveredProvider.baseUrl),
            )
          : undefined;
        updateTaskProgress(recovered.taskId, {
          status: 'processing',
          progress: recovery.progress,
          creditCost: persistedTask.creditCost,
          result: {
            submissionPayload,
            remoteTaskId: recovery.remoteTaskId,
            ...(recovery.type.startsWith('video') ? {
              thirdPartyTaskId: recovery.remoteTaskId,
              profile: recoveredVideoProfile,
              model: recovery.model,
              usedImagesEndpoint: persistedTask.result?.usedImagesEndpoint === true,
            } : {}),
            providerId: recovery.providerId,
            providerName: resolveTaskProviderDisplayName(
              recovery.providerId,
              recoveredProvider,
              '',
            ),
            usedModel: recovery.model,
            modelName: recovery.model,
          },
        });
        if (requiresSubmissionRecovery) {
          after(async () => {
            const recoveryAbort = createTaskAbortScope(recovered.taskId, {
              timeoutMs: 600_000,
              requestId,
            });
            let recoveryResponseStatus: number | undefined;
            let recoveryResponseData: Record<string, unknown> | null = null;
            try {
            if (isTaskCancelled(recovered.taskId)) return;
            const resumed = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/generate`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(await getInternalRequestHeaders(sessionUser.id, sessionUser.role === 'admin' ? 'admin' : 'user')),
              },
              body: JSON.stringify({
                ...(submissionPayload as Record<string, unknown>),
                submitOnly: false,
                _skipCredits: true,
                _skipCloudTaskPersistence: true,
              }),
              signal: recoveryAbort.signal,
            });
            recoveryResponseStatus = resumed.status;
            recoveryResponseData = await resumed.json().catch(() => null) as Record<string, unknown> | null;
            if (!resumed.ok || !recoveryResponseData?.success) {
              throw new Error(
                typeof recoveryResponseData?.error === 'string'
                  ? recoveryResponseData.error
                  : `任务恢复提交失败 (${resumed.status})`,
              );
            }
            const resumedData = recoveryResponseData;

            const directImageUrls = [
              ...(Array.isArray(resumedData.imageUrls) ? resumedData.imageUrls : []),
              ...(Array.isArray(resumedData.directImageUrls) ? resumedData.directImageUrls : []),
            ].filter((url): url is string => typeof url === 'string' && url.length > 0);
            if (directImageUrls.length > 0) {
              const completedResult = {
                ...(submissionPayload as Record<string, unknown>),
                submissionPayload,
                imageUrl: directImageUrls[0],
                imageUrls: directImageUrls,
              };
              const committed = await completeCloudTask(
                recovered.taskId,
                completedResult,
                TASK_RECOVERY_WORKER_ID,
              );
              if (!committed) {
                console.info('[poll-task] Late recovery result ignored', {
                  requestId,
                  taskId: recovered.taskId,
                  attemptedStatus: 'completed',
                });
                return;
              }

              updateTaskProgress(recovered.taskId, {
                status: 'completed',
                progress: 100,
                result: completedResult,
              });
              completedTaskCache.set(recovered.taskId, {
                userId: recovery.userId,
                imageUrl: directImageUrls[0],
                imageUrls: directImageUrls,
                taskResult: completedResult,
                timestamp: Date.now(),
              });
              releaseQueueSlot(recovered.taskId);
              return;
            }

            const remoteTaskIds = Array.isArray(resumedData.taskIds)
              ? resumedData.taskIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
              : [];
            if (remoteTaskIds.length === 0) {
              throw new Error('任务恢复未返回供应商任务 ID');
            }

            const recoveredResult = {
              ...(submissionPayload as Record<string, unknown>),
              submissionPayload,
              remoteTaskId: remoteTaskIds[0],
              remoteTaskIds,
              providerId: resumedData.providerId || recovery.providerId,
              usedModel: resumedData.model || recovery.model,
              modelName: resumedData.modelName || recovery.model,
              providerName: resumedData.providerName,
            };
            const updated = await updateCloudTask(recovered.taskId, {
              remoteTaskId: remoteTaskIds[0],
              progress: 10,
              result: recoveredResult,
              expectedStatuses: ['processing'],
              leaseOwner: TASK_RECOVERY_WORKER_ID,
            });
            if (!updated) {
              console.info('[poll-task] Late recovery provider id ignored', {
                requestId,
                taskId: recovered.taskId,
                remoteTaskId: remoteTaskIds[0],
              });
              return;
            }
            updateTaskProgress(recovered.taskId, { status: 'processing', progress: 10, result: recoveredResult });
          } catch (error) {
            const recoveryFailure = recoveryAbort.signal.aborted
              ? null
              : classifyRecoverySubmissionFailure({
                  status: recoveryResponseStatus,
                  responseData: recoveryResponseData,
                  error,
                  attemptCount: lease.attemptCount,
                  requestId,
                });
            if (recoveryFailure?.defer) {
              const deferred = await deferCloudTaskRecovery(
                recovered.taskId,
                TASK_RECOVERY_WORKER_ID,
                recoveryFailure.retryDelayMs,
                recoveryFailure.taskError.message,
              );
              if (deferred) {
                updateTaskProgress(recovered.taskId, {
                  status: 'processing',
                  progress: Math.max(recovery.progress, 1),
                  label: recoveryFailure.taskError.message,
                });
                console.warn('[poll-task] Recovery submission deferred', {
                  requestId: recoveryFailure.taskError.requestId,
                  taskId: recovered.taskId,
                  code: recoveryFailure.taskError.code,
                  attemptCount: lease.attemptCount,
                  retryDelayMs: recoveryFailure.retryDelayMs,
                });
              }
              return;
            }
            const taskError = recoveryFailure?.taskError || normalizeTaskError(
              recoveryAbort.signal.reason,
              {
                code: 'TASK_RECOVERY_FAILED',
                message: '任务恢复失败，请稍后重试',
                source: 'wujie',
                retryable: true,
                requestId,
              },
            );
            if (taskError.code === 'TASK_EXECUTION_REPLACED') {
              console.info('[poll-task] Superseded recovery worker stopped', {
                requestId: taskError.requestId,
                taskId: recovered.taskId,
              });
              return;
            }
            const terminalStatus = taskError.code === 'TASK_TIMEOUT'
              ? 'timeout'
              : taskError.code === 'TASK_CANCELLED'
                ? 'cancelled'
                : 'failed';
            const termination = await terminateCloudTaskAndRefund(
              recovered.taskId,
              terminalStatus,
              taskError.message,
              TASK_RECOVERY_WORKER_ID,
            );
            if (!termination.transitioned) {
              console.info('[poll-task] Recovery terminal race lost', {
                requestId: taskError.requestId,
                taskId: recovered.taskId,
                attemptedStatus: terminalStatus,
                currentStatus: termination.status,
              });
              return;
            }

            updateTaskProgress(recovered.taskId, {
              status: terminalStatus,
              progress: 0,
              error: taskError.message,
            });
            failedTaskCache.set(recovered.taskId, {
              userId: recovery.userId,
              error: taskError.message,
              taskResult: {
                ...persistedResult,
                taskError,
              },
              timestamp: Date.now(),
            });
            releaseQueueSlot(recovered.taskId);
          } finally {
            recoveryAbort.dispose();
          }
          });
          return NextResponse.json(withGenerationSlotMetadata({
            success: true,
            status: 'processing',
            progress: Math.max(recovery.progress, 1),
            label: '正在提交生成任务...',
            recoveryPending: true,
          }, persistedResult, taskId), { status: 200 });
        }
        registryTask = getTaskInfo(taskId);
      }
    }
    if (registryTask) {
      const taskType = registryTask.type;
      if (registryTask.status === 'completed') {
        // ★ 释放队列槽位
        releaseQueueSlot(taskId);
        // ★ 对于 refine-engine / brand-ecommerce，同时检查 globalThis 缓存
        let taskResult = registryTask.result;
        if (!taskResult && registryTask.type === 'refine-engine') {
          const cached = getRefineResult(taskId);
          if (cached) {
            console.log(`[poll-task] 从 globalThis 缓存获取 refine-engine 结果: ${taskId}`);
            taskResult = cached;
          }
        }
        if (!taskResult && registryTask.type === 'brand-ecommerce') {
          const cached = getBrandResult(taskId);
          if (cached) {
            console.log(`[poll-task] 从 globalThis 缓存获取 brand-ecommerce 结果: ${taskId}`);
            taskResult = cached;
          }
        }
        // ★ generate-async任务完成时，直接从registryTask.result获取结果
        if (!taskResult && registryTask.type === 'generate-async' && registryTask.result) {
          taskResult = registryTask.result;
          console.log(`[poll-task] 从 task-registry 获取 generate-async 结果: ${taskId}`);
        }
        // ★ 过滤敏感字段，防止 apiKey/apiBaseUrl 等泄露到前端
        const { apiKey: _ak, apiBaseUrl: _abu, advancedParams: _ap, ...safeResult } = (taskResult as Record<string, unknown>) || {};
        const providerName = await resolveCanonicalTaskProviderName(
          safeResult?.providerId,
          safeResult?.providerName,
        );
        const completedVideo = registryTask.type === 'video'
          ? getCompletedVideoTaskResult(safeResult)
          : undefined;
        return NextResponse.json(withGenerationSlotMetadata({
          success: true,
          status: 'completed',
          progress: registryTask.progress,
          result: safeResult,
          imageUrl: safeResult?.imageUrl as string | undefined,
          imageUrls: Array.isArray(safeResult?.imageUrls) ? safeResult.imageUrls : undefined,
          ...(completedVideo?.videoUrl ? {
            mediaType: 'video',
            videoUrl: completedVideo.videoUrl,
            imageUrl: completedVideo.videoUrl,
          } : {}),
          maskUrl: safeResult?.maskUrl as string | undefined,
          maskUrls: Array.isArray(safeResult?.maskUrls) ? safeResult.maskUrls : undefined,
          modelName: (safeResult?.usedModel as string) || (safeResult?.modelName as string) || '',
          providerName,
          generationRouteAudit: safeResult?.generationRouteAudit,
        }, taskResult as Record<string, unknown> | undefined, taskId), { status: 200 });
      }
      if (registryTask.status === 'failed') {
        // ★ 释放队列槽位
        releaseQueueSlot(taskId);
        return NextResponse.json(withGenerationSlotMetadata({
          success: false,
          status: 'failed',
          progress: registryTask.progress,
          error: translateApiError(registryTask.error || '处理失败'),
          retryable: false,
        }, registryTask.result as Record<string, unknown> | undefined, taskId), { status: 200 });
      }
      if (registryTask.status === 'cancelled') {
        return NextResponse.json(withGenerationSlotMetadata({
          success: false,
          status: 'cancelled',
          error: '任务已被取消',
          retryable: false,
        }, registryTask.result as Record<string, unknown> | undefined, taskId), { status: 200 });
      }
      // submitOnly uses this task as a local progress wrapper. Its background
      // worker owns the provider task ID, so polling it remotely would send an
      // async-* ID to the provider and can falsely terminally fail the task.
      if (isPendingLocalAsyncGenerateTask(registryTask)) {
        return NextResponse.json(withGenerationSlotMetadata({
          success: true,
          status: 'processing',
          progress: registryTask.progress,
          label: registryTask.label || '生成中...',
        }, registryTask.result as Record<string, unknown> | undefined, taskId), { status: 200 });
      }
      // ★ 视频任务轮询：使用 video-api 协议适配器
      if (registryTask.type === 'video') {
        const regResult = (registryTask.result as Record<string, unknown>) || {};
        const persistedVideoTask = await getCloudTaskForUser(taskId, userId);
        const hasDurableVideoTask = Boolean(persistedVideoTask);
        const getDurableVideoTerminalResponse = async (): Promise<NextResponse> => {
          const current = await getCloudTaskForUser(taskId, userId);
          if (current?.status === 'completed' && current.result?.videoUrl) {
            return NextResponse.json({
              success: true,
              status: 'completed',
              progress: 100,
              mediaType: 'video',
              videoUrl: current.result.videoUrl,
              imageUrl: current.result.videoUrl,
            }, { status: 200 });
          }
          if (current && ['failed', 'cancelled', 'timeout'].includes(current.status)) {
            return NextResponse.json({
              success: false,
              status: current.status,
              progress: current.progress,
              error: current.error || '视频任务未完成',
              retryable: current.status === 'failed',
            }, { status: 200 });
          }
          return NextResponse.json({
            success: true,
            status: 'processing',
            progress: current?.progress ?? registryTask.progress,
            label: current?.label || registryTask.label,
          }, { status: 200 });
        };
        const thirdPartyTaskId = regResult.thirdPartyTaskId as string | undefined;
        const videoProfile = regResult.profile as string | undefined;
        const videoBaseUrl = regResult.baseUrl as string | undefined;
        const videoApiKey = regResult.apiKey as string | undefined;
        const videoModel = regResult.model as string | undefined;
        const videoProviderId = regResult.providerId as string | undefined;

        console.log(`[poll-task/video] taskId=${taskId}, thirdPartyTaskId=${thirdPartyTaskId}, profile=${videoProfile}, baseUrl=${videoBaseUrl?.slice(0, 50)}, model=${videoModel}`);

        if (!thirdPartyTaskId) {
          // 可能是同步完成的任务（API直接返回视频URL，status可能仍为processing）
          const syncVideoUrl = regResult.videoUrl as string | undefined;
          if (syncVideoUrl) {
            releaseQueueSlot(taskId);
            const safeRegistryResult = (({ apiKey: _ak, apiBaseUrl: _abu, ...rest }) => rest)(registryTask.result as Record<string, unknown>);
            return NextResponse.json({
              success: true,
              status: 'completed',
              progress: 100,
              label: registryTask.label,
              result: safeRegistryResult,
            }, { status: 200 });
          }
          // 尚未获得第三方任务ID（可能提交还在进行中）
          return NextResponse.json({
            success: true,
            status: registryTask.status,
            progress: registryTask.progress,
            label: registryTask.label,
          }, { status: 200 });
        }

        // 查找提供商信息
        let vApiKey = videoApiKey;
        let vBaseUrl = videoBaseUrl;
        if (!vApiKey || !vBaseUrl) {
          const vProvider = videoProviderId
            ? await findProviderById(videoProviderId)
            : videoModel ? await findProviderForModel(videoModel) : null;
          vApiKey = vProvider?.apiKey || '';
          vBaseUrl = normalizeApiBaseUrl(vProvider?.baseUrl || '');
        }

        if (!vApiKey || !vBaseUrl) {
          return NextResponse.json({
            success: false, status: 'failed',
            error: '未找到视频 API 提供商信息',
            retryable: false,
          }, { status: 200 });
        }

        let videoAdvancedParams = (regResult.advancedParams || regResult.providerAdvancedParams) as Record<string, unknown> | undefined;
        
        // 检查提交时是否使用了 images 端点，以便轮询也用对应端点
        const usedImagesEndpoint = regResult.usedImagesEndpoint as boolean | undefined;
        if (usedImagesEndpoint) {
          if (!videoAdvancedParams) videoAdvancedParams = {};
          videoAdvancedParams.videoEndpoint = 'images';
        }

        try {
          const {
            buildVideoPollRequest,
            parseVideoPollResponse,
          } = await import('@/lib/video-api');

          const pollReq = buildVideoPollRequest(
            (videoProfile || 'rest-generic') as import('@/lib/video-api').VideoCompatProfile,
            vBaseUrl,
            vApiKey || '',
            thirdPartyTaskId,
            videoAdvancedParams,
          );

          console.log(`[poll-task/video] Polling: url=${pollReq.url}, method=${pollReq.method}`);

          let pollResp = await fetch(pollReq.url, {
            method: pollReq.method,
            headers: pollReq.headers,
            signal: AbortSignal.timeout(30000),
          });

          // Poll endpoint fallback: if current endpoint returns 404/422, try alternative paths
          // Common pattern: /v1/tasks/{id} 404 → try /v1/images/generations/{id}
          if (pollResp.status === 404 && videoProfile === 'rest-generic') {
            const altUrl = pollReq.url.includes('/v1/tasks/')
              ? pollReq.url.replace('/v1/tasks/', '/v1/images/generations/')
              : pollReq.url.includes('/v1/images/generations/')
                ? pollReq.url.replace('/v1/images/generations/', '/v1/tasks/')
                : null;
            if (altUrl) {
              console.log(`[poll-task/video] Poll 404, trying alt: ${altUrl}`);
              pollResp = await fetch(altUrl, {
                method: pollReq.method,
                headers: pollReq.headers,
                signal: AbortSignal.timeout(30000),
              });
            }
          }

          if (!pollResp.ok) {
            // 轮询请求失败：区分4xx（客户端错误/任务不存在）和5xx（服务器临时故障）
            const errorBody = await pollResp.text().catch(() => '');
            if (pollResp.status >= 400 && pollResp.status < 500) {
              // 4xx 客户端错误：可能是 URL 格式不对或任务已过期
              console.warn(`[poll-task] Video poll 4xx (${pollResp.status}): ${errorBody.slice(0, 200)}`);
              const errorMsg = errorBody.includes('not found') || errorBody.includes('Not Found')
                ? '视频任务不存在或已过期'
                : `API 返回错误: ${errorBody.slice(0, 200)}`;
              if (hasDurableVideoTask) {
                const settled = await terminateCloudTaskAndRefund(taskId, 'failed', errorMsg);
                if (!settled.transitioned) return getDurableVideoTerminalResponse();
              } else {
                const videoPoll4xxCreditStatus = await refundTaskCredits(
                  taskId,
                  getTaskInfo(taskId)?.creditCost,
                  `视频生成失败退款 (API ${pollResp.status}, taskId: ${taskId})`,
                );
                void recordVideoTaskTerminal(taskId, { status: 'failed', error: errorMsg, creditStatus: videoPoll4xxCreditStatus })
                  .catch((error) => console.warn('[poll-task] Video failure persistence failed:', error));
              }
              updateTaskProgress(taskId, { status: 'failed', error: errorMsg, progress: 0 });
              releaseQueueSlot(taskId);
              failedTaskCache.set(taskId, { userId, error: errorMsg, timestamp: Date.now() });
              return NextResponse.json({
                success: false, status: 'failed',
                error: translateApiError(errorMsg),
                retryable: true,
              }, { status: 200 });
            }
            // 5xx 服务器错误：可能是临时故障，返回 processing 让前端继续轮询
            console.warn(`[poll-task] Video poll ${pollResp.status}, retrying: ${errorBody.slice(0, 200)}`);
            return NextResponse.json({
              success: true, status: 'processing',
              progress: registryTask.progress,
              label: registryTask.label,
            }, { status: 200 });
          }

          const pollData = await pollResp.json();
          const videoResult = parseVideoPollResponse(
            (videoProfile || 'rest-generic') as import('@/lib/video-api').VideoCompatProfile,
            pollData,
          );

          console.log(`[poll-task/video] Poll result: status=${videoResult.status}, videoUrl=${videoResult.videoUrl ? '(has url)' : '(none)'}, progress=${videoResult.progress}, raw keys=${Object.keys(pollData).join(',')}`);
          console.log(`[poll-task/video] Raw poll response (first 500 chars): ${JSON.stringify(pollData).slice(0, 500)}`);

          if (['succeeded', 'completed', 'success', 'done'].includes(videoResult.status)) {
            // 如果 parseVideoPollResponse 未能提取 videoUrl，尝试从原始数据中提取
            if (!videoResult.videoUrl && pollData) {
              const rawResult = pollData?.data?.result || pollData?.data?.results || pollData?.result || pollData?.results;
              const rawVideos = rawResult?.videos || rawResult?.video_results;
              if (Array.isArray(rawVideos) && rawVideos.length > 0) {
                videoResult.videoUrl = Array.isArray(rawVideos[0].url) ? rawVideos[0].url[0] : rawVideos[0].url;
              } else if (rawResult?.video_url) {
                videoResult.videoUrl = rawResult.video_url;
              } else if (rawResult?.url) {
                videoResult.videoUrl = rawResult.url;
              }
              if (videoResult.videoUrl) {
                console.log(`[poll-task/video] Extracted videoUrl from raw data: ${videoResult.videoUrl.slice(0, 100)}`);
              }
            }

            // AI Link: video content is NOT in the poll response.
            // When status is "completed", fetch GET /v1/videos/{task_id}/content with auth header.
            if (!videoResult.videoUrl && videoProfile === 'ai-link') {
              try {
                const { getAiLinkContentUrl } = await import('@/lib/video-api');
                const contentUrl = getAiLinkContentUrl(vBaseUrl, thirdPartyTaskId);
                console.log(`[poll-task/video] AI Link: fetching content from ${contentUrl}`);
                videoResult.videoUrl = contentUrl;
              } catch (aiLinkErr) {
                console.warn(`[poll-task/video] AI Link content URL construction failed:`, aiLinkErr);
              }
            }
            
            if (videoResult.videoUrl) {
              // 持久化视频文件（直接下载保存，不经过sharp压缩）
              let persistedVideoUrl = videoResult.videoUrl;
              try {
                const path = await import('path');
                const fs = await import('fs/promises');
                const { getServerDataRoot } = await import('@/lib/server-data-root');
                const dataRoot = getServerDataRoot();
                
                // AI Link content endpoint requires Authorization header
                const videoFetchHeaders: Record<string, string> = {};
                if (videoProfile === 'ai-link') {
                  videoFetchHeaders['Authorization'] = `Bearer ${vApiKey}`;
                }

                const videoResp = await fetch(videoResult.videoUrl, {
                  headers: videoFetchHeaders,
                  signal: AbortSignal.timeout(120000),
                });
                if (videoResp.ok) {
                  // Guard against error JSON being returned with a 200 status
                  // (some AI Link gateways return errors as JSON with 200)
                  const contentType = videoResp.headers.get('content-type') || '';
                  if (contentType.includes('application/json') && videoProfile === 'ai-link') {
                    const errorBody = await videoResp.text();
                    console.warn(`[poll-task/video] AI Link content endpoint returned JSON instead of binary: ${errorBody.slice(0, 500)}`);
                    // Try to extract a video URL from the JSON error/response
                    try {
                      const parsed = JSON.parse(errorBody);
                      const fallbackUrl = parsed?.data?.video_url || parsed?.data?.url || parsed?.video_url || parsed?.url;
                      if (typeof fallbackUrl === 'string' && fallbackUrl.startsWith('http')) {
                        console.log(`[poll-task/video] AI Link: extracted fallback URL from JSON: ${fallbackUrl.slice(0, 100)}`);
                        const retryResp = await fetch(fallbackUrl, {
                          headers: videoFetchHeaders,
                          signal: AbortSignal.timeout(120000),
                        });
                        if (retryResp.ok && !retryResp.headers.get('content-type')?.includes('application/json')) {
                          const videoBuffer = Buffer.from(await retryResp.arrayBuffer());
                          const origPath = new URL(fallbackUrl).pathname;
                          const ext = path.extname(origPath).toLowerCase() || '.mp4';
                          const filename = `video_${taskId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
                          const dirPath = path.join(dataRoot, 'uploads', 'video', taskId);
                          await fs.mkdir(dirPath, { recursive: true });
                          await fs.writeFile(path.join(dirPath, filename), videoBuffer);
                          persistedVideoUrl = `/api/serve-upload/video/${taskId}/${filename}`;
                          console.log(`[poll-task/video] Persisted video from fallback URL: ${persistedVideoUrl} (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
                        }
                      }
                    } catch {
                      // JSON parse failed — nothing more we can do
                    }
                  } else {
                    const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
                    // 从原始URL或Content-Type推断视频扩展名
                    const origPath = new URL(videoResult.videoUrl).pathname;
                    const ext = path.extname(origPath).toLowerCase() || '.mp4';
                    const filename = `video_${taskId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
                    const dirPath = path.join(dataRoot, 'uploads', 'video', taskId);
                    await fs.mkdir(dirPath, { recursive: true });
                    await fs.writeFile(path.join(dirPath, filename), videoBuffer);
                    persistedVideoUrl = `/api/serve-upload/video/${taskId}/${filename}`;
                    console.log(`[poll-task/video] Persisted video: ${persistedVideoUrl} (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
                  }
                } else {
                  // Read error body for diagnostics
                  let errorDetail = '';
                  try { errorDetail = await videoResp.text(); } catch { /* ignore */ }
                  console.warn(`[poll-task/video] Failed to download video: ${videoResp.status} ${videoResp.statusText}`, errorDetail.slice(0, 300));
                }
              } catch (persistErr) {
                console.warn('[poll-task] Video persist failed, using source URL:', persistErr);
              }

              const completedResult = {
                ...regResult,
                videoUrl: persistedVideoUrl,
                videoDuration: videoResult.duration,
              };
              if (hasDurableVideoTask) {
                const completed = await completeCloudTask(taskId, completedResult);
                if (!completed) return getDurableVideoTerminalResponse();
              } else {
                void recordVideoTaskTerminal(taskId, {
                  status: 'completed',
                  videoUrl: persistedVideoUrl,
                }).catch((error) => console.warn('[poll-task] Video completion persistence failed:', error));
              }
              updateTaskProgress(taskId, {
                status: 'completed',
                progress: 100,
                result: completedResult,
              });
              releaseQueueSlot(taskId);
              completedTaskCache.set(taskId, { userId, imageUrl: persistedVideoUrl, modelName: '', providerName: '', timestamp: Date.now() });

              return NextResponse.json({
                success: true,
                status: 'completed',
                progress: 100,
                imageUrl: persistedVideoUrl,
                mediaType: 'video',
                videoUrl: persistedVideoUrl,
                videoDuration: videoResult.duration,
                watermarkVideoUrl: videoResult.watermarkVideoUrl,
                modelName: videoModel || '',
              }, { status: 200 });
            }
            // 视频完成但无URL — 视为失败并退款
            const noUrlError = '视频生成已完成但未返回可用地址，请稍后重试';
            console.warn(`[poll-task/video] Task ${taskId} completed but no videoUrl found in response`);
            if (hasDurableVideoTask) {
              const settled = await terminateCloudTaskAndRefund(taskId, 'failed', noUrlError);
              if (!settled.transitioned) return getDurableVideoTerminalResponse();
            } else {
              const noUrlCreditStatus = await refundTaskCredits(
                taskId,
                getTaskInfo(taskId)?.creditCost,
                `视频完成无URL退款 (taskId: ${taskId})`,
              );
              void recordVideoTaskTerminal(taskId, { status: 'failed', error: noUrlError, creditStatus: noUrlCreditStatus })
                .catch((err) => console.warn('[poll-task] Video no-url persistence failed:', err));
            }
            updateTaskProgress(taskId, { status: 'failed', error: noUrlError, progress: 0 });
            releaseQueueSlot(taskId);
            failedTaskCache.set(taskId, { userId, error: noUrlError, timestamp: Date.now() });
          }

          if (videoResult.status === 'failed') {
            const videoFailedError = translateApiError(videoResult.error || '视频生成失败');
            if (hasDurableVideoTask) {
              const settled = await terminateCloudTaskAndRefund(taskId, 'failed', videoFailedError);
              if (!settled.transitioned) return getDurableVideoTerminalResponse();
            } else {
              const videoFailedCreditStatus = await refundTaskCredits(
                taskId,
                getTaskInfo(taskId)?.creditCost,
                `视频生成失败退款 (taskId: ${taskId})`,
              );
              void recordVideoTaskTerminal(taskId, {
                status: 'failed',
                error: videoFailedError,
                creditStatus: videoFailedCreditStatus,
              }).catch((error) => console.warn('[poll-task] Video failure persistence failed:', error));
            }
            updateTaskProgress(taskId, { status: 'failed', error: videoFailedError, progress: 0 });
            releaseQueueSlot(taskId);
            failedTaskCache.set(taskId, { userId, error: videoFailedError, timestamp: Date.now() });
            return NextResponse.json({
              success: false, status: 'failed',
              error: videoFailedError,
              retryable: true,
            }, { status: 200 });
          }

          // 仍在处理中 - 更新进度
          const progress = videoResult.progress || Math.min(registryTask.progress + 5, 90);
          const updatedLabel = `${registryTask.label?.split('·')[0] || '视频生成'} · ${videoResult.status === 'running' ? '生成中' : '排队中'}...`;
          updateTaskProgress(taskId, {
            progress,
            label: updatedLabel,
          });

          // ★ P1: 任务运行 >30s 时，附加预计剩余时间（帮助用户判断是否超时）
          const videoElapsed = Date.now() - (registryTask.createdAt || Date.now());
          const VIDEO_ESTIMATED_TOTAL_MS = 120_000; // 视频默认预估120秒完成
          const videoEstimatedRemaining = videoElapsed > 30_000
            ? Math.max(0, Math.round((VIDEO_ESTIMATED_TOTAL_MS - videoElapsed) / 1000))
            : undefined;

          return NextResponse.json({
            success: true, status: 'processing',
            progress,
            label: updatedLabel,
            ...(videoEstimatedRemaining !== undefined && { estimatedRemainingSeconds: videoEstimatedRemaining }),
          }, { status: 200 });
        } catch (videoPollErr) {
          console.warn('[poll-task] Video poll error:', videoPollErr instanceof Error ? videoPollErr.message : videoPollErr);
          // ★ P1: 即使轮询出错，也尽量附加预计剩余时间
          const videoElapsedCatch = Date.now() - (registryTask.createdAt || Date.now());
          const videoEstRemainingCatch = videoElapsedCatch > 30_000
            ? Math.max(0, Math.round((120_000 - videoElapsedCatch) / 1000))
            : undefined;
          return NextResponse.json({
            success: true, status: 'processing',
            progress: registryTask.progress,
            label: registryTask.label,
            ...(videoEstRemainingCatch !== undefined && { estimatedRemainingSeconds: videoEstRemainingCatch }),
          }, { status: 200 });
        }
      }

      // ★ 关键修复：queued / processing 状态不直接返回！
      // 对于所有远端异步任务类型，必须继续查询远端API获取真实状态
      // 只有纯本地任务（edit/agent-edit）才由后端自行更新 registry，直接返回
      // ★ refine-engine/brand-ecommerce 使用远端 API（APImart等），需要远程轮询
      const LOCAL_TASK_TYPES = ['edit', 'agent-edit', 'brand-ecommerce', 'generate-async'];
      if (LOCAL_TASK_TYPES.includes(registryTask.type) && !shouldPollRemoteAsyncGenerateTask(registryTask)) {
        // 纯本地任务：由后端自行更新 registry，直接返回当前状态
        // ★ 增量结果：将 partialResults 传递给前端
        const response: Record<string, unknown> = {
          success: true,
          status: registryTask.status,
          progress: registryTask.progress,
          label: registryTask.label,
        };
        if (registryTask.partialResults) {
          response.partialResults = registryTask.partialResults;
        }
        return NextResponse.json(response, { status: 200 });
      }
      // ★ refine-engine/brand-ecommerce：检查 registry 中是否已有直接结果（同步模式返回的）
      if ((registryTask.type === 'refine-engine' || registryTask.type === 'brand-ecommerce') && registryTask.result) {
        const directResult = registryTask.result as Record<string, unknown>;
        const directUrls = directResult.directImageUrls as string[] | undefined;
        if (directUrls && directUrls.length > 0) {
          console.log(`[poll-task] ${registryTask.type} 任务有直接结果，返回: ${taskId}`);
          return NextResponse.json({
            success: true,
            status: 'completed',
            progress: 100,
            result: directResult,
          }, { status: 200 });
        }
      }
      // 远端异步任务（generate/mask/erase/outpaint/multi-angle/removebg/refine-engine/brand-ecommerce 等）：继续往下走，查询远端 API
    }

    // ★ 多提供商重试中：任务仍在提交阶段（IIFE尚未完成），没有remoteTaskId
    // 直接返回processing状态，不做远程轮询，避免用本地taskId去查第三方API导致404
    if (registryTask && registryTask.status === 'processing') {
      const regResult = (registryTask.result as Record<string, unknown>) || {};
      // ★ APImart 等异步供应商返回的 taskId 本身就是远程任务 ID（如 task_01KX...）
      const taskIdIsRemote = typeof taskId === 'string' && taskId.startsWith('task_');
      const effectiveRemoteTaskId = (regResult.remoteTaskId as string | undefined) || (taskIdIsRemote ? taskId : undefined);
      // ★ direct- 前缀的 remoteTaskId 表示同步提供商的直接结果，应从 task-registry 查找而非远程轮询
      if (effectiveRemoteTaskId && effectiveRemoteTaskId.startsWith('direct-')) {
        // ★ 多图修复：recovery 路径将所有 direct- taskId 存入 remoteTaskIds，
        // 需聚合全部，而非只取 remoteTaskId（第一个）
        const allDirectTaskIds: string[] = (
          Array.isArray(regResult.remoteTaskIds)
            ? (regResult.remoteTaskIds as unknown[]).filter((id): id is string => typeof id === 'string' && id.startsWith('direct-'))
            : []
        );
        // 确保 remoteTaskId 本身也在列表中
        if (!allDirectTaskIds.includes(effectiveRemoteTaskId)) {
          allDirectTaskIds.unshift(effectiveRemoteTaskId);
        }

        // 检查所有 direct 任务状态并聚合 imageUrls
        const aggregatedImageUrls: string[] = [];
        let firstDirectResult: Record<string, unknown> | undefined;
        let anyStillPending = false;

        for (const directId of allDirectTaskIds) {
          const directTask = getTaskInfo(directId);
          if (!directTask || directTask.status === 'processing' || directTask.status === 'queued') {
            anyStillPending = true;
            continue;
          }
          if (directTask.status === 'completed') {
            const directResult = (directTask.result as Record<string, unknown>) || {};
            if (!firstDirectResult) firstDirectResult = directResult;
            if (Array.isArray(directResult.imageUrls)) {
              aggregatedImageUrls.push(...(directResult.imageUrls as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0));
            }
            if (typeof directResult.imageUrl === 'string' && directResult.imageUrl.length > 0) {
              aggregatedImageUrls.push(directResult.imageUrl);
            }
          }
        }

        // 如果有任务仍在进行，但已有部分完成：返回 partiallyCompleted 让前端提前显示
        if (anyStillPending) {
          const dedupedPartialUrls = Array.from(new Set(aggregatedImageUrls));
          if (dedupedPartialUrls.length > 0) {
            // 计算进度百分比
            const completedCount = allDirectTaskIds.length - allDirectTaskIds.filter(id => {
              const t = getTaskInfo(id);
              return !t || t.status === 'processing' || t.status === 'queued';
            }).length;
            const progressPct = Math.round((completedCount / allDirectTaskIds.length) * 90) + 5;
            return NextResponse.json({
              success: true,
              status: 'partiallyCompleted',
              progress: progressPct,
              label: `生成中 (${completedCount}/${allDirectTaskIds.length})...`,
              imageUrls: dedupedPartialUrls,
              imageUrl: dedupedPartialUrls[0],
              completedCount,
              totalCount: allDirectTaskIds.length,
            }, { status: 200 });
          }
          return NextResponse.json({
            success: true,
            status: 'processing',
            progress: registryTask.progress || 30,
            label: '生成中...',
          }, { status: 200 });
        }

        const dedupedImageUrls = Array.from(new Set(aggregatedImageUrls));
        if (dedupedImageUrls.length > 0) {
          const imageUrl = dedupedImageUrls[0];
          // 将所有 direct task 的聚合结果同步到当前 async task
          updateTaskProgress(taskId, {
            status: 'completed',
            progress: 100,
            label: `生成完成 (${dedupedImageUrls.length}张)`,
            result: {
              imageUrl,
              imageUrls: dedupedImageUrls,
              usedModel: firstDirectResult?.usedModel || regResult.usedModel,
              modelName: firstDirectResult?.modelName || regResult.modelName,
              providerName: firstDirectResult?.providerName || regResult.providerName,
              providerId: firstDirectResult?.providerId || regResult.providerId,
              apiBaseUrl: firstDirectResult?.apiBaseUrl || regResult.apiBaseUrl,
            },
          });
          return NextResponse.json({
            success: true,
            status: 'completed',
            progress: 100,
            label: `生成完成 (${dedupedImageUrls.length}张)`,
            imageUrl,
            imageUrls: dedupedImageUrls,
            task: getTaskInfo(taskId),
          }, { status: 200 });
        }
        // direct tasks 均已完成但没有 imageUrl（极罕见），继续 processing
        return NextResponse.json({
          success: true,
          status: 'processing',
          progress: registryTask.progress || 30,
          label: '生成中...',
        }, { status: 200 });
      }
      const hasRemoteTaskId = !!effectiveRemoteTaskId;
      const hasDirectUrls = !!(regResult.directImageUrls as string[] | undefined)?.length;
      if (!hasRemoteTaskId && !hasDirectUrls) {
        // IIFE还在重试/提交中，尚未获得远程任务ID
        return NextResponse.json({
          success: true,
          status: 'processing',
          progress: registryTask.progress || 10,
          label: registryTask.label || '正在提交生成任务...',
        }, { status: 200 });
      }
      // ★ 将推导出的 remoteTaskId 注入 regResult，供后续远端轮询使用
      if (effectiveRemoteTaskId && !regResult.remoteTaskId) {
        regResult.remoteTaskId = effectiveRemoteTaskId;
      }
    }

    // ★ refine-engine/brand-ecommerce 兜底：如果 task-registry 中没有，
    // 但 globalThis 缓存中有结果，直接返回
    if (!registryTask) {
      // 先检查 font-design 缓存
      const fontDesignCached = getFontDesignResult(taskId);
      if (fontDesignCached) {
        console.log(`[poll-task] task-registry 未找到，从 globalThis 缓存返回 font-design 结果: ${taskId}`);
        const fontDesignResult = unwrapFontDesignTaskResult(fontDesignCached);
        return NextResponse.json({
          success: true,
          status: 'completed',
          progress: 100,
          result: fontDesignResult,
          directImageUrls: fontDesignResult?.directImageUrls as string[] | undefined,
        }, { status: 200 });
      }
      // 再检查 refine-engine 缓存
      const refineCached = getRefineResult(taskId);
      if (refineCached) {
        console.log(`[poll-task] task-registry 未找到，从 globalThis 缓存返回 refine-engine 结果: ${taskId}`);
        return NextResponse.json({
          success: true,
          status: 'completed',
          progress: 100,
          result: refineCached,
          imageUrl: ((refineCached as unknown) as Record<string, unknown>)?.imageUrl as string | undefined,
          maskUrl: ((refineCached as unknown) as Record<string, unknown>)?.maskUrl as string | undefined,
        }, { status: 200 });
      }
      // 既不在 registry 也不在缓存，任务不存在或已过期
      // ★ 检查是否为 layer-decomposition 任务（segment-elements/layered-decompose 提交的任务）
      // layer 任务使用独立的 cloud_tasks 表，不注册到 task-registry
      if (sessionUser) {
        try {
          const layerTask = await getLayerTaskStatus({
            taskId,
            userId: sessionUser.id,
            userRole: sessionUser.role || 'user',
          });
          if (layerTask) {
            console.log(`[poll-task] layer task found: taskId=${taskId}, status=${layerTask.status}, progress=${layerTask.progress}`);
            if (layerTask.status === 'completed' && layerTask.result) {
              return NextResponse.json({
                success: true,
                status: 'completed',
                progress: 100,
                result: { decomposition: layerTask.result, type: 'layer-decomposition' },
              }, { status: 200 });
            }
            if (layerTask.status === 'failed' || layerTask.status === 'cancelled' || layerTask.status === 'timeout') {
              return NextResponse.json({
                success: false,
                status: layerTask.status,
                progress: layerTask.progress,
                error: layerTask.error?.message || '图片分层任务失败',
                retryable: layerTask.error?.retryable || false,
              }, { status: 200 });
            }
            // pending / processing
            return NextResponse.json({
              success: true,
              status: 'processing',
              progress: layerTask.progress,
              label: layerTask.phase || '正在处理图片分层...',
            }, { status: 200 });
          }
        } catch {
          // Not a layer task or layer service unavailable — fall through to "not found"
        }
      }
      // ★ 返回 status:'failed' 而非 'not_found'，确保所有前端轮询代码（检查 status==='failed'）都能正确停止
      console.log(`[poll-task] 任务不存在或已过期: ${taskId}`);
      return NextResponse.json({
        success: false,
        status: 'failed',
        error: '任务不存在或已过期，请重新提交',
        progress: 0,
        label: '任务已过期',
      });
    }

    if (!taskId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing taskId' 
      }, { status: 400 });
    }

    // ★ 查找 API 提供商：优先使用 task-registry 中存储的提供商信息
    // （image-edit 注册异步任务时存储了 apiBaseUrl/apiKey/advancedParams）
    const regInfoForProvider = getTaskInfo(taskId);
    const regResultForProvider = (regInfoForProvider?.result as Record<string, unknown>) || {};
    const regApiBaseUrl = regResultForProvider.apiBaseUrl as string | undefined;
    const regApiKey = regResultForProvider.apiKey as string | undefined;
    const regAdvancedParams = regResultForProvider.advancedParams as Record<string, string> | undefined;
    const regProviderId = regResultForProvider.providerId as string | undefined;
    const regUsedModel = regResultForProvider.usedModel as string | undefined;
    const regModelName = regResultForProvider.modelName as string | undefined;
    const regProviderName = regResultForProvider.providerName as string | undefined;

    let apiKey: string | undefined;
    let apiBaseUrl: string;
    let profile: ApiCompatProfile;
    let providerName = 'unknown';

    if (regApiBaseUrl && regApiKey) {
      // ★ 从 task-registry 获取的提供商信息（最准确，由 image-edit 提交时保存）
      apiKey = regApiKey;
      apiBaseUrl = normalizeApiBaseUrl(regApiBaseUrl);
      profile = resolveCompatProfile({ baseUrl: regApiBaseUrl, advancedParams: regAdvancedParams });
      providerName = `registry(${regUsedModel || 'unknown'})`;
      console.log(`[poll-task] Using registry-stored provider for taskId=${taskId}, model=${regUsedModel || 'unknown'}, baseUrl=${apiBaseUrl}`);
    } else if (bodyApiKey && bodyApiKey !== 'server-managed' && bodyApiBaseUrl) {
      // ★ bgPoll 直接传递的 API 凭证（绕过 registry 查找失败）
      apiKey = bodyApiKey as string;
      apiBaseUrl = normalizeApiBaseUrl(bodyApiBaseUrl as string);
      profile = resolveCompatProfile({ baseUrl: apiBaseUrl, advancedParams: {} });
      providerName = `bgPoll(${model || 'unknown'})`;
      console.log(`[poll-task] Using bgPoll-provided credentials for taskId=${taskId}, model=${model || 'unknown'}, baseUrl=${apiBaseUrl}`);
    } else {
      // 降级：从管理员配置查找提供商（优先使用 providerId 精确匹配）
      const recoveredProviderId = effectiveProviderId || regProviderId;
      const provider = await findProviderForModel(model || regUsedModel || '', 'image', recoveredProviderId || undefined)
        || await findProviderForModel(model || regUsedModel || '', 'universal', recoveredProviderId || undefined);
      apiKey = provider?.apiKey;
      apiBaseUrl = normalizeApiBaseUrl(provider?.baseUrl || '');
      providerName = provider?.name || 'unknown';
      console.log(`[poll-task] 提供商查找: providerId="${effectiveProviderId}", model="${model || regUsedModel || ''}", matched="${provider?.displayName || provider?.name || 'none'}", matchedId="${provider?.id || 'none'}", baseUrl="${apiBaseUrl}"`);
      if (!apiKey || !apiBaseUrl) {
        console.error(`[poll-task] No API provider for taskId=${taskId}, model=${model}, providerId=${effectiveProviderId}`);
        return NextResponse.json({ success: false, error: 'No API provider configured for image polling' }, { status: 400 });
      }
      profile = resolveCompatProfile(provider);
    }

    // ★ 解析兼容性档案 - 确定轮询 URL 格式
    // 对于 refine-engine/brand-ecommerce，使用注册表中存储的 remoteTaskId（APImart 的任务ID）
    // 而不是本地的 taskId（refine-xxx），否则 APImart 无法识别
    const regRemoteTaskId = regResultForProvider.remoteTaskId as string | undefined;
    const effectiveTaskId = regRemoteTaskId || taskId;
    const pollUrl = buildPollUrl(apiBaseUrl, effectiveTaskId, profile);
    console.log(`[poll-task] Polling taskId=${taskId}, remoteTaskId=${regRemoteTaskId || 'N/A'}, effectiveTaskId=${effectiveTaskId}, provider=${providerName}, model=${model || regUsedModel || ''}, pollUrl=${pollUrl?.substring(0, 100)}...`);

    if (!pollUrl) {
      // 该提供商不支持轮询（直接返回模式），不应该到这里
      return NextResponse.json({
        success: false,
        status: 'error',
        error: '该 API 提供商不支持异步轮询',
        retryable: false,
      }, { status: 400 });
    }

    // ★ 短循环模式：服务端内部快速轮询，减少前端→后端往返
    // 当任务仍在处理中时，在服务端内快速重试最多10次（间隔1秒）
    // 增加到10次以减少前端轮询往返次数，缓解慢速API和擦除等长时间任务的超时问题
    // 10次 * 1秒 = 最多10秒服务端等待，足够覆盖大多数模型的首轮返回
    const MAX_QUICK_POLLS = 20;
    const QUICK_POLL_INTERVAL = 500;

    const doSinglePoll = async (): Promise<{ statusResult: Record<string, unknown>; statusResponse: Response } | null> => {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 15000);
      try {
        const resp = await fetch(pollUrl, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        if (!resp.ok) return null;
        const text = await resp.text();
        try {
          return { statusResult: JSON.parse(text), statusResponse: resp };
        } catch {
          return null;
        }
      } catch {
        clearTimeout(tid);
        return null;
      }
    };

    let statusResult: Record<string, unknown> | null = null;
    let statusResponse: Response | null = null;

    // 首次查询
    {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 15000);
      try {
        statusResponse = await fetch(pollUrl, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: ctrl.signal,
        });
        clearTimeout(timeoutId);

        if (!statusResponse.ok) {
          const errorText = await statusResponse.text();
          console.error('Poll task error:', statusResponse.status, errorText);
          return NextResponse.json({
            success: false,
            status: 'error',
            error: `查询任务状态失败: ${statusResponse.status}`,
            retryable: true,
          }, { status: 200 });
        }

        const statusText = await statusResponse.text();
        try {
          statusResult = JSON.parse(statusText);
        } catch {
          console.error('[poll-task] API returned non-JSON response, first 200 chars:', statusText.substring(0, 200));
          return NextResponse.json({
            success: false,
            status: 'error',
            error: 'API 返回了非 JSON 响应（可能是端点不存在），请检查 API 地址配置',
            retryable: true,
          }, { status: 200 });
        }
      } catch (fetchError: unknown) {
        clearTimeout(timeoutId);
        const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        if (errMsg.includes('abort') || errMsg.includes('timeout')) {
          return NextResponse.json({ success: false, status: 'timeout', error: '查询超时，请重试', retryable: true }, { status: 200 });
        }
        return NextResponse.json({ success: false, status: 'error', error: `网络错误: ${errMsg}`, retryable: true }, { status: 200 });
      }
    }

    // ★ 短循环：如果任务仍在处理中，在服务端快速重试最多 MAX_QUICK_POLLS 次
    if (statusResult) {
      const taskData0 = statusResult.data as Record<string, unknown> | undefined;
      const taskStatus0 = taskData0?.status as string | undefined;
      const processingStatuses = ['processing', 'running', 'pending', 'in_progress', 'queued', 'submitted', 'not_start', 'modal', 'PROCESSING', 'RUNNING', 'PENDING', 'IN_PROGRESS', 'QUEUED', 'SUBMITTED', 'NOT_START', 'MODAL'];
      const completedStatuses = ['completed', 'succeeded', 'success', 'done', 'SUCCEEDED', 'COMPLETED', 'SUCCESS', 'DONE'];
      const failedStatuses = ['failed', 'failure', 'cancelled', 'FAILED', 'FAILURE', 'CANCELLED'];

      if (processingStatuses.includes(taskStatus0 || '')) {
        for (let qp = 0; qp < MAX_QUICK_POLLS; qp++) {
          await new Promise(r => setTimeout(r, QUICK_POLL_INTERVAL));
          const pollResult = await doSinglePoll();
          if (pollResult) {
            const td = pollResult.statusResult.data as Record<string, unknown> | undefined;
            const ts = td?.status as string | undefined;
            if (completedStatuses.includes(ts || '') || failedStatuses.includes(ts || '')) {
              statusResult = pollResult.statusResult;
              break;
            }
          }
        }
      }
    }

    if (!statusResult) {
      return NextResponse.json({ success: false, status: 'error', error: '无法获取任务状态', retryable: true }, { status: 200 });
    }

    // ★ 多格式兼容：data 内层 vs 顶层
    const taskData = (statusResult.data as Record<string, unknown> | undefined) || statusResult;
    let taskStatus = taskData?.status as string | undefined;

    // 额外检查：data.result.status（部分 API 嵌套更深）
    if (!taskStatus) {
      const taskResult = taskData?.result as Record<string, unknown> | undefined;
      if (taskResult?.status) taskStatus = taskResult.status as string;
    }

    const completedStatuses = ['completed', 'succeeded', 'success', 'done', 'SUCCEEDED', 'COMPLETED', 'SUCCESS', 'DONE'];
    const processingStatuses = ['processing', 'running', 'pending', 'in_progress', 'queued', 'submitted', 'not_start', 'modal', 'PROCESSING', 'RUNNING', 'PENDING', 'IN_PROGRESS', 'QUEUED', 'SUBMITTED', 'NOT_START', 'MODAL'];
    const failedStatuses = ['failed', 'failure', 'FAILED', 'FAILURE'];
    const cancelledStatuses = ['cancelled', 'CANCELLED'];
    let normalizedStatus = completedStatuses.includes(taskStatus || '')
      ? 'completed'
      : failedStatuses.includes(taskStatus || '')
        ? 'failed'
        : cancelledStatuses.includes(taskStatus || '')
          ? 'cancelled'
          : processingStatuses.includes(taskStatus || '')
            ? 'processing'
            : (taskStatus?.toLowerCase() || 'processing');

    // ★ 日志：每次轮询结果
    console.log(`[poll-task] taskId=${taskId} status=${taskStatus} → normalized=${normalizedStatus}, progress=${(taskData?.progress as number) || 0}`);

    // 返回完整状态信息给前端（标准化 completed 状态）
    const pollResult: Record<string, unknown> = {
      success: true,
      status: normalizedStatus,
      progress: (taskData?.progress as number) || 0,
      estimatedTime: taskData?.estimated_time,
      actualTime: taskData?.actual_time,
    };

    if (normalizedStatus === 'completed') {
      // 提取图片URL - 通用格式兼容（多种 API 响应格式）
      const sourceImageUrls: string[] = [];
      const appendSourceImageUrl = (value: unknown, base64 = false): void => {
        if (Array.isArray(value)) {
          value.forEach(item => appendSourceImageUrl(item, base64));
          return;
        }
        if (value && typeof value === 'object') {
          const item = value as Record<string, unknown>;
          appendSourceImageUrl(item.url ?? item.image_url ?? item.imageUrl ?? item.src ?? item.b64_json, Boolean(item.b64_json));
          return;
        }
        if (typeof value !== 'string' || value.length === 0) return;
        const url = base64 && !value.startsWith('data:') ? `data:image/png;base64,${value}` : value;
        if (!sourceImageUrls.includes(url)) sourceImageUrls.push(url);
      };
      let sourceImageUrl: string | null = null;

      // ★ 日志：原始 taskData 结构（深度解析 APImart 响应）
      console.log(`[poll-task] taskId=${taskId} completed, taskData keys:`, Object.keys(taskData || {}));
      const taskResultLog = taskData?.result as Record<string, unknown> | undefined;
      if (taskResultLog) {
        console.log(`[poll-task] taskId=${taskId} taskData.result keys:`, Object.keys(taskResultLog));
        const imagesLog = taskResultLog?.images as Array<Record<string, unknown>> | undefined;
        if (imagesLog && imagesLog.length > 0) {
          console.log(`[poll-task] taskId=${taskId} taskData.result.images[0] keys:`, Object.keys(imagesLog[0] || {}));
          const firstImgUrlRaw = imagesLog[0]?.url;
          const firstImgUrl = typeof firstImgUrlRaw === 'string' ? firstImgUrlRaw : (typeof firstImgUrlRaw === 'object' ? JSON.stringify(firstImgUrlRaw).substring(0, 100) : undefined);
          if (firstImgUrl) {
            console.log(`[poll-task] taskId=${taskId} taskData.result.images[0].url prefix:`, firstImgUrl.substring(0, 100));
          }
        }
      }

      // 路径1: data.result.images[].url（APImart 格式）
      const taskResult = taskData?.result as Record<string, unknown> | undefined;
      const images = taskResult?.images as Array<Record<string, unknown>> | undefined;
      console.log(`[poll-task] taskId=${taskId} path1: images array exists=${!!images}, length=${images?.length || 0}`);
      appendSourceImageUrl(images);

      // 路径2: data.result.b64_json / image_urls / generated_images / data
      appendSourceImageUrl(taskResult?.b64_json, true);
      // Midjourney returns a four-up preview separately from individual images.
      // Preserve it as metadata while still making it a usable fallback result.
      const gridImageUrl = typeof taskResult?.grid_image_url === 'string'
        ? taskResult.grid_image_url
        : typeof taskData?.grid_image_url === 'string'
          ? taskData.grid_image_url
          : undefined;
      if (gridImageUrl) appendSourceImageUrl(gridImageUrl);
      const taskButtons = Array.isArray(taskResult?.buttons)
        ? taskResult.buttons
        : Array.isArray(taskData?.buttons)
          ? taskData.buttons
          : [];
      if (gridImageUrl) pollResult.gridImageUrl = gridImageUrl;
      if (taskButtons.length > 0) pollResult.buttons = taskButtons;
      appendSourceImageUrl(taskResult?.image_urls);
      appendSourceImageUrl(taskResult?.imageUrls);
      appendSourceImageUrl(taskResult?.generated_images);
      appendSourceImageUrl(taskResult?.data);

      // 路径3: data.output[].url（OpenAI images/generations 兼容格式）
      // 也兼容 PearAPI 格式: data.output.data[].url / data.output.image_urls[]
      const output = taskData?.output as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
      if (Array.isArray(output)) {
        appendSourceImageUrl(output);
      } else if (output && typeof output === 'object') {
        appendSourceImageUrl(output.data);
        appendSourceImageUrl(output.image_urls);
        appendSourceImageUrl(output.imageUrls);
        appendSourceImageUrl(output.generated_images);
        appendSourceImageUrl(output.url ?? output.image_url ?? output.imageUrl);
      }

      // 路径4: data.data[].url（嵌套 data 数组格式 - 同步模式直返）
      appendSourceImageUrl(taskData?.data);

      // 路径5: data.images / image_urls / generated_images / image_url / url
      appendSourceImageUrl(taskData?.images);
      appendSourceImageUrl(taskData?.image_urls);
      appendSourceImageUrl(taskData?.imageUrls);
      appendSourceImageUrl(taskData?.generated_images);
      appendSourceImageUrl(taskData?.image_url ?? taskData?.imageUrl ?? taskData?.url);

      sourceImageUrl = sourceImageUrls[0] || null;

      // ★ 日志：最终提取结果
      const safeSourceImageUrl = typeof sourceImageUrl === 'string' ? sourceImageUrl : (sourceImageUrl ? JSON.stringify(sourceImageUrl).substring(0, 100) : '(null)');
      console.log(`[poll-task] taskId=${taskId} sourceImageUrl extracted: ${sourceImageUrl ? 'YES' : 'NO'}`, safeSourceImageUrl.substring(0, 100) + (typeof sourceImageUrl === 'string' ? '...' : ''));

      // ★ 关键修复：如果提取到了imageUrl，即使status字段不存在或不匹配，也强制设置为completed
      // 因为：图片URL已经存在 = 任务已完成！这是很多第三方API的返回格式（直接返回图片URL，没有status字段）
      if (sourceImageUrl && normalizedStatus !== 'completed') {
        normalizedStatus = 'completed';
        console.log(`[poll-task] taskId=${taskId} imageUrl存在，强制设置为completed状态`);
      }

      // ★ 持久化策略：普通生成任务立即返回完整远程 URL 数组，避免大图下载阻塞 completed 响应。
      // 只有依赖本地文件的后处理任务才同步持久化首图；批量结果由后续统一缓存与云端终态完整保存。
      if (sourceImageUrl) {
        pollResult.imageUrl = sourceImageUrl;
        pollResult.imageUrls = sourceImageUrls;

        const registryInfoForCheck = getTaskInfo(taskId);
        const registryResultForCheck = (registryInfoForCheck?.result as Record<string, unknown>) || {};
        const needsPostProcess = !!(
          registryResultForCheck.outpaintInfo
          || registryResultForCheck.engine === 'ai-background-remove'
          || registryResultForCheck.cropInfo
          || registryResultForCheck._needsResize
        );

        if (needsPostProcess) {
          try {
            const { persistRemoteImage } = await import('@/lib/s3-storage');
            const persistedUrl = await persistRemoteImage(sourceImageUrl, `generate/${taskId}`);
            if (persistedUrl) {
              pollResult.imageUrl = persistedUrl;
              pollResult.imageUrls = [persistedUrl, ...sourceImageUrls.slice(1)];
              try {
                const { saveImageDataMapping } = await import('@/lib/image-source-map');
                const filename = persistedUrl.split('/').pop() || persistedUrl;
                await saveImageDataMapping(filename, sourceImageUrl);
              } catch {}
            }
          } catch (persistErr) {
            console.warn('[poll-task] Post-process source persist failed, using original URL:', persistErr);
          }
        }

        // ★ Outpaint 扩展后处理：直接返回 AI API 扩展结果，不合成原图
        const registryInfo = getTaskInfo(taskId);
        const registryResult = (registryInfo?.result as Record<string, unknown>) || {};
        const outpaintInfo = registryResult.outpaintInfo as Record<string, number> | undefined;
        if (outpaintInfo && pollResult.imageUrl) {
          try {
            const sharp = (await import('sharp')).default;
            const targetW = outpaintInfo.targetW;
            const targetH = outpaintInfo.targetH;
            const genW = outpaintInfo.genW || targetW;
            const genH = outpaintInfo.genH || targetH;

            // Resize AI result to target dimensions if needed
            const aiResultBuf = await fetchImageBuffer(pollResult.imageUrl as string);
            const aiMeta = await sharp(aiResultBuf).metadata();
            const aiW = aiMeta.width || genW;
            const aiH = aiMeta.height || genH;
            let finalBuf = aiResultBuf;

            if (aiW !== targetW || aiH !== targetH) {
              finalBuf = await sharp(aiResultBuf)
                .resize(targetW, targetH, { fit: 'fill' })
                .jpeg({ quality: 92 })
                .toBuffer();
            } else {
              finalBuf = await sharp(aiResultBuf).jpeg({ quality: 92 }).toBuffer();
            }

            // Save the result directly
            const { saveImageFile } = await import('../../../lib/server-data-root');
            const ts = Date.now();
            const filename = `outpaint-${ts}.jpg`;
            const resizedUrl = saveImageFile(finalBuf, filename, 'outpaint');
            if (resizedUrl) {
              pollResult.imageUrl = resizedUrl;
            } else {
              pollResult.imageUrl = `data:image/jpeg;base64,${finalBuf.toString('base64')}`;
            }

            (pollResult as Record<string, unknown>).targetWidth = targetW;
            (pollResult as Record<string, unknown>).targetHeight = targetH;
            console.log(`[poll-task] Outpaint: returning AI result directly, target ${targetW}x${targetH}, genSize ${genW}x${genH}, AI generated: ${aiW}x${aiH}`);
          } catch (outpaintErr) {
            console.warn('[poll-task] Outpaint resize failed, using raw AI result:', outpaintErr instanceof Error ? outpaintErr.message : outpaintErr);
          }
        }

        // ★ AI 放大后处理：AI 必须真实生成目标像素，Sharp 只允许下采样和格式归一。
        const upscaleResizeInfo = registryResult._needsResize as boolean | undefined;
        const registeredOutputSize = registryResult.outputSize as { width?: number; height?: number } | undefined;
        const upscaleTargetW = (registryResult._targetW as number | undefined) || registeredOutputSize?.width;
        const upscaleTargetH = (registryResult._targetH as number | undefined) || registeredOutputSize?.height;
        if (upscaleResizeInfo && upscaleTargetW && upscaleTargetH && pollResult.imageUrl) {
          try {
            const sharp = (await import('sharp')).default;
            const aiResultBuf = await fetchImageBuffer(pollResult.imageUrl as string);
            const aiMeta = await sharp(aiResultBuf).metadata();
            const aiW = aiMeta.width || 0;
            const aiH = aiMeta.height || 0;

            if (aiW < upscaleTargetW || aiH < upscaleTargetH) {
              throw new Error(`AI 超分输出尺寸不足：${aiW}x${aiH}，目标为 ${upscaleTargetW}x${upscaleTargetH}`);
            }

            let finalBuf = aiResultBuf;
            if (aiW !== upscaleTargetW || aiH !== upscaleTargetH) {
              finalBuf = await sharp(aiResultBuf)
                .resize(upscaleTargetW, upscaleTargetH, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
                .png({ quality: 95 })
                .toBuffer();

              const { saveImageFile } = await import('../../../lib/server-data-root');
              const savedUrl = saveImageFile(finalBuf, `upscale-ai-${Date.now()}.png`, 'upscale');
              if (savedUrl) pollResult.imageUrl = savedUrl;
            }

            (pollResult as Record<string, unknown>).outputSize = { width: upscaleTargetW, height: upscaleTargetH };
            (pollResult as Record<string, unknown>).outputWidth = upscaleTargetW;
            (pollResult as Record<string, unknown>).outputHeight = upscaleTargetH;
            (pollResult as Record<string, unknown>).engine = registryResult.engine || 'dedicated-ai';
            (pollResult as Record<string, unknown>).usedModel = registryResult.usedModel;
            (pollResult as Record<string, unknown>).providerId = registryResult.providerId;
            (pollResult as Record<string, unknown>).tiled = registryResult.tiled || false;
            (pollResult as Record<string, unknown>).tileCount = registryResult.tileCount || 1;
            (pollResult as Record<string, unknown>).fallbackAllowed = registryResult.fallbackAllowed || false;
            (pollResult as Record<string, unknown>).fallbackReason = registryResult.fallbackReason;
            console.log(`[poll-task] AI Upscale: validated output ${upscaleTargetW}x${upscaleTargetH}`);
          } catch (upscaleResizeErr) {
            const message = upscaleResizeErr instanceof Error ? upscaleResizeErr.message : String(upscaleResizeErr);
            console.warn('[poll-task] AI Upscale validation failed:', message);
            pollResult.imageUrl = undefined;
            pollResult.imageUrls = [];
            pollResult.status = 'failed';
            pollResult.success = false;
            pollResult.error = message;
          }
        }

        // ★ AI RemoveBG 后处理：用蒙版应用到原图，精确去背景
        // 当 image-edit 的 remove_background 动作返回 AI 异步 taskId 时，
        // 从 AI 结果生成蒙版 → 优化边缘 → 用蒙版应用到原图
        // 优先使用请求参数中的 engine（前端传递），其次检查 task-registry
        const rbRegistryInfo = getTaskInfo(taskId);
        const rbRegistryResult = (rbRegistryInfo?.result as Record<string, unknown>) || {};
        const registryEngine = rbRegistryResult.engine as string | undefined;
        const taskEngine = requestEngineStr || registryEngine;
        if (taskEngine === 'ai-background-remove' && pollResult.imageUrl) {
          try {
            // 获取原图 URL（从 task-registry 中存储的元数据）
            const originalImageUrl = registryResult.originalImageUrl as string | undefined;
            console.log(`[poll-task] Applying mask-based background removal for AI RemoveBG task ${taskId}, originalUrl: ${originalImageUrl || 'N/A'}`);
            const aiRemoveBgResult = await postProcessAIRemoveBG(pollResult.imageUrl as string, originalImageUrl || undefined);
            if (aiRemoveBgResult) {
              pollResult.imageUrl = aiRemoveBgResult.imageUrl;
              // 传递 maskUrl 到前端
              (pollResult as Record<string, unknown>).maskUrl = aiRemoveBgResult.maskUrl || '';
              console.log(`[poll-task] AI RemoveBG post-processing complete: ${aiRemoveBgResult.imageUrl}, mask: ${aiRemoveBgResult.maskUrl || 'N/A'}`);
            } else {
              // postProcessAIRemoveBG 返回 null → 用简单透明化兜底
              console.warn('[poll-task] AI RemoveBG post-processing returned null, trying local fallback');
              if (originalImageUrl) {
                try {
                  const imgBuf = await fetchImageBuffer(originalImageUrl);
                  // 使用 sharp 做简单透明化兜底
                  const sharp = (await import('sharp')).default;
                  const meta = await sharp(imgBuf).metadata();
                  if (meta.width && meta.height) {
                    const rgba = await sharp(imgBuf).ensureAlpha().raw().toBuffer();
                    // 采样四个角落的平均亮度作为背景色
                    const w = meta.width;
                    const h = meta.height;
                    const cornerSize = Math.max(5, Math.min(20, Math.floor(Math.min(w, h) * 0.05)));
                    let rSum = 0, gSum = 0, bSum = 0, sampleCount = 0;
                    for (const [sy, sx] of [[0, 0], [0, w - cornerSize], [h - cornerSize, 0], [h - cornerSize, w - cornerSize]]) {
                      for (let dy = 0; dy < cornerSize; dy++) {
                        for (let dx = 0; dx < cornerSize; dx++) {
                          const idx = ((sy + dy) * w + (sx + dx)) * 4;
                          rSum += rgba[idx]; gSum += rgba[idx + 1]; bSum += rgba[idx + 2];
                          sampleCount++;
                        }
                      }
                    }
                    const bgR = rSum / sampleCount, bgG = gSum / sampleCount, bgB = bSum / sampleCount;
                    // 生成黑白蒙版：与背景色距离小于阈值的像素为黑色（背景），其余为白色（前景）
                    const maskThreshold = 60;
                    const maskData = Buffer.alloc(w * h);
                    for (let i = 0; i < w * h; i++) {
                      const idx = i * 4;
                      const dr = rgba[idx] - bgR, dg = rgba[idx + 1] - bgG, db = rgba[idx + 2] - bgB;
                      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
                      // 将与背景色距离小于阈值的像素设为透明
                      if (dist < maskThreshold) rgba[idx + 3] = 0;
                      // 蒙版：白色=前景，黑色=背景
                      maskData[i] = dist < maskThreshold ? 0 : 255;
                    }
                    const resultPng = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
                    const { saveImageFile } = await import('../../../lib/server-data-root');
                    const timestamp = Date.now();
                    const filename = `removebg-fallback-${timestamp}.png`;
                    const fallbackUrl = saveImageFile(resultPng, filename, 'removebg');
                    // 保存黑白蒙版图
                    const maskPng = await sharp(maskData, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
                    const maskFilename = `removebg-mask-${timestamp}.png`;
                    const maskUrl = saveImageFile(maskPng, maskFilename, 'removebg');
                    pollResult.imageUrl = fallbackUrl;
                    (pollResult as Record<string, unknown>).maskUrl = maskUrl || '';
                    console.log(`[poll-task] Local fallback RemoveBG succeeded: ${fallbackUrl}, mask: ${maskUrl || 'N/A'}`);
                  }
                } catch (fallbackErr) {
                  console.warn('[poll-task] Local fallback also failed:', fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
                }
              }
            }
          } catch (postErr) {
            console.warn('[poll-task] AI RemoveBG mask-based removal failed, using original:', postErr instanceof Error ? postErr.message : postErr);
          }
        }

        const cropInfoReg = getTaskInfo(taskId);
        const cropInfoResult = (cropInfoReg?.result as Record<string, unknown>) || {};
        const cropInfoData = cropInfoResult.cropInfo as Record<string, number> | undefined;
        const originalImageUrl = cropInfoResult.originalImageUrl as string | undefined;
        const maskImageUrl = cropInfoResult.maskImageUrl as string | undefined;
        if (originalImageUrl && maskImageUrl && pollResult.imageUrl) {
          try {
            const sharp = (await import('sharp')).default;
            const originalBuf = await fetchImageBuffer(originalImageUrl);
            const maskBuf = await fetchImageBuffer(maskImageUrl);
            let editedFullSize = await fetchImageBuffer(pollResult.imageUrl as string);

            if (cropInfoData?.cropW && cropInfoData?.cropH) {
              const resizedResult = await sharp(editedFullSize)
                .resize(cropInfoData.cropW, cropInfoData.cropH, { fit: 'fill' })
                .png()
                .toBuffer();
              editedFullSize = await sharp(originalBuf)
                .composite([{
                  input: resizedResult,
                  left: cropInfoData.cropX,
                  top: cropInfoData.cropY,
                  blend: 'over',
                }])
                .png()
                .toBuffer();
            } else {
              const originalMeta = await sharp(originalBuf).metadata();
              editedFullSize = await sharp(editedFullSize)
                .resize(originalMeta.width, originalMeta.height, { fit: 'fill' })
                .png()
                .toBuffer();
            }

            const compositeResult = await compositeMaskedEdit({
              source: originalBuf,
              edited: editedFullSize,
              mask: maskBuf,
            });
            pollResult.imageUrl = `data:image/png;base64,${compositeResult.toString('base64')}`;
            console.log(`[poll-task] Applied lossless masked edit for task ${taskId} (${(compositeResult.length / 1024).toFixed(0)}KB)`);
          } catch (cropErr) {
            const message = cropErr instanceof Error ? cropErr.message : String(cropErr);
            console.warn('[poll-task] Masked edit composite failed closed:', message);
            pollResult.imageUrl = undefined;
            pollResult.imageUrls = [];
            pollResult.status = 'failed';
            pollResult.success = false;
            pollResult.code = 'MASKED_COMPOSITE_FAILED';
            pollResult.error = '蒙版合成失败，无法保证未编辑区域保持不变，请重试';
            pollResult.retryable = true;
          }
        }

      }
      // ★ 更新任务注册中心状态（包含 result，后续 poll 可直接从 registry 返回）
      // 保留原有 result 中的 engine/cropInfo 等元数据
      const regInfo = getTaskInfo(taskId);
      const existingResult = (regInfo?.result as Record<string, unknown>) || {};
      const maskUrl = (pollResult as Record<string, unknown>).maskUrl as string | undefined;
      // ★ 保留模型名称和供应商信息到 result，确保后续 poll 和前端能获取到
      const finalModelName = (existingResult.modelName as string) || regModelName || (model || regUsedModel || '');
      const finalProviderId = (existingResult.providerId as string)
        || regProviderId
        || effectiveProviderId;
      const finalProviderName = await resolveCanonicalTaskProviderName(
        finalProviderId,
        (existingResult.providerName as string) || regProviderName || '',
      );
      const durableGenerationSlot = isDurableGenerationSlot(existingResult);

      if (!pollResult.imageUrl) {
        const taskError = taskData?.error as Record<string, unknown> | undefined;
        const postProcessError = typeof pollResult.error === 'string' ? pollResult.error : '';
        const errorDetail = postProcessError
          || (taskData?.fail_reason as string)
          || (taskData?.failReason as string)
          || (taskError?.message as string)
          || (typeof taskData?.error === 'string' ? taskData.error : '');
        const classifiedNoImgErr = classifyApiError(errorDetail || '模型返回了文本而不是生成图像');

        const terminalError = classifiedNoImgErr.friendlyMessage
          || translateApiError(errorDetail)
          || '模型返回了文本而不是生成图像，请尝试重新措辞提示';

        const durableTermination = durableGenerationSlot
          ? await terminateCloudTaskAndRefund(taskId, 'failed', terminalError)
          : null;
        if (durableGenerationSlot && !durableTermination?.transitioned) {
          const persistedResponse = await getDurableGenerationSlotResponse(taskId, userId);
          if (persistedResponse) return persistedResponse;
          return NextResponse.json({
            success: false,
            status: 'failed',
            error: '持久化任务状态不可用，未覆盖原有终态',
            retryable: true,
          }, { status: 409 });
        }
        const creditStatus = durableTermination?.refunded
          ? 'refunded'
          : await refundTaskCredits(
            taskId,
            regInfo?.creditCost,
            `图像生成无结果退款 (taskId: ${taskId})`,
          );
        updateTaskProgress(taskId, { status: 'failed', progress: 100, error: terminalError });
        if (!durableGenerationSlot) {
          await recordImageTaskTerminal(taskId, { status: 'failed', error: terminalError, creditStatus });
        }
        failedTaskCache.set(taskId, {
          userId,
          error: terminalError,
          taskResult: existingResult,
          timestamp: Date.now(),
        });
        releaseQueueSlot(taskId);
        pollResult.status = 'failed';
        pollResult.progress = 100;
        pollResult.error = terminalError;
        pollResult.success = false;
        pollResult.retryable = false;
      } else {
      const rawPollImageUrls = Array.isArray((pollResult as Record<string, unknown>).imageUrls)
        ? ((pollResult as Record<string, unknown>).imageUrls as unknown[]).filter((url): url is string => typeof url === 'string' && url.length > 0)
        : [];
      const finalPrimaryImageUrl = typeof pollResult.imageUrl === 'string' && pollResult.imageUrl.length > 0
        ? pollResult.imageUrl
        : rawPollImageUrls[0];
      const pollImageUrls = finalPrimaryImageUrl
        ? [finalPrimaryImageUrl, ...rawPollImageUrls.filter(url => url !== finalPrimaryImageUrl && url !== rawPollImageUrls[0])]
        : rawPollImageUrls;
      const existingImageUrls = Array.isArray(existingResult.imageUrls)
        ? (existingResult.imageUrls as unknown[]).filter((url): url is string => typeof url === 'string' && url.length > 0)
        : [];
      const imageUrls = Array.from(new Set([
        ...pollImageUrls,
        ...existingImageUrls.filter(url => url !== rawPollImageUrls[0]),
      ]));
      const pollMaskUrls = Array.isArray((pollResult as Record<string, unknown>).maskUrls)
        ? ((pollResult as Record<string, unknown>).maskUrls as unknown[]).filter((url): url is string => typeof url === 'string' && url.length > 0)
        : [];
      const existingMaskUrls = Array.isArray(existingResult.maskUrls)
        ? (existingResult.maskUrls as unknown[]).filter((url): url is string => typeof url === 'string' && url.length > 0)
        : [];
      const maskUrls = Array.from(new Set([
        ...pollMaskUrls,
        ...existingMaskUrls,
        ...(maskUrl ? [maskUrl] : []),
      ]));
      pollResult.imageUrl = imageUrls[0];
      (pollResult as Record<string, unknown>).imageUrls = imageUrls;
      (pollResult as Record<string, unknown>).maskUrls = maskUrls;
      const gridImageUrl = typeof pollResult.gridImageUrl === 'string' ? pollResult.gridImageUrl : '';
      const buttons = Array.isArray(pollResult.buttons) ? pollResult.buttons : [];
      const completedTaskResult = {
        ...existingResult,
        imageUrl: imageUrls[0],
        imageUrls,
        maskUrl: maskUrls[0] || '',
        maskUrls,
        gridImageUrl,
        buttons,
        usedModel: model || regUsedModel || existingResult.usedModel,
        modelName: finalModelName,
        providerId: finalProviderId,
        providerName: finalProviderName,
        generationRouteAudit: existingResult.generationRouteAudit,
      };
      if (durableGenerationSlot) {
        const generationCompletion = await completeCloudTask(taskId, completedTaskResult);
        if (!generationCompletion) {
          const persistedResponse = await getDurableGenerationSlotResponse(taskId, userId);
          if (persistedResponse) return persistedResponse;
          return NextResponse.json({
            success: false,
            status: 'failed',
            error: '持久化任务状态不可用，未覆盖原有终态',
            retryable: true,
          }, { status: 409 });
        }
      }
      await appendUserJsonl(userId, 'images', {
        type: 'completed',
        providerId: finalProviderId || providerName,
        model: model || regUsedModel || '',
        taskId,
        imageUrl: imageUrls[0],
        imageUrls,
      });
      updateTaskProgress(taskId, { status: 'completed', progress: 100, result: completedTaskResult });
      if (!durableGenerationSlot) {
        void recordImageTaskTerminal(taskId, {
          status: 'completed',
          imageUrl: imageUrls[0],
          imageUrls,
          maskUrl: maskUrls[0],
          maskUrls,
          gridImageUrl,
          buttons,
          creditStatus: regInfo?.creditCost && regInfo.creditCost > 0 ? 'charged' : 'not-applicable',
          generationRouteAudit: existingResult.generationRouteAudit as import('@/lib/generation-route-audit').GenerationRouteAudit | undefined,
        }).catch(error => console.warn('[poll-task] 云端任务完成记录失败:', error));
      }

      // ★ 将 cropInfo（蒙版修图需要）和 targetWidth/Height（扩展需要）等元数据附加到 pollResult
      if (existingResult.cropInfo) {
        (pollResult as Record<string, unknown>).cropInfo = existingResult.cropInfo;
      }
      if (existingResult.outpaintInfo) {
        const oi = existingResult.outpaintInfo as Record<string, number>;
        if (oi.targetW) (pollResult as Record<string, unknown>).targetWidth = oi.targetW;
        if (oi.targetH) (pollResult as Record<string, unknown>).targetHeight = oi.targetH;
      }

      // ★ 将模型信息附加到 pollResult（前端需要）
      (pollResult as Record<string, unknown>).usedModel = model || regUsedModel || existingResult.usedModel;
      (pollResult as Record<string, unknown>).modelName = finalModelName;
      (pollResult as Record<string, unknown>).providerName = finalProviderName;
      (pollResult as Record<string, unknown>).generationRouteAudit = existingResult.generationRouteAudit;

      // ★ 同时更新本地完成缓存（Next.js dev模式下 registry 实例可能不一致）
      const cachedImageUrl = imageUrls[0];
      if (cachedImageUrl) {
        completedTaskCache.set(taskId, {
          userId,
          imageUrl: cachedImageUrl,
          imageUrls,
          maskUrl: maskUrls[0] || '',
          maskUrls,
          gridImageUrl,
          buttons,
          modelName: finalModelName,
          providerName: finalProviderName,
          taskResult: {
            ...existingResult,
            imageUrl: cachedImageUrl,
            imageUrls,
          },
          timestamp: Date.now(),
        });
      }
      }
    } else if (normalizedStatus === 'failed') {
      const durableFailureResult = (getTaskInfo(taskId)?.result as Record<string, unknown>) || {};
      const durableGenerationSlot = isDurableGenerationSlot(durableFailureResult);
      const taskError = taskData?.error as Record<string, unknown> | undefined;
      const rawError = (taskData?.fail_reason as string)
        || (taskData?.failReason as string)
        || (taskError?.message as string)
        || (typeof taskData?.error === 'string' ? taskData.error : '')
        || '图像生成任务失败';
      const classifiedErr = classifyApiError(rawError);
      const translatedError = classifiedErr.friendlyMessage + (classifiedErr.suggestion ? ' — ' + classifiedErr.suggestion : '');
      const isCfTimeout = isCloudflareTimeoutError(rawError);
      const durableTermination = durableGenerationSlot
        ? await terminateCloudTaskAndRefund(taskId, 'failed', translatedError)
        : null;
      if (durableGenerationSlot && !durableTermination?.transitioned) {
        const persistedResponse = await getDurableGenerationSlotResponse(taskId, userId);
        if (persistedResponse) return persistedResponse;
        return NextResponse.json({
          success: false,
          status: 'failed',
          error: '持久化任务状态不可用，未覆盖原有终态',
          retryable: true,
        }, { status: 409 });
      }
      const creditStatus = durableTermination?.refunded
        ? 'refunded'
        : await refundTaskCredits(
          taskId,
          getTaskInfo(taskId)?.creditCost,
          `图像生成失败退款 (taskId: ${taskId})`,
        );
      updateTaskProgress(taskId, { status: 'failed', error: translatedError });
      if (!durableGenerationSlot) {
        await recordImageTaskTerminal(taskId, {
          status: 'failed',
          error: translatedError,
          creditStatus,
        }).catch(error => console.warn('[poll-task] 云端任务失败记录失败:', error));
      }
      failedTaskCache.set(taskId, {
        userId,
        error: translatedError,
        taskResult: durableFailureResult,
        timestamp: Date.now(),
      });
      releaseQueueSlot(taskId);
      pollResult.error = translatedError;
      pollResult.success = false;
      (pollResult as Record<string, unknown>).errorCategory = classifiedErr.category;
      (pollResult as Record<string, unknown>).isRetryable = classifiedErr.isRetryable;
      (pollResult as Record<string, unknown>).isCfTimeout = isCfTimeout;
    } else if (normalizedStatus === 'cancelled') {
      const durableCancelledResult = (getTaskInfo(taskId)?.result as Record<string, unknown>) || {};
      const durableGenerationSlot = isDurableGenerationSlot(durableCancelledResult);
      const durableTermination = durableGenerationSlot
        ? await terminateCloudTaskAndRefund(taskId, 'cancelled', '任务已被取消')
        : null;
      if (durableGenerationSlot && !durableTermination?.transitioned) {
        const persistedResponse = await getDurableGenerationSlotResponse(taskId, userId);
        if (persistedResponse) return persistedResponse;
        return NextResponse.json({
          success: false,
          status: 'failed',
          error: '持久化任务状态不可用，未覆盖原有终态',
          retryable: true,
        }, { status: 409 });
      }
      const creditStatus = durableTermination?.refunded
        ? 'refunded'
        : await refundTaskCredits(
          taskId,
          getTaskInfo(taskId)?.creditCost,
          `图像生成取消退款 (taskId: ${taskId})`,
        );
      updateTaskProgress(taskId, { status: 'cancelled', progress: 100, error: '任务已被取消' });
      if (!durableGenerationSlot) {
        await recordImageTaskTerminal(taskId, {
          status: 'cancelled',
          error: '任务已被取消',
          creditStatus,
        }).catch(error => console.warn('[poll-task] 云端任务取消记录失败:', error));
      }
      releaseQueueSlot(taskId);
      pollResult.error = '任务已被取消';
      pollResult.success = false;
      pollResult.retryable = false;
    }

    // ★ 日志：返回给前端的最终结果
    console.log(`[poll-task] taskId=${taskId} returning: status=${pollResult.status}, imageUrl=${pollResult.imageUrl ? 'YES' : 'NO'}, progress=${pollResult.progress}`);

    const currentTaskResult = getTaskInfo(taskId)?.result;
    return NextResponse.json(withGenerationSlotMetadata(
      pollResult as Record<string, unknown>,
      currentTaskResult && typeof currentTaskResult === 'object'
        ? currentTaskResult as Record<string, unknown>
        : undefined,
      taskId,
    ));

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Poll task route error:', errMsg);
    const classifiedErr = classifyApiError(errMsg);
    const translatedErrMsg = classifiedErr.friendlyMessage + (classifiedErr.suggestion ? ' — ' + classifiedErr.suggestion : '');
    return NextResponse.json({
      success: false,
      status: 'error',
      error: translatedErrMsg,
      errorCategory: classifiedErr.category,
      isRetryable: classifiedErr.isRetryable,
      isCfTimeout: isCloudflareTimeoutError(errMsg),
      retryable: classifiedErr.isRetryable,
    }, { status: 500 });
  }
}
