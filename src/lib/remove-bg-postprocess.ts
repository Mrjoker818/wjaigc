import path from 'path';
import sharp from 'sharp';
import { spawn } from 'child_process';

/**
 * AI RemoveBG 后处理：用 rembg 对 AI 结果生成精确蒙版
 * 
 * 策略：AI 模型（Gemini/GPT）擅长理解"主体是什么"，但生成的图
 * 背景是均匀灰色/棋盘格而非真正透明。用 rembg 对 AI 结果再
 * 做一次蒙版提取，因为 AI 结果背景高度均匀，rembg 极易精确分割。
 * 
 * 组合优势：AI 主体理解（知道白色脸部是主体）+ rembg 精确蒙版（背景均匀易分割）
 */
export async function postProcessAIRemoveBG(
  imageInput: Buffer | string,
  options: {
    maskDilatePx?: number; // 蒙版膨胀像素，保护主体边缘（默认 8）
    featherPx?: number;     // 边缘羽化像素（默认 3）
  } = {}
): Promise<{ buffer: Buffer; format: 'png' } | null> {
  const { maskDilatePx = 10, featherPx = 3 } = options;

  // 支持 URL 或 Buffer 输入
  let imageBuffer: Buffer;
  if (typeof imageInput === 'string') {
    // 将相对路径转为绝对 URL
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

  console.log(`[ai-rmbg-post] Starting AI RemoveBG post-process (dilate=${maskDilatePx}px, feather=${featherPx}px, input=${imageBuffer.length} bytes)`);

  // Step 1: 用 rembg 生成蒙版
  const maskResult = await generateRembgMask(imageBuffer, 'u2net');
  if (maskResult) {
    return applyMaskToImage(imageBuffer, maskResult, maskDilatePx, featherPx);
  }

  // u2net 失败，尝试 u2netp
  const fallbackMask = await generateRembgMask(imageBuffer, 'u2netp');
  if (fallbackMask) {
    return applyMaskToImage(imageBuffer, fallbackMask, maskDilatePx, featherPx);
  }

  // rembg 不可用（无 venv），降级到颜色 BFS 检测
  console.warn('[ai-rmbg-post] rembg unavailable, falling back to color-based BFS detection');
  return colorBasedBackgroundRemoval(imageBuffer, maskDilatePx, featherPx);
}

/**
 * 调用 Python rembg 脚本生成蒙版
 */
async function generateRembgMask(
  imageBuffer: Buffer,
  model: string
): Promise<Buffer | null> {
  const pythonScript = path.join(process.cwd(), 'scripts', 'iopaint_removebg.py');
  const modelsDir = path.join(process.cwd(), 'models', 'removebg');
  const venvPython = path.join(process.cwd(), '.venv', 'bin', 'python3');

  const inputPayload = JSON.stringify({
    image: imageBuffer.toString('base64'),
    model: model,
    gen_mask: true,
  });

  try {
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const proc = spawn(venvPython, [pythonScript], {
        env: {
          ...process.env,
          REMOVEBG_MODELS_DIR: modelsDir,
          U2NET_HOME: modelsDir,
          TF_CPP_MIN_LOG_LEVEL: '3',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(`Python process exited with code ${code}: ${stderr.slice(-500)}`));
        } else {
          resolve({ stdout, stderr });
        }
      });

      proc.on('error', (err: Error) => { reject(err); });

      // 写入 stdin
      proc.stdin.write(inputPayload);
      proc.stdin.end();

      // 60 秒超时
      setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Python process timed out after 60s'));
      }, 60000);
    });

    const parsed = JSON.parse(result.stdout.trim());
    if (!parsed.success || !parsed.image) {
      console.error(`[rembgMask] Python script error: ${parsed.error || 'no image'}`);
      return null;
    }

    return Buffer.from(parsed.image, 'base64');
  } catch (err) {
    console.error(`[rembgMask] Failed:`, (err as Error).message);
    return null;
  }
}

/**
 * 应用蒙版到原图：膨胀保护主体 + 羽化边缘
 */
async function applyMaskToImage(
  imageBuffer: Buffer,
  maskPng: Buffer,
  maskDilatePx: number,
  featherPx: number
): Promise<{ buffer: Buffer; format: 'png' }> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const { width = 1, height = 1 } = metadata;

  // 读取蒙版灰度图
  const maskData = await sharp(maskPng)
    .resize(width, height, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();

  // 膨胀蒙版：保护主体边缘
  const dilatedMask = dilateMask(maskData, width, height, maskDilatePx);

  // 羽化边缘
  const featheredMask = featherMask(dilatedMask, width, height, featherPx);

  // 应用蒙版：创建带 alpha 通道的 PNG
  const { data: rgbaData, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < width * height; i++) {
    rgbaData[i * 4 + 3] = featheredMask[i]; // 设置 alpha
  }

  const resultBuffer = await sharp(rgbaData, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();

  const transparentCount = featheredMask.filter(v => v < 128).length;
  const totalCount = width * height;
  console.log(`[ai-rmbg-post] Mask applied: ${(transparentCount / totalCount * 100).toFixed(1)}% background removed (dilate=${maskDilatePx}px, feather=${featherPx}px)`);

  return { buffer: resultBuffer, format: 'png' };
}

/**
 * 膨胀蒙版：向外扩展前景区域，保护主体边缘
 * 使用方形结构元素，迭代扩展
 */
function dilateMask(mask: Buffer, width: number, height: number, dilatePx: number): Buffer {
  let current = Buffer.from(mask);

  // 迭代膨胀，每次扩展 1 像素
  for (let iter = 0; iter < dilatePx; iter++) {
    const next = Buffer.alloc(current.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (current[idx] > 127) {
          // 前景像素：保持 + 扩展到 4 邻域
          next[idx] = 255;
          if (x > 0) next[idx - 1] = 255;
          if (x < width - 1) next[idx + 1] = 255;
          if (y > 0) next[idx - width] = 255;
          if (y < height - 1) next[idx + width] = 255;
        }
      }
    }

    current = next;
  }

  return current;
}

/**
 * 羽化蒙版边缘：在前景/背景边界做 alpha 渐变
 * 避免硬边切割效果
 */
function featherMask(mask: Buffer, width: number, height: number, featherPx: number): Buffer {
  if (featherPx <= 0) return mask;

  const result = Buffer.from(mask);

  // 计算每个像素到最近背景像素的距离
  // 使用简化版：在前景边缘做渐变
  const dist = new Float32Array(width * height).fill(Infinity);

  // 从背景像素开始 BFS
  const queue: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (mask[i] < 128) {
      dist[i] = 0;
      queue.push(i);
    }
  }

  // BFS 计算距离
  let head = 0;
  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];

  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % width;
    const y = Math.floor(idx / width);
    const d = dist[idx];

    if (d >= featherPx) continue;

    for (let dir = 0; dir < 4; dir++) {
      const nx = x + dx[dir];
      const ny = y + dy[dir];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (dist[nIdx] > d + 1) {
        dist[nIdx] = d + 1;
        queue.push(nIdx);
      }
    }
  }

  // 应用羽化
  for (let i = 0; i < width * height; i++) {
    if (mask[i] >= 128) {
      // 前景像素：根据距离做渐变
      const d = dist[i];
      if (d <= featherPx) {
        // 在羽化范围内：alpha 从 0 渐变到 255
        result[i] = Math.round((1 - d / featherPx) * 200 + 55);
        // 确保最内层也是 255
        if (d === 0) result[i] = 0; // 距离为 0 的是背景
      }
      // 距离 > featherPx 的保持 255
    } else {
      // 背景像素保持 0（透明）
      result[i] = 0;
    }
  }

  // 纠正：距离为 0 的是背景，应该是透明
  for (let i = 0; i < width * height; i++) {
    if (mask[i] < 128) {
      result[i] = 0;
    } else if (dist[i] >= featherPx || !isFinite(dist[i])) {
      result[i] = 255;
    } else {
      // 在羽化范围的前景像素
      const ratio = dist[i] / featherPx;
      result[i] = Math.round(ratio * 255);
      if (result[i] < 55) result[i] = 55; // 最低 alpha，避免主体太薄
    }
  }

  return result;
}

/**
 * 本地 RemoveBG 的透明化兜底（替代旧的 createLocalBackgroundAlpha）
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

    // 简单策略：检测纯白/近白像素（>240）作为背景
    // 从边缘 BFS 扩展，只删除连通的背景
    const bgMask = new Uint8Array(width * height); // 0=keep, 1=remove
    const visited = new Uint8Array(width * height);

    const isBackground = (idx: number): boolean => {
      const r = data[idx * 4];
      const g = data[idx * 4 + 1];
      const b = data[idx * 4 + 2];
      // 近白色/近灰色
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      return max > 230 && (max - min) < 20;
    };

    // 从四条边开始 BFS
    const queue: number[] = [];
    for (let x = 0; x < width; x++) {
      const topIdx = x;
      const bottomIdx = (height - 1) * width + x;
      if (isBackground(topIdx) && !visited[topIdx]) { visited[topIdx] = 1; bgMask[topIdx] = 1; queue.push(topIdx); }
      if (isBackground(bottomIdx) && !visited[bottomIdx]) { visited[bottomIdx] = 1; bgMask[bottomIdx] = 1; queue.push(bottomIdx); }
    }
    for (let y = 0; y < height; y++) {
      const leftIdx = y * width;
      const rightIdx = y * width + (width - 1);
      if (isBackground(leftIdx) && !visited[leftIdx]) { visited[leftIdx] = 1; bgMask[leftIdx] = 1; queue.push(leftIdx); }
      if (isBackground(rightIdx) && !visited[rightIdx]) { visited[rightIdx] = 1; bgMask[rightIdx] = 1; queue.push(rightIdx); }
    }

    // BFS 扩展
    let head = 0;
    const dx = [-1, 1, 0, 0];
    const dy = [0, 0, -1, 1];
    while (head < queue.length) {
      const idx = queue[head++];
      const x = idx % width;
      const y = Math.floor(idx / width);
      for (let dir = 0; dir < 4; dir++) {
        const nx = x + dx[dir];
        const ny = y + dy[dir];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (visited[nIdx]) continue;
        visited[nIdx] = 1;
        if (isBackground(nIdx)) {
          bgMask[nIdx] = 1;
          queue.push(nIdx);
        }
      }
    }

    // 应用蒙版
    let removedCount = 0;
    for (let i = 0; i < width * height; i++) {
      if (bgMask[i]) {
        data[i * 4 + 3] = 0; // 透明
        removedCount++;
      }
    }

    const resultBuffer = await sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();

    console.log(`[local-transparent] Removed ${(removedCount / (width * height) * 100).toFixed(1)}% background pixels`);

    return { buffer: resultBuffer, format: 'png' };
  } catch (err) {
    console.error('[local-transparent] Error:', (err as Error).message);
    return null;
  }
}

/**
 * 颜色 BFS 背景移除 — rembg 不可用时的降级方案
 * 从图片四边采样背景色，BFS 扩展标记背景区域，替换为透明
 */
async function colorBasedBackgroundRemoval(
  imageBuffer: Buffer,
  maskDilatePx: number = 10,
  featherPx: number = 2
): Promise<{ buffer: Buffer; format: 'png' } | null> {
  try {
    const image = sharp(imageBuffer);
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    // Step 1: 从四边采样背景色
    const edgeSamples: number[][] = [];
    const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 100));

    for (let x = 0; x < width; x += sampleStep) {
      for (let row of [0, 1, 2, height - 1, height - 2, height - 3]) {
        if (row < height) {
          const idx = row * width + x;
          edgeSamples.push([data[idx * 4], data[idx * 4 + 1], data[idx * 4 + 2]]);
        }
      }
    }
    for (let y = 0; y < height; y += sampleStep) {
      for (let col of [0, 1, 2, width - 1, width - 2, width - 3]) {
        if (col < width) {
          const idx = y * width + col;
          edgeSamples.push([data[idx * 4], data[idx * 4 + 1], data[idx * 4 + 2]]);
        }
      }
    }

    // Step 2: 简单聚类 — 找出前2个最大颜色簇
    const clusters: { center: number[]; count: number }[] = [];
    const CLUSTER_THRESHOLD = 40;

    for (const sample of edgeSamples) {
      let found = false;
      for (const cluster of clusters) {
        const dist = Math.sqrt(
          (sample[0] - cluster.center[0]) ** 2 +
          (sample[1] - cluster.center[1]) ** 2 +
          (sample[2] - cluster.center[2]) ** 2
        );
        if (dist < CLUSTER_THRESHOLD) {
          cluster.count++;
          // 更新中心
          cluster.center[0] = Math.round((cluster.center[0] * (cluster.count - 1) + sample[0]) / cluster.count);
          cluster.center[1] = Math.round((cluster.center[1] * (cluster.count - 1) + sample[1]) / cluster.count);
          cluster.center[2] = Math.round((cluster.center[2] * (cluster.count - 1) + sample[2]) / cluster.count);
          found = true;
          break;
        }
      }
      if (!found) {
        clusters.push({ center: [...sample], count: 1 });
      }
    }

    clusters.sort((a, b) => b.count - a.count);
    const bgColors = clusters.slice(0, 2).map(c => c.center);
    console.log(`[color-bfs-fallback] Background colors: ${bgColors.map(c => `rgb(${c.join(',')})`).join(' + ')}`);

    // Step 3: BFS 从四边扩展，标记背景
    const bgMask = new Uint8Array(width * height);
    const visited = new Uint8Array(width * height);

    const colorDist = (idx: number, ref: number[]): number => {
      const r = data[idx * 4], g = data[idx * 4 + 1], b = data[idx * 4 + 2];
      return Math.sqrt((r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2);
    };

    const isNearBg = (idx: number): boolean => {
      const r = data[idx * 4], g = data[idx * 4 + 1], b = data[idx * 4 + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const isGray = (max - min) < 30;
      const threshold = isGray ? 30 : 22;
      return bgColors.some(ref => colorDist(idx, ref) < threshold);
    };

    // 从四边开始
    const queue: number[] = [];
    for (let x = 0; x < width; x++) {
      for (const row of [0, height - 1]) {
        const idx = row * width + x;
        if (!visited[idx] && isNearBg(idx)) { visited[idx] = 1; bgMask[idx] = 1; queue.push(idx); }
      }
    }
    for (let y = 0; y < height; y++) {
      for (const col of [0, width - 1]) {
        const idx = y * width + col;
        if (!visited[idx] && isNearBg(idx)) { visited[idx] = 1; bgMask[idx] = 1; queue.push(idx); }
      }
    }

    // BFS 扩展
    let head = 0;
    const dx = [-1, 1, 0, 0], dy = [0, 0, -1, 1];
    while (head < queue.length) {
      const idx = queue[head++];
      const x = idx % width, y = Math.floor(idx / width);
      for (let dir = 0; dir < 4; dir++) {
        const nx = x + dx[dir], ny = y + dy[dir];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (visited[nIdx]) continue;
        visited[nIdx] = 1;
        if (isNearBg(nIdx)) { bgMask[nIdx] = 1; queue.push(nIdx); }
      }
    }

    // 统计
    let bgCount = 0;
    for (let i = 0; i < width * height; i++) if (bgMask[i]) bgCount++;
    console.log(`[color-bfs-fallback] BFS marked ${(bgCount / (width * height) * 100).toFixed(1)}% as background`);

    // Step 4: 膨胀蒙版保护主体
    let maskBuf: Buffer = Buffer.from(bgMask.map(v => v > 0 ? 255 : 0));
    for (let i = 0; i < maskDilatePx; i++) {
      maskBuf = dilateMask(maskBuf, width, height, 1) as Buffer;
    }
    // 反转：255=背景(要删除), 0=前景(要保留)
    const finalMask = Buffer.from(maskBuf.map(v => v > 128 ? 0 : 255));

    // Step 5: 羽化
    const featheredMask = featherMask(finalMask, width, height, featherPx);

    // Step 6: 应用蒙版
    for (let i = 0; i < width * height; i++) {
      data[i * 4 + 3] = featheredMask[i];
    }

    const resultBuffer = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
    console.log(`[color-bfs-fallback] Post-processed image saved as transparent PNG`);

    return { buffer: resultBuffer, format: 'png' };
  } catch (err) {
    console.error('[color-bfs-fallback] Error:', (err as Error).message);
    return null;
  }
}
