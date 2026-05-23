/**
 * RemoveBG 后处理 — 蒙版法
 * 
 * 核心思路（用户确认的正确流程）：
 * 1. AI 识别画面主体 → 生成黑白蒙版（白色=主体，黑色=背景）
 * 2. Alpha 提取法优化蒙版边缘（边缘更圆润顺滑）
 * 3. 优化后的蒙版应用到原图 → 蒙版黑色区域变透明，白色区域保留原图像素
 * 
 * 关键：蒙版应用到【原图】而非 AI 结果！
 * - AI 结果可能有主体像素修改（颜色变化、细节丢失）
 * - 原图保留完整真实的主体像素
 * - 蒙版精确标记了主体/背景，直接应用到原图即可
 */

import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { saveImageFile } from './server-data-root';

const execFileAsync = promisify(execFile);

/** RGB 像素 */
interface RGB { r: number; g: number; b: number; }

/** 颜色距离（欧几里得） */
function colorDist(a: RGB, b: RGB): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主入口：蒙版法后处理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * RemoveBG 后处理主函数
 * 
 * 流程：
 * 1. 从 AI 结果图生成黑白蒙版（rembg / 颜色距离 / 棋盘格检测）
 * 2. Alpha 提取法优化蒙版边缘
 * 3. 将优化后的蒙版应用到【原图】
 * 4. 保存并返回透明 PNG URL
 * 
 * @param aiResultUrl AI 结果图 URL（主体+统一背景，用于生成蒙版）
 * @param originalImageUrl 原图 URL（复杂背景+真实主体像素，蒙版应用目标）
 * @returns 透明 PNG URL，失败返回 null
 */
export async function postProcessAIRemoveBG(
  aiResultUrl: string,
  originalImageUrl?: string
): Promise<string | null> {
  try {
    console.log('[remove-bg-postprocess] 开始蒙版法后处理');
    console.log(`[remove-bg-postprocess] AI结果: ${aiResultUrl}`);
    console.log(`[remove-bg-postprocess] 原图: ${originalImageUrl || '(未提供，回退旧逻辑)'}`);

    // ── Step 1: 获取 AI 结果图，生成黑白蒙版 ──
    const aiResultBuffer = await fetchImageBuffer(aiResultUrl);
    if (!aiResultBuffer) {
      console.error('[remove-bg-postprocess] 无法获取 AI 结果图');
      return null;
    }

    // 生成蒙版（灰度 Buffer，白色=主体，黑色=背景）
    const maskResult = await generateMaskFromAIResult(aiResultBuffer);

    if (!maskResult) {
      console.warn('[remove-bg-postprocess] 蒙版生成失败，回退旧逻辑处理 AI 结果');
      // 回退：没有蒙版，对 AI 结果做简单透明化
      return fallbackProcessAIResult(aiResultBuffer);
    }

    console.log(`[remove-bg-postprocess] 蒙版生成成功: ${maskResult.width}x${maskResult.height}`);

    // ── Step 2: Alpha 提取法优化蒙版边缘 ──
    const optimizedMask = await optimizeMaskEdges(
      maskResult.maskData,
      maskResult.width,
      maskResult.height
    );

    // ── Step 3: 将优化后的蒙版应用到目标图 ──
    // 优先应用到原图（保留真实主体像素），无原图时应用到 AI 结果
    let targetBuffer: Buffer;
    let targetWidth: number;
    let targetHeight: number;

    if (originalImageUrl) {
      const originalBuffer = await fetchImageBuffer(originalImageUrl);
      if (originalBuffer) {
        targetBuffer = originalBuffer;
        const meta = await sharp(originalBuffer).metadata();
        targetWidth = meta.width || maskResult.width;
        targetHeight = meta.height || maskResult.height;
        console.log(`[remove-bg-postprocess] 蒙版应用到原图: ${targetWidth}x${targetHeight}`);
      } else {
        // 原图获取失败，回退到 AI 结果
        targetBuffer = aiResultBuffer;
        targetWidth = maskResult.width;
        targetHeight = maskResult.height;
        console.warn('[remove-bg-postprocess] 原图获取失败，回退到 AI 结果');
      }
    } else {
      targetBuffer = aiResultBuffer;
      targetWidth = maskResult.width;
      targetHeight = maskResult.height;
    }

    // 将蒙版缩放到目标图尺寸
    let finalMask = optimizedMask;
    if (targetWidth !== maskResult.width || targetHeight !== maskResult.height) {
      // 用 sharp 将蒙版缩放到原图尺寸
      const maskPng = await sharp(Buffer.from(optimizedMask), {
        raw: { width: maskResult.width, height: maskResult.height, channels: 1 }
      }).png().toBuffer();
      
      const resizedMaskBuf = await sharp(maskPng)
        .resize(targetWidth, targetHeight, { fit: 'fill' })
        .raw()
        .toBuffer();
      
      finalMask = new Uint8Array(resizedMaskBuf);
    }

    // ── Step 4: 应用蒙版 → 透明 PNG ──
    const targetRaw = await sharp(targetBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data: targetData, info: targetInfo } = targetRaw;
    const pixelCount = targetInfo.width * targetInfo.height;
    const channels = targetInfo.channels;

    // 蒙版值映射：mask > 128 → alpha=255（主体保留），mask ≤ 128 → alpha=0（背景透明）
    // 蒙版边缘过渡值（128 附近）保留为中间 alpha，实现平滑过渡
    for (let i = 0; i < pixelCount; i++) {
      const maskVal = finalMask[i] || 0;
      let alpha: number;

      if (maskVal >= 200) {
        // 明确的主体区域 → 完全不透明
        alpha = 255;
      } else if (maskVal <= 55) {
        // 明确的背景区域 → 完全透明
        alpha = 0;
      } else {
        // 蒙版边缘过渡区 → alpha 线性插值，实现圆润边缘
        alpha = Math.round((maskVal - 55) / (200 - 55) * 255);
      }

      targetData[i * channels + 3] = alpha;
    }

    // 保存透明 PNG
    const outputBuffer = await sharp(Buffer.from(targetData), {
      raw: { width: targetInfo.width, height: targetInfo.height, channels: 4 }
    }).png().toBuffer();

    const timestamp = Date.now();
    const filename = `removebg_mask_${timestamp}.png`;
    const savedUrl = await saveImageFile(outputBuffer, filename, 'removebg');
    console.log(`[remove-bg-postprocess] 蒙版法透明 PNG 已保存: ${savedUrl}`);
    return savedUrl;

  } catch (err) {
    console.error('[remove-bg-postprocess] 蒙版法后处理异常:', err);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Step 1: 从 AI 结果生成黑白蒙版
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface MaskResult {
  maskData: Uint8Array;  // 灰度蒙版，255=主体，0=背景
  width: number;
  height: number;
}

/**
 * 从 AI 结果图生成黑白蒙版
 * 降级链：rembg → 颜色距离 Alpha → 棋盘格检测
 */
async function generateMaskFromAIResult(aiResultBuffer: Buffer): Promise<MaskResult | null> {
  // 尝试 1: rembg 生成蒙版（最精确）
  const rembgMask = await generateRembgMask(aiResultBuffer);
  if (rembgMask) return rembgMask;

  // 尝试 2: 颜色距离 Alpha 提取蒙版
  const alphaMask = await generateAlphaMaskFromColorDistance(aiResultBuffer);
  if (alphaMask) return alphaMask;

  // 尝试 3: 棋盘格检测
  const checkerMask = await generateMaskFromCheckerboard(aiResultBuffer);
  if (checkerMask) return checkerMask;

  return null;
}

/**
 * 使用 rembg 生成蒙版（调用 Python iopaint_removebg.py --gen_mask）
 * AI 结果背景统一，rembg 极易精确分割
 */
async function generateRembgMask(aiResultBuffer: Buffer): Promise<MaskResult | null> {
  const venvPython = path.join(process.cwd(), '.venv/bin/python3');
  const scriptPath = path.join(process.cwd(), 'scripts/iopaint_removebg.py');

  try {
    // 将 AI 结果保存为临时文件
    const tempInput = path.join('/tmp', `rembg_input_${Date.now()}.png`);
    const tempOutput = path.join('/tmp', `rembg_mask_${Date.now()}.png`);

    await sharp(aiResultBuffer).png().toFile(tempInput);

    // 调用 Python 生成蒙版（u2net 模型，不膨胀）
    const { stderr } = await execFileAsync(venvPython, [
      scriptPath,
      '--input', tempInput,
      '--output', tempOutput,
      '--model', 'u2net',
      '--gen_mask',
    ], { timeout: 60000 });

    if (stderr && stderr.includes('Error')) {
      console.warn('[remove-bg-postprocess] rembg 蒙版生成警告:', stderr.substring(0, 200));
    }

    // 读取蒙版
    const maskBuf = await sharp(tempOutput).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = maskBuf;

    // 取 R 通道作为蒙版（灰度图 RGB 三个通道相同）
    const maskData = new Uint8Array(info.width * info.height);
    for (let i = 0; i < maskData.length; i++) {
      maskData[i] = data[i * info.channels]; // R channel
    }

    // 清理临时文件
    try { await import('fs').then(f => f.promises.unlink(tempInput)); } catch {}
    try { await import('fs').then(f => f.promises.unlink(tempOutput)); } catch {}

    console.log(`[remove-bg-postprocess] rembg 蒙版生成成功: ${info.width}x${info.height}`);
    return { maskData, width: info.width, height: info.height };

  } catch (err) {
    console.warn('[remove-bg-postprocess] rembg 蒙版生成失败:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 颜色距离 Alpha 提取蒙版
 * 从 AI 结果边缘采样背景色，颜色距离小=背景(alpha=0)，距离大=主体(alpha=255)
 */
async function generateAlphaMaskFromColorDistance(aiResultBuffer: Buffer): Promise<MaskResult | null> {
  try {
    const { data, info } = await sharp(aiResultBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width, h = info.height, ch = info.channels;

    // 如果已有 alpha 透明通道，直接提取为蒙版
    if (ch === 4) {
      let hasTransparent = false;
      for (let i = 0; i < w * h; i++) {
        if (data[i * 4 + 3] < 200) { hasTransparent = true; break; }
      }
      if (hasTransparent) {
        console.log('[remove-bg-postprocess] AI 结果已有 alpha 通道，直接提取为蒙版');
        const maskData = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          // alpha > 128 → 主体(255)，alpha ≤ 128 → 背景(0)
          maskData[i] = data[i * 4 + 3] > 128 ? 255 : 0;
        }
        return { maskData, width: w, height: h };
      }
    }

    // 从边框采样背景色
    const bgColor = sampleBorderColor(data, w, h, ch);
    if (!bgColor) return null;

    const bgLum = bgColor.r * 0.299 + bgColor.g * 0.587 + bgColor.b * 0.114;
    
    // 动态阈值（与之前一致）
    let distThresh: number;
    if (bgLum <= 5) distThresh = 4;
    else if (bgLum < 30) distThresh = 5;
    else if (bgLum < 80) distThresh = 7;
    else if (bgLum < 180) distThresh = 8;
    else distThresh = 10;

    // 生成蒙版：颜色距离 < distThresh → 背景(0)，否则 → 主体(255)
    const maskData = new Uint8Array(w * h);
    const maxDist = distThresh * 3; // 过渡区宽度

    for (let i = 0; i < w * h; i++) {
      const px: RGB = { r: data[i * ch], g: data[i * ch + 1], b: data[i * ch + 2] };
      const dist = colorDist(px, bgColor);

      if (dist < distThresh) {
        maskData[i] = 0; // 纯背景
      } else if (dist > maxDist) {
        maskData[i] = 255; // 纯主体
      } else {
        // 过渡区：线性插值
        maskData[i] = Math.round((dist - distThresh) / (maxDist - distThresh) * 255);
      }
    }

    // 边缘连通性：只有与图片边缘连通的背景区域才变透明
    // 主体内部与背景色相近的区域保持主体
    const connectedMask = enforceEdgeConnectivity(maskData, w, h);

    console.log(`[remove-bg-postprocess] 颜色距离蒙版生成成功: ${w}x${h}, 阈值=${distThresh}`);
    return { maskData: connectedMask, width: w, height: h };

  } catch (err) {
    console.warn('[remove-bg-postprocess] 颜色距离蒙版生成失败:', err);
    return null;
  }
}

/**
 * 棋盘格检测生成蒙版
 */
async function generateMaskFromCheckerboard(aiResultBuffer: Buffer): Promise<MaskResult | null> {
  try {
    const { data, info } = await sharp(aiResultBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width, h = info.height, ch = info.channels;
    const maskData = new Uint8Array(w * h);

    // 检测棋盘格：寻找两种交替颜色
    const gridSizes = [8, 10, 12, 16, 20];
    let detected = false;

    for (const gs of gridSizes) {
      if (detected) break;
      let matchCount = 0;
      let totalCount = 0;

      for (let y = gs; y < h - gs; y += gs) {
        for (let x = gs; x < w - gs; x += gs) {
          const idx1 = (y * w + x) * ch;
          const idx2 = (y * w + x + gs / 2) * ch;
          if (idx2 + 2 >= data.length) continue;

          const p1: RGB = { r: data[idx1], g: data[idx1 + 1], b: data[idx1 + 2] };
          const p2: RGB = { r: data[idx2], g: data[idx2 + 1], b: data[idx2 + 2] };
          const dist = colorDist(p1, p2);

          totalCount++;
          if (dist > 5 && dist < 60) matchCount++;
        }
      }

      if (totalCount > 0 && matchCount / totalCount > 0.6) {
        // 检测到棋盘格，标记棋盘格区域为背景
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const gridX = Math.floor(x / gs);
            const gridY = Math.floor(y / gs);
            // 棋盘格的"浅色"格子（网格位置之和为偶数）
            if ((gridX + gridY) % 2 === 0) {
              maskData[y * w + x] = 0; // 背景
            } else {
              // 也检查"深色"格子是否也是背景
              const idx = (y * w + x) * ch;
              const px: RGB = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
              // 与边框像素比较
              const borderIdx = (0 * w + Math.min(x, w - 1)) * ch;
              const borderPx: RGB = { r: data[borderIdx], g: data[borderIdx + 1], b: data[borderIdx + 2] };
              maskData[y * w + x] = colorDist(px, borderPx) < 30 ? 0 : 255;
            }
          }
        }
        detected = true;
      }
    }

    if (!detected) return null;

    // 用边缘连通性确保不误删主体内部
    const connectedMask = enforceEdgeConnectivity(maskData, w, h);

    console.log(`[remove-bg-postprocess] 棋盘格蒙版生成成功: ${w}x${h}`);
    return { maskData: connectedMask, width: w, height: h };

  } catch (err) {
    console.warn('[remove-bg-postprocess] 棋盘格蒙版生成失败:', err);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Step 2: Alpha 提取法优化蒙版边缘
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Alpha 提取法优化蒙版边缘
 * 
 * 目的：让蒙版边缘更圆润顺滑
 * 方法：对蒙版做高斯模糊，让硬边缘变为软过渡
 * - 纯主体区域(255)保持不变
 * - 纯背景区域(0)保持不变  
 * - 边缘处产生中间值，实现圆润过渡
 */
async function optimizeMaskEdges(
  maskData: Uint8Array,
  width: number,
  height: number
): Promise<Uint8Array> {
  // 使用 sharp 高斯模糊蒙版
  // sigma=1.5 大约影响 3-4 像素范围，产生平滑过渡
  const maskPng = sharp(Buffer.from(maskData), {
    raw: { width, height, channels: 1 }
  })
    .blur(1.5)
    .raw()
    .toBuffer();

  const blurred = new Uint8Array(await maskPng);

  // 确保主体核心区域仍然是 255，背景核心仍然是 0
  // 模糊只在边缘产生过渡
  const result = new Uint8Array(width * height);
  for (let i = 0; i < result.length; i++) {
    const orig = maskData[i];
    const blur = blurred[i];

    if (orig >= 250) {
      // 原始蒙版明确为主体 → 保持 255
      result[i] = 255;
    } else if (orig <= 5) {
      // 原始蒙版明确为背景 → 保持 0
      result[i] = 0;
    } else {
      // 原始蒙版边缘过渡区 → 使用模糊后的值（更平滑）
      result[i] = blur;
    }
  }

  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 辅助函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 从图片边框采样背景色 */
function sampleBorderColor(data: Buffer, w: number, h: number, ch: number): RGB | null {
  // 收集边框 2px 带的像素
  const borderPixels: RGB[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < 2 || x >= w - 2 || y < 2 || y >= h - 2) {
        const idx = (y * w + x) * ch;
        borderPixels.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
      }
    }
  }

  if (borderPixels.length === 0) return null;

  // 量化颜色：将 RGB 各通道按 16 级量化
  const buckets = new Map<string, { sum: RGB; count: number }>();
  for (const px of borderPixels) {
    const qr = Math.floor(px.r / 16);
    const qg = Math.floor(px.g / 16);
    const qb = Math.floor(px.b / 16);
    const key = `${qr}_${qg}_${qb}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.sum.r += px.r;
      bucket.sum.g += px.g;
      bucket.sum.b += px.b;
      bucket.count++;
    } else {
      buckets.set(key, { sum: { r: px.r, g: px.g, b: px.b }, count: 1 });
    }
  }

  // 找占比最大的颜色桶
  let best: { sum: RGB; count: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }

  if (!best || best.count / borderPixels.length < 0.3) return null;

  return {
    r: Math.round(best.sum.r / best.count),
    g: Math.round(best.sum.g / best.count),
    b: Math.round(best.sum.b / best.count),
  };
}

/**
 * 边缘连通性保护
 * 只有与图片边缘连通的背景区域才是真正的背景
 * 主体内部与背景色相近的区域保持为主体
 */
function enforceEdgeConnectivity(maskData: Uint8Array, w: number, h: number): Uint8Array {
  const result = new Uint8Array(maskData);
  const visited = new Uint8Array(w * h);

  // 从所有边缘像素开始 BFS，只通过背景像素(maskVal < 128)扩散
  const queue: number[] = [];
  
  // 添加四条边的背景像素
  for (let x = 0; x < w; x++) {
    const topIdx = x;
    const botIdx = (h - 1) * w + x;
    if (result[topIdx] < 128) { queue.push(topIdx); visited[topIdx] = 1; }
    if (result[botIdx] < 128) { queue.push(botIdx); visited[botIdx] = 1; }
  }
  for (let y = 1; y < h - 1; y++) {
    const leftIdx = y * w;
    const rightIdx = y * w + w - 1;
    if (result[leftIdx] < 128) { queue.push(leftIdx); visited[leftIdx] = 1; }
    if (result[rightIdx] < 128) { queue.push(rightIdx); visited[rightIdx] = 1; }
  }

  // BFS 扩展
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % w;
    const y = Math.floor(idx / w);

    const neighbors = [
      y > 0 ? idx - w : -1,
      y < h - 1 ? idx + w : -1,
      x > 0 ? idx - 1 : -1,
      x < w - 1 ? idx + 1 : -1,
    ];

    for (const nIdx of neighbors) {
      if (nIdx < 0 || visited[nIdx]) continue;
      visited[nIdx] = 1;
      if (result[nIdx] < 128) {
        queue.push(nIdx);
      }
    }
  }

  // 未被 BFS 访问到的背景像素 → 主体内部的背景色区域 → 改为主体
  for (let i = 0; i < w * h; i++) {
    if (result[i] < 128 && !visited[i]) {
      result[i] = 255; // 标记为主体
    }
  }

  return result;
}

/** 获取图片 Buffer */
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    let fetchUrl = url;
    if (url.startsWith('/')) {
      const port = process.env.DEPLOY_RUN_PORT || '5000';
      fetchUrl = `http://localhost:${port}${url}`;
    }

    const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) return null;
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    console.warn('[remove-bg-postprocess] 获取图片失败:', url, err);
    return null;
  }
}

/** 兜底：对 AI 结果做简单透明化（无法生成蒙版时） */
async function fallbackProcessAIResult(aiResultBuffer: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(aiResultBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width, h = info.height, ch = info.channels;

    // 检查是否已有透明通道
    let hasTransparent = false;
    for (let i = 0; i < w * h; i++) {
      if (ch === 4 && data[i * 4 + 3] < 200) { hasTransparent = true; break; }
    }

    if (hasTransparent) {
      // 已有透明，直接保存
      const outputBuffer = await sharp(Buffer.from(data), {
        raw: { width: w, height: h, channels: 4 }
      }).png().toBuffer();

      const timestamp = Date.now();
      const filename = `removebg_fallback_${timestamp}.png`;
      return await saveImageFile(outputBuffer, filename, 'removebg');
    }

    // 无法处理，返回 null（调用方使用原 URL）
    console.warn('[remove-bg-postprocess] 兜底处理：无法生成透明 PNG');
    return null;

  } catch (err) {
    console.error('[remove-bg-postprocess] 兜底处理异常:', err);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 本地 RemoveBG 透明化（本地模型路径使用）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 本地 RemoveBG 后处理（本地 rembg 路径）
 * 对本地 rembg 结果做简单透明化处理
 */
export async function createLocalTransparentBg(imageUrl: string): Promise<string | null> {
  try {
    const imageBuffer = await fetchImageBuffer(imageUrl);
    if (!imageBuffer) return null;

    const { data, info } = await sharp(imageBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width, h = info.height, ch = info.channels;

    // 检查已有透明通道
    if (ch === 4) {
      let hasTransparent = false;
      for (let i = 0; i < w * h; i++) {
        if (data[i * 4 + 3] < 200) { hasTransparent = true; break; }
      }
      if (hasTransparent) {
        const outputBuffer = await sharp(Buffer.from(data), {
          raw: { width: w, height: h, channels: 4 }
        }).png().toBuffer();

        const timestamp = Date.now();
        const filename = `local_removebg_${timestamp}.png`;
        return await saveImageFile(outputBuffer, filename, 'removebg');
      }
    }

    return null;
  } catch (err) {
    console.error('[remove-bg-postprocess] 本地透明化异常:', err);
    return null;
  }
}
