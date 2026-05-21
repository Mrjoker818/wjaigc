import { NextRequest, NextResponse } from 'next/server';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { resolveCompatProfile, buildPollUrl, type ApiCompatProfile } from '@/lib/api-compatibility';
import { getEditTask, deleteEditTask } from '@/lib/edit-task-store';
import { isTaskCancelled, updateTaskProgress, getTaskInfo, releaseQueueSlot } from '@/lib/task-registry';

export const dynamic = 'force-dynamic';

// 轮询异步任务状态 - 由前端调用
// 通用化设计：支持不同提供商的任务状态查询格式
export async function POST(request: NextRequest) {
  try {
    const { taskId, model: rawModel, userId: requestUserId, providerId } = await request.json();
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json({
        success: false,
        status: 'error',
        error: '缺少 taskId 参数',
        retryable: false,
      }, { status: 400 });
    }
    const model = typeof rawModel === 'string' ? rawModel : (rawModel as Record<string, unknown>)?.model as string || String(rawModel || '');
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

    // ★ 检查 task-registry 中的任务（agent-edit/image-edit 等注册的任务）
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
      // queued / processing
      return NextResponse.json({
        success: true,
        status: registryTask.status,
        progress: registryTask.progress,
        label: registryTask.label,
      }, { status: 200 });
    }

    if (!taskId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing taskId' 
      }, { status: 400 });
    }

    const provider = providerId ? await findProviderById(providerId)
      : await findProviderForModel(model || '', 'imageEdit')
      || await findProviderForModel(model || '', 'image')
      || await findProviderForModel(model || '', 'universal');
    const apiKey = provider?.apiKey;
    const apiBaseUrl = normalizeApiBaseUrl(provider?.baseUrl || '');
    if (!apiKey || !apiBaseUrl) {
      return NextResponse.json({ success: false, error: 'No API provider configured for image polling' }, { status: 400 });
    }

    // 解析兼容性档案 - 确定轮询 URL 格式
    const profile: ApiCompatProfile = resolveCompatProfile(provider);
    const pollUrl = buildPollUrl(apiBaseUrl, taskId, profile);

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
    // 当任务仍在处理中时，在服务端内快速重试最多3次（间隔1秒）
    const MAX_QUICK_POLLS = 3;
    const QUICK_POLL_INTERVAL = 1000;

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

    // 返回完整状态信息给前端（标准化 completed 状态）
    const pollResult: Record<string, unknown> = {
      success: true,
      status: normalizedStatus,
      progress: (taskData?.progress as number) || 0,
      estimatedTime: taskData?.estimated_time,
      actualTime: taskData?.actual_time,
    };

    if (completedStatuses.includes(taskStatus || '')) {
      // ★ 更新任务注册中心状态
      updateTaskProgress(taskId, { status: 'completed', progress: 100 });
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
        await appendUserJsonl(userId, 'images', { type: 'completed', providerId: provider?.id || 'env', model, taskId, imageUrl: pollResult.imageUrl });
      }
      if (!pollResult.imageUrl) {
        const taskError = taskData?.error as Record<string, unknown> | undefined;
        const errorDetail = (taskError?.message as string) || '';
        pollResult.error = errorDetail || '模型返回了文本而不是生成图像，请尝试重新措辞提示';
        pollResult.success = false;
        pollResult.retryable = true;
      }
    } else if (taskStatus === 'failed') {
      updateTaskProgress(taskId, { status: 'failed' });
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
