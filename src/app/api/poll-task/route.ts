import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300; // 5分钟 - 支持长时间轮询慢速API

import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { resolveCompatProfile, buildPollUrl, type ApiCompatProfile } from '@/lib/api-compatibility';
import { postProcessAIRemoveBG } from '@/lib/remove-bg-postprocess';
import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { getEditTask, deleteEditTask, setEditTask, failEditTask } from '@/lib/edit-task-store';
import { isTaskCancelled, updateTaskProgress, getTaskInfo, releaseQueueSlot } from '@/lib/task-registry';
import { translateApiError } from '@/lib/api-error-translate';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getRefineResult } from '@/app/api/refine-engine/route';
import { getBrandResult } from '@/app/api/brand-ecommerce/route';

export const dynamic = 'force-dynamic';

// ★ 本地完成缓存：避免同一任务重复查远端API和重复持久化
// （Next.js dev模式下不同路由可能使用不同的 task-registry 实例，
//   所以在 poll-task 内部维护自己的缓存更可靠）
const completedTaskCache = new Map<string, { imageUrl: string; maskUrl?: string; timestamp: number }>();
const FAILED_CACHE = Symbol('failed');
const failedTaskCache = new Map<string, { error: string; timestamp: number }>();

// 定期清理过期缓存（5分钟以上的缓存清除）
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of completedTaskCache) {
      if (now - v.timestamp > 5 * 60 * 1000) completedTaskCache.delete(k);
    }
    for (const [k, v] of failedTaskCache) {
      if (now - v.timestamp > 5 * 60 * 1000) failedTaskCache.delete(k);
    }
  }, 60_000).unref?.();
}

// 轮询异步任务状态 - 由前端调用
// 通用化设计：支持不同提供商的任务状态查询格式
export async function POST(request: NextRequest) {
  try {
    const { taskId, model: rawModel, userId: requestUserId, providerId, engine: requestEngine } = await request.json();
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json({
        success: false,
        status: 'error',
        error: '缺少 taskId 参数',
        retryable: false,
      }, { status: 400 });
    }
    const model = typeof rawModel === 'string' ? rawModel : (rawModel as Record<string, unknown>)?.model as string || String(rawModel || '');
    // ★ engine 参数：前端传递的任务引擎类型（用于 AI RemoveBG 后处理等场景）
    // 优先使用请求参数，因为 Next.js dev 模式下 task-registry 可能不共享
    const requestEngineStr = typeof requestEngine === 'string' ? requestEngine : '';
    const sessionUser = await getSessionUser(request);
    const userId = sessionUser?.id ?? requestUserId ?? "anonymous";

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
        return NextResponse.json({
          success: true,
          status: 'completed',
          stage: task.stage,
          result: task.result,
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
          const { taskId: remoteTaskId, apiBaseUrl, apiKey, model: remoteModel } = remotePollInfo;
          const pollUrl = `${apiBaseUrl}/tasks/${remoteTaskId}`;
          const pollResp = await fetchWithV1Retry(
            apiBaseUrl,
            `/tasks/${remoteTaskId}`,
            {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(30000),
            },
          );

          if (pollResp.ok) {
            const pollData = await pollResp.json() as Record<string, unknown>;
            const taskData = (pollData.data as Record<string, unknown>) || pollData;
            const taskStatus = String(taskData.status || '').toLowerCase();

            if (taskStatus === 'succeeded' || taskStatus === 'completed' || taskStatus === 'success') {
              // 远程任务完成，提取图片
              const images: Array<{ url: string }> = [];
              const dataItems = taskData.images || taskData.results || taskData.output;
              if (Array.isArray(dataItems)) {
                for (const item of dataItems) {
                  const url = item.url || item.image_url || item;
                  if (typeof url === 'string' && url.startsWith('http')) {
                    images.push({ url });
                  }
                }
              } else if (typeof taskData.image_url === 'string') {
                images.push({ url: taskData.image_url });
              } else if (typeof taskData.url === 'string' && taskData.url.startsWith('http')) {
                images.push({ url: taskData.url });
              }

              if (images.length > 0) {
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
            } else if (taskStatus === 'failed' || taskStatus === 'error') {
              const taskError = (taskData.error as Record<string, unknown>) || {};
              const rawError = (typeof taskError === 'object' && taskError.message)
                ? String(taskError.message)
                : String(taskData.error_message || taskData.message || '远程任务失败');
              failEditTask(taskId, translateApiError(rawError));
              return NextResponse.json({
                success: false,
                status: 'failed',
                error: translateApiError(rawError),
                retryable: true,
              }, { status: 200 });
            } else {
              // 仍在处理中
              const progress = typeof taskData.progress === 'number' ? taskData.progress : task.progress;
              return NextResponse.json({
                success: true,
                status: 'processing',
                stage: task.stage,
                progress: Math.max(progress, 15),
              }, { status: 200 });
            }
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
        maskUrl: cachedCompleted.maskUrl || '',
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
    const registryTask = getTaskInfo(taskId);
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
        return NextResponse.json({
          success: true,
          status: 'completed',
          progress: registryTask.progress,
          result: taskResult,
          imageUrl: (taskResult as unknown as Record<string, unknown>)?.imageUrl as string | undefined,
          maskUrl: (taskResult as unknown as Record<string, unknown>)?.maskUrl as string | undefined,
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
      // ★ 关键修复：queued / processing 状态不直接返回！
      // 对于所有远端异步任务类型，必须继续查询远端API获取真实状态
      // 只有纯本地任务（edit/agent-edit）才由后端自行更新 registry，直接返回
      // ★ refine-engine/brand-ecommerce 使用远端 API（APImart等），需要远程轮询
      const LOCAL_TASK_TYPES = ['edit', 'agent-edit', 'brand-ecommerce'];
      if (LOCAL_TASK_TYPES.includes(registryTask.type)) {
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

    // ★ refine-engine/brand-ecommerce 兜底：如果 task-registry 中没有，
    // 但 globalThis 缓存中有结果，直接返回
    if (!registryTask) {
      // 先检查 refine-engine 缓存
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
      // 再检查 brand-ecommerce 缓存
      const brandCached = getBrandResult(taskId);
      if (brandCached) {
        console.log(`[poll-task] task-registry 未找到，从 globalThis 缓存返回 brand-ecommerce 结果: ${taskId}`);
        return NextResponse.json({
          success: true,
          status: 'completed',
          progress: 100,
          result: brandCached,
        }, { status: 200 });
      }
      // 既不在 registry 也不在缓存，返回 processing 状态让前端继续轮询
      return NextResponse.json({
        success: true,
        status: 'processing',
        progress: 10,
        label: '处理中...',
      }, { status: 200 });
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
    const regUsedModel = regResultForProvider.usedModel as string | undefined;

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
    } else {
      // 降级：从管理员配置查找提供商
      const provider = providerId ? await findProviderById(providerId)
        : await findProviderForModel(model || regUsedModel || '', 'imageEdit')
        || await findProviderForModel(model || regUsedModel || '', 'image')
        || await findProviderForModel(model || regUsedModel || '', 'universal');
      apiKey = provider?.apiKey;
      apiBaseUrl = normalizeApiBaseUrl(provider?.baseUrl || '');
      providerName = provider?.name || 'unknown';
      if (!apiKey || !apiBaseUrl) {
        console.error(`[poll-task] No API provider for taskId=${taskId}, model=${model}, providerId=${providerId}`);
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
      const processingStatuses = ['processing', 'running', 'pending', 'in_progress', 'queued', 'submitted'];
      const completedStatuses = ['completed', 'succeeded', 'success', 'done'];

      if (processingStatuses.includes(taskStatus0 || '')) {
        for (let qp = 0; qp < MAX_QUICK_POLLS; qp++) {
          await new Promise(r => setTimeout(r, QUICK_POLL_INTERVAL));
          const pollResult = await doSinglePoll();
          if (pollResult) {
            const td = pollResult.statusResult.data as Record<string, unknown> | undefined;
            const ts = td?.status as string | undefined;
            if (completedStatuses.includes(ts || '') || ts === 'failed' || ts === 'cancelled') {
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

    const completedStatuses = ['completed', 'succeeded', 'success', 'done'];
    const normalizedStatus = completedStatuses.includes(taskStatus || '') ? 'completed' : taskStatus;

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
      let sourceImageUrl: string | null = null;

      // 路径1: data.result.images[].url（APImart 格式）
      const images = (taskData?.result as Record<string, unknown>)?.images as Array<Record<string, unknown>> | undefined;
      if (images && images.length > 0) {
        const firstImage = images[0];
        const rawUrl = firstImage.url || firstImage.image_url || firstImage.src;
        sourceImageUrl = Array.isArray(rawUrl) ? rawUrl[0] : (typeof rawUrl === 'string' ? rawUrl : null);
      }

      // 路径2: data.result.b64_json
      const taskResult = taskData?.result as Record<string, unknown> | undefined;
      if (!sourceImageUrl && taskResult?.b64_json) {
        sourceImageUrl = `data:image/png;base64,${taskResult.b64_json}`;
      }

      // 路径3: data.output[].url（OpenAI images/generations 兼容格式）
      if (!sourceImageUrl) {
        const output = taskData?.output as Array<Record<string, unknown>> | undefined;
        if (output && Array.isArray(output) && output.length > 0) {
          const rawUrl = output[0].url || output[0].image_url;
          sourceImageUrl = Array.isArray(rawUrl) ? rawUrl[0] : (typeof rawUrl === 'string' ? rawUrl : null);
        }
      }

      // 路径4: data.data[].url（嵌套 data 数组格式）
      if (!sourceImageUrl) {
        const nestedData = taskData?.data as Array<Record<string, unknown>> | undefined;
        if (nestedData && Array.isArray(nestedData) && nestedData.length > 0) {
          const rawUrl = nestedData[0].url || nestedData[0].image_url || nestedData[0].b64_json;
          if (typeof rawUrl === 'string') {
            sourceImageUrl = rawUrl.startsWith('data:') ? rawUrl : rawUrl;
          }
        }
      }

      // 路径5: data.image_url / data.url（单图格式）
      if (!sourceImageUrl) {
        const singleUrl = (taskData?.image_url as string) || (taskData?.url as string);
        if (singleUrl && typeof singleUrl === 'string') {
          sourceImageUrl = Array.isArray(singleUrl) ? singleUrl[0] : singleUrl;
        }
      }

      // ★ 持久化图片策略：
      // 1. 需要后处理的任务(outpaint/removeBG/crop)：必须同步持久化，因为后处理需要下载图片
      // 2. data: URL：必须同步持久化，浏览器无法缓存大data URL
      // 3. 普通生成任务：立即返回源URL，后台异步持久化（速度优化）
      if (sourceImageUrl) {
        pollResult.imageUrl = sourceImageUrl;

        // 检测是否需要后处理（outpaint/removeBG/crop），这些任务需要同步持久化
        const registryInfoForCheck = getTaskInfo(taskId);
        const registryResultForCheck = (registryInfoForCheck?.result as Record<string, unknown>) || {};
        const needsPostProcess = !!(registryResultForCheck.outpaintInfo || registryResultForCheck.engine === 'ai-background-remove' || registryResultForCheck.cropInfo);
        const needsImmediatePersist = sourceImageUrl.startsWith('data:') || needsPostProcess;

        if (needsImmediatePersist) {
          // 同步持久化：data: URL 或需要后处理的任务
          try {
            const { persistRemoteImage } = await import('@/lib/s3-storage');
            const persistedUrl = await persistRemoteImage(sourceImageUrl, `generate/${taskId}`);
            if (persistedUrl) {
              pollResult.imageUrl = persistedUrl;
              completedTaskCache.set(taskId, { imageUrl: persistedUrl, timestamp: Date.now() });
            }
          } catch (persistErr) {
            console.warn('[poll-task] Synchronous persist failed:', persistErr);
            // 持久化失败时仍设置缓存，避免重复查询远端
            completedTaskCache.set(taskId, { imageUrl: sourceImageUrl, timestamp: Date.now() });
          }
        } else {
          // HTTP/远程 URL + 普通生成任务：先写入完成缓存，后台异步持久化
          completedTaskCache.set(taskId, { imageUrl: sourceImageUrl, timestamp: Date.now() });

          const bgTaskId = taskId;
          const bgSourceUrl = sourceImageUrl;
          (async () => {
            try {
              const { persistRemoteImage } = await import('@/lib/s3-storage');
              const persistedUrl = await persistRemoteImage(bgSourceUrl, `generate/${bgTaskId}`);
              if (persistedUrl) {
                completedTaskCache.set(bgTaskId, { imageUrl: persistedUrl, timestamp: Date.now() });
                try {
                  const { saveImageDataMapping } = await import('@/lib/image-source-map');
                  const filename = persistedUrl.split('/').pop() || persistedUrl;
                  await saveImageDataMapping(filename, bgSourceUrl);
                } catch {}
                console.log(`[poll-task] Background persist completed: ${bgTaskId} → ${persistedUrl}`);
              }
            } catch (persistErr) {
              console.warn('[poll-task] Background persist failed (source URL still works):', persistErr);
            }
          })();
        }

        // ★ Outpaint 扩展后处理：将原图合成到 AI 结果中心
        // 当 image-edit 的 outpaint 动作返回 AI 异步 taskId 时，
        // AI 返回的扩展图片尺寸可能与目标不匹配，需要：1) resize 到目标尺寸 2) 将原图叠在中心
        const registryInfo = getTaskInfo(taskId);
        const registryResult = (registryInfo?.result as Record<string, unknown>) || {};
        const outpaintInfo = registryResult.outpaintInfo as Record<string, number> | undefined;
        if (outpaintInfo && pollResult.imageUrl) {
          try {
            const sharp = (await import('sharp')).default;
            const originalImageUrl = registryResult.originalImageUrl as string | undefined;
            console.log(`[poll-task] Outpaint composite for task ${taskId}, originalUrl: ${originalImageUrl || 'N/A'}`);

            if (originalImageUrl) {
              // 获取 AI 扩展结果和原图
              // ★ 扩展画面：直接使用 AI 结果（AI 已基于参考图生成包含原图内容的完整画面）
              // 不再做"原图覆盖到AI结果上"的合成，因为：
              // 1. AI 接收了参考图，生成结果已包含原图内容
              // 2. 硬覆盖原图会产生拼接痕迹和边界问题
              // 3. 灰色块是因为原图覆盖位置/尺寸不匹配
              try {
                const outpaintInfo = registryResult.outpaintInfo as Record<string, number> | undefined;
                if (outpaintInfo) {
                  const aiResultBuf = await fetchImageBuffer(pollResult.imageUrl as string);
                  const targetW = outpaintInfo.targetW;
                  const targetH = outpaintInfo.targetH;

                  // 将 AI 结果 resize 到精确的目标尺寸（避免比例偏差）
                  const aiMeta = await sharp(aiResultBuf).metadata();
                  if (targetW && targetH && ((aiMeta.width || 0) !== targetW || (aiMeta.height || 0) !== targetH)) {
                    const resizedBuf = await sharp(aiResultBuf)
                      .resize(targetW, targetH, { fit: 'fill' })
                      .jpeg({ quality: 92 })
                      .toBuffer();

                    const { saveImageFile } = await import('../../../lib/server-data-root');
                    const timestamp = Date.now();
                    const resizedFilename = `outpaint-${timestamp}.jpg`;
                    const resizedUrl = saveImageFile(resizedBuf, resizedFilename, 'outpaint');
                    if (resizedUrl) {
                      pollResult.imageUrl = resizedUrl;
                    } else {
                      pollResult.imageUrl = `data:image/jpeg;base64,${resizedBuf.toString('base64')}`;
                    }
                  }

                  // 传递目标尺寸给前端
                  (pollResult as Record<string, unknown>).targetWidth = targetW;
                  (pollResult as Record<string, unknown>).targetHeight = targetH;
                  console.log(`[poll-task] Outpaint: using AI result directly (no composite), target: ${targetW}x${targetH}`);
                }
              } catch (outpaintErr) {
                console.warn('[poll-task] Outpaint resize failed, using raw AI result:', outpaintErr instanceof Error ? outpaintErr.message : outpaintErr);
              }
            } else {
              // 没有原图 URL，直接使用 AI 结果
              console.log(`[poll-task] Outpaint: no original URL, using AI result directly`);
            }
          } catch (outpaintCompositeErr) {
            console.warn('[poll-task] Outpaint composite failed:', outpaintCompositeErr instanceof Error ? outpaintCompositeErr.message : outpaintCompositeErr);
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

        await appendUserJsonl(userId, 'images', { type: 'completed', providerId: providerName, model: model || regUsedModel || '', taskId, imageUrl: pollResult.imageUrl });
      }
      // ★ 更新任务注册中心状态（包含 result，后续 poll 可直接从 registry 返回）
      // 保留原有 result 中的 engine/cropInfo 等元数据
      const regInfo = getTaskInfo(taskId);
      const existingResult = (regInfo?.result as Record<string, unknown>) || {};
      const maskUrl = (pollResult as Record<string, unknown>).maskUrl as string | undefined;
      updateTaskProgress(taskId, { status: 'completed', progress: 100, result: { ...existingResult, imageUrl: pollResult.imageUrl, maskUrl: maskUrl || '' } });

      // ★ 将 cropInfo（蒙版修图需要）和 targetWidth/Height（扩展需要）等元数据附加到 pollResult
      if (existingResult.cropInfo) {
        (pollResult as Record<string, unknown>).cropInfo = existingResult.cropInfo;
      }
      if (existingResult.outpaintInfo) {
        const oi = existingResult.outpaintInfo as Record<string, number>;
        if (oi.targetW) (pollResult as Record<string, unknown>).targetWidth = oi.targetW;
        if (oi.targetH) (pollResult as Record<string, unknown>).targetHeight = oi.targetH;
      }

      if (existingResult.usedModel) {
        (pollResult as Record<string, unknown>).usedModel = existingResult.usedModel;
      }
      // ★ 同时更新本地完成缓存（Next.js dev模式下 registry 实例可能不一致）
      const cachedImageUrl = pollResult.imageUrl as string | undefined;
      const cachedMaskUrl = (pollResult as Record<string, unknown>).maskUrl as string | undefined;
      if (cachedImageUrl) {
        completedTaskCache.set(taskId, { imageUrl: cachedImageUrl, maskUrl: cachedMaskUrl || '', timestamp: Date.now() });
      }
      if (!pollResult.imageUrl) {
        const taskError = taskData?.error as Record<string, unknown> | undefined;
        const errorDetail = (taskError?.message as string) || '';
        pollResult.error = translateApiError(errorDetail) || '模型返回了文本而不是生成图像，请尝试重新措辞提示';
        pollResult.success = false;
        pollResult.retryable = true;
      }
    } else if (taskStatus === 'failed') {
      const rawError = ((taskData?.error as Record<string, unknown>)?.message as string) || '图像生成任务失败';
      const translatedError = translateApiError(rawError);
      updateTaskProgress(taskId, { status: 'failed', error: translatedError });
      failedTaskCache.set(taskId, { error: translatedError, timestamp: Date.now() });
      releaseQueueSlot(taskId);
      pollResult.error = translatedError;
      pollResult.success = false;
    } else if (taskStatus === 'cancelled') {
      pollResult.error = '任务已被取消';
      pollResult.success = false;
    }

    return NextResponse.json(pollResult);

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Poll task route error:', errMsg);
    return NextResponse.json({
      success: false,
      status: 'error',
      error: translateApiError(errMsg),
      retryable: true,
    }, { status: 500 });
  }
}
