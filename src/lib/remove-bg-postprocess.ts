/**
 * RemoveBG 后处理模块
 * 
 * 流程（用户描述的正确方式）:
 * 1. 本地 rembg 模型（u2net/isnet/silueta/u2netp）识别主体 → 生成黑白蒙版（白色=主体，黑色=背景）
 * 2. 高斯模糊+阈值化优化蒙版边缘（圆润顺滑）
 * 3. 用优化后的蒙版应用到原图 → 蒙版白色=保留原图像素，蒙版黑色=变透明
 * 
 * RemoveBG 不使用第三方图像 API，完全靠本地模型
 */

import sharp from 'sharp';
import path from 'path';
import { saveImageFile } from './server-data-root';

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

  // 调试：统计蒙版中白/黑像素比例
  let whiteCount = 0;
  let blackCount = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i] > 128) whiteCount++;
    else blackCount++;
  }
  const total = width * height;
  console.log(`[optimizeMask] Mask stats: ${whiteCount} white (${(whiteCount/total*100).toFixed(1)}%), ${blackCount} black (${(blackCount/total*100).toFixed(1)}%), size=${width}x${height}`);

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
  
  let current = input;
  
  for (let i = 0; i < iterations; i++) {
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
 * - 蒙版白色(255) → 保留原图像素（alpha=255，不透明）
 * - 蒙版黑色(0) → 变为透明（alpha=0）
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
    console.log(`[applyMaskToOriginal] Resizing mask from ${maskWidth}x${maskHeight} to ${originalWidth}x${originalHeight}`);
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

  // 获取原图像素数据 — 必须先解码为 raw RGBA
  let origRgba: Uint8ClampedArray;
  const origRawRgba = await sharp(originalBuffer).ensureAlpha().raw().toBuffer();
  origRgba = bufferToUint8Clamped(origRawRgba);

  // 应用蒙版到原图：蒙版值直接作为 alpha
  // 白色(255) = 不透明（保留主体），黑色(0) = 透明（去除背景）
  const pixelCount = originalWidth * originalHeight;
  for (let i = 0; i < pixelCount; i++) {
    origRgba[i * 4 + 3] = finalMask[i];
  }

  // 编码为 PNG（确保输出 RGBA PNG，保留 alpha 通道）
  return sharp(Buffer.from(origRgba), {
    raw: { width: originalWidth, height: originalHeight, channels: 4 },
  }).png().toBuffer();
}

// ============================================================
// 主入口：本地 RemoveBG 后处理
// ============================================================

/**
 * 本地 RemoveBG 后处理
 * 
 * 接收 iopaint-client 生成的蒙版 base64，优化蒙版边缘后应用到原图
 * 
 * @param originalImageUrl 原图 URL
 * @param maskBase64 rembg 生成的蒙版 PNG (base64 编码)
 * @returns 持久化后的透明 PNG URL
 */
export async function postProcessLocalRemoveBG(
  originalImage: string | Buffer,
  maskBase64: string
): Promise<string | null> {
  try {
    // 1. 获取原图像素数据
    console.log('[remove-bg-postprocess-local] Step 1: Prepare original image');
    let origBuffer: Buffer;
    if (Buffer.isBuffer(originalImage)) {
      // 直接传入 Buffer：无需下载
      origBuffer = originalImage;
    } else {
      const baseUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
      const origUrl = originalImage.startsWith('http') ? originalImage : `${baseUrl}${originalImage}`;
      const origResp = await fetch(origUrl);
      if (!origResp.ok) {
        console.error('[remove-bg-postprocess-local] Failed to fetch original:', origResp.status);
        return null;
      }
      origBuffer = Buffer.from(await origResp.arrayBuffer());
    }
    const origMeta = await sharp(origBuffer).metadata();
    const origWidth = origMeta.width || 0;
    const origHeight = origMeta.height || 0;
    const origChannels = origMeta.channels || 3;

    if (!origWidth || !origHeight) {
      console.error('[remove-bg-postprocess-local] Invalid original dimensions');
      return null;
    }

    console.log(`[remove-bg-postprocess-local] Original: ${origWidth}x${origHeight}, channels=${origChannels}`);

    // 2. 解码蒙版 PNG
    console.log('[remove-bg-postprocess-local] Step 2: Decode mask from base64');
    const maskBuffer = Buffer.from(maskBase64, 'base64');
    const maskMeta = await sharp(maskBuffer).metadata();
    const maskWidth = maskMeta.width || 0;
    const maskHeight = maskMeta.height || 0;
    const maskChannels = maskMeta.channels || 1;

    if (!maskWidth || !maskHeight) {
      console.error('[remove-bg-postprocess-local] Invalid mask dimensions');
      return null;
    }

    console.log(`[remove-bg-postprocess-local] Mask: ${maskWidth}x${maskHeight}, channels=${maskChannels}`);

    // 将蒙版转为单通道灰度 raw 数据（最可靠的方式）
    // grayscale() 确保输出为灰度色彩空间
    // resolveWithObject 返回实际通道数信息，避免 assumeAlpha() 对灰度图产生 2 通道
    const { data: maskRawObj, info: maskInfo } = await sharp(maskBuffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // 提取灰度值作为蒙版
    // rembg 生成的蒙版：白色=主体，黑色=背景
    const maskPixelCount = maskInfo.width * maskInfo.height;
    const actualChannels = maskInfo.channels;
    const maskData = new Uint8ClampedArray(maskPixelCount);
    
    console.log(`[remove-bg-postprocess-local] Mask raw: ${maskInfo.width}x${maskInfo.height}, channels=${actualChannels}, size=${maskRawObj.length}`);
    
    if (actualChannels === 1) {
      // 单通道灰度：直接拷贝
      for (let i = 0; i < maskPixelCount; i++) {
        maskData[i] = maskRawObj[i];
      }
    } else {
      // 多通道(RGB/RGBA)：取 R 通道作为灰度值
      for (let i = 0; i < maskPixelCount; i++) {
        maskData[i] = maskRawObj[i * actualChannels];
      }
    }

    // 调试：统计原始蒙版白/黑比例
    let whiteCount = 0;
    let blackCount = 0;
    for (let i = 0; i < maskPixelCount; i++) {
      if (maskData[i] > 128) whiteCount++;
      else blackCount++;
    }
    console.log(`[remove-bg-postprocess-local] Raw mask stats: ${whiteCount} white (${(whiteCount/maskPixelCount*100).toFixed(1)}%), ${blackCount} black (${(blackCount/maskPixelCount*100).toFixed(1)}%)`);

    // 3. 优化蒙版边缘：高斯模糊 + 阈值化 + 轻微膨胀
    console.log('[remove-bg-postprocess-local] Step 3: Optimize mask edges');
    const optimizedMask = await optimizeMask(maskData, maskWidth, maskHeight, {
      blurRadius: 3,
      dilateIterations: 1,
    });

    // 4. 用优化后的蒙版应用到原图
    console.log('[remove-bg-postprocess-local] Step 4: Apply optimized mask to original');
    const resultPng = await applyMaskToOriginal(
      origBuffer, origWidth, origHeight, origChannels,
      optimizedMask, maskWidth, maskHeight
    );

    // 5. 持久化结果（saveImageFile 直接写入 Buffer，不丢失 alpha）
    const filename = `removebg-${Date.now()}.png`;
    const resultUrl = saveImageFile(resultPng, filename, 'removebg');

    // 6. 验证输出 PNG 确实有 alpha 通道
    const verifyMeta = await sharp(resultPng).metadata();
    console.log(`[remove-bg-postprocess-local] Output PNG: ${verifyMeta.width}x${verifyMeta.height}, channels=${verifyMeta.channels}, format=${verifyMeta.format}, hasAlpha=${verifyMeta.hasAlpha}`);

    console.log('[remove-bg-postprocess-local] Done:', resultUrl);
    return resultUrl;
  } catch (err) {
    console.error('[remove-bg-postprocess-local] Error:', err);
    return null;
  }
}

// ============================================================
// AI 路径 RemoveBG 后处理
// ============================================================

/**
 * RemoveBG 后处理（AI 路径）
 * 
 * AI 生成模型返回的结果通常是带白底/棋盘格背景的图，
 * 需要从中提取蒙版，然后应用到原图上得到透明PNG。
 * 
 * 流程：
 * 1. 获取 AI 结果图和原图
 * 2. 用 rembg 对 AI 结果生成蒙版（AI 结果背景统一，rembg 极易分割）
 * 3. 优化蒙版边缘
 * 4. 用蒙版应用到原图
 */
export async function postProcessAIRemoveBG(
  aiResultUrl: string,
  originalImageUrl?: string
): Promise<string | null> {
  try {
    if (!originalImageUrl) {
      console.error('[remove-bg-postprocess-ai] No original image URL provided');
      return null;
    }

    const baseUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
    const aiUrl = aiResultUrl.startsWith('http') ? aiResultUrl : `${baseUrl}${aiResultUrl}`;
    const origUrl = originalImageUrl.startsWith('http') ? originalImageUrl : `${baseUrl}${originalImageUrl}`;

    // 1. 获取原图
    console.log('[remove-bg-postprocess-ai] Step 1: Fetch original image');
    const origResp = await fetch(origUrl);
    if (!origResp.ok) {
      console.error('[remove-bg-postprocess-ai] Failed to fetch original:', origResp.status);
      return null;
    }
    const origBuffer = Buffer.from(await origResp.arrayBuffer());
    const origMeta = await sharp(origBuffer).metadata();
    const origWidth = origMeta.width || 0;
    const origHeight = origMeta.height || 0;
    const origChannels = origMeta.channels || 3;

    if (!origWidth || !origHeight) {
      console.error('[remove-bg-postprocess-ai] Invalid original image dimensions');
      return null;
    }

    // 2. 获取 AI 结果图
    console.log('[remove-bg-postprocess-ai] Step 2: Fetch AI result image');
    const aiResp = await fetch(aiUrl);
    if (!aiResp.ok) {
      console.error('[remove-bg-postprocess-ai] Failed to fetch AI result:', aiResp.status);
      return null;
    }
    const aiBuffer = Buffer.from(await aiResp.arrayBuffer());

    // 3. 用 rembg 对 AI 结果生成蒙版（AI 结果背景统一，rembg 容易精确分割）
    console.log('[remove-bg-postprocess-ai] Step 3: Generate mask from AI result using rembg');
    let maskResult = await generateRembgMask(aiBuffer, origWidth, origHeight, 'u2net');

    // 降级尝试
    if (!maskResult) {
      console.log('[remove-bg-postprocess-ai] u2net failed, trying u2netp...');
      maskResult = await generateRembgMask(aiBuffer, origWidth, origHeight, 'u2netp');
    }

    if (!maskResult) {
      console.error('[remove-bg-postprocess-ai] All rembg models failed for mask generation');
      return null;
    }

    // 4. 优化蒙版边缘
    console.log('[remove-bg-postprocess-ai] Step 4: Optimize mask edges');
    const optimizedMask = await optimizeMask(maskResult.maskData, maskResult.width, maskResult.height, {
      blurRadius: 3,
      dilateIterations: 1,
    });

    // 5. 用蒙版应用到原图
    console.log('[remove-bg-postprocess-ai] Step 5: Apply optimized mask to original');
    const resultPng = await applyMaskToOriginal(
      origBuffer, origWidth, origHeight, origChannels,
      optimizedMask, maskResult.width, maskResult.height
    );

    // 6. 持久化
    const filename = `removebg-${Date.now()}.png`;
    const resultUrl = saveImageFile(resultPng, filename, 'removebg');

    console.log('[remove-bg-postprocess-ai] Done:', resultUrl);
    return resultUrl;
  } catch (err) {
    console.error('[remove-bg-postprocess-ai] Error:', err);
    return null;
  }
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
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile) as (file: string, args: string[], options: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }>;

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

    // 解码蒙版 PNG — 使用 grayscale()+resolveWithObject 确保正确读取
    const maskBuffer = Buffer.from(result.mask, 'base64');
    const { data: maskRawObj, info: maskOutInfo } = await sharp(maskBuffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const maskPixelCount = maskOutInfo.width * maskOutInfo.height;
    const actualChannels = maskOutInfo.channels;
    const rawMaskData = new Uint8ClampedArray(maskRawObj.buffer, maskRawObj.byteOffset, maskRawObj.byteLength);

    // 如果蒙版是多通道（grayscale 后一般不会，但防御性编程），转为单通道灰度
    let maskData: Uint8ClampedArray;
    if (actualChannels === 1) {
      maskData = rawMaskData;
    } else {
      maskData = new Uint8ClampedArray(maskPixelCount);
      for (let i = 0; i < maskPixelCount; i++) {
        maskData[i] = rawMaskData[i * actualChannels];
      }
    }

    console.log(`[generateRembgMask] Mask decoded: ${maskOutInfo.width}x${maskOutInfo.height}, channels=${actualChannels}, pixels=${maskPixelCount}`);

    return {
      maskData,
      width: maskOutInfo.width || width,
      height: maskOutInfo.height || height,
    };
  } catch (err) {
    console.error('[remove-bg-postprocess] rembg mask generation error:', err);
    return null;
  }
}

// ============================================================
// 辅助：本地透明化兜底（不依赖 rembg）
// ============================================================

/**
 * 简单本地透明化：将白色/接近白色背景设为透明
 * 用作最后的兜底方案，当 rembg 模型完全不可用时
 */
export async function createLocalTransparentBg(
  imageBuffer: Buffer,
  _model: string = 'u2net'
): Promise<{ buffer: Buffer; format: 'png' } | null> {
  try {
    const meta = await sharp(imageBuffer).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (!width || !height) return null;

    // 转为 RGBA
    const rgba = await sharp(imageBuffer).ensureAlpha().raw().toBuffer();
    const pixels = bufferToUint8Clamped(rgba);
    const pixelCount = width * height;

    // 采样边缘像素，找出背景色
    const edgeSamples: number[] = [];
    for (let x = 0; x < width; x++) {
      // 顶边
      const topIdx = x * 4;
      edgeSamples.push(pixels[topIdx], pixels[topIdx + 1], pixels[topIdx + 2]);
      // 底边
      const botIdx = ((height - 1) * width + x) * 4;
      edgeSamples.push(pixels[botIdx], pixels[botIdx + 1], pixels[botIdx + 2]);
    }
    for (let y = 1; y < height - 1; y++) {
      // 左边
      const leftIdx = y * width * 4;
      edgeSamples.push(pixels[leftIdx], pixels[leftIdx + 1], pixels[leftIdx + 2]);
      // 右边
      const rightIdx = (y * width + width - 1) * 4;
      edgeSamples.push(pixels[rightIdx], pixels[rightIdx + 1], pixels[rightIdx + 2]);
    }

    // 计算平均背景色
    let bgR = 0, bgG = 0, bgB = 0;
    const sampleCount = edgeSamples.length / 3;
    for (let i = 0; i < edgeSamples.length; i += 3) {
      bgR += edgeSamples[i];
      bgG += edgeSamples[i + 1];
      bgB += edgeSamples[i + 2];
    }
    bgR = Math.round(bgR / sampleCount);
    bgG = Math.round(bgG / sampleCount);
    bgB = Math.round(bgB / sampleCount);

    console.log(`[createLocalTransparentBg] Detected bg color: rgb(${bgR}, ${bgG}, ${bgB})`);

    // 根据背景色亮度决定阈值
    const bgBrightness = (bgR + bgG + bgB) / 3;
    const threshold = bgBrightness > 128 ? 40 : 25; // 亮背景用更大阈值

    // 将与背景色相近的像素设为透明
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      const dr = Math.abs(pixels[idx] - bgR);
      const dg = Math.abs(pixels[idx + 1] - bgG);
      const db = Math.abs(pixels[idx + 2] - bgB);
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      
      if (distance < threshold) {
        pixels[idx + 3] = 0; // 完全透明
      } else if (distance < threshold + 20) {
        // 过渡区域
        const alpha = Math.round(((distance - threshold) / 20) * 255);
        pixels[idx + 3] = Math.min(pixels[idx + 3], alpha);
      }
    }

    const resultBuffer = await sharp(Buffer.from(pixels), {
      raw: { width, height, channels: 4 },
    }).png().toBuffer();

    return { buffer: resultBuffer, format: 'png' as const };
  } catch (err) {
    console.error('[remove-bg-postprocess] createLocalTransparentBg error:', err);
    return null;
  }
}
