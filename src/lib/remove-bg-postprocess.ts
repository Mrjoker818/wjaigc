import sharp from 'sharp';
import { saveImageFile } from './server-data-root';

/** Buffer 转 Uint8ClampedArray */
function bufferToUint8ClampedArray(buf: Buffer): Uint8ClampedArray {
    return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
}

// 极简安全策略：只把 AI 明确标记为背景的像素设为透明
// 绝不碰任何可能是主体的像素！
// 策略 1: 如果已有透明 alpha 通道 → 直接用
// 策略 2: 棋盘格背景 → 只替换明确是棋盘格的像素
// 策略 3: 纯色背景 → 只替换和边缘颜色完全相同且连通的像素
// 兜底: 返回全不透明 PNG

export async function postProcessAIRemoveBG(imageUrl: string): Promise<string | null> {
    try {
        const imageBuffer = await fetchImageBuffer(imageUrl);
        const { data, info } = await sharp(imageBuffer)
            .raw()
            .toBuffer({ resolveWithObject: true });
        const { width: w, height: h, channels } = info;
        const pixelCount = w * h;

        // 检查是否已有 alpha
        if (channels === 4) {
            let hasTransparency = false;
            for (let i = 0; i < pixelCount; i++) {
                if (data[i * 4 + 3] < 255) {
                    hasTransparency = true;
                    break;
                }
            }
            if (hasTransparency) {
                console.log('[AI-RemoveBG] Already has transparent alpha');
                const clampedData = bufferToUint8ClampedArray(data);
                return saveAsPngAndGetUrl(clampedData, w, h);
            }
        }

        // 准备带 alpha 的 buffer
        const clampedData = bufferToUint8ClampedArray(data);
        const rgbaData = new Uint8ClampedArray(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            const srcIdx = channels === 4 ? i * 4 : i * 3;
            rgbaData[i * 4] = clampedData[srcIdx];
            rgbaData[i * 4 + 1] = clampedData[srcIdx + 1];
            rgbaData[i * 4 + 2] = clampedData[srcIdx + 2];
            rgbaData[i * 4 + 3] = 255; // 默认不透明
        }

        // 策略1: 精确棋盘格检测（最安全）
        if (detectAndRemoveCheckerboard(rgbaData, w, h)) {
            console.log('[AI-RemoveBG] Checkerboard removed');
            return saveAsPngAndGetUrl(rgbaData, w, h);
        }

        // 策略2: 纯色背景检测（只替换边缘连通的同色像素）
        if (detectAndRemoveSolidBackground(rgbaData, w, h)) {
            console.log('[AI-RemoveBG] Solid background removed');
            return saveAsPngAndGetUrl(rgbaData, w, h);
        }

        // 兜底：没有找到明确背景模式，返回全不透明 PNG
        console.log('[AI-RemoveBG] No clear background pattern, returning opaque PNG');
        return saveAsPngAndGetUrl(rgbaData, w, h);
    } catch (e) {
        console.error('[AI-RemoveBG] Post-processing error:', e);
        return null;
    }
}

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

/** 检测并移除棋盘格背景（精确检测） */
function detectAndRemoveCheckerboard(data: Uint8ClampedArray, w: number, h: number): boolean {
    const sizes = [8, 10, 12, 16, 4];
    for (const size of sizes) {
        const { pattern, colorA, colorB, confidence } = detectCheckerboardPattern(data, w, h, size);
        if (pattern === 'clear' && confidence > 0.8) {
            // 精确移除：只替换明确是棋盘格的像素
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
            const distA2 = Math.sqrt((r2 - colorA.r) ** 2 + (g2 - colorA.g) ** 2 + (b2 - colorA.b) ** 2);
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

/** 本地兜底透明化（仅用于本地 rembg） */
export async function createLocalTransparentBg(imageUrl: string): Promise<{ buffer: Buffer; format: 'png' } | null> {
    try {
        const imageBuffer = await fetchImageBuffer(imageUrl);
        const { data, info } = await sharp(imageBuffer)
            .raw()
            .toBuffer({ resolveWithObject: true });
        const { width: w, height: h, channels } = info;
        const pixelCount = w * h;

        const clampedData = bufferToUint8ClampedArray(data);
        const rgbaData = new Uint8ClampedArray(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            const srcIdx = channels === 4 ? i * 4 : i * 3;
            rgbaData[i * 4] = clampedData[srcIdx];
            rgbaData[i * 4 + 1] = clampedData[srcIdx + 1];
            rgbaData[i * 4 + 2] = clampedData[srcIdx + 2];
            rgbaData[i * 4 + 3] = 255;
        }

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
