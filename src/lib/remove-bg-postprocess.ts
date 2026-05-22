/**
 * AI RemoveBG 后处理：背景检测与透明化
 * 
 * AI 模型（GPT/Gemini）去背景时通常返回 JPEG（无 alpha 通道），
 * 背景区域可能是：
 * 1. 棋盘格图案（灰色+白色 或 黑色+白色 交替方块）
 * 2. 纯白/浅灰/浅色背景
 * 3. 棋盘格+纯色混合
 * 
 * 本模块检测这些背景模式并替换为真正的透明像素，输出 PNG。
 */
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

/**
 * 检测像素是否为"灰色"（低饱和度）
 * 灰色像素的 R≈G≈B，饱和度极低
 */
function isGrayish(r: number, g: number, b: number, maxSaturation: number = 0.12): boolean {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  if (maxC === 0) return true;
  const saturation = (maxC - minC) / maxC;
  return saturation < maxSaturation;
}

/**
 * 策略1: 检测棋盘格图案并替换为透明
 * 支持多种棋盘格尺寸和颜色
 */
function detectCheckerboard(
  raw: Buffer, width: number, height: number
): { alphaChannel: Uint8Array; checkerPixels: number } {
  const totalPixels = width * height;
  const alphaChannel = new Uint8Array(totalPixels).fill(255);
  let checkerPixels = 0;

  // 尝试多种棋盘格尺寸
  const CHECKER_SIZES = [4, 8, 10, 12, 16, 20];

  let bestSize = 0;
  let bestCount = 0;

  // 先用采样法找到最佳棋盘格尺寸
  for (const size of CHECKER_SIZES) {
    let count = 0;
    const sampleStep = Math.max(1, Math.floor(size / 2));
    // 采样：每隔 sampleStep 检查一个像素
    for (let y = size; y < height - size; y += sampleStep) {
      for (let x = size; x < width - size; x += sampleStep) {
        const idx = (y * width + x) * 4;
        const r = raw[idx], g = raw[idx + 1], b = raw[idx + 2];
        
        if (!isGrayish(r, g, b, 0.15)) continue;

        // 检查水平方向相邻块的颜色差异
        const nextIdx = (y * width + Math.min(x + size, width - 1)) * 4;
        const nR = raw[nextIdx], nG = raw[nextIdx + 1], nB = raw[nextIdx + 2];
        
        if (!isGrayish(nR, nG, nB, 0.15)) continue;

        const currBrightness = (r + g + b) / 3;
        const nextBrightness = (nR + nG + nB) / 3;
        const diff = Math.abs(currBrightness - nextBrightness);

        // 棋盘格特征：相邻块亮度有明显差异但不极端
        if (diff > 10 && diff < 180) {
          count++;
        }
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestSize = size;
    }
  }

  if (bestSize === 0) {
    return { alphaChannel, checkerPixels: 0 };
  }

  console.log(`[removeCheckerboard] Best checker size: ${bestSize} (sampled ${bestCount} matches)`);

  // 用最佳尺寸逐像素检测
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = raw[idx], g = raw[idx + 1], b = raw[idx + 2];

      // 检查是否为灰色像素（棋盘格总是灰色的）
      if (!isGrayish(r, g, b, 0.18)) continue;

      const brightness = (r + g + b) / 3;
      // 棋盘格亮度范围：从深灰到近白（0-240），排除极端亮白（可能是主体高光）
      if (brightness > 245) continue;

      // 检查当前像素所在块的相邻块是否有亮度差异（棋盘格的标志）
      const blockX = Math.floor(x / bestSize);
      const blockY = Math.floor(y / bestSize);

      // 取当前块和相邻块的中心像素亮度
      const centers: number[] = [];
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const nbx = blockX + dx;
        const nby = blockY + dy;
        const cx = Math.min((nbx * bestSize) + Math.floor(bestSize / 2), width - 1);
        const cy = Math.min((nby * bestSize) + Math.floor(bestSize / 2), height - 1);
        const ci = (cy * width + cx) * 4;
        if (isGrayish(raw[ci], raw[ci + 1], raw[ci + 2], 0.18)) {
          centers.push((raw[ci] + raw[ci + 1] + raw[ci + 2]) / 3);
        }
      }

      // 当前块中心亮度
      const currCX = Math.min((blockX * bestSize) + Math.floor(bestSize / 2), width - 1);
      const currCY = Math.min((blockY * bestSize) + Math.floor(bestSize / 2), height - 1);
      const currCI = (currCY * width + currCX) * 4;
      if (!isGrayish(raw[currCI], raw[currCI + 1], raw[currCI + 2], 0.18)) continue;
      const currCenterBrightness = (raw[currCI] + raw[currCI + 1] + raw[currCI + 2]) / 3;

      // 至少有一个相邻块与当前块有明显亮度差异
      let isCheckerArea = false;
      for (const nb of centers) {
        if (Math.abs(currCenterBrightness - nb) > 10 && Math.abs(currCenterBrightness - nb) < 180) {
          isCheckerArea = true;
          break;
        }
      }

      if (isCheckerArea) {
        alphaChannel[y * width + x] = 0;
        checkerPixels++;
      }
    }
  }

  return { alphaChannel, checkerPixels };
}

/**
 * 策略2: 检测纯色/渐变背景并替换为透明
 * 从图片边缘采样，找出背景色，将相似的像素替换为透明
 */
function detectSolidBackground(
  raw: Buffer, width: number, height: number,
  existingAlpha: Uint8Array
): { alphaChannel: Uint8Array; bgPixels: number } {
  const alphaChannel = new Uint8Array(existingAlpha);
  let bgPixels = 0;

  // 从四条边采样背景颜色
  const edgeSamples: { r: number; g: number; b: number }[] = [];
  const sampleEvery = Math.max(1, Math.floor(Math.min(width, height) / 50));

  // 上边
  for (let x = 0; x < width; x += sampleEvery) {
    const idx = x * 4;
    edgeSamples.push({ r: raw[idx], g: raw[idx + 1], b: raw[idx + 2] });
  }
  // 下边
  for (let x = 0; x < width; x += sampleEvery) {
    const idx = ((height - 1) * width + x) * 4;
    edgeSamples.push({ r: raw[idx], g: raw[idx + 1], b: raw[idx + 2] });
  }
  // 左边
  for (let y = 0; y < height; y += sampleEvery) {
    const idx = (y * width) * 4;
    edgeSamples.push({ r: raw[idx], g: raw[idx + 1], b: raw[idx + 2] });
  }
  // 右边
  for (let y = 0; y < height; y += sampleEvery) {
    const idx = (y * width + width - 1) * 4;
    edgeSamples.push({ r: raw[idx], g: raw[idx + 1], b: raw[idx + 2] });
  }

  if (edgeSamples.length === 0) return { alphaChannel, bgPixels: 0 };

  // 找出最常见的边缘颜色簇
  // 简单方法：统计灰色像素的平均值作为背景色
  const graySamples = edgeSamples.filter(s => isGrayish(s.r, s.g, s.b, 0.10));
  
  if (graySamples.length < edgeSamples.length * 0.3) {
    // 不到 30% 的边缘像素是灰色，可能不是纯色背景
    return { alphaChannel, bgPixels: 0 };
  }

  // 计算背景色的平均值
  let avgR = 0, avgG = 0, avgB = 0;
  for (const s of graySamples) {
    avgR += s.r; avgG += s.g; avgB += s.b;
  }
  avgR = Math.round(avgR / graySamples.length);
  avgG = Math.round(avgG / graySamples.length);
  avgB = Math.round(avgB / graySamples.length);

  const bgBrightness = (avgR + avgG + avgB) / 3;
  console.log(`[removeSolidBg] Detected background color: rgb(${avgR},${avgG},${avgB}), brightness: ${bgBrightness.toFixed(0)}`);

  // 计算背景色的颜色范围（容差）
  // 对于灰色背景，使用亮度差异而非颜色差异
  const TOLERANCE = 40; // 亮度容差

  // 从边缘开始 flood-fill，将与背景色相似的连通区域标记为透明
  // 这样可以避免将主体内部的灰色区域误判为背景
  const visited = new Uint8Array(width * height);
  const queue: [number, number][] = [];

  // 将所有边缘像素中与背景色相似的加入队列
  for (let x = 0; x < width; x++) {
    // 上边
    const idx1 = x * 4;
    if (isSimilarToBackground(raw[idx1], raw[idx1 + 1], raw[idx1 + 2], avgR, avgG, avgB, TOLERANCE)) {
      queue.push([x, 0]);
    }
    // 下边
    const idx2 = ((height - 1) * width + x) * 4;
    if (isSimilarToBackground(raw[idx2], raw[idx2 + 1], raw[idx2 + 2], avgR, avgG, avgB, TOLERANCE)) {
      queue.push([x, height - 1]);
    }
  }
  for (let y = 0; y < height; y++) {
    // 左边
    const idx1 = (y * width) * 4;
    if (isSimilarToBackground(raw[idx1], raw[idx1 + 1], raw[idx1 + 2], avgR, avgG, avgB, TOLERANCE)) {
      queue.push([0, y]);
    }
    // 右边
    const idx2 = (y * width + width - 1) * 4;
    if (isSimilarToBackground(raw[idx2], raw[idx2 + 1], raw[idx2 + 2], avgR, avgG, avgB, TOLERANCE)) {
      queue.push([width - 1, y]);
    }
  }

  // BFS flood-fill
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const pixelIdx = y * width + x;
    if (visited[pixelIdx]) continue;
    visited[pixelIdx] = 1;

    const dataIdx = pixelIdx * 4;
    if (!isSimilarToBackground(raw[dataIdx], raw[dataIdx + 1], raw[dataIdx + 2], avgR, avgG, avgB, TOLERANCE)) {
      continue;
    }

    // 标记为透明（但不覆盖已经被棋盘格策略标记为透明的像素）
    if (alphaChannel[pixelIdx] !== 0) {
      alphaChannel[pixelIdx] = 0;
      bgPixels++;
    }

    // 扩展到相邻像素
    if (x > 0) queue.push([x - 1, y]);
    if (x < width - 1) queue.push([x + 1, y]);
    if (y > 0) queue.push([x, y - 1]);
    if (y < height - 1) queue.push([x, y + 1]);
  }

  return { alphaChannel, bgPixels };
}

/**
 * 判断像素颜色是否与背景色相似
 */
function isSimilarToBackground(
  r: number, g: number, b: number,
  bgR: number, bgG: number, bgB: number,
  tolerance: number
): boolean {
  // 使用亮度差异（更适合灰色背景检测）
  const pixelBrightness = (r + g + b) / 3;
  const bgBrightness = (bgR + bgG + bgB) / 3;
  if (Math.abs(pixelBrightness - bgBrightness) > tolerance) return false;

  // 同时检查饱和度（灰色背景的像素也应为灰色）
  if (!isGrayish(r, g, b, 0.15)) return false;

  // 检查颜色通道差异（防止将相似亮度的彩色像素误判）
  const colorDist = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
  return colorDist < tolerance * 3;
}

/**
 * 对 alpha 通道做边缘羽化（抗锯齿）
 */
function featherAlphaEdge(
  raw: Buffer, width: number, height: number,
  alphaChannel: Uint8Array, radius: number = 3
): void {
  const origAlpha = Buffer.from(alphaChannel);
  
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      const idx = y * width + x;
      if (origAlpha[idx] !== 255) continue; // 只处理不透明像素

      // 检查周围是否有透明像素
      let nearbyTransparent = false;
      let minDist = radius + 1;

      for (let dy = -radius; dy <= radius && !nearbyTransparent; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dy === 0 && dx === 0) continue;
          const ni = (y + dy) * width + (x + dx);
          if (origAlpha[ni] === 0) {
            nearbyTransparent = true;
            const dist = Math.sqrt(dx * dx + dy * dy);
            minDist = Math.min(minDist, dist);
          }
        }
      }

      if (nearbyTransparent && minDist <= radius) {
        // 根据到透明区域距离设置 alpha 值
        // 距离越近越透明，距离越远越不透明
        const featherAlpha = Math.round(255 * Math.min(1, minDist / radius));
        alphaChannel[idx] = featherAlpha;

        // 同时对颜色做预乘：将边缘像素颜色与背景色混合，避免透明边缘出现灰边
        // 简单做法：将颜色向白色方向调整一点
        const dataIdx = idx * 4;
        if (featherAlpha < 200) {
          const factor = featherAlpha / 255;
          raw[dataIdx] = Math.round(raw[dataIdx] * factor + 255 * (1 - factor));
          raw[dataIdx + 1] = Math.round(raw[dataIdx + 1] * factor + 255 * (1 - factor));
          raw[dataIdx + 2] = Math.round(raw[dataIdx + 2] * factor + 255 * (1 - factor));
        }
      }
    }
  }
}

/**
 * 主函数：检测 AI RemoveBG 结果的背景并替换为透明
 * 
 * 多策略检测：
 * 1. 棋盘格检测（支持多种尺寸和颜色）
 * 2. 纯色/渐变背景检测（从边缘 BFS 扩展）
 * 3. 如果都不满足，返回原图
 * 
 * @param imageUrl 图片 URL（支持 data: URL、相对路径 /uploads/xxx、完整 URL）
 * @returns 处理后的图片 URL（相对路径 /uploads/xxx）或原图 URL
 */
export async function removeCheckerboardAndMakeTransparent(imageUrl: string): Promise<string> {
  // 1. 获取图片数据
  let imageBuffer: Buffer;
  if (imageUrl.startsWith('data:')) {
    const base64Data = imageUrl.split(',')[1];
    imageBuffer = Buffer.from(base64Data, 'base64');
  } else {
    const fetchUrl = imageUrl.startsWith('/') ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}` : imageUrl;
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
    imageBuffer = Buffer.from(await resp.arrayBuffer());
  }

  // 2. 用 sharp 获取 RGBA 原始像素
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const raw = await sharp(imageBuffer).ensureAlpha().raw().toBuffer();
  const totalPixels = width * height;

  // 2.5 先检查图片是否已有真正的透明像素（alpha < 255 的非全透明像素）
  let hasRealAlpha = false;
  let transparentPixelCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    const a = raw[i * 4 + 3];
    if (a < 255) {
      transparentPixelCount++;
      if (a > 0 && a < 255) {
        // 有半透明像素 = 真正的 alpha 通道
        hasRealAlpha = true;
        break;
      }
    }
  }
  if (!hasRealAlpha && transparentPixelCount > totalPixels * 0.05) {
    // 有大量全透明像素但无半透明像素 → 可能已有透明通道
    hasRealAlpha = true;
  }

  if (hasRealAlpha) {
    console.log(`[removeBgPostProcess] Image already has alpha channel transparency, returning as-is`);
    // 图片已有透明通道，直接保存为 PNG
    const outputBuffer = await sharp(imageBuffer).png({ compressionLevel: 6 }).toBuffer();
    return await saveTransparentPng(outputBuffer, width, height);
  }

  // 3. 策略1：棋盘格检测
  const { alphaChannel: checkerAlpha, checkerPixels } = detectCheckerboard(raw, width, height);
  const checkerRatio = checkerPixels / totalPixels;
  console.log(`[removeBgPostProcess] Checkerboard: ${checkerPixels} pixels (${(checkerRatio * 100).toFixed(1)}%)`);

  // 合并策略结果
  let finalAlpha = checkerAlpha;
  let totalBgPixels = checkerPixels;

  // 4. 策略2：纯色背景检测（补充棋盘格遗漏的区域）
  if (checkerRatio > 0.02) {
    // 已检测到部分棋盘格，再用 BFS 补充连通的纯色区域
    const { alphaChannel: solidAlpha, bgPixels } = detectSolidBackground(raw, width, height, finalAlpha);
    // 合并：任一策略标记为透明的像素都变透明
    for (let i = 0; i < totalPixels; i++) {
      if (solidAlpha[i] === 0 && finalAlpha[i] !== 0) {
        finalAlpha[i] = 0;
        totalBgPixels++;
      }
    }
    console.log(`[removeBgPostProcess] Solid background BFS: +${bgPixels} pixels, total: ${totalBgPixels} (${(totalBgPixels / totalPixels * 100).toFixed(1)}%)`);
  } else if (checkerRatio < 0.02) {
    // 棋盘格检测几乎无结果，尝试纯色背景检测
    const { alphaChannel: solidAlpha, bgPixels } = detectSolidBackground(raw, width, height, finalAlpha);
    finalAlpha = solidAlpha;
    totalBgPixels = bgPixels;
    console.log(`[removeBgPostProcess] No checkerboard, trying solid background: ${bgPixels} pixels (${(bgPixels / totalPixels * 100).toFixed(1)}%)`);
  }

  // 5. 判断是否有足够的背景区域需要移除
  const bgRatio = totalBgPixels / totalPixels;
  if (bgRatio < 0.03) {
    console.log(`[removeBgPostProcess] Background ratio too low (${(bgRatio * 100).toFixed(1)}%), returning original`);
    return imageUrl;
  }

  // 6. 对 alpha 边缘做羽化
  featherAlphaEdge(raw, width, height, finalAlpha, 3);

  // 7. 重建图片，将背景区域设为透明
  const outputRaw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 4;
    outputRaw[dstIdx] = raw[srcIdx];         // R
    outputRaw[dstIdx + 1] = raw[srcIdx + 1]; // G
    outputRaw[dstIdx + 2] = raw[srcIdx + 2]; // B
    outputRaw[dstIdx + 3] = finalAlpha[i];   // A (背景=0, 主体=255, 边缘=渐变)
  }

  // 8. 输出为 PNG
  const outputBuffer = await sharp(outputRaw, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toBuffer();

  return await saveTransparentPng(outputBuffer, width, height, bgRatio);
}

/**
 * 保存透明 PNG 到文件
 */
async function saveTransparentPng(
  outputBuffer: Buffer,
  width: number,
  height: number,
  bgRatio?: number
): Promise<string> {
  const INPAINT_OUTPUT_DIR = process.env.INPAINT_OUTPUT_DIR || path.join(process.cwd(), 'public', 'uploads');
  const outputId = `removebg-transparent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputFilename = `${outputId}.png`;
  const outputPath = path.join(INPAINT_OUTPUT_DIR, outputFilename);
  await fs.mkdir(INPAINT_OUTPUT_DIR, { recursive: true });
  await fs.writeFile(outputPath, outputBuffer);

  const resultUrl = `/uploads/${outputFilename}`;
  const ratioStr = bgRatio !== undefined ? ` (${(bgRatio * 100).toFixed(1)}% background removed)` : '';
  console.log(`[removeBgPostProcess] Saved transparent PNG: ${resultUrl} [${width}x${height}]${ratioStr}`);
  return resultUrl;
}

/**
 * 创建本地背景透明化结果（兜底方案）
 * 使用简单的边缘检测+阈值方法将白色/浅色背景替换为透明
 */
export async function createLocalBackgroundAlpha(imageUrl: string): Promise<string> {
  let imageBuffer: Buffer;
  if (imageUrl.startsWith('data:')) {
    const base64Data = imageUrl.split(',')[1];
    imageBuffer = Buffer.from(base64Data, 'base64');
  } else {
    const fetchUrl = imageUrl.startsWith('/') ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}` : imageUrl;
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
    imageBuffer = Buffer.from(await resp.arrayBuffer());
  }

  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const raw = await sharp(imageBuffer).ensureAlpha().raw().toBuffer();

  // 将白色/近白色像素替换为透明（简单阈值法）
  const totalPixels = width * height;
  const outputRaw = Buffer.alloc(totalPixels * 4);
  let transparentCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = raw[idx], g = raw[idx + 1], b = raw[idx + 2];
    const brightness = (r + g + b) / 3;

    // 亮度 > 240 且饱和度极低 → 认为是白色背景
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;

    if (brightness > 240 && saturation < 0.05) {
      outputRaw[idx] = 0;
      outputRaw[idx + 1] = 0;
      outputRaw[idx + 2] = 0;
      outputRaw[idx + 3] = 0;
      transparentCount++;
    } else {
      outputRaw[idx] = r;
      outputRaw[idx + 1] = g;
      outputRaw[idx + 2] = b;
      outputRaw[idx + 3] = 255;
    }
  }

  if (transparentCount < totalPixels * 0.02) {
    console.log(`[localBgAlpha] Too few white pixels (${transparentCount}), returning original`);
    return imageUrl;
  }

  console.log(`[localBgAlpha] Made ${transparentCount} white pixels transparent`);

  const outputBuffer = await sharp(outputRaw, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toBuffer();

  return await saveTransparentPng(outputBuffer, width, height);
}
