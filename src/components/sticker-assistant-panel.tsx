'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GripVertical, X, Minus, Sparkles, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Download, ChevronRight, Smile, Upload, ImagePlus, Archive } from 'lucide-react';
import JSZip from 'jszip';
import { getModelDisplayName } from '@/lib/model-name-map';
import { getStickerModelLoadDiagnosticMessage } from '@/lib/sticker-model-load-state';
import { getStickerFailureMessage } from '@/lib/sticker-failure-message';


/* ──────────────────── 主题色 ──────────────────── */
const themes = {
  gold: {
    panelBg: '#1a1a1a',
    deepBg: '#141414',
    cardBg: '#222',
    inputBg: '#1e1e1e',
    border: 'rgba(255,255,255,0.08)',
    accent: '#d4af37',
    accentHover: '#e0be4a',
    accentBg: 'rgba(212,175,55,0.10)',
    text: '#e5e5e5',
    textSub: '#a3a3a3',
    textDim: '#737373',
    shadow: '0 8px 32px rgba(0,0,0,0.5)',
    headerGrad: 'linear-gradient(135deg, #222 0%, #1a1a1a 100%)',
    btnClose: '#ef4444',
  },
  mono: {
    panelBg: '#ffffff',
    deepBg: '#f9fafb',
    cardBg: '#ffffff',
    inputBg: '#ffffff',
    border: '#e5e7eb',
    accent: '#2563eb',
    accentHover: '#1d4ed8',
    accentBg: 'rgba(37,99,235,0.06)',
    text: '#1f2937',
    textSub: '#6b7280',
    textDim: '#9ca3af',
    shadow: '0 8px 32px rgba(0,0,0,0.08)',
    headerGrad: 'linear-gradient(135deg, #f3f4f6 0%, #ffffff 100%)',
    btnClose: '#dc2626',
  },
} as const;

type ThemeKey = keyof typeof themes;

/* ──────────────────── 数据类型 ──────────────────── */
interface StickerItem {
  id: number;
  caption: string;
  action: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  imageUrl?: string;
  error?: string;
}

interface StylePreset {
  key: string;
  label: string;
  icon: string;
  positivePrompt: string;
  negativePrompt: string;
}

interface ThemePreset {
  key: string;
  label: string;
  icon: string;
  captions: string[];
  mood: string;
}

interface ModelOption {
  id: string;
  providerId: string;
  providerName: string;
  displayLabel?: string;
}

/* ──────────────────── 预设数据 (from Zinxtick) ──────────────────── */
const STYLE_PRESETS: StylePreset[] = [
  {
    key: 'general',
    label: '大众通用',
    icon: '😊',
    positivePrompt: 'cute cartoon sticker, thick outlines, vivid solid colors, flat shading, clean white background, sticker art style, expressive pose, die-cut sticker, chibi proportions',
    negativePrompt: 'photorealistic, 3d render, complex details, gradient, realistic texture, blurry, low quality, watermark, text, cluttered background, detailed background, checkerboard, mosaic, noise, pattern',
  },
  {
    key: 'comic',
    label: '漫画风格',
    icon: '💥',
    positivePrompt: 'manga style sticker, screen tones, bold ink outlines, dynamic action lines, monochrome with spot color, speech bubble elements, dramatic expression, clean white background, die-cut sticker',
    negativePrompt: 'photorealistic, watercolor, pastel, gradient, realistic shading, blurry, low quality, watermark, cluttered background, detailed background, checkerboard, mosaic, noise, pattern',
  },
  {
    key: 'classic',
    label: '经典贴纸',
    icon: '⭐',
    positivePrompt: 'die-cut sticker style, clean vector outline, solid bold colors, clean white background, whimsical character design, rounded shapes, professional sticker production, white border outline',
    negativePrompt: 'photorealistic, 3d, gradient, messy lines, blurry, low quality, watermark, photo, cluttered background, detailed background, checkerboard, mosaic, noise, pattern',
  },
  {
    key: 'flat',
    label: '平面设计',
    icon: '🎨',
    positivePrompt: 'flat design sticker, minimal geometric shapes, limited color palette, clean vector art, bold solid fills, no shadows, modern graphic style, simple silhouettes, white background, die-cut sticker',
    negativePrompt: 'realistic, 3d, gradient, texture, complex details, watercolor, photorealistic, blurry',
  },
  {
    key: 'retro',
    label: '古早QQ风',
    icon: '🐧',
    positivePrompt: 'early 2000s Chinese QQ sticker style, pixel-art influenced, simple round body, big head small body, bright saturated colors, cute kawaii expression, retro digital feel, simple gif-style pose, clean white background, die-cut sticker',
    negativePrompt: 'photorealistic, 3d render, complex shading, realistic, modern minimalist, gradient, checkerboard, mosaic, noise, pattern',
  },
  {
    key: 'custom',
    label: '自定义',
    icon: '✏️',
    positivePrompt: '',
    negativePrompt: '',
  },
];

const THEME_PRESETS: ThemePreset[] = [
  { key: 'everyday', label: '日常高频', icon: '💬', captions: ['收到','谢谢','好耶','加油','不行','你猜','无语','吃瓜','摸鱼','开摆','裂开','困了','抱抱','冲','哈哈','晚安'], mood: '日常实用、友好亲切' },
  { key: 'work', label: '打工摸鱼', icon: '💼', captions: ['收到','在忙','马上','加班中','摸鱼','开会了','别催','需求变了','崩溃','救命','下班','老板来了','先鸽了','继续冲','已读乱回','周一不想动'], mood: '疲惫搞笑、社交解压' },
  { key: 'sarcastic', label: '阴阳怪气', icon: '😏', captions: ['你猜','啊对对对','就不','关我啥事','你说得对','好棒棒','笑死','我不信','真的假的','还有这事','你开心就好','懂了','已阅','退退退','看戏','别装'], mood: '傲娇吐槽、俏皮搞笑' },
  { key: 'cute', label: '可爱贴贴', icon: '💕', captions: ['贴贴','抱抱','想你','喜欢','谢谢你','辛苦啦','摸摸头','不哭','陪你','晚安','早安','开心','给你花花','心动','充电中','一起躺'], mood: '温暖治愈、软萌贴心' },
  { key: 'food', label: '吃喝玩乐', icon: '🍜', captions: ['开吃','干杯','好香','饿了','吃瓜','点奶茶','续命','出门玩','躺平','快乐水','再来一口','买它','排队中','拍照','嗨起来','明天减肥'], mood: '热闹感官、快乐吃喝' },
  { key: 'holiday', label: '节日祝福', icon: '🎉', captions: ['早安','晚安','新年好','恭喜发财','大吉大利','平安喜乐','生日快乐','谢谢','想你','祝你好运','万事顺意','元气满满','收红包','干杯','团圆啦','明天更好'], mood: '积极温暖、吉祥如意' },
  { key: 'custom', label: '自定义', icon: '✏️', captions: [], mood: '' },
];

/* ──────────────────── Props ──────────────────── */
interface StickerAssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  isMonochrome?: boolean;
  onAddImages?: (urls: string[], meta?: { modelName?: string; apiProvider?: string }) => void;
}

/* ──────────────────── 表情包背景统一处理（参考 zinxtick production-qa：structured masking + white border + edge anti-aliasing） ──────────────────── */

/**
 * 为透明PNG添加白边描边（die-cut sticker 标准效果）
 * 在主体周围绘制2-3px白色描边，让贴纸在任意背景上都清晰可见
 */
async function addWhiteBorderStroke(imageUrl: string, borderWidth: number = 2): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const { width, height } = img;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }

        // 1. 先绘制扩展版（描边层）：稍微放大后绘制白色剪影
        const strokeCanvas = document.createElement('canvas');
        strokeCanvas.width = width;
        strokeCanvas.height = height;
        const strokeCtx = strokeCanvas.getContext('2d');
        if (!strokeCtx) { resolve(null); return; }

        // 先画原图到临时canvas
        strokeCtx.drawImage(img, 0, 0);
        const strokeData = strokeCtx.getImageData(0, 0, width, height);
        const sd = strokeData.data;

        // 标记不透明像素
        const opaque = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
          opaque[i] = sd[i * 4 + 3] > 128 ? 1 : 0;
        }

        // 对不透明区域做膨胀（dilate），扩展 borderWidth 像素
        const dilated = new Uint8Array(width * height);
        dilated.set(opaque);
        for (let pass = 0; pass < borderWidth; pass++) {
          const prev = new Uint8Array(dilated);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const idx = y * width + x;
              if (prev[idx]) { dilated[idx] = 1; continue; }
              // 4邻域有不透明像素则膨胀
              if ((x > 0 && prev[y * width + (x - 1)]) ||
                  (x < width - 1 && prev[y * width + (x + 1)]) ||
                  (y > 0 && prev[(y - 1) * width + x]) ||
                  (y < height - 1 && prev[(y + 1) * width + x])) {
                dilated[idx] = 1;
              }
            }
          }
        }

        // 2. 在主canvas上绘制白边描边
        // 白边区域 = dilated - opaque（膨胀多出来的部分）
        ctx.fillStyle = 'white';
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (dilated[idx] && !opaque[idx]) {
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }

        // 3. 在白边之上绘制原始图像
        ctx.drawImage(img, 0, 0);

        // 4. 持久化
        canvas.toBlob(async (blob) => {
          if (!blob) { resolve(null); return; }
          try {
            const formData = new FormData();
            formData.append('file', blob, 'sticker-bordered.png');
            const res = await fetch('/api/save-image', { method: 'POST', body: formData });
            if (res.ok) {
              const result = await res.json();
              resolve(result.url || null);
            } else {
              resolve(canvas.toDataURL('image/png'));
            }
          } catch {
            resolve(canvas.toDataURL('image/png'));
          }
        }, 'image/png');
      };
      img.onerror = () => resolve(null);
      img.src = imageUrl;
    } catch {
      resolve(null);
    }
  });
}

/**
 * 表情包背景统一处理流程：
 * 1. 优先使用服务端 RemoveBG（IOPaint BiRefNet / AI模型）— 最专业，支持任意背景
 * 2. 服务端不可用时，回退到本地 BFS flood-fill 算法
 * 3. 最后统一添加白边描边（die-cut sticker 标准效果）
 */
async function processStickerBackground(imageUrl: string, modelId?: string | null): Promise<string | null> {
  // ── Step 1: 尝试服务端 RemoveBG ──
  let transparentUrl: string | null = null;
  try {
    const pollModelId = modelId?.includes('::') ? modelId.split('::').pop()! : (modelId || undefined);
    const pollProviderId = modelId?.includes('::') ? modelId.split('::')[0] : undefined;
    const res = await fetch('/api/image-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'remove_background',
        imageUrl,
        model: pollModelId,
        providerId: pollProviderId,
        removeBgModel: 'birefnet-general-lite',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.imageUrl) {
        // 同步模式：直接拿到透明图
        transparentUrl = data.imageUrl;
      } else if (data.success && data.taskId) {
        // 异步模式：轮询等待结果
        const taskId = data.taskId;
        const usedProviderId = pollProviderId || data.usedProviderId;
        for (let attempt = 0; attempt < 60; attempt++) {
          await new Promise(r => setTimeout(r, 2000));
          const pollRes = await fetch('/api/poll-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, model: pollModelId, providerId: usedProviderId }),
          });
          if (!pollRes.ok) continue;
          const pollData = await pollRes.json();
          if (pollData.status === 'completed') {
            transparentUrl = pollData.imageUrl || (pollData.imageUrls?.length > 0 ? pollData.imageUrls[0] : null);
            break;
          }
          if (pollData.status === 'failed') break;
        }
      }
    }
  } catch { /* 服务端 RemoveBG 不可用 */ }

  // ── Step 2: 回退到本地算法 ──
  if (!transparentUrl) {
    transparentUrl = await removeBackgroundLocal(imageUrl);
  }

  // ── Step 3: 统一添加白边描边 ──
  if (transparentUrl) {
    const borderedUrl = await addWhiteBorderStroke(transparentUrl, 2);
    return borderedUrl || transparentUrl;
  }

  return null;
}

/* ── 本地背景移除算法（BFS flood-fill + edge-flood + 边缘颜色修复 + 通道预乘抗锯齿） ── */
async function removeBackgroundLocal(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const { width, height } = img;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        const { data } = imageData;

        // ── 1. 采样四边像素，计算背景色 ──
        let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
        const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 50));
        for (let x = 0; x < width; x += sampleStep) {
          for (const yy of [0, height - 1]) {
            const idx = (yy * width + x) * 4;
            if (data[idx + 3] < 128) continue;
            bgR += data[idx]; bgG += data[idx + 1]; bgB += data[idx + 2]; bgCount++;
          }
        }
        for (let y = sampleStep; y < height - sampleStep; y += sampleStep) {
          for (const xx of [0, width - 1]) {
            const idx = (y * width + xx) * 4;
            if (data[idx + 3] < 128) continue;
            bgR += data[idx]; bgG += data[idx + 1]; bgB += data[idx + 2]; bgCount++;
          }
        }
        if (bgCount === 0) { resolve(null); return; }
        bgR = Math.round(bgR / bgCount);
        bgG = Math.round(bgG / bgCount);
        bgB = Math.round(bgB / bgCount);

        // 处理浅色到中等亮度背景（亮度>120），覆盖更多场景
        const bgBrightness = (bgR * 299 + bgG * 587 + bgB * 114) / 1000;
        if (bgBrightness < 120) { resolve(null); return; }

        // ── 2. 创建浮点 alpha mask（0=透明, 1=不透明），初始化全1 ──
        const mask = new Float32Array(width * height).fill(1.0);

        // ── 3. BFS flood-fill 从四边标记背景区域 ──
        // 使用较高容差(55)彻底清除背景，作为服务端RemoveBG的回退
        const bgTolerance = 55;
        const visited = new Uint8Array(width * height);
        const isBackground = new Uint8Array(width * height);
        const queue: number[] = [];

        for (let x = 0; x < width; x++) {
          queue.push(x);
          queue.push((height - 1) * width + x);
        }
        for (let y = 1; y < height - 1; y++) {
          queue.push(y * width);
          queue.push(y * width + (width - 1));
        }

        while (queue.length > 0) {
          const idx = queue.shift()!;
          if (visited[idx]) continue;
          visited[idx] = 1;

          const px = idx * 4;
          const r = data[px], g = data[px + 1], b = data[px + 2], a = data[px + 3];
          if (a < 128) { isBackground[idx] = 1; continue; } // 已透明视为背景

          const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
          if (dist > bgTolerance) continue; // 非背景像素，BFS停止

          isBackground[idx] = 1;

          const x = idx % width, y = Math.floor(idx / width);
          if (x > 0) queue.push(y * width + (x - 1));
          if (x < width - 1) queue.push(y * width + (x + 1));
          if (y > 0) queue.push((y - 1) * width + x);
          if (y < height - 1) queue.push((y + 1) * width + x);
        }

        // ── 4. 白边保护：检测白边环带（紧贴主体的亮色像素） ──
        // 找到背景区域边界，向内扩展2-3px保护白边
        const whiteBorder = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (isBackground[idx]) continue; // 背景区域不处理
            // 检查8邻域是否有背景像素
            let hasBgNeighbor = false;
            for (let dy = -1; dy <= 1 && !hasBgNeighbor; dy++) {
              for (let dx = -1; dx <= 1 && !hasBgNeighbor; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) { hasBgNeighbor = true; continue; }
                if (isBackground[ny * width + nx]) hasBgNeighbor = true;
              }
            }
            if (hasBgNeighbor) {
              // 这是背景-前景边界上的像素，标记为白边区域
              const px = idx * 4;
              const r = data[px], g = data[px + 1], b = data[px + 2];
              const brightness = (r * 299 + g * 587 + b * 114) / 1000;
              if (brightness > 200) { // 亮色像素视为白边
                whiteBorder[idx] = 1;
              }
            }
          }
        }

        // 从白边向内扩展2px（白边通常2-3px宽）
        const whiteBorderExpanded = new Uint8Array(width * height);
        whiteBorderExpanded.set(whiteBorder);
        for (let pass = 0; pass < 2; pass++) {
          const temp = new Uint8Array(width * height);
          temp.set(whiteBorderExpanded);
          for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
              const idx = y * width + x;
              if (whiteBorderExpanded[idx]) continue;
              if (isBackground[idx]) continue;
              // 8邻域有白边像素且当前像素也是亮色 → 扩展白边
              let hasWbNeighbor = false;
              for (let dy = -1; dy <= 1 && !hasWbNeighbor; dy++) {
                for (let dx = -1; dx <= 1 && !hasWbNeighbor; dx++) {
                  if (dx === 0 && dy === 0) continue;
                  if (whiteBorderExpanded[(y + dy) * width + (x + dx)]) hasWbNeighbor = true;
                }
              }
              if (hasWbNeighbor) {
                const px = idx * 4;
                const r = data[px], g = data[px + 1], b = data[px + 2];
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                if (brightness > 200) temp[idx] = 1;
              }
            }
          }
          whiteBorderExpanded.set(temp);
        }

        // ── 5. 应用 mask：背景=0，白边=1，其他前景=1 ──
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (isBackground[idx] && !whiteBorderExpanded[idx]) {
              mask[idx] = 0; // 背景透明
            }
            // 白边区域和主体区域保持 mask=1
          }
        }

        // ── 6. 多次分离式 box blur（水平+垂直，近似高斯模糊，O(N)复杂度） ──
        // 使用 5x1 + 1x5 分离式卷积，半径更大，抗锯齿效果更好
        const blurRadius = 2; // 半径2 = 5px宽
        const blurPasses = 4; // 4次迭代，近似σ≈2.4的高斯
        let bSrc = new Float32Array(mask);
        const bDst = new Float32Array(width * height);

        for (let pass = 0; pass < blurPasses; pass++) {
          // 水平方向
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              let sum = 0, cnt = 0;
              for (let dx = -blurRadius; dx <= blurRadius; dx++) {
                const nx = x + dx;
                if (nx >= 0 && nx < width) {
                  sum += bSrc[y * width + nx];
                  cnt++;
                }
              }
              bDst[y * width + x] = sum / cnt;
            }
          }
          // 垂直方向
          const tmp = new Float32Array(width * height);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              let sum = 0, cnt = 0;
              for (let dy = -blurRadius; dy <= blurRadius; dy++) {
                const ny = y + dy;
                if (ny >= 0 && ny < height) {
                  sum += bDst[ny * width + x];
                  cnt++;
                }
              }
              tmp[y * width + x] = sum / cnt;
            }
          }
          bSrc = tmp;
        }
        const blurred = bSrc;

        // ── 7. 对模糊后的 mask 做阈值化，保留平滑过渡 ──
        // 使用更宽松的过渡区间（0.2-0.8），让边缘更平滑
        for (let i = 0; i < width * height; i++) {
          let alpha: number;
          if (blurred[i] < 0.2) alpha = 0;
          else if (blurred[i] > 0.8) alpha = 1;
          else alpha = (blurred[i] - 0.2) / 0.6;

          // 白边区域强制不透明
          if (whiteBorderExpanded[i]) alpha = 1;

          data[i * 4 + 3] = Math.round(alpha * 255);
        }

        // ── 8. 边缘颜色修复（参考 repairEdgeColors + zinxtick production-qa） ──
        // 半透明像素用周围不透明像素颜色替换，消除锯齿边缘的"晕边"（fringe/halo）伪影
        const edgeRadius = 2;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const a = data[idx + 3];
            if (a <= 0 || a >= 252) continue; // 只处理半透明像素

            // 在 5x5 区域采样不透明像素颜色
            const rSamples: number[] = [], gSamples: number[] = [], bSamples: number[] = [];
            for (let dy = -edgeRadius; dy <= edgeRadius; dy++) {
              for (let dx = -edgeRadius; dx <= edgeRadius; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                const nIdx = (ny * width + nx) * 4;
                if (data[nIdx + 3] >= 252) {
                  rSamples.push(data[nIdx]);
                  gSamples.push(data[nIdx + 1]);
                  bSamples.push(data[nIdx + 2]);
                }
              }
            }

            if (rSamples.length > 0) {
              // 使用中位数颜色替换（比均值更抗异常值）
              rSamples.sort((a, b) => a - b);
              gSamples.sort((a, b) => a - b);
              bSamples.sort((a, b) => a - b);
              const mid = Math.floor(rSamples.length / 2);
              data[idx] = rSamples.length % 2 !== 0 ? rSamples[mid] : Math.round((rSamples[mid - 1] + rSamples[mid]) / 2);
              data[idx + 1] = gSamples.length % 2 !== 0 ? gSamples[mid] : Math.round((gSamples[mid - 1] + gSamples[mid]) / 2);
              data[idx + 2] = bSamples.length % 2 !== 0 ? bSamples[mid] : Math.round((bSamples[mid - 1] + bSamples[mid]) / 2);
            }
          }
        }

        // ── 9. 白边外缘抗锯齿：对白边边缘的半透明像素做 premultiplied alpha 混合 ──
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            if (!whiteBorderExpanded[idx]) continue;
            const a = data[idx * 4 + 3];
            if (a < 255) {
              const px = idx * 4;
              const factor = a / 255;
              data[px] = Math.round(255 + (data[px] - 255) * factor);
              data[px + 1] = Math.round(255 + (data[px + 1] - 255) * factor);
              data[px + 2] = Math.round(255 + (data[px + 2] - 255) * factor);
              data[px + 3] = 255;
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);

        // ── 10. 检查变化率 ──
        let transparentCount = 0;
        const outData = ctx.getImageData(0, 0, width, height).data;
        for (let i = 3; i < outData.length; i += 4) {
          if (outData[i] < 128) transparentCount++;
        }
        const transparentRatio = transparentCount / (width * height);
        if (transparentRatio < 0.05) { resolve(null); return; }

        // ── 11. 持久化 ──
        canvas.toBlob(async (blob) => {
          if (!blob) { resolve(null); return; }
          try {
            const formData = new FormData();
            formData.append('file', blob, 'sticker-transparent.png');
            const res = await fetch('/api/save-image', { method: 'POST', body: formData });
            if (res.ok) {
              const result = await res.json();
              resolve(result.url || null);
            } else {
              resolve(canvas.toDataURL('image/png'));
            }
          } catch {
            resolve(canvas.toDataURL('image/png'));
          }
        }, 'image/png');
      };
      img.onerror = () => resolve(null);
      img.src = imageUrl;
    } catch {
      resolve(null);
    }
  });
}

/* ──────────────────── 组件 ──────────────────── */
export default function StickerAssistantPanel({
  isOpen,
  onClose,
  isMonochrome = false,
  onAddImages,
}: StickerAssistantPanelProps) {
  const t = themes[isMonochrome ? 'mono' : 'gold'];

  /* ── 拖拽 & 最小化 ── */
  const panelW = 480;
  const panelH = 620;
  const [pos, setPos] = useState({
    x: typeof window !== 'undefined' ? Math.max(40, (window.innerWidth - panelW) / 2) : 0,
    y: typeof window !== 'undefined' ? Math.max(40, (window.innerHeight - panelH) / 2) : 0,
  });
  const [dragging, setDragging] = useState(false);
  const dragOff = useRef({ x: 0, y: 0 });
  const [minimized, setMinimized] = useState(false);

  /* ── 步骤 ── */
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [subject, setSubject] = useState('');
  const [subjectSource, setSubjectSource] = useState<'text' | 'image'>('text');
  const [subjectImage, setSubjectImage] = useState<string | null>(null); // data URL or server URL
  const [subjectImageIdentifying, setSubjectImageIdentifying] = useState(false);
  const [styleKey, setStyleKey] = useState('general');
  const [themeKey, setThemeKey] = useState('everyday');
  const [count, setCount] = useState<9 | 16>(9);
  const [customStyle, setCustomStyle] = useState('');
  const [customTheme, setCustomTheme] = useState('');

  /* ── 模型选择 ── */
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelDiagnostic, setModelDiagnostic] = useState('');
  const [chatModelId, setChatModelId] = useState('');
  const [chatModels, setChatModels] = useState<ModelOption[]>([]);

  /* ── 计划 ── */
  const [plan, setPlan] = useState<StickerItem[]>([]);
  const planRef = useRef<StickerItem[]>([]);
  planRef.current = plan; // 同步最新 plan 到 ref
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');

  /* ── 生成 ── */
  const [generating, setGenerating] = useState(false);
  const [genIdx, setGenIdx] = useState(-1);
  const [loadingStep, setLoadingStep] = useState('');
  const isGeneratingRef = useRef(false); // 整体生成标记
  const [failedMessage, setFailedMessage] = useState('');
  const pollAttemptsRef = useRef(0);
  const failedMessageRef = useRef('');
  const lastAttemptRef = useRef(0);
  const modelLoadDiagnosticShownRef = useRef(false);

  /* ── 文件上传 ref ── */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isGeneratingItemRef = useRef(false); // 防止并发生图

  /* ── 加载模型列表 ── */
  useEffect(() => {
    if (!isOpen) return;
    const loadModels = async () => {
      setModelsLoading(true);
      try {
        // 并行加载图像模型和聊天模型
        const [imgRes, chatRes] = await Promise.all([
          fetch('/api/models?type=image'),
          fetch('/api/models?type=chat'),
        ]);
        const loaded: ModelOption[] = [];
        const chatLoaded: ModelOption[] = [];

        if (imgRes.ok) {
          const data = await imgRes.json();
          const providerMap = new Map<string, string>();
          if (data.providers && Array.isArray(data.providers)) {
            for (const p of data.providers) {
              providerMap.set(p.id, p.name || p.displayName || '');
            }
          }
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              const rawId = m.id || m.name;
              loaded.push({
                id: m.providerId ? `${m.providerId}::${rawId}` : rawId,
                providerId: m.providerId || '',
                providerName: providerMap.get(m.providerId) || m.providerId || '',
                displayLabel: getModelDisplayName(rawId),
              });
            }
          }
          setModels(loaded);
          if (loaded.length > 0 && !selectedModelId) {
            setSelectedModelId(loaded[0].id);
          }
        }

        if (chatRes.ok) {
          const data = await chatRes.json();
          const providerMap = new Map<string, string>();
          if (data.providers && Array.isArray(data.providers)) {
            for (const p of data.providers) {
              providerMap.set(p.id, p.name || p.displayName || '');
            }
          }
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              const rawId = m.id || m.name;
              chatLoaded.push({
                id: m.providerId ? `${m.providerId}::${rawId}` : rawId,
                providerId: m.providerId || '',
                providerName: providerMap.get(m.providerId) || m.providerId || '',
                displayLabel: getModelDisplayName(rawId),
              });
            }
          }
          setChatModels(chatLoaded);
          if (chatLoaded.length > 0 && !chatModelId) {
            setChatModelId(chatLoaded[0].id);
          }
        }
      } catch { /* ignore */ } finally {
        setModelsLoading(false);
      }
    };
    loadModels();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // 模型加载完成后生成诊断信息
  useEffect(() => {
    if (!isOpen || modelsLoading) return;
    setModelDiagnostic(getStickerModelLoadDiagnosticMessage(models.length > 0, selectedModelId || ''));
  }, [isOpen, modelsLoading, models.length, selectedModelId]);

  // 模型加载诊断
  useEffect(() => {
    if (!isOpen) { modelLoadDiagnosticShownRef.current = false; return; }
    if (modelsLoading) return;
    if (modelLoadDiagnosticShownRef.current) return;
    if (selectedModelId && models.length > 0) {
      modelLoadDiagnosticShownRef.current = true;
      const diag = getStickerModelLoadDiagnosticMessage(models.length > 0, selectedModelId);
      if (diag) setModelDiagnostic(diag);
    }
  }, [isOpen, modelsLoading, models.length, selectedModelId]);

  const selectedModel = models.find(m => m.id === selectedModelId);

  /* ── 拖拽逻辑 ── */
  const onDragDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const rect = (e.currentTarget.parentElement as HTMLElement)?.getBoundingClientRect();
    dragOff.current = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, [chatModelId]);
  useEffect(() => {
    if (!dragging) return;
    const mv = (e: MouseEvent) => setPos({ x: e.clientX - dragOff.current.x, y: e.clientY - dragOff.current.y });
    const up = () => setDragging(false);
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, [dragging]);

  /* ── ESC ── */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  /* ── 辅助 ── */
  const selectedStyle = STYLE_PRESETS.find(s => s.key === styleKey)!;
  const selectedTheme = THEME_PRESETS.find(th => th.key === themeKey)!;

  /* ── 主体详细描述（用于增强一致性） ── */
  const [subjectDetail, setSubjectDetail] = useState('');

  const buildIdentityLock = useCallback((): string => {
    // 简洁版：仅提供关键身份信息，不过度重复（referenceCategories 已触发 API 自动添加 [REFERENCE MODE] 保留指令）
    const visualDesc = subjectDetail || subject;
    if (subjectSource === 'image' && subjectImage) {
      return `Subject identity: ${subject}. Visual: ${visualDesc}. ONLY expression/pose/action may differ.`;
    }
    return `Subject: ${subject}. Visual: ${visualDesc}`;
  }, [subject, subjectDetail, subjectSource, subjectImage]);

  /* ── 上传主体图片并识别 ── */
  const handleSubjectImageUpload = useCallback(async (file: File) => {
    // 读取为 data URL 用于预览
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setSubjectImage(dataUrl);
      setSubjectSource('image');
      setSubjectImageIdentifying(true);

      try {
        // 先持久化到服务器（data URL 太大无法直接传给 vision API）
        let imageUrl = dataUrl;
        try {
          const saveRes = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: dataUrl }),
          });
          if (saveRes.ok) {
            const saveData = await saveRes.json();
            if (saveData.url) imageUrl = saveData.url;
          }
        } catch { /* keep data URL */ }

        // 使用 chat API + 图片识别主体，获取简短名称和详细视觉描述
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: '请仔细分析这张图片中的主体角色，按以下格式输出（严格遵循）：\n第一行：主体简短名称（2-6个字，如：橘猫、小恐龙）\n第二行起：详细视觉外观描述，必须包含以下所有维度（200-300字）：\n1. 物种/类型（如：橘色家猫、Q版小恐龙）\n2. 体型比例（如：圆胖矮小、修长高挑、头身比3:1）\n3. 整体配色方案（如：主色橘黄#F5A623，辅色白色，眼睛翠绿#2ECC71）\n4. 毛发/皮肤纹理（如：短毛光滑、鳞片质感、蓬松卷毛）\n5. 五官特征（如：大圆眼+小三角鼻+微笑嘴、细长丹凤眼）\n6. 耳朵/角/尾巴特征（如：尖耳内粉色、短粗翘尾、头顶小角）\n7. 穿着/配饰（如：红色蝴蝶结项圈、无穿衣、蓝色围巾）\n8. 标志性视觉特征（如：左眼有黑色眼罩斑、额头M字纹、脸颊腮红圆点）\n\n示例：\n橘猫\n物种：橘色家猫。体型：圆胖矮小，头身比约2.5:1，四肢粗短。配色：主色橘黄(#F5A623)，腹部和爪尖白色(#FFFFFF)，鼻头粉色。毛发：短毛光滑，背部橘色略深，腹部白色。五官：大圆眼翠绿色(#2ECC71)，瞳孔圆形；小三角粉色鼻子；微笑弧形嘴。耳朵：三角形尖耳，耳内粉色，耳距较宽。尾巴：短粗上翘，尾尖微弯。配饰：红色蝴蝶结项圈。标志特征：额头经典M字深橘色纹路，左右脸颊各一个淡粉色腮红圆点。' },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            }],
          model: chatModelId || (chatModels.length > 0 ? chatModels[0].id : undefined),
            stream: false,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content ?? data.content ?? '';
          const lines = content.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
          // 第一行是简短名称
          const shortName = (lines[0] || '').replace(/["""\n\r]/g, '').trim();
          // 第二行起是详细描述
          const detail = lines.slice(1).join('，').replace(/["""\n\r]/g, '').trim();
          if (shortName) {
            setSubject(shortName);
          }
          if (detail) {
            setSubjectDetail(detail);
          } else if (shortName) {
            // 如果没有详细描述，至少用简短名称作为描述
            setSubjectDetail(shortName);
          }
        }
      } catch {
        // 识别失败不影响使用，用户可以手动输入
      } finally {
        setSubjectImageIdentifying(false);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  /* ── 处理文件拖放 ── */
  const handleSubjectImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleSubjectImageUpload(file);
    }
  }, [handleSubjectImageUpload]);

  /* ── Step 0 → 1: 生成计划 ── */
  const handleGeneratePlan = useCallback(async () => {
    const hasSubject = subject.trim() || (subjectSource === 'image' && subjectImage);
    if (!hasSubject) return;
    setPlanLoading(true);
    setPlanError('');
    try {
      const themeDesc = themeKey === 'custom'
        ? customTheme
        : `主题:${selectedTheme.label}, 情绪:${selectedTheme.mood}, 参考文案:${selectedTheme.captions.slice(0, 8).join('/')}`;
      const styleDesc = styleKey === 'custom'
        ? customStyle
        : `风格:${selectedStyle.label}, 正向提示:${selectedStyle.positivePrompt}`;

      const subjectDesc = (subjectDetail || subject).trim()
        ? `${subject}${subjectDetail ? `（${subjectDetail}）` : ''}`
        : (subjectSource === 'image' && subjectImage ? '上传图片中的主体角色' : '未知主体');

      const prompt = `你是一个表情包策划专家。请根据以下要求生成表情包计划。

主体: ${subjectDesc}
${styleDesc}
${themeDesc}
数量: ${count}个

要求:
1. 每个表情必须有明确的"文案"(caption)和"动作描述"(action)
2. 文案要简短(1-4个字), 适合聊天场景
3. 动作描述要具体, 确保每个表情的姿势/动作有明显差异
4. 主体特征必须保持绝对一致(外形/颜色/轮廓/物种/服饰), 仅允许表情和姿势变化
5. 动作描述中要包含该表情的具体身体动作和面部表情, 以确保生成的图片有足够的视觉差异

请严格以JSON格式输出, 不要添加任何其他文字:
[{"id":1,"caption":"文案","action":"动作描述"},...]`;

      const chatModel = chatModels.find(m => m.id === chatModelId);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel?.id?.split('::').pop() || chatModelId,
          providerId: chatModel?.providerId || undefined,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
      });

      if (!res.ok) throw new Error(`API错误: ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? data.content ?? '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('无法解析表情计划');
      const items: StickerItem[] = JSON.parse(jsonMatch[0]).map((item: { caption?: string; action?: string }, i: number) => ({
        id: i + 1,
        caption: item.caption || `表情${i + 1}`,
        action: item.action || '微笑',
        status: 'pending' as const,
      }));
      setPlan(items);
      setStep(1);
    } catch (err: unknown) {
      setPlanError(err instanceof Error ? err.message : '生成计划失败');
    } finally {
      setPlanLoading(false);
    }
  }, [subject, subjectDetail, styleKey, themeKey, count, customStyle, customTheme, selectedStyle, selectedTheme, chatModelId, chatModels, subjectSource, subjectImage]);

  /* ── Step 1 → 2: 批量生成贴纸 ── */
  const handleStartGeneration = useCallback(() => {
    setStep(2);
    setGenerating(true);
  }, []);

  // 并发控制：最多同时3个请求，检测平台是否支持批量(n>1)
  const MAX_CONCURRENT = 3;
  const batchSupportRef = useRef<'unknown' | 'supported' | 'unsupported'>('unknown');
  const batchDetectRef = useRef(false);
  const [batchMode, setBatchMode] = useState<'unknown' | 'supported' | 'unsupported'>('unknown');

  // 检测当前API是否支持批量生成（n>1）
  // 策略：通过模型能力推断，而非发送真实生成请求（避免浪费API额度）
  const detectBatchSupport = useCallback((): boolean => {
    if (batchDetectRef.current) return batchSupportRef.current === 'supported';
    batchDetectRef.current = true;

    // 已知不支持 n>1 的模型模式：DALL-E 3, Gemini 图像模型, Midjourney
    // 已知支持 n>1 的模型模式：Stable Diffusion, Flux, 部分国产模型
    if (!selectedModelId) {
      batchSupportRef.current = 'unsupported';
      setBatchMode('unsupported');
      return false;
    }

    const modelId = selectedModelId.includes('::') ? selectedModelId.split('::').pop()! : selectedModelId;
    const id = modelId.toLowerCase();

    // 明确支持批量生成的模型
    const batchSupportedPatterns = [
      'flux', 'sdxl', 'stable-diffusion', 'sd-',
      'kandinsky', 'deepfloyd', 'wuerstchen',
      'doubao-seedream', 'seedream', 'wanx',
      'kling', 'ideogram', 'hidream',
      'playground', 'leonardoai',
    ];

    // 明确不支持批量生成的模型（这些模型n参数固定为1）
    const batchUnsupportedPatterns = [
      'dall-e', 'gpt-image', 'gpt-4o',
      'gemini', 'midjourney', 'mj-',
      'imagen', 'recraft-v3',
    ];

    const isSupported = batchSupportedPatterns.some(p => id.includes(p));
    const isUnsupported = batchUnsupportedPatterns.some(p => id.includes(p));

    if (isUnsupported) {
      batchSupportRef.current = 'unsupported';
      setBatchMode('unsupported');
      return false;
    } else if (isSupported) {
      batchSupportRef.current = 'supported';
      setBatchMode('supported');
      return true;
    } else {
      // 未知模型：保守处理，不支持批量
      batchSupportRef.current = 'unsupported';
      setBatchMode('unsupported');
      return false;
    }
  }, [selectedModelId]);

  // 模型切换时重置批量检测
  useEffect(() => {
    batchDetectRef.current = false;
    batchSupportRef.current = 'unknown';
    setBatchMode('unknown');
  }, [selectedModelId]);

  // 生成单个表情的完整流程（返回结果URL或抛出错误）
  const generateOneSticker = useCallback(async (item: StickerItem): Promise<string> => {
    const styleP = styleKey === 'custom' ? customStyle : selectedStyle.positivePrompt;
    const negP = styleKey === 'custom' ? '' : selectedStyle.negativePrompt;
    const identityLock = buildIdentityLock();

    // 构建生成 prompt
    let prompt: string;
    if (subjectImage && subjectSource === 'image') {
      prompt = `[ref] Use the provided reference image(s) as the base. Create an image of: Sticker #${item.id}: "${item.caption}" — ${item.action}. ${styleP}. While creating this new image, strictly preserve the main subject and focal point of the reference image(s) — do NOT change the original product/object identity, strictly preserve the artistic style and visual aesthetics of the reference image(s), strictly preserve the color palette and tone of the reference image(s), strictly preserve the fine details and textures of the reference image(s). IMPORTANT: The product/object in the result MUST be the SAME product/object as in the reference image — do NOT substitute or replace it with a different product. ${identityLock}. Feel free to reimagine the composition and layout structure, the scene and environment setting. ${subjectDetail ? `[Subject visual details: ${subjectDetail}]` : ''}. Clean solid white background, die-cut sticker style, 1024x1024 square, sticker sheet single item.${negP ? ` Avoid: ${negP}` : ''}`;
    } else {
      prompt = `Sticker #${item.id}: "${item.caption}" — ${item.action}. ${styleP}. Subject identity: ${identityLock}. Clean solid white background, die-cut sticker style, 1024x1024 square, sticker sheet single item.${negP ? ` Avoid: ${negP}` : ''}`;
    }

    const requestBody: Record<string, unknown> = {
      prompt,
      aspectRatio: '1:1',
      n: 1,
      outputCount: 1,
      submitOnly: true,
      quality: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).quality : 'standard'; } catch { return 'standard'; } })(),
    };

    if (selectedModelId) {
      const selModel = models.find(m => m.id === selectedModelId);
      if (selModel) {
        requestBody.model = selModel.id.includes('::') ? selModel.id.split('::').pop()! : selModel.id;
        requestBody.providerId = selModel.providerId || undefined;
      } else if (selectedModelId.includes('::')) {
        requestBody.model = selectedModelId.split('::').pop()!;
        requestBody.providerId = selectedModelId.split('::')[0];
      } else {
        requestBody.model = selectedModelId;
      }
    }

    // 如果有主体图片，持久化后作为参考图传入
    if (subjectImage && subjectSource === 'image') {
      try {
        let persistedUrl = subjectImage;
        if (subjectImage.startsWith('data:')) {
          const saveRes = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: subjectImage }),
          });
          if (saveRes.ok) {
            const saveData = await saveRes.json();
            if (saveData.url) persistedUrl = saveData.url;
          }
        }
        requestBody.referenceImages = [persistedUrl];
        requestBody.referenceMode = 'reference';
        requestBody.referenceCategories = { '0': ['subject', 'style', 'color', 'detail'] };
        requestBody.referenceStrengths = [95];
        requestBody.strength = 0.15;
      } catch { /* 使用原始 URL 兜底 */ }
    }

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || data.message || `生成失败: ${res.status}`);
    }

    let imageUrl: string | undefined;
    if (data.imageUrls?.length > 0) {
      imageUrl = data.imageUrls[0];
    } else if (data.taskIds?.length > 0) {
      const taskId = data.taskIds[0];
      const pollModelId = selectedModelId?.includes('::') ? selectedModelId.split('::').pop()! : (selectedModelId || undefined);
      const pollProviderId = selectedModelId?.includes('::') ? selectedModelId.split('::')[0] : undefined;
      pollAttemptsRef.current = 0;
      for (let attempt = 0; attempt < 360; attempt++) {
        pollAttemptsRef.current = attempt;
        await new Promise(r => setTimeout(r, 2000));
        const pollRes = await fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, model: pollModelId, providerId: pollProviderId }),
        });
        if (!pollRes.ok) continue;
        const pollData = await pollRes.json();
        if (pollData.status === 'completed') {
          imageUrl = pollData.imageUrl || (pollData.imageUrls?.length > 0 ? pollData.imageUrls[0] : undefined);
          break;
        }
        if (pollData.status === 'failed') {
          const fm = getStickerFailureMessage(pollData.error || '生成失败');
          failedMessageRef.current = fm;
          throw new Error(fm);
        }
        // After 150 attempts (5 minutes), set a failure message
        if (attempt > 150 && !failedMessageRef.current) {
          const fm = getStickerFailureMessage(pollData.error || '生成超时');
          failedMessageRef.current = fm;
          setFailedMessage(fm);
        }
      }
    }
    if (!imageUrl) throw new Error('未获取到图片');

    // 持久化
    try {
      const saveRes = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (saveRes.ok) {
        const saveData = await saveRes.json();
        if (saveData.url) imageUrl = saveData.url;
      }
    } catch { /* keep original URL */ }

    // 自动移除背景 → 透明PNG + 白边描边（参考 zinxtick：edge-flood + structured masking + white border）
    try {
      if (imageUrl) {
        const processedUrl = await processStickerBackground(imageUrl, selectedModelId);
        if (processedUrl) imageUrl = processedUrl;
      }
    } catch { /* 保留原图 */ }

    return imageUrl!;
  }, [styleKey, customStyle, selectedStyle, selectedModelId, models, subjectImage, subjectSource, subjectDetail, buildIdentityLock]);

  useEffect(() => {
    if (!generating || step !== 2 || plan.length === 0) return;
    if (isGeneratingItemRef.current) return; // 防止重复触发

    isGeneratingItemRef.current = true;

    const runBatchGeneration = async () => {
      // 1. 先检测平台是否支持批量生成
      const supportsBatch = detectBatchSupport();

      // 2. 持续处理直到所有项完成
      while (true) {
        // 收集当前待处理的项
        const currentPlan = planRef.current;
        const pendingItems = currentPlan.filter(p => p.status === 'pending');
        if (pendingItems.length === 0) break;

        // 取一批待处理项（最多MAX_CONCURRENT个）
        const batch = pendingItems.slice(0, MAX_CONCURRENT);

        // 标记为 generating
        for (const item of batch) {
          setPlan(prev => prev.map(p => p.id === item.id ? { ...p, status: 'generating' as const } : p));
        }
        setGenIdx(batch[0].id - 1);

        if (batch.length > 1) {
          // ── 并发批量生成：同时发送多个请求，大幅提升速度 ──
          // 注意：由于每个表情的 prompt 不同，无法使用 API 的 n>1 参数
          // 改用并发请求（最多 MAX_CONCURRENT 个同时进行）
          const results = await Promise.allSettled(
            batch.map(item => generateOneSticker(item))
          );
          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const item = batch[i];
            if (result.status === 'fulfilled') {
              setPlan(prev => prev.map(p => p.id === item.id ? { ...p, status: 'done' as const, imageUrl: result.value } : p));
            } else {
              setPlan(prev => prev.map(p => p.id === item.id ? { ...p, status: 'failed' as const, error: result.reason?.message || '生成失败' } : p));
            }
          }
        } else {
          // ── 单张生成 ──
          const item = batch[0];
          try {
            const imageUrl = await generateOneSticker(item);
            setPlan(prev => prev.map(p => p.id === item.id ? { ...p, status: 'done' as const, imageUrl } : p));
          } catch (err: unknown) {
            setPlan(prev => prev.map(p => p.id === item.id ? { ...p, status: 'failed' as const, error: err instanceof Error ? err.message : '生成失败' } : p));
          }
        }
      }

      setGenerating(false);
      setGenIdx(-1);
      isGeneratingItemRef.current = false;
    };

    runBatchGeneration();
  }, [generating, step, plan, detectBatchSupport, generateOneSticker]);

  /* ── 重试失败项 ── */
  const handleRetry = useCallback((id: number) => {
    setPlan(prev => prev.map(p => p.id === id ? { ...p, status: 'pending' as const, error: undefined } : p));
    setStep(2);
    setGenerating(true);
  }, []);

  const handleRetryFailed = useCallback(() => {
    setPlan(prev => prev.map(p => p.status === 'failed' ? { ...p, status: 'pending' as const, error: undefined } : p));
    setStep(2);
    setGenerating(true);
  }, []);

  /* ── 停止生成 ── */
  const handleStop = useCallback(() => {
    setGenerating(false);
    setGenIdx(-1);
    isGeneratingItemRef.current = false;
  }, []);

  /* ── 全部添加到画布 ── */
  const handleAddAllToCanvas = useCallback(() => {
    const urls = plan.filter(p => p.status === 'done' && p.imageUrl).map(p => p.imageUrl!);
    if (urls.length > 0 && onAddImages) {
      // ★ 传递模型信息
      const meta: { modelName?: string; apiProvider?: string } = {};
      if (selectedModelId) {
        const pureModelId = selectedModelId.includes('::') ? selectedModelId.split('::').pop()! : selectedModelId;
        meta.modelName = pureModelId;
        const model = models.find(m => m.id === selectedModelId);
        if (model?.providerId) meta.apiProvider = model.providerId;
      }
      onAddImages(urls, meta);
    }
  }, [plan, onAddImages, selectedModelId, models]);

  /* ── 下载全部（ZIP 压缩包） ── */
  const [downloadZipping, setDownloadZipping] = useState(false);
  const handleDownloadAll = useCallback(async () => {
    const done = plan.filter(p => p.status === 'done' && p.imageUrl);
    if (done.length === 0) return;
    setDownloadZipping(true);
    try {
      const zip = new JSZip();
      await Promise.all(done.map(async (item) => {
        try {
          const res = await fetch(item.imageUrl!);
          const blob = await res.blob();
          const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
          zip.file(`sticker_${String(item.id).padStart(2, '0')}_${item.caption.replace(/[/\\?%*:|"<>]/g, '_')}.${ext}`, blob);
        } catch { /* skip failed */ }
      }));
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stickers_${subject || 'pack'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadZipping(false);
    }
  }, [plan, subject]);

  /* ── 重置 ── */
  const handleReset = useCallback(() => {
    setStep(0);
    setPlan([]);
    setPlanError('');
    setGenerating(false);
    setGenIdx(-1);
    setSubjectDetail('');
  }, []);

  if (!isOpen) return null;

  const doneCount = plan.filter(p => p.status === 'done').length;
  const failCount = plan.filter(p => p.status === 'failed').length;
  const generatingCount = plan.filter(p => p.status === 'generating').length;

  return (
    <div
      className="fixed z-[150] flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        width: panelW,
        maxHeight: minimized ? 40 : 'calc(100vh - 100px)',
        background: t.panelBg,
        borderRadius: 10,
        border: `1px solid ${t.border}`,
        boxShadow: t.shadow,
        overflow: 'hidden',
        transition: 'max-height 0.2s ease',
      }}
      data-popup="sticker-assistant"
    >
      {/* ── 标题栏 ── */}
      <div
        className="flex items-center justify-between px-3 h-10 cursor-move select-none shrink-0"
        style={{ background: t.headerGrad, borderBottom: `1px solid ${t.border}` }}
        onMouseDown={onDragDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical size={14} style={{ color: t.textDim }} />
          <Smile size={15} style={{ color: t.accent }} />
          <span className="text-sm font-medium" style={{ color: t.text }}>表情助手</span>
          {plan.length > 0 && step >= 1 && (
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: t.accentBg, color: t.accent }}>
              {doneCount}/{plan.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded transition-colors duration-150"
            style={{ color: t.textDim }}
            onMouseEnter={e => (e.currentTarget.style.color = t.text)}
            onMouseLeave={e => (e.currentTarget.style.color = t.textDim)}
            onClick={() => setMinimized(v => !v)}
            aria-label="最小化"
          >
            <Minus size={14} />
          </button>
          <button
            className="p-1 rounded transition-colors duration-150"
            style={{ color: t.textDim }}
            onMouseEnter={e => (e.currentTarget.style.color = t.btnClose)}
            onMouseLeave={e => (e.currentTarget.style.color = t.textDim)}
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {minimized ? null : (
        <div className="flex-1 overflow-y-auto" style={{ background: t.deepBg }}>
          {/* ── 生成进度条 ── */}
          {step === 2 && plan.length > 0 && (
            <div className="h-1 shrink-0" style={{ background: t.border }}>
              <div
                className="h-full transition-all duration-300"
                style={{ width: `${(doneCount / plan.length) * 100}%`, background: t.accent }}
              />
            </div>
          )}

          {/* ── Step 0: 配置 ── */}
          {step === 0 && (
            <div className="p-4 space-y-4">
              {/* 主体来源切换 */}
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: t.textSub }}>表情主体</label>
                <div className="flex gap-2 mb-2">
                  <button
                    className="flex-1 px-2 py-1.5 rounded-md text-xs transition-all duration-150 cursor-pointer flex items-center justify-center gap-1"
                    style={{
                      background: subjectSource === 'text' ? t.accentBg : t.cardBg,
                      border: `1.5px solid ${subjectSource === 'text' ? t.accent : t.border}`,
                      color: subjectSource === 'text' ? t.accent : t.textSub,
                    }}
                    onClick={() => setSubjectSource('text')}
                  >
                    文字描述
                  </button>
                  <button
                    className="flex-1 px-2 py-1.5 rounded-md text-xs transition-all duration-150 cursor-pointer flex items-center justify-center gap-1"
                    style={{
                      background: subjectSource === 'image' ? t.accentBg : t.cardBg,
                      border: `1.5px solid ${subjectSource === 'image' ? t.accent : t.border}`,
                      color: subjectSource === 'image' ? t.accent : t.textSub,
                    }}
                    onClick={() => setSubjectSource('image')}
                  >
                    <ImagePlus size={12} /> 上传主体
                  </button>
                </div>

                {/* 文字描述模式 */}
                {subjectSource === 'text' && (
                  <input
                    className="w-full px-3 py-2 rounded-md text-sm outline-none transition-all duration-150"
                    style={{ background: t.inputBg, color: t.text, border: `1px solid ${t.border}` }}
                    placeholder="例如: 橘猫、奶茶杯、小恐龙..."
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    onFocus={e => (e.currentTarget.style.borderColor = t.accent)}
                    onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                  />
                )}

                {/* 上传图片模式 */}
                {subjectSource === 'image' && (
                  <div>
                    {subjectImage ? (
                      <div className="relative rounded-md overflow-hidden" style={{ border: `1px solid ${t.border}` }}>
                        <img
                          src={subjectImage}
                          alt="主体参考图"
                          className="w-full max-h-40 object-contain"
                          style={{ background: t.cardBg }}
                        />
                        {subjectImageIdentifying && (
                          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                            <div className="flex items-center gap-2 text-white text-xs">
                              <Loader2 size={14} className="animate-spin" />
                              识别主体中...
                            </div>
                          </div>
                        )}
                        <button
                          className="absolute top-1 right-1 p-1 rounded-full transition-colors duration-150 cursor-pointer"
                          style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                          onClick={() => { setSubjectImage(null); setSubject(''); setSubjectDetail(''); }}
                          aria-label="移除图片"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div
                        className="flex flex-col items-center justify-center gap-2 py-6 rounded-md cursor-pointer transition-all duration-150"
                        style={{ background: t.inputBg, border: `2px dashed ${t.border}` }}
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = t.accent; }}
                        onDragLeave={e => { e.currentTarget.style.borderColor = t.border; }}
                        onDrop={handleSubjectImageDrop}
                      >
                        <Upload size={20} style={{ color: t.textDim }} />
                        <span className="text-xs" style={{ color: t.textDim }}>点击上传或拖拽图片</span>
                        <span className="text-[10px]" style={{ color: t.textDim }}>AI 将自动识别图片中的主体</span>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleSubjectImageUpload(file);
                        e.target.value = '';
                      }}
                    />
                    {/* 识别结果可编辑 */}
                    {subjectImage && (
                      <input
                        className="w-full mt-2 px-3 py-2 rounded-md text-sm outline-none transition-all duration-150"
                        style={{ background: t.inputBg, color: t.text, border: `1px solid ${t.border}` }}
                        placeholder="识别主体名称（可手动修改）..."
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        onFocus={e => (e.currentTarget.style.borderColor = t.accent)}
                        onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* 模型选择 */}
              <div className="space-y-2">
                {/* LLM 计划模型 */}
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: t.textSub }}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0`} style={{ background: t.accent }} />
                    计划模型
                  </label>
                  <select
                    value={chatModelId}
                    onChange={(e) => setChatModelId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm appearance-none cursor-pointer transition-all duration-150"
                    style={{
                      background: t.inputBg,
                      color: t.text,
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    {chatModels.length === 0 && <option value="">暂无模型</option>}
                    {(() => {
                      const grouped: Record<string, typeof chatModels> = {};
                      chatModels.forEach(m => {
                        const key = m.providerName || '未知';
                        if (!grouped[key]) grouped[key] = [];
                        grouped[key].push(m);
                      });
                      return Object.entries(grouped).map(([providerName, models]) => (
                        <optgroup key={providerName} label={providerName}>
                          {models.map(m => (
                            <option key={m.id} value={m.id}>{m.displayLabel || m.id}</option>
                          ))}
                        </optgroup>
                      ));
                    })()}
                  </select>
                  {(() => {
                    const cm = chatModels.find(m => m.id === chatModelId);
                    if (cm) return <p className="text-xs mt-0.5" style={{ color: t.textDim }}>{cm.displayLabel || cm.id} · 来自 {cm.providerName}</p>;
                    return null;
                  })()}
                </div>
                {/* 生图模型 */}
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: t.textSub }}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0`} style={{ background: t.accent }} />
                    生图模型
                  </label>
                  <select
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm appearance-none cursor-pointer transition-all duration-150"
                    style={{
                      background: t.inputBg,
                      color: t.text,
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    {models.length === 0 && <option value="">暂无模型</option>}
                    {(() => {
                      const grouped: Record<string, typeof models> = {};
                      models.forEach(m => {
                        const key = m.providerName || '未知';
                        if (!grouped[key]) grouped[key] = [];
                        grouped[key].push(m);
                      });
                      return Object.entries(grouped).map(([providerName, ms]) => (
                        <optgroup key={providerName} label={providerName}>
                          {ms.map(m => (
                            <option key={m.id} value={m.id}>{m.displayLabel || m.id}</option>
                          ))}
                        </optgroup>
                      ));
                    })()}
                  </select>
                  {(() => {
                    const sm = models.find(m => m.id === selectedModelId);
                    if (sm) return <p className="text-xs mt-0.5" style={{ color: t.textDim }}>{sm.displayLabel || sm.id} · 来自 {sm.providerName}</p>;
                    return null;
                  })()}
                </div>
              </div>

              {/* 模型加载诊断 */}
              {modelDiagnostic && (
                <div className="mt-2 px-3 py-2 rounded-lg text-xs leading-relaxed" style={{
                  background: isMonochrome ? 'rgba(255,255,255,0.05)' : 'rgba(212,175,55,0.08)',
                  color: t.textDim,
                  borderLeft: `3px solid ${t.accent}`,
                }}>
                  {modelDiagnostic}
                </div>
              )}

              {/* 风格选择 */}
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: t.textSub }}>风格</label>
                <div className="grid grid-cols-3 gap-2">
                  {STYLE_PRESETS.map(s => (
                    <button
                      key={s.key}
                      className="flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs transition-all duration-150 cursor-pointer"
                      style={{
                        background: styleKey === s.key ? t.accentBg : t.cardBg,
                        border: `1.5px solid ${styleKey === s.key ? t.accent : t.border}`,
                        color: styleKey === s.key ? t.accent : t.textSub,
                      }}
                      onClick={() => setStyleKey(s.key)}
                    >
                      <span>{s.icon}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
                {styleKey === 'custom' && (
                  <textarea
                    className="w-full mt-2 px-3 py-2 rounded-md text-xs outline-none resize-none transition-all duration-150"
                    style={{ background: t.inputBg, color: t.text, border: `1px solid ${t.border}`, minHeight: 60 }}
                    placeholder="输入自定义风格提示词..."
                    value={customStyle}
                    onChange={e => setCustomStyle(e.target.value)}
                    onFocus={e => (e.currentTarget.style.borderColor = t.accent)}
                    onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                  />
                )}
              </div>

              {/* 主题选择 */}
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: t.textSub }}>主题</label>
                <div className="grid grid-cols-4 gap-2">
                  {THEME_PRESETS.map(th => (
                    <button
                      key={th.key}
                      className="flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-xs transition-all duration-150 cursor-pointer"
                      style={{
                        background: themeKey === th.key ? t.accentBg : t.cardBg,
                        border: `1.5px solid ${themeKey === th.key ? t.accent : t.border}`,
                        color: themeKey === th.key ? t.accent : t.textSub,
                      }}
                      onClick={() => setThemeKey(th.key)}
                    >
                      <span className="text-base">{th.icon}</span>
                      <span className="text-[10px] leading-tight">{th.label}</span>
                    </button>
                  ))}
                </div>
                {themeKey === 'custom' && (
                  <textarea
                    className="w-full mt-2 px-3 py-2 rounded-md text-xs outline-none resize-none transition-all duration-150"
                    style={{ background: t.inputBg, color: t.text, border: `1px solid ${t.border}`, minHeight: 60 }}
                    placeholder="输入自定义主题描述和想要的文案..."
                    value={customTheme}
                    onChange={e => setCustomTheme(e.target.value)}
                    onFocus={e => (e.currentTarget.style.borderColor = t.accent)}
                    onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                  />
                )}
              </div>

              {/* 数量 */}
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: t.textSub }}>数量</label>
                <div className="flex gap-2">
                  {[9, 16].map(n => (
                    <button
                      key={n}
                      className="flex-1 px-3 py-1.5 rounded-md text-xs transition-all duration-150 cursor-pointer"
                      style={{
                        background: count === n ? t.accentBg : t.cardBg,
                        border: `1.5px solid ${count === n ? t.accent : t.border}`,
                        color: count === n ? t.accent : t.textSub,
                      }}
                      onClick={() => setCount(n as 9 | 16)}
                    >
                      {n}个（{n === 9 ? '精简版' : '完整版'}）
                    </button>
                  ))}
                </div>
              </div>

              {/* 生成计划按钮 */}
              <button
                className="w-full py-2.5 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-2"
                style={{
                  background: (subject.trim() || (subjectSource === 'image' && subjectImage)) ? t.accent : t.border,
                  color: (subject.trim() || (subjectSource === 'image' && subjectImage)) ? (isMonochrome ? '#fff' : '#1a1a1a') : t.textDim,
                  opacity: planLoading ? 0.7 : 1,
                }}
                onClick={handleGeneratePlan}
                disabled={(!subject.trim() && !(subjectSource === 'image' && subjectImage)) || planLoading}
              >
                {planLoading ? (
                  <><Loader2 size={15} className="animate-spin" /> 生成计划中...</>
                ) : (
                  <><Sparkles size={15} /> 生成表情计划</>
                )}
              </button>
              {planError && (
                <p className="text-xs text-red-500 mt-1">{planError}</p>
              )}
            </div>
          )}

          {/* ── Step 1: 计划确认 ── */}
          {step === 1 && (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: t.text }}>
                  表情计划 ({plan.length}个)
                </span>
                <button
                  className="text-xs px-2 py-1 rounded transition-colors duration-150 cursor-pointer"
                  style={{ color: t.accent, background: t.accentBg }}
                  onClick={handleReset}
                >
                  重新配置
                </button>
              </div>

              {/* 主体信息 */}
              {(subjectImage || subject) && (
                <div className="flex items-center gap-2 px-2.5 py-2 rounded-md" style={{ background: t.cardBg, border: `1px solid ${t.border}` }}>
                  {subjectImage && (
                    <img src={subjectImage} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate" style={{ color: t.text }}>
                      主体: {subject}
                    </div>
                    <div className="text-[10px]" style={{ color: t.textDim }}>
                      计划: {chatModels.find(m => m.id === chatModelId)?.displayLabel || '默认'}
                      {' · '}生图: {selectedModel?.displayLabel || selectedModel?.id || '(未选择模型)'}
                      {' · '}风格: {selectedStyle.label}
                      {' · '}主题: {selectedTheme.label}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1">
                {plan.map(item => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 px-2.5 py-2 rounded-md"
                    style={{ background: t.cardBg, border: `1px solid ${t.border}` }}
                  >
                    <span className="text-xs font-mono shrink-0 mt-0.5" style={{ color: t.accent }}>
                      {String(item.id).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate" style={{ color: t.text }}>
                        {item.caption}
                      </div>
                      <div className="text-[11px] truncate" style={{ color: t.textDim }}>
                        {item.action}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                className="w-full py-2.5 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-2"
                style={{ background: t.accent, color: isMonochrome ? '#fff' : '#1a1a1a' }}
                onClick={handleStartGeneration}
              >
                <ChevronRight size={15} /> 开始生成
              </button>
              <div className="text-xs mt-1 text-center" style={{ color: t.textSub }}>
                {batchMode === 'supported' ? '批量模式：支持同时生成多张' : batchMode === 'unsupported' ? `并发模式：最多${MAX_CONCURRENT}张同时生成` : '将自动检测批量生成能力'}
              </div>
            </div>
          )}

          {/* ── Step 2: 生成 ── */}
          {step === 2 && (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: t.text }}>
                  生成进度 {doneCount}/{plan.length}
                  {generating && generatingCount > 0 && <span className="ml-1 opacity-60">（{generatingCount}张同时生成中）</span>}
                  {failCount > 0 && <span className="text-red-500 ml-1">({failCount}失败)</span>}
                </span>
                {generating ? (
                  <button
                    className="text-xs px-2 py-1 rounded cursor-pointer transition-colors duration-150"
                    style={{ background: '#ef4444', color: '#fff' }}
                    onClick={handleStop}
                  >
                    停止
                  </button>
                ) : (
                  <div className="flex gap-2">
                    {failCount > 0 && (
                      <button
                        className="text-xs px-2 py-1 rounded cursor-pointer transition-colors duration-150"
                        style={{ color: t.accent, background: t.accentBg }}
                        onClick={handleRetryFailed}
                      >
                        重试失败
                      </button>
                    )}
                    <button
                      className="text-xs px-2 py-1 rounded cursor-pointer transition-colors duration-150"
                      style={{ color: t.accent, background: t.accentBg }}
                      onClick={handleReset}
                    >
                      重新开始
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 max-h-[50vh] overflow-y-auto">
                {plan.map(item => (
                  <div
                    key={item.id}
                    className="relative rounded-md overflow-hidden"
                    style={{
                      aspectRatio: '1',
                      background: item.status === 'done' && item.imageUrl
                        ? 'repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 50% / 16px 16px'
                        : t.cardBg,
                      border: `1px solid ${item.status === 'failed' ? '#ef4444' : t.border}`,
                    }}
                  >
                    {item.status === 'done' && item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.caption}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : item.status === 'generating' ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                        <Loader2 size={18} className="animate-spin" style={{ color: t.accent }} />
                        <span className="text-[10px]" style={{ color: t.textDim }}>生成中</span>
                      </div>
                    ) : item.status === 'failed' ? (
                      <div
                        className="w-full h-full flex flex-col items-center justify-center gap-1 cursor-pointer"
                        onClick={() => handleRetry(item.id)}
                        title={getStickerFailureMessage(item.status, item.error)}
                      >
                        <XCircle size={18} className="text-red-500" />
                        <span className="text-[10px] text-red-400">点击重试</span>
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center">
                        <Clock size={16} style={{ color: t.textDim }} />
                      </div>
                    )}
                    {/* 底部文案 */}
                    <div
                      className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-center text-[10px] truncate"
                      style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                    >
                      {item.caption}
                    </div>
                  </div>
                ))}
              </div>

              {/* 底部操作 */}
              {!generating && doneCount > 0 && (
                <div className="flex gap-2 pt-1">
                  <button
                    className="flex-1 py-2 rounded-md text-xs font-medium cursor-pointer transition-all duration-150 flex items-center justify-center gap-1"
                    style={{ background: t.accent, color: isMonochrome ? '#fff' : '#1a1a1a' }}
                    onClick={handleAddAllToCanvas}
                  >
                    <CheckCircle2 size={13} /> 添加到画布 ({doneCount})
                  </button>
                  <button
                    className="py-2 px-3 rounded-md text-xs font-medium cursor-pointer transition-all duration-150 flex items-center justify-center gap-1"
                    style={{ background: t.cardBg, color: t.textSub, border: `1px solid ${t.border}` }}
                    onClick={handleDownloadAll}
                    disabled={downloadZipping}
                  >
                    {downloadZipping ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
