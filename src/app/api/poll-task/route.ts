import { NextRequest, NextResponse, after } from 'next/server';

export const maxDuration = 1800; // 30分钟 - 支持长时间轮询慢速API（apimart等需要260s+任务）

import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { resolveCompatProfile, buildPollUrl, extractImageUrl, type ApiCompatProfile } from '@/lib/api-compatibility';
import { postProcessAIRemoveBG } from '@/lib/remove-bg-postprocess';
import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { getEditTask, deleteEditTask, setEditTask, failEditTask } from '@/lib/edit-task-store';
import { isTaskCancelled, updateTaskProgress, getTaskInfo, registerTask, releaseQueueSlot, type TaskType } from '@/lib/task-registry';
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
import { claimCloudTaskLease, getCloudTaskForUser, refundCloudTaskCredits, updateCloudTask } from '@/lib/cloud-task-storage';
import { getCompletedVideoTaskResult } from '@/lib/video-task-result';
import { resolveVideoCompatProfile } from '@/lib/video-api';

export const dynamic = 'force-dynamic';

// ★ 本地完成缓存：避免同一任务重复查远端API和重复持久化
// （Next.js dev模式下不同路由可能使用不同的 task-registry 实例，
//   所以在 poll-task 内部维护自己的缓存更可靠）
const completedTaskCache = new Map<string, {
  imageUrl: string;
  imageUrls?: string[];
  maskUrl?: string;
  maskUrls?: string[];
  modelName?: string;
  providerName?: string;
  timestamp: number;
}>();
const FAILED_CACHE = Symbol('failed');
const failedTaskCache = new Map<string, { error: string; timestamp: number }>();
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

// 定期清理过期缓存（5分钟以上的缓存清除）
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
              signal: AbortSignal.timeout(30000),
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
                updateTaskProgress(taskId, { status: 'completed', progress: 100 });
                setEditTask(taskId, {
                  id: taskId,
                  status: 'completed',
                  progress: 100,
                  stage: '完成',
                  result: {
                    success: true,
                    image: images[0],
                    images,
                    model: remoteModel,
                    provider: apiBaseUrl || 'unknown',
                    llmInstruction: remotePollInfo.prompt,
                    editRegions: [],
                    autoMaskGenerated: false,
                  },
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
                  setEditTask(taskId, {
                    ...(existingTask || { id: taskId, progress: 0, createdAt: Date.now() }),
                    status: 'completed',
                    stage: '完成',
                    result: {
                      success: true,
                      image: { url: deepUrl },
                      images: [{ url: deepUrl }],
                      model: remotePollInfo.model || model,
                      provider: remotePollInfo.apiBaseUrl || 'unknown',
                    },
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
          }
        } catch (remoteErr) {
          console.warn('[poll-task] edit remote poll error:', remoteErr instanceof Error ? remoteErr.message : remoteErr);
          // 远程轮询失败，返回当前本地状态
        }
      }

      return NextResponse.json({
        success: true,
        status: 'processing',
        stage: task.stage,
        progress: task.progress,
      }, { status: 200 });
    }

    // ★ 优先检查本地完成缓存（避免重复查远端API和重复持久化）
    const cachedCompleted = completedTaskCache.get(taskId);
    if (cachedCompleted) {
      return NextResponse.json({
        success: true,
        status: 'completed',
        progress: 100,
        imageUrl: cachedCompleted.imageUrl,
        imageUrls: cachedCompleted.imageUrls || [cachedCompleted.imageUrl],
        maskUrl: cachedCompleted.maskUrl || '',
        maskUrls: cachedCompleted.maskUrls || (cachedCompleted.maskUrl ? [cachedCompleted.maskUrl] : []),
        modelName: cachedCompleted.modelName || '',
        providerName: cachedCompleted.providerName || '',
      }, { status: 200 });
    }
    const cachedFailed = failedTaskCache.get(taskId);
    if (cachedFailed) {
      return NextResponse.json({
        success: false,
        status: 'failed',
        error: translateApiError(cachedFailed.error),
        retryable: true,
      }, { status: 200 });
    }

    // ★ 检查 task-registry 中的任务
    let registryTask = getTaskInfo(taskId);
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
          return NextResponse.json({
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
          }, { status: 200 });
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
          return NextResponse.json({
            success: false,
            status: persistedTask.status,
            error: persistedTask.error || '任务未完成',
            retryable: persistedTask.status === 'failed',
          }, { status: 200 });
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
          (requiresSubmissionRecovery ? 'generate-async' : recovery.type) as TaskType,
          recovery.label,
          recovery.userId,
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
            submissionPayload: requiresSubmissionRecovery ? submissionPayload : undefined,
            remoteTaskId: recovery.remoteTaskId,
            ...(recovery.type.startsWith('video') ? {
              thirdPartyTaskId: recovery.remoteTaskId,
              profile: recoveredVideoProfile,
              model: recovery.model,
              usedImagesEndpoint: persistedTask.result?.usedImagesEndpoint === true,
            } : {}),
            providerId: recovery.providerId,
            usedModel: recovery.model,
            modelName: recovery.model,
          },
        });
        if (requiresSubmissionRecovery) {
          try {
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
              signal: AbortSignal.timeout(600000),
            });
            const resumedData = await resumed.json().catch(() => null) as Record<string, unknown> | null;
            if (!resumed.ok || !resumedData?.success) {
              throw new Error(typeof resumedData?.error === 'string' ? resumedData.error : `任务恢复提交失败 (${resumed.status})`);
            }

            const directImageUrls = [
              ...(Array.isArray(resumedData.imageUrls) ? resumedData.imageUrls : []),
              ...(Array.isArray(resumedData.directImageUrls) ? resumedData.directImageUrls : []),
            ].filter((url): url is string => typeof url === 'string' && url.length > 0);
            if (directImageUrls.length > 0) {
              updateTaskProgress(recovered.taskId, {
                status: 'completed',
                progress: 100,
                result: { imageUrl: directImageUrls[0], imageUrls: directImageUrls },
              });
              await recordImageTaskTerminal(recovered.taskId, {
                status: 'completed',
                imageUrl: directImageUrls[0],
                imageUrls: directImageUrls,
                creditStatus: persistedTask.creditCost && persistedTask.creditCost > 0 ? 'charged' : 'not-applicable',
              });
              return NextResponse.json({
                success: true,
                status: 'completed',
                progress: 100,
                imageUrl: directImageUrls[0],
                imageUrls: directImageUrls,
              }, { status: 200 });
            }

            const remoteTaskIds = Array.isArray(resumedData.taskIds)
              ? resumedData.taskIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
              : [];
            if (remoteTaskIds.length === 0) {
              throw new Error('任务恢复未返回供应商任务 ID');
            }

            const recoveredResult = {
              submissionPayload,
              remoteTaskId: remoteTaskIds[0],
              remoteTaskIds,
              providerId: resumedData.providerId || recovery.providerId,
              usedModel: resumedData.model || recovery.model,
              modelName: resumedData.modelName || recovery.model,
              providerName: resumedData.providerName,
            };
            updateTaskProgress(recovered.taskId, { status: 'processing', progress: 10, result: recoveredResult });
            await updateCloudTask(recovered.taskId, {
              remoteTaskId: remoteTaskIds[0],
              progress: 10,
              result: recoveredResult,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : '任务恢复提交失败';
            let creditStatus: 'pending' | 'refunded' | 'not-applicable' = persistedTask.creditCost && persistedTask.creditCost > 0
              ? 'pending'
              : 'not-applicable';
            if (persistedTask.creditCost && persistedTask.creditCost > 0 && persistedTask.creditStatus !== 'refunded') {
              try {
                const refund = await refundCloudTaskCredits(
                  recovered.taskId,
                  `图像生成恢复失败退款 (taskId: ${recovered.taskId})`,
                );
                creditStatus = refund.refunded ? 'refunded' : 'pending';
              } catch (refundError) {
                console.error('[poll-task] Resumed generation refund failed:', refundError);
              }
            }
            updateTaskProgress(recovered.taskId, { status: 'failed', progress: 0, error: message });
            await recordImageTaskTerminal(recovered.taskId, { status: 'failed', error: message, creditStatus });
            return NextResponse.json({ success: false, status: 'failed', error: translateApiError(message), retryable: true }, { status: 200 });
          }
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
        const completedVideo = registryTask.type === 'video'
          ? getCompletedVideoTaskResult(safeResult)
          : undefined;
        return NextResponse.json({
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
          providerName: (safeResult?.providerName as string) || (safeResult?.providerId as string) || '',
        }, { status: 200 });
      }
      if (registryTask.status === 'failed') {
        // ★ 释放队列槽位
        releaseQueueSlot(taskId);
        return NextResponse.json({
          success: false,
          status: 'failed',
          progress: registryTask.progress,
          error: translateApiError(registryTask.error || '处理失败'),
          retryable: false,
        }, { status: 200 });
      }
      if (registryTask.status === 'cancelled') {
        return NextResponse.json({
          success: false,
          status: 'cancelled',
          error: '任务已被取消',
          retryable: false,
        }, { status: 200 });
      }
      // submitOnly uses this task as a local progress wrapper. Its background
      // worker owns the provider task ID, so polling it remotely would send an
      // async-* ID to the provider and can falsely terminally fail the task.
      if (isPendingLocalAsyncGenerateTask(registryTask)) {
        return NextResponse.json({
          success: true,
          status: 'processing',
          progress: registryTask.progress,
          label: registryTask.label || '生成中...',
        }, { status: 200 });
      }
      // ★ 视频任务轮询：使用 video-api 协议适配器
      if (registryTask.type === 'video') {
        const regResult = (registryTask.result as Record<string, unknown>) || {};
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
              updateTaskProgress(taskId, { status: 'failed', error: errorMsg, progress: 0 });
              void recordVideoTaskTerminal(taskId, { status: 'failed', error: errorMsg })
                .catch((error) => console.warn('[poll-task] Video failure persistence failed:', error));
              releaseQueueSlot(taskId);
              failedTaskCache.set(taskId, { error: errorMsg, timestamp: Date.now() });
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
            
            if (videoResult.videoUrl) {
              // 持久化视频文件（直接下载保存，不经过sharp压缩）
              let persistedVideoUrl = videoResult.videoUrl;
              try {
                const path = await import('path');
                const fs = await import('fs/promises');
                const { getServerDataRoot } = await import('@/lib/server-data-root');
                const dataRoot = getServerDataRoot();
                
                const videoResp = await fetch(videoResult.videoUrl, { signal: AbortSignal.timeout(120000) });
                if (videoResp.ok) {
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
                } else {
                  console.warn(`[poll-task/video] Failed to download video: ${videoResp.status}`);
                }
              } catch (persistErr) {
                console.warn('[poll-task] Video persist failed, using source URL:', persistErr);
              }

              updateTaskProgress(taskId, {
                status: 'completed',
                progress: 100,
                result: {
                  ...regResult,
                  videoUrl: persistedVideoUrl,
                  videoDuration: videoResult.duration,
                },
              });
              void recordVideoTaskTerminal(taskId, {
                status: 'completed',
                videoUrl: persistedVideoUrl,
              }).catch((error) => console.warn('[poll-task] Video completion persistence failed:', error));
              releaseQueueSlot(taskId);
              completedTaskCache.set(taskId, { imageUrl: persistedVideoUrl, modelName: '', providerName: '', timestamp: Date.now() });

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
            // 视频完成但无URL — 视为失败
            console.warn(`[poll-task/video] Task ${taskId} completed but no videoUrl found in response`);
          }

          if (videoResult.status === 'failed') {
            updateTaskProgress(taskId, { status: 'failed', error: videoResult.error || '视频生成失败', progress: 0 });
            void recordVideoTaskTerminal(taskId, {
              status: 'failed',
              error: videoResult.error || '视频生成失败',
            }).catch((error) => console.warn('[poll-task] Video failure persistence failed:', error));
            releaseQueueSlot(taskId);
            failedTaskCache.set(taskId, { error: videoResult.error || '视频生成失败', timestamp: Date.now() });
            return NextResponse.json({
              success: false, status: 'failed',
              error: translateApiError(videoResult.error || '视频生成失败'),
              retryable: true,
            }, { status: 200 });
          }

          // 仍在处理中 - 更新进度
          const progress = videoResult.progress || Math.min(registryTask.progress + 5, 90);
          updateTaskProgress(taskId, {
            progress,
            label: `${registryTask.label?.split('·')[0] || '视频生成'} · ${videoResult.status === 'running' ? '生成中' : '排队中'}...`,
          });

          return NextResponse.json({
            success: true, status: 'processing',
            progress,
            label: registryTask.label,
          }, { status: 200 });
        } catch (videoPollErr) {
          console.warn('[poll-task] Video poll error:', videoPollErr instanceof Error ? videoPollErr.message : videoPollErr);
          return NextResponse.json({
            success: true, status: 'processing',
            progress: registryTask.progress,
            label: registryTask.label,
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
        const directTask = getTaskInfo(effectiveRemoteTaskId);
        if (directTask?.status === 'completed') {
          const directResult = (directTask.result as Record<string, unknown>) || {};
          const directImageUrl = directResult.imageUrl as string | undefined;
          if (directImageUrl) {
            // 将 direct task 的结果同步到当前 async task
            updateTaskProgress(taskId, {
              status: 'completed',
              progress: 100,
              label: '生成完成',
              result: {
                imageUrl: directImageUrl,
                usedModel: directResult.usedModel || regResult.usedModel,
                modelName: directResult.modelName || regResult.modelName,
                providerName: directResult.providerName || regResult.providerName,
                providerId: directResult.providerId || regResult.providerId,
                apiBaseUrl: directResult.apiBaseUrl || regResult.apiBaseUrl,
              },
            });
            return NextResponse.json({
              success: true,
              status: 'completed',
              progress: 100,
              label: '生成完成',
              imageUrl: directImageUrl,
              task: getTaskInfo(taskId),
            }, { status: 200 });
          }
        }
        // direct task 尚未完成，返回 processing
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
      const processingStatuses = ['processing', 'running', 'pending', 'in_progress', 'queued', 'submitted', 'PROCESSING', 'RUNNING', 'PENDING', 'IN_PROGRESS', 'QUEUED', 'SUBMITTED'];
      const completedStatuses = ['completed', 'succeeded', 'success', 'done', 'SUCCEEDED', 'COMPLETED', 'SUCCESS', 'DONE'];

      if (processingStatuses.includes(taskStatus0 || '')) {
        for (let qp = 0; qp < MAX_QUICK_POLLS; qp++) {
          await new Promise(r => setTimeout(r, QUICK_POLL_INTERVAL));
          const pollResult = await doSinglePoll();
          if (pollResult) {
            const td = pollResult.statusResult.data as Record<string, unknown> | undefined;
            const ts = td?.status as string | undefined;
            if (completedStatuses.includes(ts || '') || (ts?.toLowerCase() === 'failed') || (ts?.toLowerCase() === 'cancelled')) {
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
    let normalizedStatus = completedStatuses.includes(taskStatus || '') ? 'completed' : (taskStatus?.toLowerCase() || 'processing');

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

    if (completedStatuses.includes(taskStatus || '')) {
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

        // ★ AI 放大后处理：AI 模型按自身预设尺寸输出，直接使用 AI 输出
        // AI 输出已是 AI 能增强的最佳尺寸，无需再 resize（resize 会导致模糊/涂抹）
        const upscaleResizeInfo = registryResult._needsResize as boolean | undefined;
        const upscaleTargetW = registryResult._targetW as number | undefined;
        const upscaleTargetH = registryResult._targetH as number | undefined;
        if (upscaleResizeInfo && upscaleTargetW && upscaleTargetH && pollResult.imageUrl) {
          try {
            const sharp = (await import('sharp')).default;
            const aiResultBuf = await fetchImageBuffer(pollResult.imageUrl as string);
            const aiMeta = await sharp(aiResultBuf).metadata();
            const aiW = aiMeta.width || upscaleTargetW;
            const aiH = aiMeta.height || upscaleTargetH;

            console.log(`[poll-task] AI Upscale: AI output ${aiW}x${aiH}, target was ${upscaleTargetW}x${upscaleTargetH}`);

            // AI 输出小于目标时，先用两步锐化增强，再用 Lanczos3 放大到目标尺寸
            let finalBuf = aiResultBuf;
            if (aiW < upscaleTargetW * 0.9 || aiH < upscaleTargetH * 0.9) {
              // AI 输出显著小于目标(差距>10%)，两步锐化 + Lanczos3 放大到目标
              // Step 1: 中频纹理恢复
              const step1 = await sharp(aiResultBuf)
                .sharpen({ sigma: 1.2, m1: 0.8, m2: 0.4, x1: 2, y2: 4, y3: 10 })
                .png({ quality: 95 })
                .toBuffer();
              // Step 2: 微观边缘增强
              const step2 = await sharp(step1)
                .sharpen({ sigma: 0.3, m1: 0.4, m2: 0.15, x1: 1, y2: 2, y3: 6 })
                .png({ quality: 95 })
                .toBuffer();
              // Step 3: Lanczos3 放大到用户设定的目标尺寸
              finalBuf = await sharp(step2)
                .resize(upscaleTargetW, upscaleTargetH, { kernel: sharp.kernel.lanczos3 })
                .png({ quality: 95 })
                .toBuffer();
              console.log(`[poll-task] AI Upscale: sharpened + Lanczos3 upscaled from ${aiW}x${aiH} to ${upscaleTargetW}x${upscaleTargetH}`);
            }

            // 仅在 AI 输出大于目标时才做缩小（精确裁剪到目标尺寸）+ 锐化
            if (aiW > upscaleTargetW && aiH > upscaleTargetH) {
              const downscaled = await sharp(aiResultBuf)
                .resize(upscaleTargetW, upscaleTargetH, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
                .png({ quality: 95 })
                .toBuffer();
              // 缩小后添加锐化补偿
              finalBuf = await sharp(downscaled)
                .sharpen({ sigma: 0.8, m1: 0.6, m2: 0.3, x1: 2, y2: 4, y3: 8 })
                .png({ quality: 95 })
                .toBuffer();
              console.log(`[poll-task] AI Upscale: downscaled from ${aiW}x${aiH} to ${upscaleTargetW}x${upscaleTargetH} + sharpened`);
            }

            // 持久化最终结果
            if (!Buffer.isBuffer(finalBuf) || finalBuf !== aiResultBuf) {
              const { saveImageFile } = await import('../../../lib/server-data-root');
              const ts = Date.now();
              const filename = `upscale-ai-${ts}.png`;
              const savedUrl = saveImageFile(Buffer.isBuffer(finalBuf) ? finalBuf : aiResultBuf, filename, 'upscale');
              if (savedUrl) {
                pollResult.imageUrl = savedUrl;
              }
            }

            // 返回最终输出尺寸：如果做了放大则用目标尺寸，否则用AI输出尺寸
            const didUpscale = (aiW < upscaleTargetW * 0.9 || aiH < upscaleTargetH * 0.9);
            const didDownscale = (aiW > upscaleTargetW && aiH > upscaleTargetH);
            const finalW = didDownscale ? upscaleTargetW : (didUpscale ? upscaleTargetW : aiW);
            const finalH = didDownscale ? upscaleTargetH : (didUpscale ? upscaleTargetH : aiH);
            (pollResult as Record<string, unknown>).outputSize = { width: finalW, height: finalH };
            console.log(`[poll-task] AI Upscale: final output ${finalW}x${finalH}`);

            // AI 画质精修（带关键词约束，仅修复画质不改变内容）
            if (pollResult.imageUrl) {
              try {
                const enhanceResult = await enhanceViaAI(pollResult.imageUrl as string);
                if (enhanceResult.enhanced && enhanceResult.url) {
                  pollResult.imageUrl = enhanceResult.url;
                  (pollResult as Record<string, unknown>).enhanced = true;
                  console.log('[poll-task] AI quality enhance applied after upscale');
                } else {
                  console.log('[poll-task] AI enhance skipped/failed, using raw upscale result');
                }
              } catch (enhanceErr) {
                console.warn('[poll-task] AI enhance error:', enhanceErr instanceof Error ? enhanceErr.message : enhanceErr);
              }
            }
          } catch (upscaleResizeErr) {
            console.warn('[poll-task] AI Upscale post-process failed, using raw AI result:', upscaleResizeErr instanceof Error ? upscaleResizeErr.message : upscaleResizeErr);
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

        // ★ 蒙版修图/擦除异步结果：AI API 返回的已是最终结果，无需蒙版合成
        // AI 模型（DALL-E / GPT Image 等）在收到蒙版+原图后，返回的图片已经是完整的修改结果
        // 直接使用 AI 返回的结果，不需要再做蒙版 alpha 合成
        // 对于有 cropInfo 的蒙版修图，AI 只返回裁剪区域的结果，需要贴回原图对应位置
        const cropInfoReg = getTaskInfo(taskId);
        const cropInfoResult = (cropInfoReg?.result as Record<string, unknown>) || {};
        const cropInfoData = cropInfoResult.cropInfo as Record<string, number> | undefined;
        if (cropInfoData && cropInfoData.cropW && cropInfoData.cropH && pollResult.imageUrl) {
          try {
            const originalImageUrl = cropInfoResult.originalImageUrl as string | undefined;
            if (originalImageUrl) {
              const sharp = (await import('sharp')).default;
              const cropX = cropInfoData.cropX;
              const cropY = cropInfoData.cropY;
              const cropW = cropInfoData.cropW;
              const cropH = cropInfoData.cropH;

              // 获取原图和 AI 结果
              const originalBuf = await fetchImageBuffer(originalImageUrl);
              const aiResultBuf = await fetchImageBuffer(pollResult.imageUrl as string);

              // 将 AI 结果 resize 到裁剪区域尺寸，直接贴回原图
              const resizedResult = await sharp(aiResultBuf)
                .resize(cropW, cropH, { fit: 'fill' })
                .png()
                .toBuffer();

              const compositeResult = await sharp(originalBuf)
                .composite([{ input: resizedResult, left: cropX, top: cropY, blend: 'over' }])
                .jpeg({ quality: 92 })
                .toBuffer();

              const compositeDataUrl = `data:image/jpeg;base64,${compositeResult.toString('base64')}`;
              pollResult.imageUrl = compositeDataUrl;
              console.log(`[poll-task] Crop paste-back: ${cropW}x${cropH} at (${cropX},${cropY}) → JPEG (${(compositeResult.length / 1024).toFixed(0)}KB)`);
            }
          } catch (cropErr) {
            console.warn('[poll-task] Crop paste-back failed, using raw AI result:', cropErr instanceof Error ? cropErr.message : cropErr);
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
      const finalProviderName = (existingResult.providerName as string) || regProviderName || '';

      if (!pollResult.imageUrl) {
        const taskError = taskData?.error as Record<string, unknown> | undefined;
        const errorDetail = (taskError?.message as string) || '';
        const classifiedNoImgErr = classifyApiError(errorDetail || '模型返回了文本而不是生成图像');

        const terminalError = classifiedNoImgErr.friendlyMessage
          || translateApiError(errorDetail)
          || '模型返回了文本而不是生成图像，请尝试重新措辞提示';

        const creditStatus = await refundTaskCredits(
          taskId,
          regInfo?.creditCost,
          `图像生成无结果退款 (taskId: ${taskId})`,
        );
        updateTaskProgress(taskId, { status: 'failed', progress: 100, error: terminalError });
        await recordImageTaskTerminal(taskId, { status: 'failed', error: terminalError, creditStatus });
        failedTaskCache.set(taskId, { error: terminalError, timestamp: Date.now() });
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
      await appendUserJsonl(userId, 'images', {
        type: 'completed',
        providerId: providerName,
        model: model || regUsedModel || '',
        taskId,
        imageUrl: imageUrls[0],
        imageUrls,
      });
      updateTaskProgress(taskId, { status: 'completed', progress: 100, result: { ...existingResult, imageUrl: imageUrls[0], imageUrls, maskUrl: maskUrls[0] || '', maskUrls, usedModel: model || regUsedModel || existingResult.usedModel, modelName: finalModelName, providerName: finalProviderName } });
      void recordImageTaskTerminal(taskId, {
        status: 'completed',
        imageUrl: imageUrls[0],
        imageUrls,
        maskUrl: maskUrls[0],
        maskUrls,
        creditStatus: regInfo?.creditCost && regInfo.creditCost > 0 ? 'charged' : 'not-applicable',
      }).catch(error => console.warn('[poll-task] 云端任务完成记录失败:', error));

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

      // ★ 同时更新本地完成缓存（Next.js dev模式下 registry 实例可能不一致）
      const cachedImageUrl = imageUrls[0];
      if (cachedImageUrl) {
        completedTaskCache.set(taskId, {
          imageUrl: cachedImageUrl,
          imageUrls,
          maskUrl: maskUrls[0] || '',
          maskUrls,
          modelName: finalModelName,
          providerName: finalProviderName,
          timestamp: Date.now(),
        });
      }
      }
    } else if (taskStatus?.toLowerCase() === 'failed') {
      const rawError = ((taskData?.error as Record<string, unknown>)?.message as string) || '图像生成任务失败';
      const classifiedErr = classifyApiError(rawError);
      const translatedError = classifiedErr.friendlyMessage + (classifiedErr.suggestion ? ' — ' + classifiedErr.suggestion : '');
      const isCfTimeout = isCloudflareTimeoutError(rawError);
      const creditStatus = await refundTaskCredits(
        taskId,
        getTaskInfo(taskId)?.creditCost,
        `图像生成失败退款 (taskId: ${taskId})`,
      );
      updateTaskProgress(taskId, { status: 'failed', error: translatedError });
      await recordImageTaskTerminal(taskId, {
        status: 'failed',
        error: translatedError,
        creditStatus,
      }).catch(error => console.warn('[poll-task] 云端任务失败记录失败:', error));
      failedTaskCache.set(taskId, { error: translatedError, timestamp: Date.now() });
      releaseQueueSlot(taskId);
      pollResult.error = translatedError;
      pollResult.success = false;
      (pollResult as Record<string, unknown>).errorCategory = classifiedErr.category;
      (pollResult as Record<string, unknown>).isRetryable = classifiedErr.isRetryable;
      (pollResult as Record<string, unknown>).isCfTimeout = isCfTimeout;
    } else if (taskStatus?.toLowerCase() === 'cancelled') {
      pollResult.error = '任务已被取消';
      pollResult.success = false;
    }

    // ★ 日志：返回给前端的最终结果
    console.log(`[poll-task] taskId=${taskId} returning: status=${pollResult.status}, imageUrl=${pollResult.imageUrl ? 'YES' : 'NO'}, progress=${pollResult.progress}`);

    return NextResponse.json(pollResult);

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
