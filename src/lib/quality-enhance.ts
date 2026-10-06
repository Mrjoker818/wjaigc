/**
 * 画质精修共享模块
 * 用于无损放大和AI放大后自动追加AI画质优化步骤
 */

import { findProviderForModel } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { setTimeout as delay } from 'node:timers/promises';
import { createImageEditProviderCall, type ImageEditProviderCallOptions } from '@/lib/image-edit-provider-boundary';
import { calculateActualPixelsFromRatio } from './canvas-generation-group';
import { normalizeLocalImagePath } from '@/lib/fetch-image-buffer';
import { inferSafeRasterImageType } from '@/lib/media-validation';

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
const ENHANCE_SOURCE_MAX_BYTES = 32 * 1024 * 1024;

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
async function persistResult(remoteUrl: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const [{ downloadPublicImage }, { persistAssetBytes }, { randomUUID }] = await Promise.all([
      import('@/lib/safe-image-download'),
      import('@/lib/asset-core/binary-persistence'),
      import('node:crypto'),
    ]);
    const maxBytes = 32 * 1024 * 1024;
    let downloaded: { buffer: Buffer; mimeType: string };
    if (remoteUrl.startsWith('data:')) {
      if (remoteUrl.length > Math.ceil(maxBytes / 3) * 4 + 80) throw new Error('Enhance data URL exceeds the size limit');
      const { getSafeImageTypeFromDataUrl } = await import('@/lib/media-validation');
      const match = /^data:(image\/(?:png|jpeg|webp|gif|avif|bmp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(remoteUrl);
      const safeType = getSafeImageTypeFromDataUrl(remoteUrl);
      if (!match || !safeType || match[2].length % 4 === 1) throw new Error('Invalid enhance data URL');
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length < 1 || buffer.length > maxBytes) throw new Error('Enhance data URL exceeds the size limit');
      downloaded = { buffer, mimeType: safeType.mimeType };
    } else {
      downloaded = await downloadPublicImage(remoteUrl,
        { maxBytes, timeoutMs: 120_000, signal });
    }
    const extension = downloaded.mimeType === 'image/jpeg' ? 'jpg'
      : downloaded.mimeType === 'image/webp' ? 'webp'
        : downloaded.mimeType === 'image/avif' ? 'avif'
          : downloaded.mimeType === 'image/gif' ? 'gif'
            : downloaded.mimeType === 'image/bmp' ? 'bmp' : 'png';
    const persisted = await persistAssetBytes({ bytes: downloaded.buffer,
      filename: `quality-enhance-${randomUUID()}.${extension}`,
      mimeType: downloaded.mimeType, signal });
    return persisted.url;
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

export interface EnhanceExecutionOptions {
  execution: ImageEditProviderCallOptions;
  signal?: AbortSignal;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function firstResultString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function managedSamePortPath(imageUrl: string): string | null {
  const match = /^http:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/[^?#]*)$/i.exec(imageUrl);
  if (!match || match[1] !== String(process.env.DEPLOY_RUN_PORT || 5000)) return null;
  if (!match[2].startsWith('/api/serve-upload/') && !match[2].startsWith('/uploads/')) return null;
  try {
    normalizeLocalImagePath(match[2]);
    return match[2];
  } catch {
    return null;
  }
}

async function readEnhanceSource(imageUrl: string, absoluteUrl: string, signal?: AbortSignal): Promise<Buffer> {
  if (/^https?:\/\//i.test(imageUrl)) {
    const { downloadPublicImage } = await import('@/lib/safe-image-download');
    return (await downloadPublicImage(imageUrl, {
      maxBytes: ENHANCE_SOURCE_MAX_BYTES, timeoutMs: 30_000, signal: withTimeout(signal, 30_000),
    })).buffer;
  }
  if (imageUrl.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|webp|gif|avif|bmp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(imageUrl);
    if (!match || match[1].length > Math.ceil(ENHANCE_SOURCE_MAX_BYTES / 3) * 4 + 4) {
      throw new Error('Invalid or oversized enhance source');
    }
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length < 1 || bytes.length > ENHANCE_SOURCE_MAX_BYTES) throw new Error('Invalid or oversized enhance source');
    return bytes;
  }
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(imageUrl); }
  catch { throw new Error('Unsupported enhance source'); }
  if (imageUrl.includes('\\') || decodedPath.includes('\\') || decodedPath.includes('%')
    || decodedPath.includes('?') || decodedPath.includes('#')
    || (!decodedPath.startsWith('/api/serve-upload/') && !decodedPath.startsWith('/uploads/'))
    || decodedPath.split('/').slice(1).some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('Unsupported enhance source');
  }
  const response = await fetch(absoluteUrl, { signal: withTimeout(signal, 30_000), redirect: 'manual' });
  if (!response.ok || !response.body) throw new Error('Enhance source is unavailable');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > ENHANCE_SOURCE_MAX_BYTES) throw new Error('Enhance source exceeds size limit');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (length < 1) throw new Error('Enhance source is empty');
  return Buffer.concat(chunks, length);
}

/**
 * 对放大后的图片进行AI画质精修
 * 以放大结果为参考图，低强度保持内容不变，仅修复画质问题
 *
 * @param imageUrl - 放大后的图片URL
 * @param model - 用于精修的图像模型（如未提供则自动查找）
 * @returns 旧调用失败时返回原图；受控调用仅明确拒绝可降级，未知或接受后故障停止
 */
export async function enhanceViaAI(
  imageUrl: string,
  model?: string,
  providerId?: string,
  target?: EnhanceTargetOptions,
  admittedProvider?: ApiProvider,
  options?: EnhanceExecutionOptions,
): Promise<EnhanceResult> {
  const execution = options?.execution;
  const signal = options?.signal;
  const call = createImageEditProviderCall(execution, model ?? '', 'image');
  // Freeze only the fields this helper consumes before image metadata performs I/O.
  target = target ? { targetWidth: target.targetWidth, targetHeight: target.targetHeight } : undefined;
  admittedProvider = admittedProvider ? { ...admittedProvider } : undefined;
  try {
    if (execution && (!model?.trim() || !admittedProvider?.isEnabled
      || admittedProvider.id !== execution.providerId || (providerId !== undefined && providerId !== admittedProvider.id)
      || !admittedProvider.apiKey?.trim() || !/^https?:\/\//i.test(admittedProvider.baseUrl)
      || Object.values(target ?? {}).some(value => value !== undefined && (!Number.isFinite(value) || value <= 0)))) {
      throw new Error('Invalid enhance execution configuration');
    }
    if (execution) new URL(admittedProvider!.baseUrl);
    signal?.throwIfAborted();
    // 解析图片URL获取绝对路径
    let absoluteUrl = imageUrl;
    if (imageUrl.startsWith('/')) {
      const port = process.env.DEPLOY_RUN_PORT || '5000';
      absoluteUrl = `http://localhost:${port}${imageUrl}`;
    }
    const localManagedPath = managedSamePortPath(imageUrl);

    // 源图必须先通过有界读取，失败时不可继续把不安全 URL 交给供应商。
    const sharp = (await import('sharp')).default;
    const imgBuf = await readEnhanceSource(localManagedPath || imageUrl, absoluteUrl, signal);
    const meta = await sharp(imgBuf).metadata();
    if (!meta.width || !meta.height) throw new Error('Enhance source has no dimensions');
    let referenceImageUrl = absoluteUrl;
    if (localManagedPath || imageUrl.startsWith('/')) {
      const safeType = inferSafeRasterImageType(imgBuf);
      if (!safeType) throw new Error('Unsupported managed enhance source');
      referenceImageUrl = `data:${safeType.mimeType};base64,${imgBuf.toString('base64')}`;
    }
    const g = gcd(meta.width, meta.height);
    const aspectRatio = `${meta.width / g}:${meta.height / g}`;
    signal?.throwIfAborted();

    // 确定使用的模型
    const enhanceModel = model || 'gpt-image-1';
    const requestedMaxEdge = Math.max(
      target?.targetWidth || 0,
      target?.targetHeight || 0,
    );
    const requestedResolution = requestedMaxEdge >= 3072 ? '4K' : '2K';

    // 查找API提供商（优先使用指定的 providerId）
    const provider = admittedProvider ?? await findProviderForModel(enhanceModel, 'image', providerId || undefined);
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
      image_urls: [referenceImageUrl],
      referenceMode: 'reference',
      referenceStrength: 30,
      referenceCategories: ['style', 'composition'],
    };

    // 提交精修任务
    const submitResp = await call.fetchWithV1Retry(apiBase, '/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: execution ? withTimeout(signal, 300_000) : undefined,
    });
    signal?.throwIfAborted();

    if (!submitResp.ok) {
      const errText = await submitResp.text().catch(() => '');
      signal?.throwIfAborted();
      console.warn(`[quality-enhance] Submit failed (${submitResp.status}):`, errText.slice(0, 200));
      return { url: imageUrl, enhanced: false };
    }

    const submitData = await submitResp.json() as Record<string, unknown>;
    signal?.throwIfAborted();

    // 检查是否异步任务
    const taskId = execution ? firstResultString(submitData.taskId, submitData.task_id, submitData.id)
      : submitData.taskId || submitData.task_id || submitData.id;
    if (taskId) {
      await call.acceptImage({ taskId: taskId as string });
      signal?.throwIfAborted();
      // 异步轮询模式
      const startTime = Date.now();
      while (Date.now() - startTime < ENHANCE_TIMEOUT_MS) {
        await delay(ENHANCE_POLL_INTERVAL_MS, undefined, { signal });
        signal?.throwIfAborted();

        try {
          const pollResp = await fetchWithV1Retry(apiBase, `/tasks/${taskId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            ...(execution ? { signal: withTimeout(signal, 300_000), propagateErrors: true } : {}),
          });
          signal?.throwIfAborted();
          if (!pollResp.ok) {
            if (execution) throw new Error('Enhance polling failed');
            continue;
          }

          const pollData = await pollResp.json() as Record<string, unknown>;
          const status = (pollData.status || pollData.state) as string;

          if (status === 'completed' || status === 'succeeded') {
            const resultUrl = execution ? firstResultString(pollData.imageUrl, pollData.image_url, pollData.url,
              (pollData.data as Record<string, unknown>)?.image_url, (pollData.result as Record<string, unknown>)?.image_url)
              : (pollData.imageUrl || pollData.image_url
              || pollData.url || (pollData.data as Record<string, unknown>)?.image_url
              || (pollData.result as Record<string, unknown>)?.image_url) as string;
            if (resultUrl) {
              let persistedUrl: string;
              try {
                persistedUrl = await persistResult(resultUrl, signal);
              } catch (error) {
                if (execution) throw error;
                return { url: imageUrl, enhanced: false };
              }
              signal?.throwIfAborted();
              return { url: persistedUrl, enhanced: true };
            }
            break;
          }

          if (status === 'failed' || status === 'cancelled') {
            console.warn('[quality-enhance] Task failed:', status);
            break;
          }
        } catch (error) {
          call.stop(error);
          continue;
        }
      }
      call.stop(new Error('Enhance polling timeout or failed'));
      console.warn('[quality-enhance] Polling timeout or failed');
      return { url: imageUrl, enhanced: false };
    }

    // 同步模式 — 直接返回结果
    const resultUrl = execution ? firstResultString(submitData.imageUrl, submitData.image_url, submitData.url,
      (submitData.data as Record<string, unknown>)?.image_url, (submitData.data as Record<string, unknown>)?.url)
      : (submitData.imageUrl || submitData.image_url
      || submitData.url || (submitData.data as Record<string, unknown>)?.image_url
      || (submitData.data as Record<string, unknown>)?.url) as string;

    if (resultUrl) {
      if (execution && resultUrl.startsWith('data:')) {
        const persistedUrl = await persistResult(resultUrl, signal);
        await call.acceptImage({ directUrl: persistedUrl, managedExport: true });
        signal?.throwIfAborted();
        return { url: persistedUrl, enhanced: true };
      }
      await call.acceptImage({ directUrl: resultUrl });
      signal?.throwIfAborted();
      const persistedUrl = await persistResult(resultUrl, signal);
      signal?.throwIfAborted();
      return { url: persistedUrl, enhanced: true };
    }

    call.stop(new Error('Missing enhance image result'));
    return { url: imageUrl, enhanced: false };
  } catch (err) {
    call.stop(err);
    console.warn('[quality-enhance] Error:', err instanceof Error ? err.message : err);
    return { url: imageUrl, enhanced: false };
  }
}
