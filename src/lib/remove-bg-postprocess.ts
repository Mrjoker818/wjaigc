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
 * 1. 检测图片已有 alpha 透明 → 直接输出 PNG
 * 2. 精准棋盘格检测 → 只删除棋盘格图案像素
 * 3. 纯色边缘 BFS（动态阈值 + 安全腐蚀）→ 只删除与边缘连通的背景像素
 * 4. 兜底 → 转为 PNG 全不透明输出
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

  console.log(`[ai-rmbg-post] Starting background removal (input=${imageBuffer.length} bytes)`);

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
      console.log(`[ai-rmbg-post] Checkerboard detected and removed: ${checkerboardResult.pct.toFixed(1)}% (grid=${checkerboardResult.gridSize})`);
      return await persistBuffer(resultBuffer, `rmbg-${uid}.png`, 'removebg');
    }

    // 策略 3: 纯色边缘 BFS（动态阈值 + 安全腐蚀）
    const bfsResult = smartEdgeBFS(data, w, h);
    if (bfsResult !== null && bfsResult.pct > 0) {
      const resultBuffer = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
        .png()
        .toBuffer();
      console.log(`[ai-rmbg-post] Solid background removed: ${bfsResult.pct.toFixed(1)}% (color=${bfsResult.bgColor}, threshold=${bfsResult.threshold})`);
      return await persistBuffer(resultBuffer, `rmbg-${uid}.png`, 'removebg');
    }

    // 策略 4: 兜底 — 转为 PNG 全不透明
    console.log('[ai-rmbg-post] No clear background pattern detected, outputting as opaque PNG (safe fallback)');
    const fallbackBuffer = await sharp(imageBuffer).ensureAlpha().png().toBuffer();
    return await persistBuffer(fallbackBuffer, `rmbg-${uid}.png`, 'removebg');

  } catch (err) {
    console.error('[ai-rmbg-post] Error:', (err as Error).message);
    return null;
  }
}

// ============================================================
// 棋盘格检测
// ============================================================

/**
 * 精准棋盘格检测与移除
 *
 * 棋盘格特征：两种颜色在规则网格上交替排列。
 * 只删除与边缘连通的棋盘格像素，主体内部即使颜色匹配也不删。
 */
function detectAndRemoveCheckerboard(
  data: Uint8Array,
  w: number,
  h: number
): { pct: number; gridSize: number } | null {
  const CANDIDATE_SIZES = [4, 6, 8, 10, 12, 14, 16, 20, 24];
  const MIN_MATCH_RATIO = 0.15;

  let bestGrid = 0;
  let bestPct = 0;

  for (const gs of CANDIDATE_SIZES) {
    if (gs > w / 4 || gs > h / 4) continue;

    const sampleA = sampleRegion(data, w, h, Math.floor(gs / 2), Math.floor(gs / 2), gs);
    const sampleB = sampleRegion(data, w, h, gs + Math.floor(gs / 2), Math.floor(gs / 2), gs);

    if (!sampleA || !sampleB) continue;

    const colorDiff = Math.sqrt(
      (sampleA[0] - sampleB[0]) ** 2 +
      (sampleA[1] - sampleB[1]) ** 2 +
      (sampleA[2] - sampleB[2]) ** 2
    );
    if (colorDiff < 20) continue;

    let matchCount = 0;
    const totalPixels = w * h;
    const TOLERANCE = 25;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const gridX = Math.floor(x / gs);
        const gridY = Math.floor(y / gs);
        const isEvenCell = (gridX + gridY) % 2 === 0;
        const ref = isEvenCell ? sampleA : sampleB;
        const dist = Math.sqrt((r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2);
        if (dist < TOLERANCE) matchCount++;
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

  // 标记所有匹配棋盘格的像素
  const cbMatch = new Uint8Array(w * h);
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
      if (dist < TOLERANCE) cbMatch[y * w + x] = 1;
    }
  }

  // 只删除与边缘连通的棋盘格像素
  const edgeConnected = floodFillFromEdges(cbMatch, w, h);

  let removedCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (edgeConnected[i]) {
      data[i * 4 + 3] = 0;
      removedCount++;
    }
  }

  // 对透明边缘做羽化
  applyEdgeFeather(data, w, h, 2);

  const pct = (removedCount / (w * h) * 100);
  return { pct, gridSize: bestGrid };
}

// ============================================================
// 纯色边缘 BFS（动态阈值 + 安全腐蚀）
// ============================================================

/**
 * 智能纯色边缘 BFS
 *
 * 核心改进（相比上一版）：
 * 1. 环形边框采样 — 不只四角，更鲁棒
 * 2. 动态阈值 — 深色背景（黑底）用更紧的阈值，避免误删暗色主体
 * 3. 无局部均匀性检查 — 上一版的 avgVar<5 是黑底检测失败的根因
 * 4. 安全腐蚀 — BFS 结束后从蒙版边缘回退 2px，绝不触碰主体
 */
function smartEdgeBFS(
  data: Uint8Array,
  w: number,
  h: number
): { pct: number; bgColor: string; threshold: number } | null {

  // ---- Step 1: 环形边框采样背景色 ----
  // 从图片四条边的 2px 带状区域采样，比四角更鲁棒
  const BORDER_STRIP = 2;
  const borderSamples: number[][] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 只取边缘 2px 带的像素
      if (x >= BORDER_STRIP && x < w - BORDER_STRIP &&
          y >= BORDER_STRIP && y < h - BORDER_STRIP) continue;

      const idx = (y * w + x) * 4;
      borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  if (borderSamples.length < 10) return null;

  // 聚类找主色：用简单的量化 + 投票
  const quantized = borderSamples.map(([r, g, b]) => {
    // 量化到 16 级
    const qr = Math.round(r / 16) * 16;
    const qg = Math.round(g / 16) * 16;
    const qb = Math.round(b / 16) * 16;
    return `${qr},${qg},${qb}`;
  });

  // 统计每个量化颜色出现的次数
  const colorCounts: Record<string, { count: number; rSum: number; gSum: number; bSum: number }> = {};
  borderSamples.forEach(([r, g, b], i) => {
    const key = quantized[i];
    if (!colorCounts[key]) {
      colorCounts[key] = { count: 0, rSum: 0, gSum: 0, bSum: 0 };
    }
    colorCounts[key].count++;
    colorCounts[key].rSum += r;
    colorCounts[key].gSum += g;
    colorCounts[key].bSum += b;
  });

  // 找到出现最多的颜色（背景色）
  let maxCount = 0;
  let bgR = 0, bgG = 0, bgB = 0;
  for (const key in colorCounts) {
    const entry = colorCounts[key];
    if (entry.count > maxCount) {
      maxCount = entry.count;
      bgR = Math.round(entry.rSum / entry.count);
      bgG = Math.round(entry.gSum / entry.count);
      bgB = Math.round(entry.bSum / entry.count);
    }
  }

  // 背景色必须占据边框像素的显著比例（>30%）
  const borderTotal = borderSamples.length;
  const bgRatio = maxCount / borderTotal;
  if (bgRatio < 0.3) {
    console.log(`[smart-bfs] Border dominant color only ${ (bgRatio * 100).toFixed(1) }%, not a uniform background`);
    return null;
  }

  const bgColorStr = `rgb(${bgR},${bgG},${bgB})`;
  console.log(`[smart-bfs] Background color from border: ${bgColorStr} (${(bgRatio * 100).toFixed(0)}% of border pixels)`);

  // ---- Step 2: 动态阈值计算 ----
  // 根据背景色亮度自适应调整：
  //   深色背景（亮度<30）→ 阈值 5（极紧，保护暗色主体）
  //   中深背景（30-80）  → 阈值 7
  //   中等背景（80-180） → 阈值 8
  //   浅色背景（180-255）→ 阈值 10
  const bgBrightness = (bgR + bgG + bgB) / 3;
  let COLOR_THRESHOLD: number;
  if (bgBrightness < 30) {
    COLOR_THRESHOLD = 5;
  } else if (bgBrightness < 80) {
    COLOR_THRESHOLD = 7;
  } else if (bgBrightness < 180) {
    COLOR_THRESHOLD = 8;
  } else {
    COLOR_THRESHOLD = 10;
  }

  // 额外安全：如果是纯黑背景，进一步收紧
  if (bgR <= 5 && bgG <= 5 && bgB <= 5) {
    COLOR_THRESHOLD = 4;
  }

  console.log(`[smart-bfs] Background brightness=${bgBrightness.toFixed(0)}, threshold=${COLOR_THRESHOLD}`);

  // ---- Step 3: BFS 从四条边出发 ----
  // 纯颜色匹配，无局部均匀性检查
  const visited = new Uint8Array(w * h);
  const bgMask = new Uint8Array(w * h); // 1=背景候选
  const queue: number[] = [];

  const isMatchBg = (idx: number): boolean => {
    const px = idx * 4;
    const r = data[px], g = data[px + 1], b = data[px + 2];
    const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
    return dist <= COLOR_THRESHOLD;
  };

  // 从四边初始化 BFS
  for (let x = 0; x < w; x++) {
    const topIdx = x;
    const bottomIdx = (h - 1) * w + x;
    if (isMatchBg(topIdx) && !visited[topIdx]) { visited[topIdx] = 1; bgMask[topIdx] = 1; queue.push(topIdx); }
    if (isMatchBg(bottomIdx) && !visited[bottomIdx]) { visited[bottomIdx] = 1; bgMask[bottomIdx] = 1; queue.push(bottomIdx); }
    // 第 2 行也加入
    if (h > 2) {
      const topIdx2 = w + x;
      const bottomIdx2 = (h - 2) * w + x;
      if (isMatchBg(topIdx2) && !visited[topIdx2]) { visited[topIdx2] = 1; bgMask[topIdx2] = 1; queue.push(topIdx2); }
      if (isMatchBg(bottomIdx2) && !visited[bottomIdx2]) { visited[bottomIdx2] = 1; bgMask[bottomIdx2] = 1; queue.push(bottomIdx2); }
    }
  }
  for (let y = 0; y < h; y++) {
    const leftIdx = y * w;
    const rightIdx = y * w + (w - 1);
    if (isMatchBg(leftIdx) && !visited[leftIdx]) { visited[leftIdx] = 1; bgMask[leftIdx] = 1; queue.push(leftIdx); }
    if (isMatchBg(rightIdx) && !visited[rightIdx]) { visited[rightIdx] = 1; bgMask[rightIdx] = 1; queue.push(rightIdx); }
    if (w > 2) {
      const leftIdx2 = y * w + 1;
      const rightIdx2 = y * w + (w - 2);
      if (isMatchBg(leftIdx2) && !visited[leftIdx2]) { visited[leftIdx2] = 1; bgMask[leftIdx2] = 1; queue.push(leftIdx2); }
      if (isMatchBg(rightIdx2) && !visited[rightIdx2]) { visited[rightIdx2] = 1; bgMask[rightIdx2] = 1; queue.push(rightIdx2); }
    }
  }

  if (queue.length === 0) {
    console.log('[smart-bfs] No background pixels found at edges');
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
      if (isMatchBg(nIdx)) {
        bgMask[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  // ---- Step 4: 安全腐蚀 — 从蒙版边缘回退 2px ----
  // 防止主体边缘有少量颜色接近背景的像素被误删
  const ERODE_PX = 2;
  const erodedMask = erodeMask(bgMask, w, h, ERODE_PX);

  // ---- Step 5: 应用蒙版 ----
  let removedCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (erodedMask[i]) {
      data[i * 4 + 3] = 0; // 透明
      removedCount++;
    }
  }

  // 羽化边缘
  applyEdgeFeather(data, w, h, 2);

  const pct = (removedCount / (w * h) * 100);
  if (pct < 0.5) {
    // 删除的太少，可能不是纯色背景
    console.log(`[smart-bfs] Only ${pct.toFixed(1)}% removed, not a solid background`);
    // 恢复 alpha
    for (let i = 0; i < w * h; i++) {
      data[i * 4 + 3] = 255;
    }
    return null;
  }

  return { pct, bgColor: bgColorStr, threshold: COLOR_THRESHOLD };
}

// ============================================================
// 蒙版腐蚀 — 从边缘回退 N 像素
// ============================================================

/**
 * 腐蚀蒙版：将蒙版边缘向内收缩 N 像素
 * 对于每个"背景"像素，如果它在 N 像素范围内有"非背景"邻居，
 * 则将其从蒙版中移除（标记为非背景）。
 *
 * 这确保主体边缘绝对不会被误删。
 */
function erodeMask(mask: Uint8Array, w: number, h: number, erodePx: number): Uint8Array {
  if (erodePx <= 0) return mask;

  // 计算每个蒙版像素到最近非蒙版像素的距离
  // 使用 BFS 从所有非蒙版像素出发
  const dist = new Int16Array(w * h).fill(-1);
  const queue: number[] = [];
  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];

  // 非蒙版像素距离为 0
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) {
      dist[i] = 0;
      queue.push(i);
    }
  }

  // BFS 扩展距离
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % w;
    const y = Math.floor(idx / w);
    const d = dist[idx];
    if (d >= erodePx) continue;

    for (let dir = 0; dir < 4; dir++) {
      const nx = x + dx[dir];
      const ny = y + dy[dir];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (dist[nIdx] >= 0) continue; // 已访问
      dist[nIdx] = d + 1;
      queue.push(nIdx);
    }
  }

  // 只保留距离 >= erodePx 的像素
  const result = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    result[i] = (dist[i] >= erodePx) ? 1 : 0;
  }
  return result;
}

// ============================================================
// 通用工具函数
// ============================================================

/**
 * 从二值蒙版（1=匹配, 0=不匹配）的四条边 BFS，返回与边缘连通的区域
 */
function floodFillFromEdges(matchMask: Uint8Array, w: number, h: number): Uint8Array {
  const visited = new Uint8Array(w * h);
  const connected = new Uint8Array(w * h);
  const queue: number[] = [];
  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];

  // 从四边初始化
  for (let x = 0; x < w; x++) {
    const topIdx = x;
    const bottomIdx = (h - 1) * w + x;
    if (matchMask[topIdx] && !visited[topIdx]) { visited[topIdx] = 1; connected[topIdx] = 1; queue.push(topIdx); }
    if (matchMask[bottomIdx] && !visited[bottomIdx]) { visited[bottomIdx] = 1; connected[bottomIdx] = 1; queue.push(bottomIdx); }
  }
  for (let y = 0; y < h; y++) {
    const leftIdx = y * w;
    const rightIdx = y * w + (w - 1);
    if (matchMask[leftIdx] && !visited[leftIdx]) { visited[leftIdx] = 1; connected[leftIdx] = 1; queue.push(leftIdx); }
    if (matchMask[rightIdx] && !visited[rightIdx]) { visited[rightIdx] = 1; connected[rightIdx] = 1; queue.push(rightIdx); }
  }

  // BFS 扩展
  let head = 0;
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
      if (matchMask[nIdx]) {
        connected[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  return connected;
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
 * 对透明/不透明边界做羽化
 * 在 alpha=0 和 alpha=255 的边界做渐变，避免硬边锯齿
 */
function applyEdgeFeather(data: Uint8Array, w: number, h: number, featherPx: number): void {
  if (featherPx <= 0) return;

  const isTransparent = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    isTransparent[i] = data[i * 4 + 3] < 128 ? 1 : 0;
  }

  // BFS 从透明区域计算距离
  const dist = new Int16Array(w * h).fill(-1);
  const queue: number[] = [];
  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];

  for (let i = 0; i < w * h; i++) {
    if (isTransparent[i]) {
      dist[i] = 0;
      queue.push(i);
    }
  }

  let head = 0;
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
    if (isTransparent[i]) continue;
    const d = dist[i];
    if (d > 0 && d <= featherPx) {
      const ratio = d / featherPx;
      data[i * 4 + 3] = Math.round(ratio * 255);
    }
  }
}

/**
 * 本地 RemoveBG 的透明化兜底
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

    // 先尝试棋盘格
    const cbResult = detectAndRemoveCheckerboard(data, width, height);
    if (cbResult) {
      const resultBuffer = await sharp(data, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
      console.log(`[local-transparent] Checkerboard removed: ${cbResult.pct}% (grid=${cbResult.gridSize})`);
      return { buffer: resultBuffer, format: 'png' };
    }

    // 再尝试纯色 BFS
    const bfsResult = smartEdgeBFS(data, width, height);
    if (bfsResult && bfsResult.pct > 0) {
      const resultBuffer = await sharp(data, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
      console.log(`[local-transparent] Solid background removed: ${bfsResult.pct}% (color=${bfsResult.bgColor})`);
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
