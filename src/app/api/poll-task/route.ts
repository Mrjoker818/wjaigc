import { NextRequest, NextResponse } from 'next/server';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { resolveCompatProfile, buildPollUrl, type ApiCompatProfile } from '@/lib/api-compatibility';
import { postProcessAIRemoveBG } from '@/lib/remove-bg-postprocess';
import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { getEditTask, deleteEditTask } from '@/lib/edit-task-store';
import { isTaskCancelled, updateTaskProgress, getTaskInfo, releaseQueueSlot } from '@/lib/task-registry';

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
          error: task.error || '处理失败',
          retryable: false,
        }, { status: 200 });
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
        error: cachedFailed.error,
        retryable: true,
      }, { status: 200 });
    }

    // ★ 检查 task-registry 中的任务
    const registryTask = getTaskInfo(taskId);
    if (registryTask) {
      if (registryTask.status === 'completed') {
        // ★ 释放队列槽位
        releaseQueueSlot(taskId);
        return NextResponse.json({
          success: true,
          status: 'completed',
          progress: registryTask.progress,
          result: registryTask.result,
          imageUrl: (registryTask.result as Record<string, unknown>)?.imageUrl as string | undefined,
          maskUrl: (registryTask.result as Record<string, unknown>)?.maskUrl as string | undefined,
        }, { status: 200 });
      }
      if (registryTask.status === 'failed') {
        // ★ 释放队列槽位
        releaseQueueSlot(taskId);
        return NextResponse.json({
          success: false,
          status: 'failed',
          progress: registryTask.progress,
          error: registryTask.error || '处理失败',
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
      const LOCAL_TASK_TYPES = ['edit', 'agent-edit'];
      if (LOCAL_TASK_TYPES.includes(registryTask.type)) {
        // 纯本地任务：由后端自行更新 registry，直接返回当前状态
        return NextResponse.json({
          success: true,
          status: registryTask.status,
          progress: registryTask.progress,
          label: registryTask.label,
        }, { status: 200 });
      }
      // 远端异步任务（generate/mask/erase/outpaint/multi-angle/removebg 等）：继续往下走，查询远端 API
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

    // 解析兼容性档案 - 确定轮询 URL 格式
    const pollUrl = buildPollUrl(apiBaseUrl, taskId, profile);
    console.log(`[poll-task] Polling taskId=${taskId}, provider=${providerName}, model=${model || regUsedModel || ''}, pollUrl=${pollUrl?.substring(0, 100)}...`);

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
    // 当任务仍在处理中时，在服务端内快速重试最多5次（间隔1.5秒）
    // 增加到5次以减少前端轮询往返次数，缓解擦除等长时间任务的超时问题
    const MAX_QUICK_POLLS = 5;
    const QUICK_POLL_INTERVAL = 1500;

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
          const rawUrl = nestedData[0].url || nestedData[0].b64_json;
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

      // ★ 持久化图片：下载远程/b64图片 → 保存本地 + 上传S3 → 返回持久化URL
      if (sourceImageUrl) {
        try {
          const { persistRemoteImage } = await import('@/lib/s3-storage');
          const persistedUrl = await persistRemoteImage(sourceImageUrl, `generate/${taskId}`);
          if (persistedUrl) {
            pollResult.imageUrl = persistedUrl;
            try {
              const { saveImageDataMapping } = await import('@/lib/image-source-map');
              const filename = persistedUrl.split('/').pop() || persistedUrl;
              await saveImageDataMapping(filename, sourceImageUrl);
            } catch {}
          } else {
            pollResult.imageUrl = sourceImageUrl;
          }
        } catch (persistErr) {
          console.warn('[poll-task] persistRemoteImage failed, using raw URL:', persistErr);
          pollResult.imageUrl = sourceImageUrl;
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

        // ★ 蒙版修图/擦除异步结果后处理：poll-task 做蒙版合成，前端无需二次处理
        // 当 image-edit 的 mask/erase 动作返回异步 taskId 时，
        // poll-task 轮询到 AI 结果后，用蒙版合成回原图，确保结果与同步路径一致
        const compositeRegistryInfo = getTaskInfo(taskId);
        const compositeRegistryResult = (compositeRegistryInfo?.result as Record<string, unknown>) || {};
        const compositeInfo = compositeRegistryResult.compositeInfo as Record<string, unknown> | undefined;
        const taskType = compositeRegistryInfo?.type as string | undefined;
        if ((taskType === 'mask' || taskType === 'erase') && compositeInfo && pollResult.imageUrl) {
          try {
            const originalImageUrl = compositeInfo.originalImageUrl as string | undefined;
            const maskDataUrl = compositeInfo.maskDataUrl as string | undefined;
            const cropInfoData = compositeInfo.cropInfo as Record<string, number> | undefined;
            const origW = compositeInfo.origW as number | undefined;
            const origH = compositeInfo.origH as number | undefined;
            const aiInputW = compositeInfo.aiInputW as number | undefined;
            const aiInputH = compositeInfo.aiInputH as number | undefined;

            if (originalImageUrl && maskDataUrl && origW && origH) {
              console.log(`[poll-task] Mask/erase composite for task ${taskId}, type=${taskType}, origW=${origW}, origH=${origH}`);

              const sharp = (await import('sharp')).default;

              // 获取原图和 AI 结果
              const originalBuf = await fetchImageBuffer(originalImageUrl);
              const aiResultBuf = await fetchImageBuffer(pollResult.imageUrl as string);

              // 将 AI 结果 resize 到原图尺寸
              const aiMeta = await sharp(aiResultBuf).metadata();
              let resultOrigSize: Buffer;
              const resW = aiMeta.width || aiInputW || origW;
              const resH = aiMeta.height || aiInputH || origH;
              if (resW !== origW || resH !== origH) {
                let step1: Buffer;
                if (aiInputW && aiInputH && (resW !== aiInputW || resH !== aiInputH)) {
                  step1 = await sharp(aiResultBuf).resize(aiInputW, aiInputH, { fit: 'fill' }).png().toBuffer();
                } else {
                  step1 = aiResultBuf;
                }
                if (aiInputW !== origW || aiInputH !== origH) {
                  resultOrigSize = await sharp(step1).resize(origW, origH, { fit: 'fill' }).png().toBuffer();
                } else {
                  resultOrigSize = step1;
                }
              } else {
                resultOrigSize = aiResultBuf;
              }

              // 提取蒙版数据
              const maskBase64 = maskDataUrl.replace(/^data:image\/\w+;base64,/, '');
              const maskBuf = Buffer.from(maskBase64, 'base64');

              if (cropInfoData && cropInfoData.cropW && cropInfoData.cropH) {
                // 有 cropInfo：蒙版是裁剪区域的，需要合成到正确位置
                const cropX = cropInfoData.cropX;
                const cropY = cropInfoData.cropY;
                const cropW = cropInfoData.cropW;
                const cropH = cropInfoData.cropH;

                // 将 AI 结果 resize 到裁剪区域尺寸
                let resizedResult: Buffer;
                if (resW !== cropW || resH !== cropH) {
                  const innerResult = await sharp(resultOrigSize)
                    .resize(cropW, cropH, { fit: 'inside', withoutEnlargement: true })
                    .png()
                    .toBuffer();
                  const innerMeta = await sharp(innerResult).metadata();
                  const padX = Math.floor((cropW - (innerMeta.width || cropW)) / 2);
                  const padY = Math.floor((cropH - (innerMeta.height || cropH)) / 2);
                  if (padX > 0 || padY > 0) {
                    resizedResult = await sharp({
                      create: { width: cropW, height: cropH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
                    })
                      .composite([{ input: innerResult, left: padX, top: padY, blend: 'over' }])
                      .png()
                      .toBuffer();
                  } else {
                    resizedResult = innerResult;
                  }
                } else {
                  resizedResult = resultOrigSize;
                }

                // 用蒙版做柔边合成
                const croppedSoftMask = await sharp(maskBuf)
                  .threshold(127)
                  .blur(12)
                  .grayscale()
                  .raw()
                  .toBuffer();

                const aiRaw = await sharp(resizedResult).ensureAlpha().raw().toBuffer();
                for (let i = 0; i < cropW * cropH; i++) {
                  aiRaw[i * 4 + 3] = croppedSoftMask[i];
                }
                const aiWithAlpha = await sharp(aiRaw, { raw: { width: cropW, height: cropH, channels: 4 } }).png().toBuffer();

                // 合成回原图
                const compositeResult = await sharp(originalBuf)
                  .composite([{ input: aiWithAlpha, left: cropX, top: cropY, blend: 'over' }])
                  .jpeg({ quality: 92 })
                  .toBuffer();

                const compositeDataUrl = `data:image/jpeg;base64,${compositeResult.toString('base64')}`;
                pollResult.imageUrl = compositeDataUrl;
                console.log(`[poll-task] Mask composite with cropInfo: JPEG (${(compositeResult.length / 1024).toFixed(0)}KB)`);
              } else {
                // 无 cropInfo：蒙版是全图尺寸的，直接做全图合成
                const fullMask = await sharp(maskBuf)
                  .threshold(127)
                  .blur(12)
                  .grayscale()
                  .raw()
                  .toBuffer();

                const aiRaw = await sharp(resultOrigSize).ensureAlpha().raw().toBuffer();
                for (let i = 0; i < origW * origH; i++) {
                  aiRaw[i * 4 + 3] = fullMask[i];
                }
                const aiWithAlpha = await sharp(aiRaw, { raw: { width: origW, height: origH, channels: 4 } }).png().toBuffer();

                const compositeResult = await sharp(originalBuf)
                  .composite([{ input: aiWithAlpha, left: 0, top: 0, blend: 'over' }])
                  .jpeg({ quality: 92 })
                  .toBuffer();

                const compositeDataUrl = `data:image/jpeg;base64,${compositeResult.toString('base64')}`;
                pollResult.imageUrl = compositeDataUrl;
                console.log(`[poll-task] Mask composite (full image): JPEG (${(compositeResult.length / 1024).toFixed(0)}KB)`);
              }

              // 清除 compositeInfo，避免前端再做二次合成
              if (compositeRegistryResult.compositeInfo) {
                compositeRegistryResult.compositeInfo = undefined;
              }
            }
          } catch (maskCompositeErr) {
            console.warn('[poll-task] Mask/erase composite failed, using raw AI result:', maskCompositeErr instanceof Error ? maskCompositeErr.message : maskCompositeErr);
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
      if (existingResult.compositeInfo) {
        (pollResult as Record<string, unknown>).compositeInfo = existingResult.compositeInfo;
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
        pollResult.error = errorDetail || '模型返回了文本而不是生成图像，请尝试重新措辞提示';
        pollResult.success = false;
        pollResult.retryable = true;
      }
    } else if (taskStatus === 'failed') {
      updateTaskProgress(taskId, { status: 'failed', error: (taskData?.error as Record<string, unknown>)?.message as string || '图像生成任务失败' });
      failedTaskCache.set(taskId, { error: (taskData?.error as Record<string, unknown>)?.message as string || '图像生成任务失败', timestamp: Date.now() });
      releaseQueueSlot(taskId);
      const taskError = taskData?.error as Record<string, unknown> | undefined;
      const rawError = (taskError?.message as string) || '图像生成任务失败';
      if (rawError.includes('ratio or price') || rawError.includes('not configured')) {
        pollResult.error = '当前模型暂不可用，请切换其他模型或联系管理员配置';
      } else if (rawError.includes('Insufficient balance') || rawError.includes('insufficient')) {
        pollResult.error = 'API 余额不足，请联系管理员充值';
      } else if (rawError.includes('Rate limit') || rawError.includes('rate_limit') || rawError.includes('Too many requests')) {
        pollResult.error = '请求过于频繁，请稍后再试';
      } else {
        pollResult.error = rawError;
      }
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
      error: errMsg,
      retryable: true,
    }, { status: 500 });
  }
}
