import sharp from 'sharp';
import { spawn } from 'child_process';
import { saveImageFile } from './server-data-root';

/**
 * AI RemoveBG 后处理 — 蒙版法
 *
 * 核心思路：AI 已经完美识别了主体，输出的是"主体+统一背景(白底/棋盘格)"的 JPG。
 * 我们对 AI 结果图用 rembg 生成黑白蒙版，蒙版=主体区域，非蒙版=背景→透明。
 *
 * 为什么对 AI 结果图再跑 rembg 而不是对原图？
 * - 原图背景复杂（街道、渐变等），rembg 可能误删
 * - AI 结果背景已经是统一的（白色/灰色/棋盘格），rembg 极易精确分割
 * - 等于利用了两层智能：AI 识别主体 + rembg 精确蒙版
 *
 * 降级链：u2net → u2netp → 边缘采样纯色BFS
 */

export async function postProcessAIRemoveBG(imageUrl: string): Promise<string | null> {
    try {
        const imageBuffer = await fetchImageBuffer(imageUrl);
        const { data, info } = await sharp(imageBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const { width: w, height: h, channels } = info;
        const pixelCount = w * h;

        // 检查是否已有 alpha 透明（AI 有时直接返回透明 PNG）
        if (channels === 4) {
            let hasTransparency = false;
            for (let i = 0; i < pixelCount; i++) {
                if (data[i * 4 + 3] < 255) {
                    hasTransparency = true;
                    break;
                }
            }
            if (hasTransparency) {
                console.log('[AI-RemoveBG] Already has transparent alpha, skipping post-process');
                const rgbaData = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
                return saveAsPngAndGetUrl(rgbaData, w, h);
            }
        }

        // 策略 1: 用 rembg 生成蒙版（最可靠）
        for (const model of ['u2net', 'u2netp']) {
            const maskResult = await generateRembgMask(imageBuffer, model);
            if (maskResult) {
                console.log(`[AI-RemoveBG] rembg mask generated with model=${model}, applying...`);
                const rgbaData = rgbToRgba(data, w, h, channels);
                applyMaskToImage(rgbaData, maskResult, w, h, 6, 2); // 膨胀6px, 羽化2px
                return saveAsPngAndGetUrl(rgbaData, w, h);
            }
        }

        // 策略 2: 边缘采样纯色 BFS 兜底
        console.log('[AI-RemoveBG] rembg mask failed, falling back to edge BFS');
        const rgbaData = rgbToRgba(data, w, h, channels);
        if (detectAndRemoveSolidBackground(rgbaData, w, h)) {
            console.log('[AI-RemoveBG] Edge BFS background removed');
            return saveAsPngAndGetUrl(rgbaData, w, h);
        }

        // 兜底: 棋盘格检测
        if (detectAndRemoveCheckerboard(rgbaData, w, h)) {
            console.log('[AI-RemoveBG] Checkerboard removed');
            return saveAsPngAndGetUrl(rgbaData, w, h);
        }

        // 最终兜底: 返回原图（宁可保留背景也不删主体）
        console.log('[AI-RemoveBG] No post-processing method succeeded, returning original');
        return saveAsPngAndGetUrl(rgbaData, w, h);
    } catch (e) {
        console.error('[AI-RemoveBG] Post-processing error:', e);
        return null;
    }
}

/** RGB/RGBA 数据统一转为 RGBA Uint8ClampedArray */
function rgbToRgba(data: Buffer, w: number, h: number, channels: number): Uint8ClampedArray {
    const pixelCount = w * h;
    const src = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    const rgbaData = new Uint8ClampedArray(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
        const srcIdx = channels === 4 ? i * 4 : i * 3;
        rgbaData[i * 4] = src[srcIdx];
        rgbaData[i * 4 + 1] = src[srcIdx + 1];
        rgbaData[i * 4 + 2] = src[srcIdx + 2];
        rgbaData[i * 4 + 3] = 255;
    }
    return rgbaData;
}

// ============================================================
// rembg 蒙版生成（调用 Python 子进程）
// ============================================================

async function generateRembgMask(imageBuffer: Buffer, model: string): Promise<Uint8ClampedArray | null> {
    const venvPython = '/workspace/projects/.venv/bin/python3';
    const scriptPath = '/workspace/projects/scripts/iopaint_removebg.py';
    const base64Input = imageBuffer.toString('base64');

    const requestJson = JSON.stringify({
        image: base64Input,
        model: model,
        gen_mask: true,
    });

    try {
        const result = await new Promise<{ success: boolean; image?: string; error?: string }>((resolve, reject) => {
            const proc = spawn(venvPython, [scriptPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 60000,
                env: {
                    ...process.env,
                    TF_CPP_MIN_LOG_LEVEL: '3',
                },
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            proc.on('close', (code: number) => {
                if (code !== 0) {
                    console.error(`[AI-RemoveBG] rembg mask process exited with code ${code}`);
                    if (stderr) console.error(`[AI-RemoveBG] stderr: ${stderr.slice(-200)}`);
                    resolve({ success: false, error: `exit code ${code}` });
                    return;
                }
                try {
                    const parsed = JSON.parse(stdout.trim());
                    resolve(parsed);
                } catch (e) {
                    console.error(`[AI-RemoveBG] Failed to parse rembg output: ${stdout.slice(0, 200)}`);
                    resolve({ success: false, error: 'parse error' });
                }
            });

            proc.on('error', (err: Error) => {
                console.error(`[AI-RemoveBG] rembg mask process error:`, err.message);
                resolve({ success: false, error: err.message });
            });

            proc.stdin.write(requestJson);
            proc.stdin.end();
        });

        if (!result.success || !result.image) {
            console.error(`[AI-RemoveBG] rembg mask failed: ${result.error || 'no image'}`);
            return null;
        }

        // 解码蒙版 PNG
        const maskBuffer = Buffer.from(result.image, 'base64');
        const { data: maskData, info: maskInfo } = await sharp(maskBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        // 蒙版是灰度图，取任意通道作为蒙版值
        const mask = new Uint8ClampedArray(maskInfo.width * maskInfo.height);
        for (let i = 0; i < mask.length; i++) {
            mask[i] = maskData[i * maskInfo.channels]; // 取 R 通道
        }

        console.log(`[AI-RemoveBG] rembg mask decoded: ${maskInfo.width}x${maskInfo.height}, channels=${maskInfo.channels}`);
        return mask;
    } catch (e) {
        console.error(`[AI-RemoveBG] generateRembgMask error:`, e);
        return null;
    }
}

// ============================================================
// 蒙版应用：膨胀 + 羽化 + 设透明
// ============================================================

/**
 * 将蒙版应用到图片数据
 * @param imageData RGBA 像素数据（原地修改 alpha）
 * @param mask 蒙版数据（0=背景, 255=主体）
 * @param w 宽度
 * @param h 高度
 * @param maskDilatePx 膨胀像素数（保护主体边缘）
 * @param featherPx 羽化像素数（边缘柔化）
 */
function applyMaskToImage(
    imageData: Uint8ClampedArray,
    mask: Uint8ClampedArray,
    w: number,
    h: number,
    maskDilatePx: number,
    featherPx: number,
): void {
    // 第一步：膨胀蒙版（保护主体边缘不被切掉）
    const dilatedMask = dilateMask(mask, w, h, maskDilatePx);

    // 第二步：羽化蒙版边缘（避免硬边锯齿）
    const featheredMask = featherMask(dilatedMask, w, h, featherPx);

    // 第三步：应用蒙版 — 蒙版值=alpha值
    for (let i = 0; i < w * h; i++) {
        imageData[i * 4 + 3] = featheredMask[i];
    }
}

/** 膨胀蒙版：前景区域向外扩展 N 像素 */
function dilateMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
    if (radius <= 0) return mask;

    const result = new Uint8ClampedArray(mask);

    // 简单的矩形核膨胀（radius 次 1px 膨胀）
    for (let iter = 0; iter < radius; iter++) {
        const prev = new Uint8ClampedArray(result);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                if (prev[idx] > 127) {
                    // 当前是前景，标记周围为前景
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx, ny = y + dy;
                            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                                result[ny * w + nx] = 255;
                            }
                        }
                    }
                }
            }
        }
    }

    return result;
}

/** 羽化蒙版：对 alpha 边缘做渐变过渡 */
function featherMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
    if (radius <= 0) return mask;

    // 计算每个像素到最近背景像素的距离
    // 简化版：对蒙版边缘做 box blur
    const result = new Uint8ClampedArray(mask);

    for (let iter = 0; iter < radius; iter++) {
        const prev = new Uint8ClampedArray(result);
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                // 只在边缘区域做模糊（前景与背景交界处）
                const val = prev[idx];
                const top = prev[(y - 1) * w + x];
                const bottom = prev[(y + 1) * w + x];
                const left = prev[y * w + (x - 1)];
                const right = prev[y * w + (x + 1)];

                // 如果周围有不同值，做平均
                if (val !== top || val !== bottom || val !== left || val !== right) {
                    result[idx] = Math.round((val + top + bottom + left + right) / 5);
                }
            }
        }
    }

    return result;
}

// ============================================================
// 纯色背景 BFS 兜底方案
// ============================================================

/** 检测并移除纯色背景（只替换和边缘同色且连通的像素） */
function detectAndRemoveSolidBackground(data: Uint8ClampedArray, w: number, h: number): boolean {
    const bgColor = sampleBorderColor(data, w, h);
    if (!bgColor) return false;

    const bgR = bgColor.r, bgG = bgColor.g, bgB = bgColor.b;
    const visited = new Uint8Array(w * h);
    const queue: number[] = [];

    // 动态阈值，非常保守
    const brightness = (bgR + bgG + bgB) / 3;
    const threshold = brightness < 30 ? 4 : brightness < 80 ? 5 : brightness > 200 ? 8 : 6;

    // 初始化队列：从四条边入队
    for (let x = 0; x < w; x++) {
        checkAndEnqueue(x, 0);
        checkAndEnqueue(x, h - 1);
    }
    for (let y = 1; y < h - 1; y++) {
        checkAndEnqueue(0, y);
        checkAndEnqueue(w - 1, y);
    }

    function checkAndEnqueue(x: number, y: number) {
        const idx = y * w + x;
        if (visited[idx]) return;
        const px = idx * 4;
        const r = data[px], g = data[px + 1], b = data[px + 2];
        const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
        if (dist <= threshold) {
            visited[idx] = 1;
            queue.push(idx);
        }
    }

    // Flood Fill 只替换边缘连通的同色像素
    while (queue.length > 0) {
        const idx = queue.shift()!;
        const x = idx % w, y = Math.floor(idx / w);

        const px = idx * 4;
        data[px + 3] = 0;

        const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nIdx = ny * w + nx;
            if (visited[nIdx]) continue;

            const nPx = nIdx * 4;
            const r = data[nPx], g = data[nPx + 1], b = data[nPx + 2];
            const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
            if (dist <= threshold) {
                visited[nIdx] = 1;
                queue.push(nIdx);
            }
        }
    }

    // 检查是否移除了足够比例的像素（5%以上才算明确背景）
    let removed = 0;
    for (let i = 0; i < w * h; i++) {
        if (data[i * 4 + 3] === 0) removed++;
    }
    const pct = (removed / (w * h)) * 100;

    if (pct < 5) {
        // 移除太少，可能不是明确背景，恢复
        for (let i = 0; i < w * h; i++) {
            data[i * 4 + 3] = 255;
        }
        return false;
    }

    return true;
}

/** 从四条边 2px 采样主色 */
function sampleBorderColor(data: Uint8ClampedArray, w: number, h: number) {
    const samples: number[] = [];
    const band = 2;
    for (let x = 0; x < w; x++) {
        for (let dy = 0; dy < band; dy++) {
            if (dy < h) {
                const idx = ((dy) * w + x) * 4;
                samples.push(quantizeColor(data[idx], data[idx + 1], data[idx + 2]));
            }
            if ((h - 1 - dy) >= 0) {
                const idx = ((h - 1 - dy) * w + x) * 4;
                samples.push(quantizeColor(data[idx], data[idx + 1], data[idx + 2]));
            }
        }
    }
    for (let y = band; y < h - band; y++) {
        for (let dx = 0; dx < band; dx++) {
            const idx1 = (y * w + dx) * 4;
            samples.push(quantizeColor(data[idx1], data[idx1 + 1], data[idx1 + 2]));
            const idx2 = (y * w + (w - 1 - dx)) * 4;
            samples.push(quantizeColor(data[idx2], data[idx2 + 1], data[idx2 + 2]));
        }
    }

    const counts = new Map<number, number>();
    for (const c of samples) {
        counts.set(c, (counts.get(c) || 0) + 1);
    }
    let maxCount = 0, dominantKey = -1;
    for (const [k, v] of counts) {
        if (v > maxCount) {
            maxCount = v;
            dominantKey = k;
        }
    }
    const pct = maxCount / samples.length;

    if (pct < 0.3) return null;

    const r = (dominantKey >> 16) & 0xff;
    const g = (dominantKey >> 8) & 0xff;
    const b = dominantKey & 0xff;
    return { r, g, b };
}

/** 颜色量化到 32 级 */
function quantizeColor(r: number, g: number, b: number) {
    const qr = Math.floor(r / 8) * 8;
    const qg = Math.floor(g / 8) * 8;
    const qb = Math.floor(b / 8) * 8;
    return (qr << 16) | (qg << 8) | qb;
}

// ============================================================
// 棋盘格检测兜底方案
// ============================================================

/** 检测并移除棋盘格背景（精确检测） */
function detectAndRemoveCheckerboard(data: Uint8ClampedArray, w: number, h: number): boolean {
    const sizes = [8, 10, 12, 16, 4];
    for (const size of sizes) {
        const { pattern, colorA, colorB, confidence } = detectCheckerboardPattern(data, w, h, size);
        if (pattern === 'clear' && confidence > 0.8) {
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const r = data[idx], g = data[idx + 1], b = data[idx + 2];

                    const isColorA = Math.abs(r - colorA.r) < 8 && Math.abs(g - colorA.g) < 8 && Math.abs(b - colorA.b) < 8;
                    const isColorB = Math.abs(r - colorB.r) < 8 && Math.abs(g - colorB.g) < 8 && Math.abs(b - colorB.b) < 8;

                    const expectedColorA = ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0);
                    const matchesPattern = (expectedColorA && isColorA) || (!expectedColorA && isColorB);

                    if (matchesPattern) {
                        data[idx + 3] = 0;
                    }
                }
            }
            return true;
        }
    }
    return false;
}

/** 检测棋盘格模式 */
function detectCheckerboardPattern(data: Uint8ClampedArray, w: number, h: number, size: number) {
    const topLeft = Math.floor(size / 2);
    const sampleY = Math.min(topLeft, h - 1);
    const sampleX = Math.min(topLeft, w - 1);
    const idx1 = (sampleY * w + sampleX) * 4;
    const colorA = { r: data[idx1], g: data[idx1 + 1], b: data[idx1 + 2] };

    const sample2X = Math.min(sampleX + size, w - 1);
    const idx2 = (sampleY * w + sample2X) * 4;
    const colorB = { r: data[idx2], g: data[idx2 + 1], b: data[idx2 + 2] };

    const distAB = Math.sqrt(
        (colorA.r - colorB.r) ** 2 + (colorA.g - colorB.g) ** 2 + (colorA.b - colorB.b) ** 2
    );

    if (distAB < 20) return { pattern: 'none', colorA, colorB, confidence: 0 };

    let matches = 0, total = 0;
    const maxX = Math.min(w, 200), maxY = Math.min(h, 200);
    for (let y = 0; y < maxY; y += size * 2) {
        for (let x = 0; x < maxX; x += size * 2) {
            const i = (y * w + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const distA = Math.sqrt((r - colorA.r) ** 2 + (g - colorA.g) ** 2 + (b - colorA.b) ** 2);
            const distB = Math.sqrt((r - colorB.r) ** 2 + (g - colorB.g) ** 2 + (b - colorB.b) ** 2);
            if (distA < 15 || distB < 15) {
                if (distA < distB) matches++;
                total++;
            }
            const i2 = ((y) * w + (x + size)) * 4;
            const r2 = data[i2], g2 = data[i2 + 1], b2 = data[i2 + 2];
            const distA2 = Math.sqrt((r2 - colorA.r) ** 2 + (g2 - colorA.g) ** 2 + (r2 - colorA.b) ** 2);
            const distB2 = Math.sqrt((r2 - colorB.r) ** 2 + (g2 - colorB.g) ** 2 + (b2 - colorB.b) ** 2);
            if (distA2 < 15 || distB2 < 15) {
                if (distB2 < distA2) matches++;
                total++;
            }
        }
    }

    const confidence = total > 5 ? matches / total : 0;
    const pattern = confidence > 0.8 ? 'clear' : confidence > 0.5 ? 'partial' : 'none';
    return { pattern, colorA, colorB, confidence };
}

// ============================================================
// 通用工具函数
// ============================================================

/** 获取图片 Buffer */
async function fetchImageBuffer(input: string): Promise<Buffer> {
    if (Buffer.isBuffer(input)) {
        return input;
    }
    if (input.startsWith('http')) {
        const resp = await fetch(input);
        return Buffer.from(await resp.arrayBuffer());
    }
    if (input.startsWith('data:')) {
        const parts = input.split(',');
        if (parts.length === 2) return Buffer.from(parts[1], 'base64');
    }
    const isDev = process.env.COZE_PROJECT_ENV === 'DEV';
    const baseUrl = isDev ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}` : '';
    const fullUrl = input.startsWith('/') ? `${baseUrl}${input}` : input;
    const resp = await fetch(fullUrl);
    return Buffer.from(await resp.arrayBuffer());
}

/** 保存为 PNG 并返回 URL */
async function saveAsPngAndGetUrl(data: Uint8ClampedArray, width: number, height: number): Promise<string> {
    const pngBuffer = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
        raw: { width, height, channels: 4 }
    })
        .png()
        .toBuffer();

    const filename = `transparent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
    return saveImageFile(pngBuffer, filename, 'uploads');
}

/** 本地兜底透明化（仅用于本地 rembg 路径，返回 buffer） */
export async function createLocalTransparentBg(imageUrl: string): Promise<{ buffer: Buffer; format: 'png' } | null> {
    try {
        const imageBuffer = await fetchImageBuffer(imageUrl);
        const { data, info } = await sharp(imageBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const { width: w, height: h, channels } = info;
        const rgbaData = rgbToRgba(data, w, h, channels);

        if (detectAndRemoveSolidBackground(rgbaData, w, h)) {
            const buffer = await sharp(Buffer.from(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength), {
                raw: { width: w, height: h, channels: 4 }
            })
                .png()
                .toBuffer();
            return { buffer, format: 'png' };
        }

        if (detectAndRemoveCheckerboard(rgbaData, w, h)) {
            const buffer = await sharp(Buffer.from(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength), {
                raw: { width: w, height: h, channels: 4 }
            })
                .png()
                .toBuffer();
            return { buffer, format: 'png' };
        }

        return null;
    } catch (e) {
        console.error('[Local-Transparent-Bg] Error:', e);
        return null;
    }
}
