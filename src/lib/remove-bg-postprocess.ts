/**
 * RemoveBG 后处理模块
 * 
 * 流程:
 * 1. 本地 rembg 模型（u2net/isnet/silueta/u2netp）识别主体 → 生成黑白蒙版（白色=主体，黑色=背景）
 * 2. 膨胀蒙版（扩展主体区域 4-6px），确保主体边缘不被切
 * 3. 用膨胀后的蒙版应用到原图 → 蒙版白色=保留原图像素，蒙版黑色=变透明
 * 4. 对 alpha 通道做轻柔羽化（1-2px），让边缘自然过渡
 * 
 * 关键原则：宁可多保留一点背景，也不能删掉主体边缘
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

// ============================================================
// 蒙版膨胀：扩展主体区域
// ============================================================

/**
 * 膨胀蒙版：用 3x3 核迭代膨胀
 * 
 * 每次迭代扩展约 2px，iterations=3 扩展约 6px
 * 宁可多保留一点背景，也不能删掉主体边缘
 */
async function dilateMask(
  maskData: Uint8ClampedArray,
  width: number,
  height: number,
  iterations: number = 3
): Promise<Uint8ClampedArray> {
  let current = Buffer.from(maskData);
  
  for (let i = 0; i < iterations; i++) {
    // 确保输入为单通道
    const singleChannel = await sharp(current, {
      raw: { width, height, channels: 1 },
    }).grayscale().raw().toBuffer();

    // convolve + threshold: 3x3 全1核，9 个像素中只要有 1 个 255（均值 > 28）就变 255
    const dilated = await sharp(singleChannel, {
      raw: { width, height, channels: 1 },
    })
      .convolve({
        width: 3,
        height: 3,
        kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      })
      .threshold(28) // 9 个像素中有 1 个 255 → 均值 28.3 > 28 → 变 255
      .grayscale()   // threshold 输出 3 通道，转回单通道
      .raw()
      .toBuffer();
    
    current = Buffer.from(dilated);
  }

  // 调试统计
  let whiteCount = 0, blackCount = 0;
  const total = width * height;
  for (let i = 0; i < Math.min(current.length, total); i++) {
    if (current[i] > 128) whiteCount++;
    else blackCount++;
  }
  console.log(`[dilateMask] After ${iterations} iterations: white=${whiteCount} (${(whiteCount/total*100).toFixed(1)}%), black=${blackCount} (${(blackCount/total*100).toFixed(1)}%)`);

  return new Uint8ClampedArray(current.buffer, current.byteOffset, current.byteLength);
}

// ============================================================
// 蒙版应用到原图
// ============================================================

/**
 * 用蒙版应用到原图
 * - 蒙版白色(255) → 保留原图像素（alpha=255，不透明）
 * - 蒙版黑色(0) → 变为透明（alpha=0）
 * - 中间值 → alpha 渐变（边缘过渡）
 * 
 * 最后对 alpha 通道做 1-2px 轻柔羽化，让边缘自然圆润
 */
async function applyMaskToOriginal(
  originalBuffer: Buffer,
  originalWidth: number,
  originalHeight: number,
  maskData: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number
): Promise<Buffer> {
  // 1. 如果蒙版尺寸与原图不一致，缩放蒙版到原图尺寸
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

  // 2. 安全检查：如果蒙版长度异常（多通道），转换为单通道
  if (finalMask.length !== finalWidth * finalHeight) {
    const detectedChannels = finalMask.length / (finalWidth * finalHeight);
    console.warn(`[applyMaskToOriginal] Mask has ${detectedChannels} channels instead of 1, extracting grayscale`);
    const singleChannel = await sharp(Buffer.from(finalMask), {
      raw: { width: finalWidth, height: finalHeight, channels: Math.round(detectedChannels) as 1 | 2 | 3 | 4 },
    }).grayscale().raw().toBuffer();
    finalMask = new Uint8ClampedArray(singleChannel.buffer, singleChannel.byteOffset, singleChannel.byteLength);
  }

  // 3. 获取原图像素数据 — 解码为 raw RGBA
  const origRawRgba = await sharp(originalBuffer).ensureAlpha().raw().toBuffer();
  const origRgba = bufferToUint8Clamped(origRawRgba);

  // 调试
  const pixelCount = originalWidth * originalHeight;
  let dbgMaskWhite = 0, dbgMaskBlack = 0;
  for (let i = 0; i < Math.min(finalMask.length, pixelCount); i++) {
    if (finalMask[i] > 128) dbgMaskWhite++;
    else dbgMaskBlack++;
  }
  console.log(`[applyMaskToOriginal] Mask: white=${dbgMaskWhite} black=${dbgMaskBlack} total=${pixelCount}`);

  // 4. 应用蒙版：蒙版值直接作为 alpha
  // 白色(255) = 不透明（保留主体），黑色(0) = 透明（去除背景）
  for (let i = 0; i < pixelCount; i++) {
    origRgba[i * 4 + 3] = finalMask[i];
  }

  // 5. 对 alpha 通道单独做轻柔羽化（1px 模糊），让边缘自然圆润
  // 只模糊 alpha 通道，不动 RGB（避免背景色污染主体边缘）
  const alphaOnly = Buffer.alloc(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    alphaOnly[i] = origRgba[i * 4 + 3];
  }
  const blurredAlpha = await sharp(alphaOnly, {
    raw: { width: originalWidth, height: originalHeight, channels: 1 },
  }).blur(1).grayscale().raw().toBuffer();
  // blur() 会将单通道转为3通道输出，grayscale() 转回1通道
  for (let i = 0; i < pixelCount; i++) {
    origRgba[i * 4 + 3] = blurredAlpha[i];
  }

  const resultPng = await sharp(Buffer.from(origRgba), {
    raw: { width: originalWidth, height: originalHeight, channels: 4 },
  }).png().toBuffer();

  // 最终验证
  const verifyRgba = await sharp(resultPng).ensureAlpha().raw().toBuffer();
  let vAlpha0 = 0, vAlpha255 = 0, vAlphaMid = 0;
  for (let i = 0; i < pixelCount; i++) {
    const a = verifyRgba[i * 4 + 3];
    if (a === 0) vAlpha0++;
    else if (a === 255) vAlpha255++;
    else vAlphaMid++;
  }
  console.log(`[applyMaskToOriginal] Verify: alpha0=${vAlpha0} alpha255=${vAlpha255} alphaMid=${vAlphaMid} total=${pixelCount}`);

  return resultPng;
}

// ============================================================
// 主入口：本地 RemoveBG 后处理
// ============================================================

/**
 * 本地 RemoveBG 后处理
 * 
 * 接收 iopaint-client 生成的蒙版 base64，膨胀蒙版后应用到原图
 * 
 * @param originalImage 原图 URL 或 Buffer
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
    const { data: maskRawObj, info: maskInfo } = await sharp(maskBuffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const maskPixelCount = maskInfo.width * maskInfo.height;
    const actualChannels = maskInfo.channels;
    
    // 提取灰度值作为蒙版
    const maskData = new Uint8ClampedArray(maskPixelCount);
    if (actualChannels === 1) {
      for (let i = 0; i < maskPixelCount; i++) {
        maskData[i] = maskRawObj[i];
      }
    } else {
      for (let i = 0; i < maskPixelCount; i++) {
        maskData[i] = maskRawObj[i * actualChannels];
      }
    }

    // 调试：统计原始蒙版白/黑比例
    let whiteCount = 0, blackCount = 0;
    for (let i = 0; i < maskPixelCount; i++) {
      if (maskData[i] > 128) whiteCount++;
      else blackCount++;
    }
    console.log(`[remove-bg-postprocess-local] Raw mask: ${whiteCount} white (${(whiteCount/maskPixelCount*100).toFixed(1)}%), ${blackCount} black (${(blackCount/maskPixelCount*100).toFixed(1)}%), size=${maskInfo.width}x${maskInfo.height}`);

    // 3. 膨胀蒙版：扩展主体区域 4-6px，确保主体边缘不被切
    console.log('[remove-bg-postprocess-local] Step 3: Dilate mask (expand subject area)');
    const dilatedMask = await dilateMask(maskData, maskInfo.width, maskInfo.height, 5);

    // 4. 用膨胀后的蒙版应用到原图（含 alpha 羽化）
    console.log('[remove-bg-postprocess-local] Step 4: Apply dilated mask to original');
    const resultPng = await applyMaskToOriginal(
      origBuffer, origWidth, origHeight,
      dilatedMask, maskInfo.width, maskInfo.height
    );

    // 5. 持久化结果
    const filename = `removebg-${Date.now()}.png`;
    const resultUrl = saveImageFile(resultPng, filename, 'removebg');

    // 6. 验证输出 PNG
    const verifyMeta = await sharp(resultPng).metadata();
    console.log(`[remove-bg-postprocess-local] Output: ${verifyMeta.width}x${verifyMeta.height}, channels=${verifyMeta.channels}, hasAlpha=${verifyMeta.hasAlpha}`);

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
    const aiUrl = aiResultUrl.startsWith('http') ? aiResultUrl : `${baseUrl}${aiResultUrl}`;
    const aiResp = await fetch(aiUrl);
    if (!aiResp.ok) {
      console.error('[remove-bg-postprocess-ai] Failed to fetch AI result:', aiResp.status);
      return null;
    }
    const aiBuffer = Buffer.from(await aiResp.arrayBuffer());

    // 3. 用 rembg 对 AI 结果生成蒙版
    console.log('[remove-bg-postprocess-ai] Step 3: Generate mask from AI result using rembg');
    let maskResult = await generateRembgMask(aiBuffer, origWidth, origHeight, 'u2net');

    if (!maskResult) {
      console.log('[remove-bg-postprocess-ai] u2net failed, trying u2netp...');
      maskResult = await generateRembgMask(aiBuffer, origWidth, origHeight, 'u2netp');
    }

    if (!maskResult) {
      console.error('[remove-bg-postprocess-ai] All rembg models failed for mask generation');
      return null;
    }

    // 4. 膨胀蒙版
    console.log('[remove-bg-postprocess-ai] Step 4: Dilate mask');
    const dilatedMask = await dilateMask(maskResult.maskData, maskResult.width, maskResult.height, 5);

    // 5. 用蒙版应用到原图
    console.log('[remove-bg-postprocess-ai] Step 5: Apply mask to original');
    const resultPng = await applyMaskToOriginal(
      origBuffer, origWidth, origHeight,
      dilatedMask, maskResult.width, maskResult.height
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
    
    let maskData: Uint8ClampedArray;
    if (actualChannels === 1) {
      maskData = new Uint8ClampedArray(maskRawObj.buffer, maskRawObj.byteOffset, maskRawObj.byteLength);
    } else {
      maskData = new Uint8ClampedArray(maskPixelCount);
      for (let i = 0; i < maskPixelCount; i++) {
        maskData[i] = maskRawObj[i * actualChannels];
      }
    }

    console.log(`[generateRembgMask] Mask decoded: ${maskOutInfo.width}x${maskOutInfo.height}, channels=${actualChannels}`);

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

    const rgba = await sharp(imageBuffer).ensureAlpha().raw().toBuffer();
    const pixels = bufferToUint8Clamped(rgba);
    const pixelCount = width * height;

    // 采样边缘像素，找出背景色
    const edgeSamples: number[] = [];
    for (let x = 0; x < width; x++) {
      const topIdx = x * 4;
      edgeSamples.push(pixels[topIdx], pixels[topIdx + 1], pixels[topIdx + 2]);
      const botIdx = ((height - 1) * width + x) * 4;
      edgeSamples.push(pixels[botIdx], pixels[botIdx + 1], pixels[botIdx + 2]);
    }
    for (let y = 1; y < height - 1; y++) {
      const leftIdx = y * width * 4;
      edgeSamples.push(pixels[leftIdx], pixels[leftIdx + 1], pixels[leftIdx + 2]);
      const rightIdx = (y * width + width - 1) * 4;
      edgeSamples.push(pixels[rightIdx], pixels[rightIdx + 1], pixels[rightIdx + 2]);
    }

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

    const bgBrightness = (bgR + bgG + bgB) / 3;
    const threshold = bgBrightness > 128 ? 40 : 25;

    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      const dr = Math.abs(pixels[idx] - bgR);
      const dg = Math.abs(pixels[idx + 1] - bgG);
      const db = Math.abs(pixels[idx + 2] - bgB);
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      
      if (distance < threshold) {
        pixels[idx + 3] = 0;
      } else if (distance < threshold + 20) {
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
