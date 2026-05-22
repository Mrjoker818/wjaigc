/**
 * AI RemoveBG 后处理：背景检测与透明化
 * 
 * AI 模型（GPT/Gemini）去背景时通常返回 JPEG（无 alpha 通道），
 * 背景区域可能是：
 * 1. 棋盘格图案（灰色+白色 或 黑色+白色 交替方块）
 * 2. 纯色背景（白/灰/浅色）
 * 3. 棋盘格+纯色混合
 * 
 * 核心原则：**只从边缘向内扩展，遇到任何与背景色不同的像素就停止**
 * 这样主体内部的灰色/白色区域绝对不会被误删
 */
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

/**
 * 判断像素是否为"灰色"（低饱和度）
 */
function isGrayish(r: number, g: number, b: number, maxSaturation: number = 0.10): boolean {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  if (maxC === 0) return true;
  const saturation = (maxC - minC) / maxC;
  return saturation < maxSaturation;
}

/**
 * 计算两个像素的颜色距离
 */
function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * 采样图片四边的颜色，找出最常见的背景色
 * 返回背景色簇（可能有多个：如棋盘格的两种颜色）
 */
function sampleEdgeColors(
  raw: Buffer, width: number, height: number
): { clusters: { r: number; g: number; b: number; count: number }[]; grayRatio: number } {
  const BORDER = 3; // 采样边缘3像素
  const samples: { r: number; g: number; b: number }[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= BORDER && x < width - BORDER && y >= BORDER && y < height - BORDER) continue;
      const idx = (y * width + x) * 4;
      samples.push({ r: raw[idx], g: raw[idx + 1], b: raw[idx + 2] });
    }
  }
  
  if (samples.length === 0) return { clusters: [], grayRatio: 0 };
  
  // 统计灰色像素比例
  const grayCount = samples.filter(s => isGrayish(s.r, s.g, s.b, 0.12)).length;
  const grayRatio = grayCount / samples.length;
  
  // 简单聚类：将颜色距离 < 30 的归为同一簇
  const clusters: { r: number; g: number; b: number; count: number }[] = [];
  const visited = new Set<number>();
  
  for (let i = 0; i < samples.length; i++) {
    if (visited.has(i)) continue;
    const s = samples[i];
    let sumR = s.r, sumG = s.g, sumB = s.b, count = 1;
    visited.add(i);
    
    for (let j = i + 1; j < samples.length; j++) {
      if (visited.has(j)) continue;
      const t = samples[j];
      if (colorDistance(s.r, s.g, s.b, t.r, t.g, t.b) < 30) {
        sumR += t.r; sumG += t.g; sumB += t.b; count++;
        visited.add(j);
      }
    }
    
    clusters.push({
      r: Math.round(sumR / count),
      g: Math.round(sumG / count),
      b: Math.round(sumB / count),
      count
    });
  }
  
  // 按出现频率排序
  clusters.sort((a, b) => b.count - a.count);
  
  return { clusters, grayRatio };
}

/**
 * 从边缘 BFS flood-fill，将与背景色相似的连通像素标记为透明
 * 
 * 关键：只从边缘进入，遇到任何与背景色差异超过阈值的像素就停止扩展
 * 这样主体内部的灰色区域不会被误删
 */
function bfsBackgroundFromEdge(
  raw: Buffer, width: number, height: number,
  bgClusters: { r: number; g: number; b: number; count: number }[]
): Uint8Array {
  const totalPixels = width * height;
  const alphaChannel = new Uint8Array(totalPixels).fill(255);
  const visited = new Uint8Array(totalPixels);
  
  // 计算主背景簇和次背景簇（棋盘格可能有两种颜色）
  const mainBg = bgClusters[0];
  const altBg = bgClusters.length > 1 ? bgClusters[1] : null;
  
  // 严格的颜色距离阈值 - 非常关键！
  // 必须足够小以避免吃进主体，但足够大以覆盖背景的微小色彩变化
  const STRICT_THRESHOLD = 22;  // 严格模式：彩色像素与背景色距离 < 22 才视为背景
  const MEDIUM_THRESHOLD = 28;  // 中等模式：灰色像素用稍宽松阈值
  
  console.log(`[bfsBackground] Main bg: rgb(${mainBg.r},${mainBg.g},${mainBg.b}) count=${mainBg.count}`);
  if (altBg) {
    console.log(`[bfsBackground] Alt bg: rgb(${altBg.r},${altBg.g},${altBg.b}) count=${altBg.count}`);
  }
  
  // BFS 队列
  const queue: number[] = []; // 存储像素索引 (y * width + x)
  
  // 从四边开始，将与背景色匹配的像素加入队列
  const enqueueIfBackground = (pixelIdx: number) => {
    if (visited[pixelIdx]) return;
    const dataIdx = pixelIdx * 4;
    const r = raw[dataIdx], g = raw[dataIdx + 1], b = raw[dataIdx + 2];
    
    // 检查是否与主背景色匹配
    const distToMain = colorDistance(r, g, b, mainBg.r, mainBg.g, mainBg.b);
    const distToAlt = altBg ? colorDistance(r, g, b, altBg.r, altBg.g, altBg.b) : Infinity;
    const minDist = Math.min(distToMain, distToAlt);
    
    // 判断条件：颜色距离足够近 AND (灰色像素用较宽松阈值，彩色像素用严格阈值)
    const grayish = isGrayish(r, g, b, 0.12);
    const threshold = grayish ? MEDIUM_THRESHOLD : STRICT_THRESHOLD;
    
    if (minDist < threshold) {
      queue.push(pixelIdx);
    }
  };
  
  // 初始化：遍历四边像素
  for (let x = 0; x < width; x++) {
    enqueueIfBackground(x); // 上边 y=0
    enqueueIfBackground((height - 1) * width + x); // 下边
  }
  for (let y = 1; y < height - 1; y++) {
    enqueueIfBackground(y * width); // 左边 x=0
    enqueueIfBackground(y * width + width - 1); // 右边
  }
  
  // BFS 扩展
  let bgPixels = 0;
  while (queue.length > 0) {
    const pixelIdx = queue.shift()!;
    if (visited[pixelIdx]) continue;
    visited[pixelIdx] = 1;
    
    const dataIdx = pixelIdx * 4;
    const r = raw[dataIdx], g = raw[dataIdx + 1], b = raw[dataIdx + 2];
    
    // 再次检查当前像素是否与背景匹配
    const distToMain = colorDistance(r, g, b, mainBg.r, mainBg.g, mainBg.b);
    const distToAlt = altBg ? colorDistance(r, g, b, altBg.r, altBg.g, altBg.b) : Infinity;
    const minDist = Math.min(distToMain, distToAlt);
    
    const grayish = isGrayish(r, g, b, 0.12);
    const threshold = grayish ? MEDIUM_THRESHOLD : STRICT_THRESHOLD;
    
    if (minDist >= threshold) {
      // 不匹配背景色，停止扩展（主体边界）
      continue;
    }
    
    // 标记为透明
    alphaChannel[pixelIdx] = 0;
    bgPixels++;
    
    // 扩展到4邻域
    const x = pixelIdx % width;
    const y = Math.floor(pixelIdx / width);
    if (x > 0) enqueueIfBackground(pixelIdx - 1);
    if (x < width - 1) enqueueIfBackground(pixelIdx + 1);
    if (y > 0) enqueueIfBackground(pixelIdx - width);
    if (y < height - 1) enqueueIfBackground(pixelIdx + width);
  }
  
  console.log(`[bfsBackground] BFS found ${bgPixels} background pixels (${(bgPixels / totalPixels * 100).toFixed(1)}%)`);
  return alphaChannel;
}

/**
 * 对 alpha 通道做边缘羽化（抗锯齿）
 * 只对紧邻透明区域的不透明像素做微调
 */
function featherAlphaEdge(
  raw: Buffer, width: number, height: number,
  alphaChannel: Uint8Array, radius: number = 2
): void {
  const origAlpha = Buffer.from(alphaChannel);
  
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      const idx = y * width + x;
      if (origAlpha[idx] !== 255) continue; // 只处理不透明像素

      // 检查周围是否有透明像素
      let minDist = radius + 1;
      let hasTransparentNeighbor = false;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dy === 0 && dx === 0) continue;
          const ni = (y + dy) * width + (x + dx);
          if (origAlpha[ni] === 0) {
            hasTransparentNeighbor = true;
            const dist = Math.sqrt(dx * dx + dy * dy);
            minDist = Math.min(minDist, dist);
          }
        }
      }

      if (hasTransparentNeighbor && minDist <= radius) {
        const featherAlpha = Math.round(255 * Math.min(1, minDist / radius));
        alphaChannel[idx] = featherAlpha;

        // 预乘颜色混合，避免灰边
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
 * 策略：
 * 1. 采样图片边缘颜色，找出背景色簇
 * 2. 从边缘 BFS flood-fill，只移除与背景色匹配的连通区域
 * 3. 羽化边缘，输出透明 PNG
 * 
 * @param imageUrl 图片 URL
 * @returns 处理后的图片 URL 或原图 URL
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

  // 2.5 先检查图片是否已有真正的透明像素
  let hasRealAlpha = false;
  let transparentPixelCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    const a = raw[i * 4 + 3];
    if (a < 255) {
      transparentPixelCount++;
      if (a > 0 && a < 255) {
        hasRealAlpha = true;
        break;
      }
    }
  }
  if (!hasRealAlpha && transparentPixelCount > totalPixels * 0.05) {
    hasRealAlpha = true;
  }

  if (hasRealAlpha) {
    console.log(`[removeBgPostProcess] Image already has alpha channel transparency, returning as-is`);
    const outputBuffer = await sharp(imageBuffer).png({ compressionLevel: 6 }).toBuffer();
    return await saveTransparentPng(outputBuffer, width, height);
  }

  // 3. 采样边缘颜色，找出背景色簇
  const { clusters, grayRatio } = sampleEdgeColors(raw, width, height);
  console.log(`[removeBgPostProcess] Edge sampling: ${clusters.length} clusters, grayRatio=${(grayRatio * 100).toFixed(0)}%`);
  
  // 如果边缘灰色像素不足 30%，可能不是典型的去背景结果
  if (clusters.length === 0) {
    console.log(`[removeBgPostProcess] No edge color clusters found, returning original`);
    return imageUrl;
  }
  
  // 4. 取前2个最大的簇作为背景色（棋盘格通常有两种颜色）
  const bgClusters = clusters.slice(0, 2);
  
  // 5. 从边缘 BFS，将与背景色匹配的连通区域标记为透明
  const alphaChannel = bfsBackgroundFromEdge(raw, width, height, bgClusters);
  
  // 统计背景移除量
  let bgPixels = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (alphaChannel[i] === 0) bgPixels++;
  }
  const bgRatio = bgPixels / totalPixels;
  
  if (bgRatio < 0.03) {
    console.log(`[removeBgPostProcess] Background ratio too low (${(bgRatio * 100).toFixed(1)}%), returning original`);
    return imageUrl;
  }
  
  console.log(`[removeBgPostProcess] Total background removed: ${bgPixels} pixels (${(bgRatio * 100).toFixed(1)}%)`);
  
  // 6. 羽化边缘
  featherAlphaEdge(raw, width, height, alphaChannel, 2);
  
  // 7. 重建图片，将背景区域设为透明
  const outputRaw = Buffer.alloc(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 4;
    outputRaw[dstIdx] = raw[srcIdx];         // R
    outputRaw[dstIdx + 1] = raw[srcIdx + 1]; // G
    outputRaw[dstIdx + 2] = raw[srcIdx + 2]; // B
    outputRaw[dstIdx + 3] = alphaChannel[i]; // A
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
 * 使用简单的阈值方法将白色/浅色背景替换为透明
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

  // 使用与主函数相同的 BFS 策略，而不是简单阈值法
  const { clusters } = sampleEdgeColors(raw, width, height);
  if (clusters.length === 0) {
    console.log(`[localBgAlpha] No edge color clusters, returning original`);
    return imageUrl;
  }

  const bgClusters = clusters.slice(0, 2);
  const alphaChannel = bfsBackgroundFromEdge(raw, width, height, bgClusters);
  
  let transparentCount = 0;
  for (let i = 0; i < width * height; i++) {
    if (alphaChannel[i] === 0) transparentCount++;
  }
  
  if (transparentCount < width * height * 0.02) {
    console.log(`[localBgAlpha] Too few background pixels (${transparentCount}), returning original`);
    return imageUrl;
  }

  featherAlphaEdge(raw, width, height, alphaChannel, 2);

  const totalPixels = width * height;
  const outputRaw = Buffer.alloc(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 4;
    outputRaw[dstIdx] = raw[srcIdx];
    outputRaw[dstIdx + 1] = raw[srcIdx + 1];
    outputRaw[dstIdx + 2] = raw[srcIdx + 2];
    outputRaw[dstIdx + 3] = alphaChannel[i];
  }

  const outputBuffer = await sharp(outputRaw, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toBuffer();

  return await saveTransparentPng(outputBuffer, width, height);
}
