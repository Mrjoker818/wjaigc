import sharp from 'sharp';
import { saveImageFile } from '@/lib/server-data-root';
import { isS3Available, uploadImageToS3 } from '@/lib/s3-storage';
import crypto from 'crypto';

/**
 * 将图片 Buffer 持久化保存，优先 S3 → 本地文件 → base64 data URL 兜底
 */
async function persistBuffer(buffer: Buffer, filename: string, subDir: string, mimeType: string = 'image/png'): Promise<string> {
  if (await isS3Available()) {
    try {
      const s3Url = await uploadImageToS3(buffer, filename, mimeType);
      if (s3Url) return s3Url;
    } catch (e) {
      console.warn(`[remove-bg-postprocess] S3 upload failed for ${filename}:`, e);
    }
  }
  try {
    const localUrl = saveImageFile(buffer, filename, subDir);
    if (localUrl) return localUrl;
  } catch (e) {
    console.warn(`[remove-bg-postprocess] Local save failed for ${filename}:`, e);
  }
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

/**
 * AI RemoveBG 后处理：将 AI 结果的棋盘格/纯色背景转为透明 PNG
 *
 * 核心原则：AI 已正确识别主体，后处理只删除明确的背景像素，
 * 绝不删除任何可能是主体的像素。宁可保留少量背景，也不误删主体。
 *
 * 策略优先级：
 * 1. 检测图片已有 alpha 透明 → 直接输出 PNG（无需处理）
 * 2. 精准棋盘格检测 → 只删除棋盘格图案像素
 * 3. 纯色边缘 BFS → 只删除与边缘连通、颜色精确匹配的背景像素
 * 4. 兜底 → 转为 PNG 全不透明输出（绝不误删）
 *
 * 返回持久化后的 URL string
 */
export async function postProcessAIRemoveBG(
  imageInput: Buffer | string,
  _options: {
    maskDilatePx?: number;
    featherPx?: number;
  } = {}
): Promise<string | null> {
  // 支持 URL 或 Buffer 输入
  let imageBuffer: Buffer;
  if (typeof imageInput === 'string') {
    let fetchUrl = imageInput;
    if (imageInput.startsWith('/')) {
      const port = process.env.DEPLOY_RUN_PORT || '5000';
      fetchUrl = `http://127.0.0.1:${port}${imageInput}`;
    }
    console.log(`[ai-rmbg-post] Fetching image from URL: ${fetchUrl.substring(0, 100)}...`);
    const resp = await fetch(fetchUrl);
    if (!resp.ok) {
      console.error(`[ai-rmbg-post] Failed to fetch image: ${resp.status}`);
      return null;
    }
    imageBuffer = Buffer.from(await resp.arrayBuffer());
  } else {
    imageBuffer = imageInput;
  }

  console.log(`[ai-rmbg-post] Starting conservative background removal (input=${imageBuffer.length} bytes)`);

  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const { width = 1, height = 1, channels = 3 } = metadata;

    // 策略 1: 如果图片已有 alpha 通道且有透明像素，直接持久化输出 PNG
    if (channels === 4) {
      const { data: rawData, info: alphaInfo } = await image.raw().toBuffer({ resolveWithObject: true });
      const data = rawData as unknown as Uint8Array;
      let hasTransparent = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 200) { hasTransparent = true; break; }
      }
      if (hasTransparent) {
        console.log('[ai-rmbg-post] Image already has transparency, outputting directly as PNG');
        const pngBuffer = await sharp(imageBuffer).png().toBuffer();
        const uid = crypto.randomBytes(8).toString('hex');
        return await persistBuffer(pngBuffer, `rmbg-${uid}.png`, 'removebg');
      }
    }

    // 读取 RGBA 数据
    const { data: rawData, info } = await sharp(imageBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const data = rawData as unknown as Uint8Array;
    const w = info.width;
    const h = info.height;
    const uid = crypto.randomBytes(8).toString('hex');

    // 策略 2: 精准棋盘格检测
    const checkerboardResult = detectAndRemoveCheckerboard(data, w, h);
    if (checkerboardResult !== null) {
      const resultBuffer = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
        .png()
        .toBuffer();
      console.log(`[ai-rmbg-post] Checkerboard detected and removed: ${checkerboardResult.pct.toFixed(1)}% background removed (grid=${checkerboardResult.gridSize})`);
      return await persistBuffer(resultBuffer, `rmbg-${uid}.png`, 'removebg');
    }

    // 策略 3: 纯色边缘 BFS（极其保守）
    const bfsResult = conservativeEdgeBFS(data, w, h);
    if (bfsResult !== null && bfsResult.pct > 0) {
      const resultBuffer = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
        .png()
        .toBuffer();
      console.log(`[ai-rmbg-post] Solid background removed: ${bfsResult.pct.toFixed(1)}% background removed (color=${bfsResult.bgColor})`);
      return await persistBuffer(resultBuffer, `rmbg-${uid}.png`, 'removebg');
    }

    // 策略 4: 兜底 — 转为 PNG 全不透明（绝不误删主体）
    console.log('[ai-rmbg-post] No clear background pattern detected, outputting as opaque PNG (safe fallback)');
    const fallbackBuffer = await sharp(imageBuffer).ensureAlpha().png().toBuffer();
    return await persistBuffer(fallbackBuffer, `rmbg-${uid}.png`, 'removebg');

  } catch (err) {
    console.error('[ai-rmbg-post] Error:', (err as Error).message);
    return null;
  }
}

/**
 * 精准棋盘格检测与移除
 *
 * 棋盘格特征：两种颜色在规则网格上交替排列。
 * 检测步骤：
 * 1. 扫描多种常见网格尺寸（4~24px）
 * 2. 对每个候选尺寸，采样计算两种候选色
 * 3. 逐像素验证：位置在网格奇偶性 + 颜色匹配两个条件都满足才标记为棋盘格
 * 4. 需要显著比例的像素匹配才算检测成功（>15%）
 *
 * 返回 null 表示未检测到棋盘格
 */
function detectAndRemoveCheckerboard(
  data: Uint8Array,
  w: number,
  h: number
): { pct: number; gridSize: number } | null {
  const CANDIDATE_SIZES = [4, 6, 8, 10, 12, 14, 16, 20, 24];
  const MIN_MATCH_RATIO = 0.15; // 至少 15% 像素匹配才算棋盘格

  let bestGrid = 0;
  let bestPct = 0;

  for (const gs of CANDIDATE_SIZES) {
    if (gs > w / 4 || gs > h / 4) continue; // 网格不能太大

    // 采样提取两种候选颜色
    // 取 (0,0) 和 (gs,0) 两个位置的局部区域均值
    const sampleA = sampleRegion(data, w, h, Math.floor(gs / 2), Math.floor(gs / 2), gs);
    const sampleB = sampleRegion(data, w, h, gs + Math.floor(gs / 2), Math.floor(gs / 2), gs);

    if (!sampleA || !sampleB) continue;

    // 两种候选色必须有足够差异（>20）
    const colorDiff = Math.sqrt(
      (sampleA[0] - sampleB[0]) ** 2 +
      (sampleA[1] - sampleB[1]) ** 2 +
      (sampleA[2] - sampleB[2]) ** 2
    );
    if (colorDiff < 20) continue;

    // 逐像素验证棋盘格模式
    let matchCount = 0;
    const totalPixels = w * h;
    const TOLERANCE = 25; // 颜色容差

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];

        // 确定此像素在棋盘格上的"颜色组"
        const gridX = Math.floor(x / gs);
        const gridY = Math.floor(y / gs);
        const isEvenCell = (gridX + gridY) % 2 === 0;

        // 检查颜色是否匹配对应组的候选色
        const ref = isEvenCell ? sampleA : sampleB;
        const dist = Math.sqrt((r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2);

        if (dist < TOLERANCE) {
          matchCount++;
        }
      }
    }

    const matchPct = matchCount / totalPixels;
    if (matchPct > bestPct && matchPct >= MIN_MATCH_RATIO) {
      bestPct = matchPct;
      bestGrid = gs;
    }
  }

  if (bestGrid === 0) return null;

  // 用最佳网格尺寸执行删除
  const sampleA = sampleRegion(data, w, h, Math.floor(bestGrid / 2), Math.floor(bestGrid / 2), bestGrid)!;
  const sampleB = sampleRegion(data, w, h, bestGrid + Math.floor(bestGrid / 2), Math.floor(bestGrid / 2), bestGrid)!;

  // 先标记所有匹配棋盘格模式的像素
  const cbMatch = new Uint8Array(w * h); // 1=匹配棋盘格
  const TOLERANCE = 25;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];

      const gridX = Math.floor(x / bestGrid);
      const gridY = Math.floor(y / bestGrid);
      const isEvenCell = (gridX + gridY) % 2 === 0;

      const ref = isEvenCell ? sampleA : sampleB;
      const dist = Math.sqrt((r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2);

      if (dist < TOLERANCE) {
        cbMatch[y * w + x] = 1;
      }
    }
  }

  // 关键保护：只删除与图片边缘连通的棋盘格像素
  // 主体内部的像素即使颜色恰好匹配棋盘格，也不删除
  const visited = new Uint8Array(w * h);
  const edgeConnected = new Uint8Array(w * h); // 与边缘连通的棋盘格
  const queue: number[] = [];

  // 从四边开始 BFS
  for (let x = 0; x < w; x++) {
    const topIdx = x;
    const bottomIdx = (h - 1) * w + x;
    if (cbMatch[topIdx] && !visited[topIdx]) { visited[topIdx] = 1; edgeConnected[topIdx] = 1; queue.push(topIdx); }
    if (cbMatch[bottomIdx] && !visited[bottomIdx]) { visited[bottomIdx] = 1; edgeConnected[bottomIdx] = 1; queue.push(bottomIdx); }
  }
  for (let y = 0; y < h; y++) {
    const leftIdx = y * w;
    const rightIdx = y * w + (w - 1);
    if (cbMatch[leftIdx] && !visited[leftIdx]) { visited[leftIdx] = 1; edgeConnected[leftIdx] = 1; queue.push(leftIdx); }
    if (cbMatch[rightIdx] && !visited[rightIdx]) { visited[rightIdx] = 1; edgeConnected[rightIdx] = 1; queue.push(rightIdx); }
  }

  // BFS 扩展连通区域
  let head = 0;
  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % w;
    const y = Math.floor(idx / w);
    for (let dir = 0; dir < 4; dir++) {
      const nx = x + dx[dir];
      const ny = y + dy[dir];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      if (cbMatch[nIdx]) {
        edgeConnected[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  // 只删除与边缘连通的棋盘格像素
  let removedCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (edgeConnected[i]) {
      data[i * 4 + 3] = 0; // 设为透明
      removedCount++;
    }
  }

  // 对透明边缘做轻微羽化（2px），避免硬边
  applyEdgeFeather(data, w, h, 2);

  const pct = (removedCount / (w * h) * 100);
  return { pct, gridSize: bestGrid };
}

/**
 * 采样图片中一个矩形区域的平均颜色
 */
function sampleRegion(
  data: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  size: number
): [number, number, number] | null {
  const half = Math.floor(size / 2);
  const x0 = Math.max(0, cx - half);
  const y0 = Math.max(0, cy - half);
  const x1 = Math.min(w, cx + half);
  const y1 = Math.min(h, cy + half);

  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * w + x) * 4;
      rSum += data[idx];
      gSum += data[idx + 1];
      bSum += data[idx + 2];
      count++;
    }
  }

  if (count === 0) return null;
  return [Math.round(rSum / count), Math.round(gSum / count), Math.round(bSum / count)];
}

/**
 * 保守的纯色边缘 BFS
 *
 * 只删除同时满足以下所有条件的像素：
 * 1. 与图片四角的背景色精确匹配（容差极小：灰色≤12，彩色≤8）
 * 2. 与图片边缘连通（BFS 从边缘出发，不跳跃）
 * 3. 像素在局部 3x3 区域内颜色均匀（无纹理/细节）
 *
 * 不会删除：
 * - 与背景色相近但不完全匹配的像素
 * - 不与边缘连通的像素
 * - 有纹理/细节的像素（即使颜色匹配）
 */
function conservativeEdgeBFS(
  data: Uint8Array,
  w: number,
  h: number
): { pct: number; bgColor: string } | null {
  // 采样四角区域，计算背景色
  const CORNER_SIZE = Math.max(3, Math.min(10, Math.floor(Math.min(w, h) / 50)));

  const corners: number[][] = [];
  for (const [cx, cy] of [
    [0, 0], [w - CORNER_SIZE, 0],
    [0, h - CORNER_SIZE], [w - CORNER_SIZE, h - CORNER_SIZE]
  ]) {
    const sample = sampleRegion(data, w, h, cx + Math.floor(CORNER_SIZE / 2), cy + Math.floor(CORNER_SIZE / 2), CORNER_SIZE);
    if (sample) corners.push(sample);
  }

  if (corners.length === 0) return null;

  // 找到四角颜色的聚类中心（取中位数更鲁棒）
  const bgR = median(corners.map(c => c[0]));
  const bgG = median(corners.map(c => c[1]));
  const bgB = median(corners.map(c => c[2]));

  const bgColorStr = `rgb(${bgR},${bgG},${bgB})`;
  console.log(`[conservative-bfs] Background color from corners: ${bgColorStr}`);

  // 判断背景是灰色还是彩色
  const maxC = Math.max(bgR, bgG, bgB);
  const minC = Math.min(bgR, bgG, bgB);
  const isGray = (maxC - minC) < 30;
  // 极其保守的容差：灰色 12，彩色 8
  const COLOR_THRESHOLD = isGray ? 12 : 8;

  // BFS 从四条边出发
  const visited = new Uint8Array(w * h);
  const bgMask = new Uint8Array(w * h); // 1=背景
  const queue: number[] = [];

  // 判断像素是否可能是背景（颜色匹配 + 局部均匀）
  const isCandidateBg = (idx: number): boolean => {
    const px = idx * 4;
    const r = data[px], g = data[px + 1], b = data[px + 2];
    const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
    if (dist > COLOR_THRESHOLD) return false;

    // 局部均匀性检查：3x3 邻域颜色方差不能太大
    // 这可以防止将主体中与背景色相同的纹理区域误判为背景
    const x = idx % w;
    const y = Math.floor(idx / w);
    let rVar = 0, gVar = 0, bVar = 0, count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = (ny * w + nx) * 4;
        rVar += Math.abs(data[ni] - r);
        gVar += Math.abs(data[ni + 1] - g);
        bVar += Math.abs(data[ni + 2] - b);
        count++;
      }
    }
    const avgVar = (rVar + gVar + bVar) / (count * 3);
    // 局部方差阈值：背景区域应该非常均匀（方差 < 5）
    // 主体区域即使颜色相近，也会有纹理细节
    return avgVar < 5;
  };

  // 从四边初始化
  for (let x = 0; x < w; x++) {
    const topIdx = x;
    const bottomIdx = (h - 1) * w + x;
    if (isCandidateBg(topIdx)) { visited[topIdx] = 1; bgMask[topIdx] = 1; queue.push(topIdx); }
    if (isCandidateBg(bottomIdx)) { visited[bottomIdx] = 1; bgMask[bottomIdx] = 1; queue.push(bottomIdx); }
  }
  for (let y = 0; y < h; y++) {
    const leftIdx = y * w;
    const rightIdx = y * w + (w - 1);
    if (isCandidateBg(leftIdx)) { visited[leftIdx] = 1; bgMask[leftIdx] = 1; queue.push(leftIdx); }
    if (isCandidateBg(rightIdx)) { visited[rightIdx] = 1; bgMask[rightIdx] = 1; queue.push(rightIdx); }
  }

  if (queue.length === 0) {
    console.log('[conservative-bfs] No background pixels found at edges');
    return null;
  }

  // BFS 扩展
  let head = 0;
  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];

  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % w;
    const y = Math.floor(idx / w);
    for (let dir = 0; dir < 4; dir++) {
      const nx = x + dx[dir];
      const ny = y + dy[dir];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      if (isCandidateBg(nIdx)) {
        bgMask[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  // 统计并应用
  let removedCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (bgMask[i]) {
      data[i * 4 + 3] = 0; // 透明
      removedCount++;
    }
  }

  // 羽化边缘
  applyEdgeFeather(data, w, h, 2);

  const pct = (removedCount / (w * h) * 100);
  if (pct < 0.5) {
    // 删除的太少，可能不是纯色背景
    console.log(`[conservative-bfs] Only ${pct.toFixed(1)}% removed, not a solid background`);
    // 恢复 alpha
    for (let i = 0; i < w * h; i++) {
      data[i * 4 + 3] = 255;
    }
    return null;
  }

  return { pct, bgColor: bgColorStr };
}

/**
 * 对透明/不透明边界做羽化
 * 在 alpha=0 和 alpha=255 的边界做 2px 渐变，避免硬边锯齿
 */
function applyEdgeFeather(data: Uint8Array, w: number, h: number, featherPx: number): void {
  if (featherPx <= 0) return;

  // 识别边缘：透明像素旁边的非透明像素
  const isTransparent = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    isTransparent[i] = data[i * 4 + 3] < 128 ? 1 : 0;
  }

  // BFS 从透明区域计算距离
  const dist = new Int16Array(w * h).fill(-1);
  const queue: number[] = [];

  for (let i = 0; i < w * h; i++) {
    if (isTransparent[i]) {
      dist[i] = 0;
      queue.push(i);
    }
  }

  let head = 0;
  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];

  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % w;
    const y = Math.floor(idx / w);
    const d = dist[idx];
    if (d >= featherPx) continue;

    for (let dir = 0; dir < 4; dir++) {
      const nx = x + dx[dir];
      const ny = y + dy[dir];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (dist[nIdx] >= 0) continue;
      dist[nIdx] = d + 1;
      queue.push(nIdx);
    }
  }

  // 对边缘附近的不透明像素做 alpha 渐变
  for (let i = 0; i < w * h; i++) {
    if (isTransparent[i]) continue; // 已经透明
    const d = dist[i];
    if (d > 0 && d <= featherPx) {
      // 距离越近越透明
      const ratio = d / featherPx; // 0→1 (越远越不透明)
      data[i * 4 + 3] = Math.round(ratio * 255);
    }
  }
}

/**
 * 计算中位数
 */
function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * 本地 RemoveBG 的透明化兜底（保守纯色检测）
 */
export async function createLocalTransparentBg(
  imageBuffer: Buffer
): Promise<{ buffer: Buffer; format: 'png' } | null> {
  try {
    const image = sharp(imageBuffer);
    const { data: rawData, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const data = rawData as unknown as Uint8Array;
    const { width, height } = info;

    // 使用保守边缘 BFS
    const result = conservativeEdgeBFS(data, width, height);
    if (result && result.pct > 0) {
      const resultBuffer = await sharp(data, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
      console.log(`[local-transparent] Removed ${result.pct}% background (color=${result.bgColor})`);
      return { buffer: resultBuffer, format: 'png' };
    }

    // 无法检测纯色背景，尝试棋盘格
    const cbResult = detectAndRemoveCheckerboard(data, width, height);
    if (cbResult) {
      const resultBuffer = await sharp(data, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
      console.log(`[local-transparent] Checkerboard removed: ${cbResult.pct}% (grid=${cbResult.gridSize})`);
      return { buffer: resultBuffer, format: 'png' };
    }

    // 兜底：转 PNG 全不透明
    console.log('[local-transparent] No background pattern detected, outputting as opaque PNG');
    const fallbackBuffer = await sharp(imageBuffer).ensureAlpha().png().toBuffer();
    return { buffer: fallbackBuffer, format: 'png' };

  } catch (err) {
    console.error('[local-transparent] Error:', (err as Error).message);
    return null;
  }
}
