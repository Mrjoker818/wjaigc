/**
 * 画质精修共享模块
 * 用于无损放大和AI放大后自动追加AI画质优化步骤
 */

import { findProviderForModel } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';

async function getSaveImageInternalHeaders(): Promise<Record<string, string>> {
  const { getInternalRequestHeaders } = await import('@/lib/api-auth');
  return getInternalRequestHeaders('system-save-image', 'admin');
}
import { calculateActualPixelsFromRatio } from './canvas-generation-group';

/** 画质精修提示词 — 在放大后修复模糊、噪点、脏画面等问题 */
export const QUALITY_ENHANCE_PROMPT = `## 核心修复目标
将模糊低清图片修复为锐利、高清、写实质感画面，完整保留原图人物/景物/动物的五官、神态、动作、构图、拍摄角度、服饰、背景、光影氛围等全部原始内容。
## 画质优化要求
1. 提升分辨率，补齐画面细节，强化纹理质感；
2. 消除压缩噪点、像素模糊、画面发灰发白、过软发虚等瑕疵；
3. 还原自然真实色彩，明暗对比柔和自然，避免过度锐化、磨皮、失真；
4. 真实还原皮肤肌理、毛发、眼睛、布料、背景景物细节，不改动原图轮廓与内容。
## 画面限制规范
禁止过度修图、平滑磨皮、美颜滤镜；禁止生成不存在的画面元素；杜绝人工虚假锐化、画面失真怪异问题，确保修复效果自然真实。
## 画面干净度要求
clean illustration, smooth shading, soft lighting, controlled details, minimal texture, high clarity, refined edges, smooth gradients -- no noise, grain, artifacts, high frequency detail, dirty texture, oversharpen, blotchy, chaotic details`;

/** 画质精修超时时间（毫秒） */
const ENHANCE_TIMEOUT_MS = 150_000; // 2.5分钟
/** 轮询间隔（毫秒） */
const ENHANCE_POLL_INTERVAL_MS = 3_000;

/** 计算最大公约数 */
function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * 持久化远程URL到本地
 */
async function persistResult(remoteUrl: string): Promise<string> {
  try {
    const baseUrl = process.env.DEPLOY_RUN_PORT
      ? `http://localhost:${process.env.DEPLOY_RUN_PORT}`
      : 'http://localhost:5000';
    const persistResp = await fetch(`${baseUrl}/api/save-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getSaveImageInternalHeaders()) },
      body: JSON.stringify({ imageUrl: remoteUrl, prefix: 'quality-enhance' }),
      signal: AbortSignal.timeout(30000),
    });
    if (persistResp.ok) {
      const persistData = await persistResp.json() as Record<string, unknown>;
      if (persistData.url) {
        return persistData.url as string;
      }
    }
  } catch {
    // 持久化失败，返回原始URL
  }
  return remoteUrl;
}

export interface EnhanceResult {
  /** 精修后的图片URL */
  url: string;
  /** 是否成功执行了精修 */
  enhanced: boolean;
}

interface EnhanceTargetOptions {
  targetWidth?: number;
  targetHeight?: number;
}

/**
 * 对放大后的图片进行AI画质精修
 * 以放大结果为参考图，低强度保持内容不变，仅修复画质问题
 *
 * @param imageUrl - 放大后的图片URL
 * @param model - 用于精修的图像模型（如未提供则自动查找）
 * @returns 精修结果，失败时返回原图
 */
export async function enhanceViaAI(
  imageUrl: string,
  model?: string,
  providerId?: string,
  target?: EnhanceTargetOptions,
): Promise<EnhanceResult> {
  try {
    // 解析图片URL获取绝对路径
    let absoluteUrl = imageUrl;
    if (imageUrl.startsWith('/')) {
      const port = process.env.DEPLOY_RUN_PORT || '5000';
      absoluteUrl = `http://localhost:${port}${imageUrl}`;
    }

    // 获取图片尺寸以计算宽高比
    let aspectRatio = '1:1';
    try {
      const sharp = (await import('sharp')).default;
      const imgResp = await fetch(absoluteUrl, { signal: AbortSignal.timeout(30000) });
      if (imgResp.ok) {
        const imgBuf = Buffer.from(await imgResp.arrayBuffer());
        const meta = await sharp(imgBuf).metadata();
        if (meta.width && meta.height) {
          const g = gcd(meta.width, meta.height);
          aspectRatio = `${meta.width / g}:${meta.height / g}`;
        }
      }
    } catch {
      // 获取尺寸失败，使用默认1:1
    }

    // 确定使用的模型
    const enhanceModel = model || 'gpt-image-1';
    const requestedMaxEdge = Math.max(
      target?.targetWidth || 0,
      target?.targetHeight || 0,
    );
    const requestedResolution = requestedMaxEdge >= 3072 ? '4K' : '2K';

    // 查找API提供商（优先使用指定的 providerId）
    const provider = await findProviderForModel(enhanceModel, 'image', providerId || undefined);
    if (!provider) {
      console.warn('[quality-enhance] No provider found for model:', enhanceModel);
      return { url: imageUrl, enhanced: false };
    }

    const apiBase = provider.baseUrl || '';
    const apiKey = provider.apiKey || '';

    if (!apiBase || !apiKey) {
      console.warn('[quality-enhance] Missing API credentials');
      return { url: imageUrl, enhanced: false };
    }

    // 构建精修请求 — 以放大图为参考，低强度保持内容不变
    const enhancePrompt = `${QUALITY_ENHANCE_PROMPT}\n\n请对这张图片进行画质精修，只修复模糊/噪点/脏画面等画质问题，不得改变画面内容、构图、色彩倾向。`;

    const requestBody: Record<string, unknown> = {
      model: enhanceModel,
      prompt: enhancePrompt,
      n: 1,
      size: calculateActualPixelsFromRatio(aspectRatio, requestedResolution, enhanceModel) || '1024x1024',
      response_format: 'url',
      // 以放大结果为参考图，低强度保持内容不变
      image_urls: [absoluteUrl],
      referenceMode: 'reference',
      referenceStrength: 30,
      referenceCategories: ['style', 'composition'],
    };

    // 提交精修任务
    const submitResp = await fetchWithV1Retry(apiBase, '/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!submitResp.ok) {
      const errText = await submitResp.text().catch(() => '');
      console.warn(`[quality-enhance] Submit failed (${submitResp.status}):`, errText.slice(0, 200));
      return { url: imageUrl, enhanced: false };
    }

    const submitData = await submitResp.json() as Record<string, unknown>;

    // 检查是否异步任务
    const taskId = submitData.taskId || submitData.task_id || submitData.id;
    if (taskId) {
      // 异步轮询模式
      const startTime = Date.now();
      while (Date.now() - startTime < ENHANCE_TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, ENHANCE_POLL_INTERVAL_MS));

        try {
          const pollResp = await fetchWithV1Retry(apiBase, `/tasks/${taskId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
          if (!pollResp.ok) continue;

          const pollData = await pollResp.json() as Record<string, unknown>;
          const status = (pollData.status || pollData.state) as string;

          if (status === 'completed' || status === 'succeeded') {
            const resultUrl = (pollData.imageUrl || pollData.image_url
              || pollData.url || (pollData.data as Record<string, unknown>)?.image_url
              || (pollData.result as Record<string, unknown>)?.image_url) as string;
            if (resultUrl) {
              const persistedUrl = await persistResult(resultUrl);
              return { url: persistedUrl, enhanced: true };
            }
            break;
          }

          if (status === 'failed' || status === 'cancelled') {
            console.warn('[quality-enhance] Task failed:', status);
            break;
          }
        } catch {
          continue;
        }
      }
      console.warn('[quality-enhance] Polling timeout or failed');
      return { url: imageUrl, enhanced: false };
    }

    // 同步模式 — 直接返回结果
    const resultUrl = (submitData.imageUrl || submitData.image_url
      || submitData.url || (submitData.data as Record<string, unknown>)?.image_url
      || (submitData.data as Record<string, unknown>)?.url) as string;

    if (resultUrl) {
      const persistedUrl = await persistResult(resultUrl);
      return { url: persistedUrl, enhanced: true };
    }

    return { url: imageUrl, enhanced: false };
  } catch (err) {
    console.warn('[quality-enhance] Error:', err instanceof Error ? err.message : err);
    return { url: imageUrl, enhanced: false };
  }
}
