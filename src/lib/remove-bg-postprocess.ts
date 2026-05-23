/**
 * RemoveBG 后处理模块
 * 
 * 流程（用户描述的正确方式）:
 * 1. AI/本地模型识别主体 → 生成黑白蒙版（白色=主体，黑色=背景）
 * 2. Alpha 提取法优化蒙版边缘（高斯模糊+阈值化，让边缘更圆润顺滑）
 * 3. 用优化后的蒙版应用到原图 → 蒙版白色=保留原图像素，蒙版黑色=变透明
 * 
 * RemoveBG 不使用第三方图像 API，完全靠本地模型（u2net/isnet/silueta/u2netp）
 */

import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { saveImageFile } from './server-data-root';

const execFileAsync = promisify(execFile) as (file: string, args: string[], options: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }>;

// ============================================================
// 工具函数
// ============================================================

/** Buffer → Uint8ClampedArray */
function bufferToUint8Clamped(buf: Buffer): Uint8ClampedArray {
  return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** RGB → RGBA（alpha=255） */
function rgbToRgba(rgbData: Uint8ClampedArray, pixelCount: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    rgba[i * 4] = rgbData[i * 3];
    rgba[i * 4 + 1] = rgbData[i * 3 + 1];
    rgba[i * 4 + 2] = rgbData[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

// ============================================================
// 蒙版优化：高斯模糊 + 阈值化 + 轻微膨胀
// ============================================================

interface MaskOptimizeOptions {
  /** 高斯模糊半径，默认3 */
  blurRadius?: number;
  /** 膨胀次数，默认1 */
  dilateIterations?: number;
}

/**
 * 优化蒙版边缘：高斯模糊让边缘圆润 + 阈值化保持锐利 + 轻微膨胀保护主体
 * 
 * 原理：
 * - rembg 原始蒙版边缘有锯齿/粗糙
 * - 高斯模糊让边缘变得圆润顺滑
 * - 阈值化(128)恢复为干净的黑白蒙版
 * - 轻微膨胀(1次)防止主体边缘被切
 */
async function optimizeMask(
  maskData: Uint8ClampedArray,
  width: number,
  height: number,
  options: MaskOptimizeOptions = {}
): Promise<Uint8ClampedArray> {
  const { blurRadius = 3, dilateIterations = 1 } = options;

  // Step 1: 高斯模糊 — 让边缘圆润顺滑
  let pipeline = sharp(Buffer.from(maskData), {
    raw: { width, height, channels: 1 },
  }).blur(blurRadius);

  // Step 2: 阈值化 — 模糊后恢复为干净的黑白蒙版
  // blur 后边缘有渐变，threshold(128) 把中间值归到 0 或 255
  pipeline = pipeline.threshold(128);

  let result = await pipeline.raw().toBuffer();

  // Step 3: 轻微膨胀 — 保护主体边缘不被切
  // 用 3x3 椭圆核膨胀 1 次（约 2px），防止主体细节被误删
  if (dilateIterations > 0) {
    const dilated = await dilateMask(result, width, height, dilateIterations);
    result = Buffer.from(dilated);
  }

  return new Uint8ClampedArray(result.buffer, result.byteOffset, result.byteLength);
}

/**
 * 膨胀蒙版：用 3x3 椭圆核迭代膨胀
 * 对每个像素，如果邻域内有前景像素，则该像素变为前景
 */
async function dilateMask(
  maskData: Buffer | Uint8ClampedArray,
  width: number,
  height: number,
  iterations: number
): Promise<Uint8ClampedArray> {
  const input = Buffer.isBuffer(maskData) ? maskData : Buffer.from(maskData);
  
  // 用 sharp 的 dilate 操作（通过卷积实现）
  // 3x3 全1核 = 膨胀（最大值滤波）
  let current = input;
  
  for (let i = 0; i < iterations; i++) {
    // 用 convolve 实现膨胀：3x3 全1核，归一化后乘以9
    // 如果邻域中有任何前景(255)，结果 > 128 → threshold(128) 恢复为255
    const blurred = await sharp(current, {
      raw: { width, height, channels: 1 },
    })
      .convolve({
        width: 3,
        height: 3,
        kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      })
      .threshold(28) // 9个像素中只要有1个255，均值 > 28
      .raw()
      .toBuffer();
    
    current = blurred;
  }

  return new Uint8ClampedArray(current.buffer, current.byteOffset, current.byteLength);
}

// ============================================================
// 蒙版应用到原图
// ============================================================

/**
 * 用优化后的蒙版应用到原图
 * - 蒙版白色(255) → 保留原图像素
 * - 蒙版黑色(0) → 变为透明
 * - 中间值 → alpha 渐变（边缘过渡）
 */
async function applyMaskToOriginal(
  originalBuffer: Buffer,
  originalWidth: number,
  originalHeight: number,
  originalChannels: number,
  maskData: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number
): Promise<Buffer> {
  // 如果蒙版尺寸与原图不一致，缩放蒙版到原图尺寸
  let finalMask = maskData;
  let finalWidth = maskWidth;
  let finalHeight = maskHeight;

  if (maskWidth !== originalWidth || maskHeight !== originalHeight) {
    const scaledMask = await sharp(Buffer.from(maskData), {
      raw: { width: maskWidth, height: maskHeight, channels: 1 },
    })
      .resize(originalWidth, originalHeight, { fit: 'fill' })
      .raw()
      .toBuffer();
    
    finalMask = new Uint8ClampedArray(scaledMask.buffer, scaledMask.byteOffset, scaledMask.byteLength);
    finalWidth = originalWidth;
    finalHeight = originalHeight;
  }

  // 获取原图像素
  let origRgba: Uint8ClampedArray;
  if (originalChannels === 3) {
    const rawOrig = bufferToUint8Clamped(originalBuffer);
    origRgba = rgbToRgba(rawOrig, originalWidth * originalHeight);
  } else if (originalChannels === 4) {
    origRgba = bufferToUint8Clamped(originalBuffer);
  } else {
    // 转换为 RGBA
    const converted = await sharp(originalBuffer, {
      raw: { width: originalWidth, height: originalHeight, channels: originalChannels as sharp.Channels },
    }).raw().toBuffer();
    // sharp 转换需要走 pipeline
    const reconverted = await sharp(originalBuffer, {
      raw: { width: originalWidth, height: originalHeight, channels: originalChannels as sharp.Channels },
    }).toColorspace('srgb').raw().toBuffer();
    const pixelCount = originalWidth * originalHeight;
    if (originalChannels === 1) {
      const gray = bufferToUint8Clamped(reconverted);
      origRgba = new Uint8ClampedArray(pixelCount * 4);
      for (let i = 0; i < pixelCount; i++) {
        origRgba[i * 4] = gray[i];
        origRgba[i * 4 + 1] = gray[i];
        origRgba[i * 4 + 2] = gray[i];
        origRgba[i * 4 + 3] = 255;
      }
    } else {
      origRgba = rgbToRgba(bufferToUint8Clamped(reconverted), pixelCount);
    }
  }

  // 应用蒙版到原图
  const pixelCount = originalWidth * originalHeight;
  for (let i = 0; i < pixelCount; i++) {
    // 蒙版值直接作为 alpha：255=不透明，0=透明
    origRgba[i * 4 + 3] = finalMask[i];
  }

  // 编码为 PNG
  return sharp(Buffer.from(origRgba), {
    raw: { width: originalWidth, height: originalHeight, channels: 4 },
  }).png().toBuffer();
}

// ============================================================
// 通过 rembg Python 脚本生成蒙版
// ============================================================

/**
 * 调用 Python rembg 脚本，对图片生成黑白蒙版
 * 返回蒙版 PNG 的 raw 数据
 */
async function generateRembgMask(
  imageBuffer: Buffer,
  width: number,
  height: number,
  model: string = 'u2net'
): Promise<{ maskData: Uint8ClampedArray; width: number; height: number } | null> {
  const imageB64 = imageBuffer.toString('base64');

  // 查找 Python 路径
  const pythonPaths = [
    '/workspace/projects/.venv/bin/python3',
    '/workspace/projects/.venv/bin/python',
    'python3',
    'python',
  ];

  let pythonPath = '';
  for (const p of pythonPaths) {
    try {
      const { stdout } = await execFileAsync(p, ['--version'], { timeout: 5000 });
      if (stdout.includes('Python')) {
        pythonPath = p;
        break;
      }
    } catch { /* skip */ }
  }

  if (!pythonPath) {
    console.error('[remove-bg-postprocess] Python not found for rembg');
    return null;
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'iopaint_removebg.py');
  const inputJson = JSON.stringify({ image: imageB64, model, return_mask: true });

  try {
    const { stdout } = await execFileAsync(pythonPath, [scriptPath], {
      input: Buffer.from(inputJson) as any,
      timeout: 120000,
      maxBuffer: 100 * 1024 * 1024,
    });

    const result = JSON.parse(stdout);
    if (!result.success || !result.mask) {
      console.error('[remove-bg-postprocess] rembg mask generation failed:', result.error);
      return null;
    }

    // 解码蒙版 PNG
    const maskBuffer = Buffer.from(result.mask, 'base64');
    const maskMeta = await sharp(maskBuffer).metadata();
    const maskRaw = await sharp(maskBuffer).raw().toBuffer();

    return {
      maskData: new Uint8ClampedArray(maskRaw.buffer, maskRaw.byteOffset, maskRaw.byteLength),
      width: maskMeta.width || width,
      height: maskMeta.height || height,
    };
  } catch (err) {
    console.error('[remove-bg-postprocess] rembg mask generation error:', err);
    return null;
  }
}

// ============================================================
// 主入口：从 AI 结果生成蒙版 → 优化边缘 → 应用到原图
// ============================================================

/**
 * RemoveBG 后处理（AI 路径）
 * 
 * 流程：
 * 1. 用 rembg 对 AI 结果图生成黑白蒙版
 *    AI 结果背景统一（白底/棋盘格），rembg 极易精确分割
 * 2. 高斯模糊+阈值化优化蒙版边缘（圆润顺滑）
 * 3. 轻微膨胀1次保护主体边缘
 * 4. 用优化后的蒙版应用到**原图**
 * 
 * @param aiResultUrl AI 结果图 URL（主体+统一背景）
 * @param originalImageUrl 原图 URL（复杂背景+主体）
 * @returns 持久化后的透明 PNG URL，或 null 表示失败
 */
export async function postProcessAIRemoveBG(
  aiResultUrl: string,
  originalImageUrl?: string
): Promise<string | null> {
  try {
    // 解析 URL
    const baseUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
    const aiUrl = aiResultUrl.startsWith('http') ? aiResultUrl : `${baseUrl}${aiResultUrl}`;
    if (!originalImageUrl) {
      console.error('[remove-bg-postprocess] No original image URL provided');
      return null;
    }
    const origUrl = originalImageUrl.startsWith('http') ? originalImageUrl : `${baseUrl}${originalImageUrl}`;

    // 1. 获取原图
    console.log('[remove-bg-postprocess] Step 1: Fetch original image');
    const origResp = await fetch(origUrl);
    if (!origResp.ok) {
      console.error('[remove-bg-postprocess] Failed to fetch original:', origResp.status);
      return null;
    }
    const origBuffer = Buffer.from(await origResp.arrayBuffer());
    const origMeta = await sharp(origBuffer).metadata();
    const origWidth = origMeta.width || 0;
    const origHeight = origMeta.height || 0;
    const origChannels = origMeta.channels || 3;

    if (!origWidth || !origHeight) {
      console.error('[remove-bg-postprocess] Invalid original image dimensions');
      return null;
    }

    // 2. 获取 AI 结果图
    console.log('[remove-bg-postprocess] Step 2: Fetch AI result image');
    const aiResp = await fetch(aiUrl);
    if (!aiResp.ok) {
      console.error('[remove-bg-postprocess] Failed to fetch AI result:', aiResp.status);
      return null;
    }
    const aiBuffer = Buffer.from(await aiResp.arrayBuffer());

    // 3. 用 rembg 对 AI 结果生成黑白蒙版
    console.log('[remove-bg-postprocess] Step 3: Generate mask from AI result using rembg');
    let maskResult = await generateRembgMask(aiBuffer, origWidth, origHeight, 'u2net');

    // 降级尝试 u2netp
    if (!maskResult) {
      console.log('[remove-bg-postprocess] u2net failed, trying u2netp...');
      maskResult = await generateRembgMask(aiBuffer, origWidth, origHeight, 'u2netp');
    }

    if (!maskResult) {
      console.error('[remove-bg-postprocess] All rembg models failed for mask generation');
      return null;
    }

    // 4. 优化蒙版边缘：高斯模糊 + 阈值化 + 轻微膨胀
    console.log('[remove-bg-postprocess] Step 4: Optimize mask edges (blur + threshold + dilate)');
    const optimizedMask = await optimizeMask(maskResult.maskData, maskResult.width, maskResult.height, {
      blurRadius: 3,
      dilateIterations: 1,
    });

    // 5. 用优化后的蒙版应用到原图
    console.log('[remove-bg-postprocess] Step 5: Apply optimized mask to original image');
    const resultPng = await applyMaskToOriginal(
      origBuffer, origWidth, origHeight, origChannels,
      optimizedMask, maskResult.width, maskResult.height
    );

    // 6. 持久化结果
    const filename = `removebg-${Date.now()}.png`;
    const resultUrl = await saveImageFile(resultPng, filename, 'removebg');

    console.log('[remove-bg-postprocess] Done:', resultUrl);
    return resultUrl;
  } catch (err) {
    console.error('[remove-bg-postprocess] Error:', err);
    return null;
  }
}

// ============================================================
// 本地 RemoveBG 后处理：蒙版优化 + 应用到原图
// ============================================================

/**
 * 本地 RemoveBG 后处理
 * 
 * 本地 rembg 模型（u2net/isnet/silueta/u2netp）已经能生成蒙版，
 * 但默认的膨胀策略不够好。此函数：
 * 1. 用 rembg 重新生成**未经膨胀的原始蒙版**
 * 2. 高斯模糊+阈值化优化边缘（圆润顺滑）
 * 3. 轻微膨胀1次保护主体
 * 4. 用优化后的蒙版应用到**原图**
 * 
 * @param originalImageUrl 原图 URL
 * @param model rembg 模型名
 * @returns 持久化后的透明 PNG URL
 */
export async function postProcessLocalRemoveBG(
  originalImageUrl: string,
  model: string = 'u2net'
): Promise<string | null> {
  try {
    const baseUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
    const origUrl = originalImageUrl.startsWith('http') ? originalImageUrl : `${baseUrl}${originalImageUrl}`;

    // 1. 获取原图
    console.log('[remove-bg-postprocess-local] Step 1: Fetch original image');
    const origResp = await fetch(origUrl);
    if (!origResp.ok) {
      console.error('[remove-bg-postprocess-local] Failed to fetch original:', origResp.status);
      return null;
    }
    const origBuffer = Buffer.from(await origResp.arrayBuffer());
    const origMeta = await sharp(origBuffer).metadata();
    const origWidth = origMeta.width || 0;
    const origHeight = origMeta.height || 0;
    const origChannels = origMeta.channels || 3;

    if (!origWidth || !origHeight) {
      console.error('[remove-bg-postprocess-local] Invalid original dimensions');
      return null;
    }

    // 2. 用 rembg 直接对原图生成蒙版
    console.log('[remove-bg-postprocess-local] Step 2: Generate mask from original using rembg');
    let maskResult = await generateRembgMask(origBuffer, origWidth, origHeight, model);

    // 降级尝试
    if (!maskResult && model !== 'u2net') {
      console.log('[remove-bg-postprocess-local] Primary model failed, trying u2net...');
      maskResult = await generateRembgMask(origBuffer, origWidth, origHeight, 'u2net');
    }
    if (!maskResult && model !== 'u2netp') {
      console.log('[remove-bg-postprocess-local] u2net failed, trying u2netp...');
      maskResult = await generateRembgMask(origBuffer, origWidth, origHeight, 'u2netp');
    }

    if (!maskResult) {
      console.error('[remove-bg-postprocess-local] All rembg models failed');
      return null;
    }

    // 3. 优化蒙版边缘
    console.log('[remove-bg-postprocess-local] Step 3: Optimize mask edges');
    const optimizedMask = await optimizeMask(maskResult.maskData, maskResult.width, maskResult.height, {
      blurRadius: 3,
      dilateIterations: 1,
    });

    // 4. 用优化后的蒙版应用到原图
    console.log('[remove-bg-postprocess-local] Step 4: Apply optimized mask to original');
    const resultPng = await applyMaskToOriginal(
      origBuffer, origWidth, origHeight, origChannels,
      optimizedMask, maskResult.width, maskResult.height
    );

    // 5. 持久化结果
    const filename = `removebg-${Date.now()}.png`;
    const resultUrl = await saveImageFile(resultPng, filename, 'removebg');

    console.log('[remove-bg-postprocess-local] Done:', resultUrl);
    return resultUrl;
  } catch (err) {
    console.error('[remove-bg-postprocess-local] Error:', err);
    return null;
  }
}

// ============================================================
// 辅助：本地 RemoveBG（简化版，返回蒙版 RGBA PNG）
// ============================================================

/**
 * 本地 RemoveBG：rembg 直接处理 → 返回 RGBA PNG
 * 此函数用于 iopaint-client 返回的 RGBA 结果需要进一步优化的场景
 */
export async function createLocalTransparentBg(
  imageBuffer: Buffer,
  model: string = 'u2net'
): Promise<{ buffer: Buffer; format: 'png' } | null> {
  try {
    const imageB64 = imageBuffer.toString('base64');
    const pythonPaths = [
      '/workspace/projects/.venv/bin/python3',
      '/workspace/projects/.venv/bin/python',
      'python3',
      'python',
    ];

    let pythonPath = '';
    for (const p of pythonPaths) {
      try {
        const { stdout } = await execFileAsync(p, ['--version'], { timeout: 5000 });
        if (stdout.includes('Python')) { pythonPath = p; break; }
      } catch { /* skip */ }
    }

    if (!pythonPath) return null;

    const scriptPath = path.join(process.cwd(), 'scripts', 'iopaint_removebg.py');
    const inputJson = JSON.stringify({ image: imageB64, model, return_mask: false });

    const { stdout } = await execFileAsync(pythonPath, [scriptPath], {
      input: Buffer.from(inputJson) as any,
      timeout: 120000,
      maxBuffer: 100 * 1024 * 1024,
    });

    const result = JSON.parse(stdout);
    if (!result.success) return null;

    const resultBuffer = Buffer.from(result.image, 'base64');
    return { buffer: resultBuffer, format: 'png' as const };
  } catch (err) {
    console.error('[remove-bg-postprocess] createLocalTransparentBg error:', err);
    return null;
  }
}
