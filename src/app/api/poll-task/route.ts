import { NextRequest, NextResponse } from 'next/server';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

// 轮询 APImart 任务状态 - 由前端调用
export async function POST(request: NextRequest) {
  try {
    const { taskId, model: rawModel, userId: requestUserId, providerId } = await request.json();
    // 防御性处理：确保 model 是字符串（前端可能误传对象）
    const model = typeof rawModel === 'string' ? rawModel : (rawModel as any)?.model || String(rawModel || '');
    const sessionUser = await getSessionUser(request);
    const userId = (sessionUser?.id || "anonymous") || requestUserId;

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
    const apiKey = provider?.apiKey || process.env.APIMART_API_KEY;
    const apiBaseUrl = normalizeApiBaseUrl(provider?.baseUrl || 'https://api.apimart.ai');
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'No admin API key is configured for image polling' }, { status: 400 });
    }

    // 带超时的fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const statusResponse = await fetch(
        `${apiBaseUrl}/tasks/${taskId}?language=zh`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        console.error('Poll task error:', statusResponse.status, errorText);
        return NextResponse.json({
          success: false,
          status: 'error',
          error: `查询任务状态失败: ${statusResponse.status}`,
          retryable: true,
        }, { status: 200 }); // 返回200让前端可以重试
      }

      const statusResult = await statusResponse.json();
      const taskData = statusResult.data;
      const taskStatus = taskData?.status;

      const completedStatuses = ['completed', 'succeeded', 'success', 'done'];
      const normalizedStatus = completedStatuses.includes(taskStatus) ? 'completed' : taskStatus;

      // 返回完整状态信息给前端（标准化 completed 状态）
      const result: Record<string, unknown> = {
        success: true,
        status: normalizedStatus,
        progress: taskData?.progress || 0,
        estimatedTime: taskData?.estimated_time,
        actualTime: taskData?.actual_time,
      };

      if (completedStatuses.includes(taskStatus)) {
        // 提取图片URL
        const images = taskData?.result?.images;
        if (images && images.length > 0) {
          const firstImage = images[0];
          const rawUrl = firstImage.url || firstImage.image_url || firstImage.src;
          const imageUrl = Array.isArray(rawUrl) ? rawUrl[0] : (typeof rawUrl === 'string' ? rawUrl : null);
          
          if (imageUrl) {
            result.imageUrl = imageUrl;
            await appendUserJsonl(userId, 'images', { type: 'completed', providerId: provider?.id || 'env', model, taskId, imageUrl });
          }
        }
        // 兜底：b64_json格式
        if (!result.imageUrl && taskData?.result?.b64_json) {
          result.imageUrl = `data:image/png;base64,${taskData.result.b64_json}`;
        }
        // 任务完成但未提取到图片URL（模型返回文本而非图像），标记为可重试
        if (!result.imageUrl) {
          const errorDetail = taskData?.error?.message || '';
          result.error = errorDetail || '模型返回了文本而不是生成图像，请尝试重新措辞提示';
          result.success = false;
          result.retryable = true; // 允许前端重试
        }
      } else if (taskStatus === 'failed') {
        const rawError = taskData?.error?.message || '图像生成任务失败';
        // 清理常见 API 错误
        if (rawError.includes('ratio or price') || rawError.includes('not configured')) {
          result.error = '当前模型暂不可用，请切换其他模型或联系管理员配置';
        } else if (rawError.includes('Insufficient balance') || rawError.includes('insufficient')) {
          result.error = 'API 余额不足，请联系管理员充值';
        } else if (rawError.includes('Rate limit') || rawError.includes('rate_limit') || rawError.includes('Too many requests')) {
          result.error = '请求过于频繁，请稍后再试';
        } else {
          result.error = rawError;
        }
        result.success = false;
      } else if (taskStatus === 'cancelled') {
        result.error = '任务已被取消';
        result.success = false;
      }

      return NextResponse.json(result);

    } catch (fetchError: unknown) {
      clearTimeout(timeoutId);
      const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      
      if (errMsg.includes('abort') || errMsg.includes('timeout')) {
        return NextResponse.json({
          success: false,
          status: 'timeout',
          error: '查询超时，请重试',
          retryable: true,
        }, { status: 200 });
      }

      return NextResponse.json({
        success: false,
        status: 'error',
        error: `网络错误: ${errMsg}`,
        retryable: true,
      }, { status: 200 });
    }

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
