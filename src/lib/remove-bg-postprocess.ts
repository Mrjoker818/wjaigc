import sharp from 'sharp';
import { saveImageFile } from './server-data-root';

/**
 * AI RemoveBG 后处理 — 颜色距离 Alpha 提取法
 *
 * 核心思路：AI 已经完美识别主体，输出的是"主体+统一背景"的图。
 * 我们不做任何"重新识别主体"的操作（不用 rembg），
 * 而是直接从 AI 结果中提取：与背景色越接近 → alpha 越低（越透明），
 * 与背景色越不同 → alpha 越高（越不透明）。
 *
 * 这样蒙版完全遵循 AI 自己的渲染边界，包括抗锯齿过渡像素，
 * 自然就能还原 AI 原始的顺滑边缘。
 *
 * 降级链：已有透明 → 颜色距离Alpha提取 → 棋盘格检测 → 原图兜底
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

        // ★ 策略 0: 如果 AI 已经返回了带透明通道的 PNG，直接用
        if (channels === 4) {
            let transparentCount = 0;
            for (let i = 0; i < pixelCount; i++) {
                if (data[i * 4 + 3] < 250) { transparentCount++; }
            }
            if (transparentCount > pixelCount * 0.03) {
                console.log(`[AI-RemoveBG] Already has transparent alpha (${((transparentCount / pixelCount) * 100).toFixed(1)}%), saving directly`);
                const rgbaData = bufferToUint8(data);
                return saveAsPngAndGetUrl(rgbaData, w, h);
            }
        }

        const rgbaData = rgbToRgba(data, w, h, channels);

        // ★ 策略 1: 颜色距离 Alpha 提取 — 核心算法
        // 对 AI 结果图，检测背景色，用颜色距离直接映射 alpha
        const success = applyColorDistanceAlpha(rgbaData, w, h);
        if (success) {
            console.log('[AI-RemoveBG] Color distance alpha extraction succeeded');
            return saveAsPngAndGetUrl(rgbaData, w, h);
        }

        // ★ 策略 2: 棋盘格检测兜底
        if (detectAndRemoveCheckerboard(rgbaData, w, h)) {
            console.log('[AI-RemoveBG] Checkerboard removal succeeded');
            return saveAsPngAndGetUrl(rgbaData, w, h);
        }

        // ★ 兜底: 原图保存（宁可保留背景也不删主体）
        console.log('[AI-RemoveBG] No method succeeded, returning original as opaque PNG');
        return saveAsPngAndGetUrl(rgbaData, w, h);
    } catch (e) {
        console.error('[AI-RemoveBG] Post-processing error:', e);
        return null;
    }
}

// ============================================================
// 核心：颜色距离 Alpha 提取
// ============================================================

/**
 * 从 AI 结果图中提取背景 → 透明
 *
 * 原理：AI 结果的背景是统一颜色（白/灰/黑/棋盘格），
 * 主体区域的颜色与背景色不同。对每个像素计算与背景色的距离，
 * 距离越大 → 越可能是主体 → alpha 越高。
 * 距离越小 → 越可能是背景 → alpha 越低。
 *
 * 抗锯齿边缘像素是主体色和背景色的混合，
 * 其颜色距离自然处于中间值，alpha 也是中间值，
 * 所以边缘自然顺滑，不需要膨胀/羽化。
 *
 * 额外保护：只允许与图片边缘连通的区域变透明，
 * 防止主体内部与背景色相近的区域被误删。
 */
function applyColorDistanceAlpha(data: Uint8ClampedArray, w: number, h: number): boolean {
    // Step 1: 从边缘采样背景色
    const bgColors = sampleEdgeColors(data, w, h);
    if (!bgColors || bgColors.length === 0) {
        console.log('[AI-RemoveBG] No dominant edge color found');
        return false;
    }

    const primaryBg = bgColors[0];
    const bgR = primaryBg.r, bgG = primaryBg.g, bgB = primaryBg.b;
    const bgBrightness = (bgR + bgG + bgB) / 3;

    console.log(`[AI-RemoveBG] Detected background color: rgb(${bgR},${bgG},${bgB}), brightness=${bgBrightness.toFixed(0)}`);

    // Step 2: 动态阈值 — 深色背景更保守，浅色背景稍宽松
    // tightThreshold: 低于此距离 = 确定是背景 (alpha=0)
    // wideThreshold: 高于此距离 = 确定是主体 (alpha=255)
    // 之间 = 抗锯齿过渡区，线性插值
    let tightThreshold: number;
    let wideThreshold: number;

    if (bgBrightness < 30) {
        // 纯黑/深色背景：极其保守
        tightThreshold = 4;
        wideThreshold = 15;
    } else if (bgBrightness < 80) {
        tightThreshold = 5;
        wideThreshold = 18;
    } else if (bgBrightness < 180) {
        tightThreshold = 6;
        wideThreshold = 20;
    } else {
        // 浅色/白色背景：稍宽松
        tightThreshold = 8;
        wideThreshold = 25;
    }

    // 如果有第二主色（棋盘格的第二色），也一并处理
    const secondaryBg = bgColors.length > 1 ? bgColors[1] : null;

    // Step 3: 计算每个像素的 alpha
    // 先算粗略 alpha（纯颜色距离），然后用边缘连通性修正
    const alphaMap = new Float32Array(w * h); // 0~1, 0=背景, 1=主体

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const px = idx * 4;
            const r = data[px], g = data[px + 1], b = data[px + 2];

            // 计算与主背景色的距离
            const dr = r - bgR, dg = g - bgG, db = b - bgB;
            let dist = Math.sqrt(dr * dr + dg * dg + db * db);

            // 如果有第二背景色，取最小距离
            if (secondaryBg) {
                const dr2 = r - secondaryBg.r, dg2 = g - secondaryBg.g, db2 = b - secondaryBg.b;
                const dist2 = Math.sqrt(dr2 * dr2 + dg2 * dg2 + db2 * db2);
                dist = Math.min(dist, dist2);
            }

            // 映射到 alpha
            if (dist <= tightThreshold) {
                alphaMap[idx] = 0; // 确定背景
            } else if (dist >= wideThreshold) {
                alphaMap[idx] = 1; // 确定主体
            } else {
                // 过渡区：线性插值
                alphaMap[idx] = (dist - tightThreshold) / (wideThreshold - tightThreshold);
            }
        }
    }

    // Step 4: 边缘连通性保护
    // 只有从图片边缘可达的"低alpha"区域才能变透明
    // 主体内部与背景色相近的区域被主体像素包围，不会从边缘到达
    const canBeTransparent = new Uint8Array(w * h); // 1 = 可以变透明
    const queue: number[] = [];

    // 从四条边开始，如果 alpha < 0.5 就加入队列
    for (let x = 0; x < w; x++) {
        enqueueIfBackground(x, 0);
        enqueueIfBackground(x, h - 1);
    }
    for (let y = 1; y < h - 1; y++) {
        enqueueIfBackground(0, y);
        enqueueIfBackground(w - 1, y);
    }

    function enqueueIfBackground(x: number, y: number) {
        const idx = y * w + x;
        if (canBeTransparent[idx]) return;
        if (alphaMap[idx] < 0.5) {
            canBeTransparent[idx] = 1;
            queue.push(idx);
        }
    }

    // BFS 扩展：从已确认的透明区域扩展到相邻的低 alpha 像素
    // 使用较宽松的阈值（0.6），允许过渡区像素也被标记
    while (queue.length > 0) {
        const idx = queue.shift()!;
        const x = idx % w, y = Math.floor(idx / w);

        const neighbors = [
            [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
        ];

        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nIdx = ny * w + nx;
            if (canBeTransparent[nIdx]) continue;
            // 扩展条件：alpha < 0.6（过渡区的背景侧也能被标记）
            if (alphaMap[nIdx] < 0.6) {
                canBeTransparent[nIdx] = 1;
                queue.push(nIdx);
            }
        }
    }

    // Step 5: 应用最终 alpha
    let transparentCount = 0;
    for (let i = 0; i < w * h; i++) {
        if (canBeTransparent[i]) {
            // 该像素与边缘连通，可以变透明
            // alpha 值来自颜色距离计算（包含过渡区的平滑渐变）
            const alpha = Math.round(alphaMap[i] * 255);
            data[i * 4 + 3] = alpha;
            if (alpha < 250) transparentCount++;
        }
        // 如果 canBeTransparent[i] === 0，说明是主体内部，保持 alpha=255
    }

    const pct = (transparentCount / (w * h)) * 100;
    console.log(`[AI-RemoveBG] Color distance alpha: ${(pct).toFixed(1)}% pixels transparent`);

    // 如果透明像素太少（<3%），可能检测到了错误的背景色
    if (pct < 3) {
        // 恢复所有 alpha
        for (let i = 0; i < w * h; i++) {
            data[i * 4 + 3] = 255;
        }
        console.log('[AI-RemoveBG] Too few transparent pixels, treating as failure');
        return false;
    }

    return true;
}

// ============================================================
// 边缘背景色采样
// ============================================================

/**
 * 从图片四条边采样，返回 1~2 个主色
 * 返回数组按频率降序排列，第一个是最主要背景色
 */
function sampleEdgeColors(data: Uint8ClampedArray, w: number, h: number): Array<{ r: number; g: number; b: number }> | null {
    const band = 3; // 采样边框宽度
    const colorCounts = new Map<number, { r: number; g: number; b: number; count: number }>();

    for (let x = 0; x < w; x++) {
        // 顶部 band 行
        for (let dy = 0; dy < band && dy < h; dy++) {
            addSample(x, dy);
        }
        // 底部 band 行
        for (let dy = 0; dy < band && (h - 1 - dy) >= 0; dy++) {
            addSample(x, h - 1 - dy);
        }
    }
    for (let y = band; y < h - band; y++) {
        // 左侧 band 列
        for (let dx = 0; dx < band; dx++) {
            addSample(dx, y);
        }
        // 右侧 band 列
        for (let dx = 0; dx < band; dx++) {
            addSample(w - 1 - dx, y);
        }
    }

    function addSample(x: number, y: number) {
        const idx = (y * w + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const key = quantizeColor(r, g, b);
        const existing = colorCounts.get(key);
        if (existing) {
            // 累加实际颜色值，最后取平均
            existing.r += r;
            existing.g += g;
            existing.b += b;
            existing.count++;
        } else {
            colorCounts.set(key, { r, g, b, count: 1 });
        }
    }

    if (colorCounts.size === 0) return null;

    // 排序取前 2 个
    const sorted = Array.from(colorCounts.values())
        .map(c => ({
            r: Math.round(c.r / c.count),
            g: Math.round(c.g / c.count),
            b: Math.round(c.b / c.count),
            count: c.count,
        }))
        .sort((a, b) => b.count - a.count);

    const totalEdgePixels = sorted.reduce((s, c) => s + c.count, 0);
    const results: Array<{ r: number; g: number; b: number }> = [];

    // 第一主色必须占边缘 >25%
    if (sorted[0].count / totalEdgePixels < 0.25) return null;
    results.push({ r: sorted[0].r, g: sorted[0].g, b: sorted[0].b });

    // 第二主色：如果占边缘 >15% 且与第一色差异 >20（可能是棋盘格的第二色）
    if (sorted.length > 1) {
        const second = sorted[1];
        const dr = second.r - sorted[0].r;
        const dg = second.g - sorted[0].g;
        const db = second.b - sorted[0].b;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (second.count / totalEdgePixels > 0.15 && dist > 20) {
            results.push({ r: second.r, g: second.g, b: second.b });
        }
    }

    return results;
}

/** 颜色量化到 16 级（每级 16） */
function quantizeColor(r: number, g: number, b: number): number {
    const qr = Math.floor(r / 16) * 16;
    const qg = Math.floor(g / 16) * 16;
    const qb = Math.floor(b / 16) * 16;
    return (qr << 16) | (qg << 8) | qb;
}

// ============================================================
// 棋盘格检测兜底
// ============================================================

function detectAndRemoveCheckerboard(data: Uint8ClampedArray, w: number, h: number): boolean {
    const sizes = [8, 10, 12, 16, 4];
    for (const size of sizes) {
        const { colorA, colorB, confidence } = detectCheckerboardPattern(data, w, h, size);
        if (confidence > 0.8) {
            let removed = 0;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const r = data[idx], g = data[idx + 1], b = data[idx + 2];

                    const distA = Math.sqrt((r - colorA.r) ** 2 + (g - colorA.g) ** 2 + (b - colorA.b) ** 2);
                    const distB = Math.sqrt((r - colorB.r) ** 2 + (g - colorB.g) ** 2 + (b - colorB.b) ** 2);
                    const expectedA = ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0);

                    // 像素与所在格的预期颜色接近
                    if ((expectedA && distA < 10) || (!expectedA && distB < 10)) {
                        data[idx + 3] = 0;
                        removed++;
                    }
                }
            }
            if (removed > w * h * 0.03) return true;
        }
    }
    return false;
}

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
    if (distAB < 20) return { colorA, colorB, confidence: 0 };

    let matches = 0, total = 0;
    const maxX = Math.min(w, 200), maxY = Math.min(h, 200);
    for (let y = 0; y < maxY; y += size) {
        for (let x = 0; x < maxX; x += size) {
            const i = (y * w + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const distA = Math.sqrt((r - colorA.r) ** 2 + (g - colorA.g) ** 2 + (b - colorA.b) ** 2);
            const distB = Math.sqrt((r - colorB.r) ** 2 + (g - colorB.g) ** 2 + (b - colorB.b) ** 2);

            const expectedA = ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0);
            const isA = distA < 15, isB = distB < 15;

            if (isA || isB) {
                if ((expectedA && isA) || (!expectedA && isB)) matches++;
                total++;
            }
        }
    }

    const confidence = total > 5 ? matches / total : 0;
    return { colorA, colorB, confidence };
}

// ============================================================
// 通用工具函数
// ============================================================

/** Buffer 转 Uint8ClampedArray */
function bufferToUint8(data: Buffer): Uint8ClampedArray {
    return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
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
        rgbaData[i * 4 + 3] = channels === 4 ? src[srcIdx + 3] : 255;
    }
    return rgbaData;
}

/** 获取图片 Buffer */
async function fetchImageBuffer(input: string): Promise<Buffer> {
    if (Buffer.isBuffer(input)) return input;
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

/** 本地兜底透明化（仅用于本地 rembg 路径） */
export async function createLocalTransparentBg(imageUrl: string): Promise<{ buffer: Buffer; format: 'png' } | null> {
    try {
        const imageBuffer = await fetchImageBuffer(imageUrl);
        const { data, info } = await sharp(imageBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const { width: w, height: h, channels } = info;
        const rgbaData = rgbToRgba(data, w, h, channels);

        if (applyColorDistanceAlpha(rgbaData, w, h)) {
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
