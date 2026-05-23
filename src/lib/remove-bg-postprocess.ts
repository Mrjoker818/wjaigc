import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { saveImageFile } from './server-data-root';

const execFileAsync = promisify(execFile);

/**
 * AI RemoveBG 后处理 — 蒙版 + Alpha 提取结合法
 *
 * 核心思路：AI 已经完美识别主体，输出的图是"主体 + 统一背景"。
 * 
 * 算法：
 * 1. 用 rembg 对 AI 结果生成黑白蒙版 → 确定主体范围（不膨胀！）
 * 2. 用颜色距离计算每个像素的精细 alpha → 边缘自然顺滑
 * 3. 结合：蒙版内的像素 alpha=255（主体全保留），
 *         蒙版外且颜色接近背景的像素 alpha=0（背景全透明），
 *         蒙版边界的像素用颜色距离算过渡 alpha（边缘圆润）
 * 
 * 降级链：已有透明 → 蒙版+Alpha结合 → 颜色距离Alpha → 棋盘格检测 → 原图兜底
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

        // ★ 策略 1: 蒙版 + Alpha 提取结合法（最优）
        const maskResult = await generateRembgMask(imageBuffer, 'u2net');
        if (maskResult) {
            const maskData = maskResult.mask;
            const success = applyMaskPlusAlpha(rgbaData, w, h, maskData);
            if (success) {
                console.log('[AI-RemoveBG] Mask + Alpha extraction succeeded');
                return saveAsPngAndGetUrl(rgbaData, w, h);
            }
        }

        // 降级：尝试 u2netp
        if (!maskResult) {
            const maskResult2 = await generateRembgMask(imageBuffer, 'u2netp');
            if (maskResult2) {
                const success = applyMaskPlusAlpha(rgbaData, w, h, maskResult2.mask);
                if (success) {
                    console.log('[AI-RemoveBG] Mask + Alpha extraction succeeded (u2netp)');
                    return saveAsPngAndGetUrl(rgbaData, w, h);
                }
            }
        }

        // ★ 策略 2: 颜色距离 Alpha 提取（无蒙版降级）
        if (applyColorDistanceAlpha(rgbaData, w, h)) {
            console.log('[AI-RemoveBG] Color distance alpha extraction succeeded (fallback)');
            return saveAsPngAndGetUrl(rgbaData, w, h);
        }

        // ★ 策略 3: 棋盘格检测兜底
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
// 核心：蒙版 + Alpha 提取结合法
// ============================================================

/**
 * 结合 rembg 蒙版和颜色距离 Alpha 的终极算法
 * 
 * 蒙版告诉我们"谁是主体"（二值化），不膨胀。
 * 颜色距离告诉我们"每个像素离背景有多远"（连续值）。
 * 
 * 三类像素处理：
 * 1. 蒙版=主体(白) 且 远离蒙版边界 → alpha=255（主体核心，全保留）
 * 2. 蒙版=主体(白) 且 在蒙版边界附近 → 用颜色距离算 alpha（边缘圆润）
 * 3. 蒙版=背景(黑) → 用颜色距离算 alpha（背景透明，带过渡）
 */
function applyMaskPlusAlpha(
    data: Uint8ClampedArray,
    w: number,
    h: number,
    maskData: Uint8ClampedArray
): boolean {
    // Step 1: 从边缘采样背景色
    const bgColors = sampleEdgeColors(data, w, h);
    if (!bgColors || bgColors.length === 0) {
        console.log('[AI-RemoveBG] No dominant edge color found for mask+alpha');
        return false;
    }

    const primaryBg = bgColors[0];
    const bgR = primaryBg.r, bgG = primaryBg.g, bgB = primaryBg.b;
    const bgBrightness = (bgR + bgG + bgB) / 3;
    const secondaryBg = bgColors.length > 1 ? bgColors[1] : null;

    console.log(`[AI-RemoveBG] Mask+Alpha: bg=rgb(${bgR},${bgG},${bgB}), brightness=${bgBrightness.toFixed(0)}`);

    // Step 2: 动态阈值
    let tightThreshold: number;
    let wideThreshold: number;

    if (bgBrightness < 30) {
        tightThreshold = 4; wideThreshold = 15;
    } else if (bgBrightness < 80) {
        tightThreshold = 5; wideThreshold = 18;
    } else if (bgBrightness < 180) {
        tightThreshold = 6; wideThreshold = 22;
    } else {
        tightThreshold = 8; wideThreshold = 28;
    }

    // Step 3: 构建蒙版边界距离图
    // 对蒙版做距离变换：每个像素离最近的蒙版边界的距离
    // 蒙版边界 = 主体像素(白) 与 背景像素(黑) 的交界处
    const isSubject = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        isSubject[i] = maskData[i * 4] > 128 ? 1 : 0; // R通道，白=主体
    }

    // 计算每个主体像素离蒙版边界的距离（简单的 BFS 距离变换）
    const borderDist = new Int16Array(w * h).fill(-1); // -1=背景像素
    const distQueue: number[] = [];

    // 初始化：蒙版边界上的主体像素（4邻域中有背景像素的主体像素）
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            if (!isSubject[idx]) continue;

            // 检查是否在边界
            let onBorder = false;
            const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
            for (const [nx, ny] of neighbors) {
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
                    onBorder = true; break;
                }
                if (!isSubject[ny * w + nx]) {
                    onBorder = true; break;
                }
            }
            if (onBorder) {
                borderDist[idx] = 0;
                distQueue.push(idx);
            }
        }
    }

    // BFS 扩展距离
    let qi = 0;
    while (qi < distQueue.length) {
        const idx = distQueue[qi++];
        const x = idx % w, y = Math.floor(idx / w);
        const d = borderDist[idx];
        const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nIdx = ny * w + nx;
            if (borderDist[nIdx] !== -1) continue; // 已访问
            if (!isSubject[nIdx]) continue; // 只扩展主体像素
            borderDist[nIdx] = d + 1;
            distQueue.push(nIdx);
        }
    }

    // Step 4: 结合蒙版和颜色距离，计算最终 alpha
    const blendZone = 3; // 蒙版边界过渡区宽度（像素）

    let transparentCount = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const px = idx * 4;
            const r = data[px], g = data[px + 1], b = data[px + 2];

            // 计算与背景色的颜色距离
            const dr = r - bgR, dg = g - bgG, db = b - bgB;
            let dist = Math.sqrt(dr * dr + dg * dg + db * db);
            if (secondaryBg) {
                const dr2 = r - secondaryBg.r, dg2 = g - secondaryBg.g, db2 = b - secondaryBg.b;
                dist = Math.min(dist, Math.sqrt(dr2 * dr2 + dg2 * dg2 + db2 * db2));
            }

            // 颜色距离 → alpha（0=背景透明, 255=主体不透明）
            let colorAlpha: number;
            if (dist <= tightThreshold) {
                colorAlpha = 0;
            } else if (dist >= wideThreshold) {
                colorAlpha = 255;
            } else {
                colorAlpha = Math.round(((dist - tightThreshold) / (wideThreshold - tightThreshold)) * 255);
            }

            if (isSubject[idx]) {
                // 主体像素
                const bd = borderDist[idx];
                if (bd >= blendZone) {
                    // 主体核心区域：alpha=255，绝不透明
                    data[px + 3] = 255;
                } else {
                    // 主体边界区域：在蒙版和颜色距离之间插值
                    // blendFactor: 0=边界上, 1=blendZone像素远
                    const blendFactor = bd / blendZone;
                    // 边界上：用颜色距离 alpha（更顺滑）
                    // blendZone外：用蒙版 alpha=255（保护主体）
                    const finalAlpha = Math.round(colorAlpha * (1 - blendFactor) + 255 * blendFactor);
                    data[px + 3] = Math.max(finalAlpha, 50); // 主体边界最低 50，防止误删
                }
            } else {
                // 背景像素：直接用颜色距离 alpha
                // 边缘连通性保护：只允许与图片边缘连通的背景变透明
                data[px + 3] = colorAlpha;
            }

            if (data[px + 3] < 250) transparentCount++;
        }
    }

    // Step 5: 背景区域的边缘连通性保护
    // 只保留与图片边缘连通的透明区域，防止主体内部出现"空洞"
    applyEdgeConnectivity(data, w, h);

    const pct = (transparentCount / (w * h)) * 100;
    console.log(`[AI-RemoveBG] Mask+Alpha: ${pct.toFixed(1)}% pixels transparent`);

    if (pct < 3) {
        for (let i = 0; i < w * h; i++) { data[i * 4 + 3] = 255; }
        console.log('[AI-RemoveBG] Too few transparent pixels, treating as failure');
        return false;
    }

    return true;
}

/**
 * 边缘连通性保护：只保留与图片边缘连通的透明区域
 * 主体内部的透明"空洞"会被恢复为不透明
 */
function applyEdgeConnectivity(data: Uint8ClampedArray, w: number, h: number): void {
    const isTransparent = new Uint8Array(w * h);
    const visited = new Uint8Array(w * h);

    // 标记所有半透明/透明像素
    for (let i = 0; i < w * h; i++) {
        isTransparent[i] = data[i * 4 + 3] < 250 ? 1 : 0;
    }

    // 从四条边的透明像素开始 BFS
    const queue: number[] = [];
    const edgeConnected = new Uint8Array(w * h);

    for (let x = 0; x < w; x++) {
        if (isTransparent[x]) { edgeConnected[x] = 1; queue.push(x); }
        const bIdx = (h - 1) * w + x;
        if (isTransparent[bIdx]) { edgeConnected[bIdx] = 1; queue.push(bIdx); }
    }
    for (let y = 1; y < h - 1; y++) {
        const lIdx = y * w;
        if (isTransparent[lIdx]) { edgeConnected[lIdx] = 1; queue.push(lIdx); }
        const rIdx = y * w + (w - 1);
        if (isTransparent[rIdx]) { edgeConnected[rIdx] = 1; queue.push(rIdx); }
    }

    // BFS 扩展
    let qi = 0;
    while (qi < queue.length) {
        const idx = queue[qi++];
        const x = idx % w, y = Math.floor(idx / w);
        const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nIdx = ny * w + nx;
            if (edgeConnected[nIdx]) continue;
            if (isTransparent[nIdx]) {
                edgeConnected[nIdx] = 1;
                queue.push(nIdx);
            }
        }
    }

    // 不与边缘连通的透明区域 → 恢复为不透明（保护主体内部）
    let restored = 0;
    for (let i = 0; i < w * h; i++) {
        if (isTransparent[i] && !edgeConnected[i]) {
            data[i * 4 + 3] = 255;
            restored++;
        }
    }
    if (restored > 0) {
        console.log(`[AI-RemoveBG] Restored ${restored} interior transparent pixels (subject protection)`);
    }
}

// ============================================================
// rembg 蒙版生成
// ============================================================

interface MaskResult {
    mask: Uint8ClampedArray; // RGBA, 白=主体, 黑=背景
    width: number;
    height: number;
}

/**
 * 用 rembg 生成黑白蒙版（仅蒙版，不含膨胀/羽化）
 * AI 结果的背景是统一颜色，rembg 极易精确分割
 */
async function generateRembgMask(imageBuffer: Buffer, model: string): Promise<MaskResult | null> {
    try {
        const venvPython = '/workspace/projects/.venv/bin/python3';
        const script = '/workspace/projects/scripts/iopaint_removebg.py';
        const inputB64 = imageBuffer.toString('base64');

        const { stdout, stderr } = await execFileAsync(venvPython, [
            script, '--gen_mask', '--model', model,
        ], {
            input: Buffer.from(inputB64, 'utf-8'),
            maxBuffer: 50 * 1024 * 1024,
            timeout: 60000,
            encoding: 'buffer',
        } as any);

        if (stderr.length > 0) {
            const errMsg = stderr.toString().slice(0, 200);
            if (errMsg.includes('Error') || errMsg.includes('error')) {
                console.log(`[AI-RemoveBG] rembg mask stderr: ${errMsg}`);
            }
        }

        if (!stdout || stdout.length < 100) {
            console.log(`[AI-RemoveBG] rembg mask output too small: ${stdout?.length || 0} bytes`);
            return null;
        }

        // 解码蒙版 PNG
        const { data, info } = await sharp(stdout)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        return {
            mask: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
            width: info.width,
            height: info.height,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[AI-RemoveBG] rembg mask generation failed (${model}): ${msg.slice(0, 200)}`);
        return null;
    }
}

// ============================================================
// 颜色距离 Alpha 提取（无蒙版降级方案）
// ============================================================

function applyColorDistanceAlpha(data: Uint8ClampedArray, w: number, h: number): boolean {
    const bgColors = sampleEdgeColors(data, w, h);
    if (!bgColors || bgColors.length === 0) {
        console.log('[AI-RemoveBG] No dominant edge color found');
        return false;
    }

    const primaryBg = bgColors[0];
    const bgR = primaryBg.r, bgG = primaryBg.g, bgB = primaryBg.b;
    const bgBrightness = (bgR + bgG + bgB) / 3;
    const secondaryBg = bgColors.length > 1 ? bgColors[1] : null;

    let tightThreshold: number;
    let wideThreshold: number;

    if (bgBrightness < 30) {
        tightThreshold = 4; wideThreshold = 15;
    } else if (bgBrightness < 80) {
        tightThreshold = 5; wideThreshold = 18;
    } else if (bgBrightness < 180) {
        tightThreshold = 6; wideThreshold = 20;
    } else {
        tightThreshold = 8; wideThreshold = 25;
    }

    const alphaMap = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const px = idx * 4;
            const r = data[px], g = data[px + 1], b = data[px + 2];

            const dr = r - bgR, dg = g - bgG, db = b - bgB;
            let dist = Math.sqrt(dr * dr + dg * dg + db * db);
            if (secondaryBg) {
                const dr2 = r - secondaryBg.r, dg2 = g - secondaryBg.g, db2 = b - secondaryBg.b;
                dist = Math.min(dist, Math.sqrt(dr2 * dr2 + dg2 * dg2 + db2 * db2));
            }

            if (dist <= tightThreshold) {
                alphaMap[idx] = 0;
            } else if (dist >= wideThreshold) {
                alphaMap[idx] = 1;
            } else {
                alphaMap[idx] = (dist - tightThreshold) / (wideThreshold - tightThreshold);
            }
        }
    }

    // 边缘连通性 BFS
    const canBeTransparent = new Uint8Array(w * h);
    const queue: number[] = [];

    for (let x = 0; x < w; x++) {
        enqueueBg(x, 0); enqueueBg(x, h - 1);
    }
    for (let y = 1; y < h - 1; y++) {
        enqueueBg(0, y); enqueueBg(w - 1, y);
    }

    function enqueueBg(x: number, y: number) {
        const idx = y * w + x;
        if (canBeTransparent[idx]) return;
        if (alphaMap[idx] < 0.5) {
            canBeTransparent[idx] = 1;
            queue.push(idx);
        }
    }

    let qi = 0;
    while (qi < queue.length) {
        const idx = queue[qi++];
        const x = idx % w, y = Math.floor(idx / w);
        const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nIdx = ny * w + nx;
            if (canBeTransparent[nIdx]) continue;
            if (alphaMap[nIdx] < 0.6) {
                canBeTransparent[nIdx] = 1;
                queue.push(nIdx);
            }
        }
    }

    let transparentCount = 0;
    for (let i = 0; i < w * h; i++) {
        if (canBeTransparent[i]) {
            data[i * 4 + 3] = Math.round(alphaMap[i] * 255);
            if (data[i * 4 + 3] < 250) transparentCount++;
        }
    }

    const pct = (transparentCount / (w * h)) * 100;
    if (pct < 3) {
        for (let i = 0; i < w * h; i++) { data[i * 4 + 3] = 255; }
        return false;
    }
    return true;
}

// ============================================================
// 边缘背景色采样
// ============================================================

function sampleEdgeColors(data: Uint8ClampedArray, w: number, h: number): Array<{ r: number; g: number; b: number }> | null {
    const band = 3;
    const colorCounts = new Map<number, { r: number; g: number; b: number; count: number }>();

    for (let x = 0; x < w; x++) {
        for (let dy = 0; dy < band && dy < h; dy++) { addSample(x, dy); }
        for (let dy = 0; dy < band && (h - 1 - dy) >= 0; dy++) { addSample(x, h - 1 - dy); }
    }
    for (let y = band; y < h - band; y++) {
        for (let dx = 0; dx < band; dx++) { addSample(dx, y); }
        for (let dx = 0; dx < band; dx++) { addSample(w - 1 - dx, y); }
    }

    function addSample(x: number, y: number) {
        const idx = (y * w + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const key = quantizeColor(r, g, b);
        const existing = colorCounts.get(key);
        if (existing) {
            existing.r += r; existing.g += g; existing.b += b; existing.count++;
        } else {
            colorCounts.set(key, { r, g, b, count: 1 });
        }
    }

    if (colorCounts.size === 0) return null;

    const sorted = Array.from(colorCounts.values())
        .map(c => ({
            r: Math.round(c.r / c.count), g: Math.round(c.g / c.count),
            b: Math.round(c.b / c.count), count: c.count,
        }))
        .sort((a, b) => b.count - a.count);

    const totalEdgePixels = sorted.reduce((s, c) => s + c.count, 0);
    const results: Array<{ r: number; g: number; b: number }> = [];

    if (sorted[0].count / totalEdgePixels < 0.25) return null;
    results.push({ r: sorted[0].r, g: sorted[0].g, b: sorted[0].b });

    if (sorted.length > 1) {
        const second = sorted[1];
        const dr = second.r - sorted[0].r, dg = second.g - sorted[0].g, db = second.b - sorted[0].b;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (second.count / totalEdgePixels > 0.15 && dist > 20) {
            results.push({ r: second.r, g: second.g, b: second.b });
        }
    }

    return results;
}

function quantizeColor(r: number, g: number, b: number): number {
    return (Math.floor(r / 16) * 16 << 16) | (Math.floor(g / 16) * 16 << 8) | Math.floor(b / 16) * 16;
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
                    if ((expectedA && distA < 10) || (!expectedA && distB < 10)) {
                        data[idx + 3] = 0; removed++;
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

    const distAB = Math.sqrt((colorA.r - colorB.r) ** 2 + (colorA.g - colorB.g) ** 2 + (colorA.b - colorB.b) ** 2);
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
            if ((distA < 15) || (distB < 15)) {
                if ((expectedA && distA < 15) || (!expectedA && distB < 15)) matches++;
                total++;
            }
        }
    }
    return { colorA, colorB, confidence: total > 5 ? matches / total : 0 };
}

// ============================================================
// 通用工具函数
// ============================================================

function bufferToUint8(data: Buffer): Uint8ClampedArray {
    return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
}

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

async function saveAsPngAndGetUrl(data: Uint8ClampedArray, width: number, height: number): Promise<string> {
    const pngBuffer = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
        raw: { width, height, channels: 4 }
    }).png().toBuffer();

    const filename = `transparent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
    return saveImageFile(pngBuffer, filename, 'uploads');
}

/** 本地兜底透明化 */
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
            }).png().toBuffer();
            return { buffer, format: 'png' };
        }

        if (detectAndRemoveCheckerboard(rgbaData, w, h)) {
            const buffer = await sharp(Buffer.from(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength), {
                raw: { width: w, height: h, channels: 4 }
            }).png().toBuffer();
            return { buffer, format: 'png' };
        }

        return null;
    } catch (e) {
        console.error('[Local-Transparent-Bg] Error:', e);
        return null;
    }
}
