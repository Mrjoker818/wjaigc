import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';

// 通用API生成路由 - 支持第三方OpenAI兼容API的图像生成
// 当用户使用非 APIMart 管理的第三方模型时，图像生成请求会被路由到这里
export const maxDuration = 600; // 10分钟 - token link等API生图最久可达600s
export const dynamic = 'force-dynamic';

interface UniversalGenerateRequest {
  prompt: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  quality?: string;
  aspectRatio?: string;
  n?: number;
  referenceImageUrl?: string;
  userId?: string;
  providerId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: UniversalGenerateRequest = await request.json();
    const {
      prompt,
      model,
      apiKey: _clientApiKey,
      baseUrl: _clientBaseUrl,
      quality = 'standard',
      aspectRatio = '1:1',
      n = 1,
      referenceImageUrl,
      providerId,
    } = body;

    const sessionUser = await getSessionUser(request);

    // Content safety check
    const safetyResult = checkPromptSafety(prompt || '');
    if (safetyResult.level === 'block') {
      return NextResponse.json({ success: false, error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    const resolvedModel = model.includes('::') ? model.split('::').slice(1).join('::') : model;
    // 优先使用 providerId 精确匹配提供商
    let provider = providerId ? await findProviderById(providerId) : null;
    if (!provider) {
      provider = await findProviderForModel(resolvedModel, 'image');
    }
    const apiKey = provider?.apiKey;
    const baseUrl = normalizeApiBaseUrl(provider?.baseUrl || '');

    if (!prompt || !resolvedModel || !apiKey || !baseUrl) {
      return NextResponse.json({
        success: false,
        error: '缺少可用的后台图像模型配置',
      }, { status: 400 });
    }

    // 解析兼容性配置
    const profile = resolveCompatProfile(provider);

    // 构建请求体 - 先构建原始请求，再用兼容性层调整
    const rawBody: Record<string, unknown> = {
      model: resolvedModel,
      prompt,
      size: aspectRatio,
      n,
    };
    if (quality && quality !== 'standard') {
      rawBody.quality = quality;
    }
    if (referenceImageUrl) {
      rawBody.image_urls = [referenceImageUrl];
    }

    const { body: requestBody, endpoint } = adjustRequestForProfile(rawBody, profile, {
      hasImage: !!referenceImageUrl,
    });

    console.log(`[Universal API] 请求: model=${resolvedModel}, baseUrl=${baseUrl}, endpoint=${endpoint}, profile=${profile.id}`);

    // 1. 提交生成任务
    const submitResponse = await fetchWithV1Retry(baseUrl, endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const submitData = await submitResponse.json();

    // 检查提交是否成功
    if (submitData.error) {
      const rawMsg = submitData.error.message || JSON.stringify(submitData.error);
      // 清理常见 API 错误
      let cleanMsg = rawMsg;
      if (rawMsg.includes('ratio or price') || rawMsg.includes('not configured')) {
        cleanMsg = '当前模型暂不可用，请切换其他模型或联系管理员配置';
      } else if (rawMsg.includes('Insufficient balance') || rawMsg.includes('insufficient')) {
        cleanMsg = 'API 余额不足，请联系管理员充值';
      } else if (rawMsg.includes('Rate limit') || rawMsg.includes('rate_limit') || rawMsg.includes('Too many requests')) {
        cleanMsg = '请求过于频繁，请稍后再试';
      }
      return NextResponse.json({
        success: false,
        error: cleanMsg,
      }, { status: 400 });
    }

    // 使用兼容性层解析响应
    const parsed = parseResponseForProfile(submitData as Record<string, unknown>, profile);

    if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
      // 直接模式：API 返回了图片数据
      const images = parsed.directImageUrls.map((url: string, idx: number) => ({
        id: `${resolvedModel}-${Date.now()}-${idx}`,
        url,
        prompt,
        originalPrompt: prompt,
        model: resolvedModel,
      }));
      return NextResponse.json({ success: true, images });
    }

    // 异步任务模式
    const taskId = parsed.taskIds.length > 0 ? parsed.taskIds[0] : undefined;

    if (!taskId) {
      return NextResponse.json({
        success: false,
        error: '未能获取任务ID或图片数据',
        rawResponse: JSON.stringify(submitData).slice(0, 500),
      }, { status: 400 });
    }

    // 2. 异步轮询任务状态
    console.log(`[Universal API] 任务已提交: ${taskId}`);

    const maxPolls = 200; // 兼容需要2分钟以上的慢速API
    for (let i = 0; i < maxPolls; i++) {
      const interval = i <= 2 ? 800 : i <= 5 ? 1000 : i < 10 ? 1500 : 2000;
      await new Promise(resolve => setTimeout(resolve, interval));

      try {
        const statusResponse = await fetch(
          `${baseUrl}/tasks/${taskId}?language=zh`,
          { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        const statusData = await statusResponse.json();

        const taskInfo = statusData.data || statusData;
        const status = taskInfo.status;

        if (status === 'completed') {
          const result = taskInfo.result || taskInfo;
          const imagesList = result.images || [];

          const images = imagesList.map((img: Record<string, unknown>, idx: number) => {
            let url = '';
            if (Array.isArray(img.url)) {
              url = img.url[0] || '';
            } else if (typeof img.url === 'string') {
              url = img.url;
            } else if (img.b64_json) {
              url = `data:image/png;base64,${img.b64_json}`;
            }

            return {
              id: `${resolvedModel}-${Date.now()}-${idx}`,
              url,
              prompt,
              originalPrompt: prompt,
              model: resolvedModel,
            };
          }).filter((img: { url: string }) => img.url);

          if (images.length > 0) {
            console.log(`[Universal API] 任务完成: ${taskId}, 图片数: ${images.length}`);
            return NextResponse.json({ success: true, images });
          }

          return NextResponse.json({
            success: false,
            error: '任务完成但未获取到图片URL',
          }, { status: 500 });
        }

        if (status === 'failed') {
          const rawMsg = taskInfo.error?.message || '任务执行失败';
          // 清理常见 API 错误
          let cleanMsg = rawMsg;
          if (rawMsg.includes('ratio or price') || rawMsg.includes('not configured')) {
            cleanMsg = '当前模型暂不可用，请切换其他模型或联系管理员配置';
          } else if (rawMsg.includes('Insufficient balance') || rawMsg.includes('insufficient')) {
            cleanMsg = 'API 余额不足，请联系管理员充值';
          }
          return NextResponse.json({
            success: false,
            error: cleanMsg,
          }, { status: 500 });
        }

        // submitted/processing - 继续轮询
        if (i % 5 === 0) {
          console.log(`[Universal API] 轮询 #${i}: status=${status}`);
        }
      } catch (pollError) {
        console.error(`[Universal API] 轮询错误:`, pollError);
      }
    }

    return NextResponse.json({
      success: false,
      error: `${resolvedModel} 生成超时，请稍后重试`,
    }, { status: 408 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Universal API] 生成错误:', error);
    return NextResponse.json({
      success: false,
      error: `通用API生成失败: ${message}`,
    }, { status: 500 });
  }
}
