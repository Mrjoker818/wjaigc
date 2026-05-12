// ============================================================
// Image Tools — IOPaint Client (LaMa 本地修图服务)
// ============================================================

import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import {
  IOPAINT_BASE_URL,
  IOPAINT_TIMEOUT_MS,
  INPAINT_OUTPUT_DIR,
  IMAGE_MAX_EDGE,
  LOCAL_AI_ENABLED,
} from './config';
import {
  ensureOutputDirs,
  generateFilename,
  readImageToBuffer,
  saveOutputBuffer,
} from './file';
import { validateAndNormalizeMask } from './mask';

/** 检查 IOPaint 服务是否可用 */
export async function checkIOPaintHealth(): Promise<{
  available: boolean;
  baseUrl: string;
  model?: string;
  error?: string;
}> {
  if (!LOCAL_AI_ENABLED) {
    return {
      available: false,
      baseUrl: IOPAINT_BASE_URL,
      error: 'LOCAL_AI_ENABLED 未启用',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(`${IOPAINT_BASE_URL}/api/v1/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        available: true,
        baseUrl: IOPAINT_BASE_URL,
        model: (data.model as string) || 'lama',
      };
    }
    return {
      available: false,
      baseUrl: IOPAINT_BASE_URL,
      error: `IOPaint 返回状态码 ${resp.status}`,
    };
  } catch {
    return {
      available: false,
      baseUrl: IOPAINT_BASE_URL,
      error:
        '本地 LaMa 修图服务未启动，请先启动 IOPaint：iopaint start --model=lama --device=cpu --port=8080',
    };
  }
}

/** Inpaint 参数 */
export interface InpaintParams {
  imageBuffer: Buffer;
  maskBuffer: Buffer;
  prompt?: string;
  imageWidth: number;
  imageHeight: number;
}

/** Inpaint 结果 */
export interface InpaintResult {
  success: boolean;
  imageUrl?: string;
  originalSize?: { width: number; height: number };
  outputSize?: { width: number; height: number };
  engine?: string;
  error?: string;
}

/**
 * 执行本地 IOPaint 修复
 */
export async function performInpaint(
  params: InpaintParams,
): Promise<InpaintResult> {
  const { imageBuffer, maskBuffer, prompt, imageWidth, imageHeight } = params;

  // 检查 IOPaint 可用性
  const health = await checkIOPaintHealth();
  if (!health.available) {
    return {
      success: false,
      error: health.error || 'IOPaint 服务不可用',
    };
  }

  ensureOutputDirs();

  // 验证和归一化 mask
  const normalizedMask = await validateAndNormalizeMask(
    maskBuffer,
    imageWidth,
    imageHeight,
  );

  // 转为 base64
  const imageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
  const maskBase64 = `data:image/png;base64,${normalizedMask.toString('base64')}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      IOPAINT_TIMEOUT_MS,
    );

    const resp = await fetch(`${IOPAINT_BASE_URL}/api/v1/inpaint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageBase64,
        mask: maskBase64,
        prompt: prompt || '',
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        success: false,
        error: `IOPaint 返回错误 ${resp.status}: ${text.substring(0, 200)}`,
      };
    }

    // 响应可能是图片二进制或 JSON
    const contentType = resp.headers.get('content-type') || '';

    let resultBuffer: Buffer;

    if (contentType.includes('image/')) {
      // 直接返回图片
      resultBuffer = Buffer.from(await resp.arrayBuffer());
    } else {
      // JSON 格式返回
      const json = (await resp.json()) as Record<string, unknown>;

      if (json.image) {
        // base64 图片
        const imgData = json.image as string;
        const base64 = imgData.startsWith('data:')
          ? imgData.split(',')[1]
          : imgData;
        resultBuffer = Buffer.from(base64, 'base64');
      } else if (json.error) {
        return {
          success: false,
          error: `IOPaint 错误: ${json.error}`,
        };
      } else {
        return {
          success: false,
          error: 'IOPaint 返回格式无法识别',
        };
      }
    }

    // 保存结果
    const outputMeta = await sharp(resultBuffer).metadata();
    const imageUrl = saveOutputBuffer(
      resultBuffer,
      'inpaint',
      'png',
      INPAINT_OUTPUT_DIR,
    );

    return {
      success: true,
      imageUrl,
      originalSize: { width: imageWidth, height: imageHeight },
      outputSize: {
        width: outputMeta.width || imageWidth,
        height: outputMeta.height || imageHeight,
      },
      engine: 'iopaint-lama',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort')) {
      return {
        success: false,
        error: 'IOPaint 修复操作超时，请检查服务是否正常运行',
      };
    }
    return {
      success: false,
      error: `修复失败: ${msg}`,
    };
  }
}

/**
 * 通过 imageUrl + mask dataUrl 执行修复（便捷方法）
 */
export async function inpaintFromUrls(
  imageUrl: string,
  maskDataUrl: string,
  prompt?: string,
): Promise<InpaintResult> {
  const { buffer: imageBuffer, width, height } =
    await readImageToBuffer(imageUrl);

  // 如果图片过大先缩放
  const { buffer: processBuffer, width: procW, height: procH } =
    await (await import('./file')).resizeIfTooLarge(
      imageBuffer,
      IMAGE_MAX_EDGE,
    );

  // 解析 mask
  const maskBase64 = maskDataUrl.split(',')[1];
  if (!maskBase64) {
    return { success: false, error: '无效的蒙版数据' };
  }
  const maskBuffer = Buffer.from(maskBase64, 'base64');

  return performInpaint({
    imageBuffer: processBuffer,
    maskBuffer,
    prompt,
    imageWidth: procW,
    imageHeight: procH,
  });
}
