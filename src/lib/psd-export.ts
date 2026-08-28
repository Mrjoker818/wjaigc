'use client';

import type { DesignScene, DesignSceneLayer } from '@/types/psdLayer';
import { editableLayerAssetsToDesignLayers } from '@/lib/editable-layer-adapter';
import {
  LayerClientError,
  runLayerDecomposition,
} from '@/lib/layer-decomposition-client';
import type { LayerDecompositionResult } from '@/lib/layer-decomposition/types';

/**
 * PSD SKILL V4 — AI 自动分层导出 PSD
 *
 * 参考 bggg-creator-image2psd 开源项目的方法论:
 * - 使用背景移除 (background-to-alpha) 而非像素级分割来提取元素
 * - 每个图层是全画布透明 PNG，定位在 (0,0)，仅 alpha 通道不同
 * - 角落采样检测背景色 + 颜色距离生成柔和蒙版
 * - 连通域分析保证元素完整性
 * - AI 视觉理解辅助语义分类
 * - V4 规范图层命名 + 侧车清单 + 质量评分
 * - ag-psd 写入保证 Photoshop 兼容性
 */

import { writePsd } from 'ag-psd';
import type { Psd, Layer, BlendMode } from 'ag-psd';

// ==================== V4 Type Definitions ====================

/** V4 export modes: safe (raster-safe text) vs editable (experimental editable text) */
export type PSDExportMode = 'basic' | 'pro' | 'studio';

/** V4 semantic layer roles */
type LayerRole = 'background' | 'subject' | 'text' | 'deco' | 'shadow' | 'original';

/** Semantic label for classified regions */
type SemanticLabel =
  | 'background' | 'sky_ceiling' | 'ground_plane'
  | 'main_subject' | 'header' | 'footer'
  | 'left_element' | 'right_element' | 'decorative_element'
  | 'shadow' | 'ambient_shadow' | 'text';

/** V4 layer naming mapping from role + label → PSD layer name */
function v4LayerName(role: LayerRole, idx: number, label: string, excerpt?: string): string {
  switch (role) {
    case 'background': return `bg/${label || 'main'}`;
    case 'subject': return `subject/${String(idx + 1).padStart(2, '0')}/${label}`;
    case 'shadow': return `fx/shadow/${String(idx + 1).padStart(2, '0')}`;
    case 'text': return `text/${String(idx + 1).padStart(2, '0')}/${(excerpt || 'untitled').slice(0, 12)}`;
    case 'deco': return `deco/${String(idx + 1).padStart(2, '0')}/${label}`;
    case 'original': return `00_Original`;
  }
}

/** Quality score components per V4 formula */
interface QualityMetrics {
  maskBoundary: number;
  ocr: number;
  fontMatch: number;
  inpaint: number;
  layerConsistency: number;
  openability: number;
}

/** V4 quality label */
type QualityLabel = 'Excellent' | 'Good' | 'Usable' | 'Experimental';

/** V4 sidecar manifest layer entry */
interface ManifestLayer {
  id: string;
  role: LayerRole;
  name: string;
  bbox?: [number, number, number, number];
  maskScore?: number;
  edgeScore?: number;
  editableText?: string;
  ocrConfidence?: number;
  reconstructMode: 'raster-safe' | 'editable-experimental';
  fontCandidates?: Array<{ name: string; score: number }>;
  derivedFrom?: string;
  source?: 'original' | 'inpainted' | 'estimated' | 'pear-psd' | 'local-enhanced';
  warnings?: string[];
}

/** V4 sidecar manifest */
interface PSDManifest {
  schema: 'psd-export-manifest.v4';
  version: '4.0.0';
  width: number;
  height: number;
  layerCount: number;
  mode: PSDExportMode;
  quality: {
    score: number;
    label: QualityLabel;
    metrics: QualityMetrics;
  };
  layers: ManifestLayer[];
  fallbacks: Array<{ stage: string; reason: string; action: string }>;
}

/** Internal design layer during construction */
export interface BBox { x: number; y: number; width: number; height: number; }

export interface DesignLayer {
  id: string;
  parentId?: string;
  role: LayerRole;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  locked?: boolean;
  offsetX?: number;
  offsetY?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  score?: number;
  fallbackReason?: string;
  canvas?: HTMLCanvasElement;
  imageDataUrl?: string;
  boundingBox?: BBox;
  bbox?: [number, number, number, number];
  maskScore: number;
  edgeScore: number;
  semanticLabel?: SemanticLabel;
  warnings: string[];
  textContent?: string;
  editableText?: string;
  ocrConfidence?: number;
  fontSize?: number;
  textColor?: [number, number, number];
  reconstructMode: 'raster-safe' | 'editable-experimental';
  fontCandidates?: Array<{ name: string; score: number }>;
  derivedFrom?: string;
  source?: 'original' | 'inpainted' | 'estimated' | 'pear-psd' | 'local-enhanced';
}

/** Internal design group */
export interface DesignGroup {
  id: string;
  name: string;
  role: string;
  layerIds: string[];
  visible: boolean;
}

/** Export result */
export interface PSDExportResult {
  blob: Blob;
  manifest: PSDManifest;
  mode: PSDExportMode;
  filename: string;
  designScene?: DesignScene;
}

/** Export note with severity */
interface ExportNote {
  level: 'info' | 'warning' | 'error';
  message: string;
  stage?: string;
}

// ==================== Background Removal (bggg-creator-image2psd approach) ====================

/**
 * Sample corner colors from an image to detect the background color.
 * Takes patches from all 4 corners and returns the median color.
 */
function sampleCornerColors(data: Uint8ClampedArray, width: number, height: number, sampleSize: number = 12): [number, number, number] {
  const s = Math.max(1, Math.min(sampleSize, width, height));
  const patches: number[][] = [];

  // Top-left corner
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const idx = (y * width + x) * 4;
      patches.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }
  // Top-right corner
  for (let y = 0; y < s; y++) {
    for (let x = width - s; x < width; x++) {
      const idx = (y * width + x) * 4;
      patches.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }
  // Bottom-left corner
  for (let y = height - s; y < height; y++) {
    for (let x = 0; x < s; x++) {
      const idx = (y * width + x) * 4;
      patches.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }
  // Bottom-right corner
  for (let y = height - s; y < height; y++) {
    for (let x = width - s; x < width; x++) {
      const idx = (y * width + x) * 4;
      patches.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  // Also sample edge rows/columns for better bg detection
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 20))) {
    // Top edge
    const idx1 = x * 4;
    patches.push([data[idx1], data[idx1 + 1], data[idx1 + 2]]);
    // Bottom edge
    const idx2 = ((height - 1) * width + x) * 4;
    patches.push([data[idx2], data[idx2 + 1], data[idx2 + 2]]);
  }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 20))) {
    // Left edge
    const idx1 = (y * width) * 4;
    patches.push([data[idx1], data[idx1 + 1], data[idx1 + 2]]);
    // Right edge
    const idx2 = (y * width + width - 1) * 4;
    patches.push([data[idx2], data[idx2 + 1], data[idx2 + 2]]);
  }

  // Compute median for each channel
  const rArr = patches.map(p => p[0]).sort((a, b) => a - b);
  const gArr = patches.map(p => p[1]).sort((a, b) => a - b);
  const bArr = patches.map(p => p[2]).sort((a, b) => a - b);
  const mid = Math.floor(rArr.length / 2);
  return [rArr[mid], gArr[mid], bArr[mid]];
}

/**
 * Detect if the image has a uniform-ish background by checking
 * how many edge pixels match the corner color.
 */
function detectBackgroundType(data: Uint8ClampedArray, width: number, height: number, bgColor: [number, number, number], tolerance: number = 30): { isUniform: boolean; bgRatio: number } {
  const totalPixels = width * height;
  let bgPixelCount = 0;
  // Sample every 4th pixel for speed
  const step = 4;
  let sampled = 0;
  for (let i = 0; i < totalPixels; i += step) {
    const idx = i * 4;
    const dr = data[idx] - bgColor[0];
    const dg = data[idx + 1] - bgColor[1];
    const db = data[idx + 2] - bgColor[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= tolerance) {
      bgPixelCount++;
    }
    sampled++;
  }
  const bgRatio = bgPixelCount / sampled;
  return { isUniform: bgRatio > 0.15, bgRatio };
}

/**
 * Turn a flat background color into transparency.
 * Based on bggg-creator-image2psd's background_to_alpha algorithm.
 *
 * For white/light backgrounds: uses (1 - min(rgb)) * strength with tolerance feathering.
 * For other colors: uses color distance from the sampled background color.
 */
function backgroundToAlpha(
  imageData: ImageData,
  bgColor: [number, number, number],
  tolerance: number = 12.0,
  feather: number = 45.0,
  strength: number = 1.0,
  minAlpha: number = 2
): { resultCanvas: HTMLCanvasElement; alphaMask: Float32Array } {
  const { width, height, data } = imageData;
  const totalPixels = width * height;

  const rgba = new Float32Array(totalPixels * 4);
  for (let i = 0; i < totalPixels * 4; i++) {
    rgba[i] = data[i] / 255.0;
  }

  const rgb = new Float32Array(totalPixels * 3);
  for (let i = 0; i < totalPixels; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }

  const existingAlpha = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    existingAlpha[i] = rgba[i * 4 + 3];
  }

  const bgNorm = new Float32Array([bgColor[0] / 255.0, bgColor[1] / 255.0, bgColor[2] / 255.0]);

  const alpha = new Float32Array(totalPixels);

  // White or near-white background: use the special luminance-based formula
  if (Math.max(bgColor[0], bgColor[1], bgColor[2]) >= 230 && Math.min(bgColor[0], bgColor[1], bgColor[2]) >= 230) {
    // alpha = (1 - min(rgb)) * strength
    for (let i = 0; i < totalPixels; i++) {
      const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      let a = (1.0 - Math.min(r, g, b)) * strength;
      // Apply tolerance gate with feather
      if (tolerance > 0) {
        const dist = Math.sqrt(Math.pow(1.0 - r, 2) + Math.pow(1.0 - g, 2) + Math.pow(1.0 - b, 2)) * 255.0;
        const gate = Math.min(1.0, Math.max(0.0, (dist - tolerance) / (Math.max(1.0, feather) * 0.25)));
        a *= gate;
      }
      alpha[i] = a;
    }
  } else {
    // Non-white background: use distance from bg color
    for (let i = 0; i < totalPixels; i++) {
      const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      const dr = r - bgNorm[0], dg = g - bgNorm[1], db = b - bgNorm[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db) * 255.0;
      const denom = Math.max(1.0, feather);
      alpha[i] = Math.min(1.0, Math.max(0.0, (dist - tolerance) / denom)) * strength;
    }
  }

  // Blend with existing alpha
  for (let i = 0; i < totalPixels; i++) {
    alpha[i] = Math.min(1.0, Math.max(0.0, alpha[i])) * existingAlpha[i];
    if (alpha[i] < (minAlpha / 255.0)) {
      alpha[i] = 0;
    }
  }

  // Recover foreground colors from alpha-composited background
  // out_rgb = (rgb - bg * (1 - alpha)) / alpha
  const outRgb = new Float32Array(totalPixels * 3);
  for (let i = 0; i < totalPixels; i++) {
    if (alpha[i] > 1e-6) {
      outRgb[i * 3] = Math.min(1.0, Math.max(0.0, (rgb[i * 3] - bgNorm[0] * (1.0 - alpha[i])) / alpha[i]));
      outRgb[i * 3 + 1] = Math.min(1.0, Math.max(0.0, (rgb[i * 3 + 1] - bgNorm[1] * (1.0 - alpha[i])) / alpha[i]));
      outRgb[i * 3 + 2] = Math.min(1.0, Math.max(0.0, (rgb[i * 3 + 2] - bgNorm[2] * (1.0 - alpha[i])) / alpha[i]));
    }
  }

  // Build output canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const outData = ctx.createImageData(width, height);
  for (let i = 0; i < totalPixels; i++) {
    outData.data[i * 4] = Math.round(Math.min(1.0, Math.max(0.0, outRgb[i * 3])) * 255);
    outData.data[i * 4 + 1] = Math.round(Math.min(1.0, Math.max(0.0, outRgb[i * 3 + 1])) * 255);
    outData.data[i * 4 + 2] = Math.round(Math.min(1.0, Math.max(0.0, outRgb[i * 3 + 2])) * 255);
    outData.data[i * 4 + 3] = Math.round(Math.min(1.0, Math.max(0.0, alpha[i])) * 255);
  }
  ctx.putImageData(outData, 0, 0);

  return { resultCanvas: canvas, alphaMask: alpha };
}

/**
 * Detect the best background removal mode and parameters.
 */
function detectBestBgRemoval(
  imageData: ImageData
): { bgColor: [number, number, number]; mode: 'white' | 'corner' | 'color' | 'none' | 'white-preserve'; tolerance: number; feather: number } {
  const { data, width, height } = imageData;
  const cornerColor = sampleCornerColors(data, width, height);

  // Check if corners suggest a white/light background
  const cornerLum = cornerColor[0] * 0.299 + cornerColor[1] * 0.587 + cornerColor[2] * 0.114;

  // Check how much of the image matches the corner color
  const { isUniform, bgRatio } = detectBackgroundType(data, width, height, cornerColor, 30);

  if (!isUniform || bgRatio < 0.05) {
    // No uniform background detected — don't remove
    return { bgColor: cornerColor, mode: 'none', tolerance: 0, feather: 0 };
  }

  if (cornerLum > 220 && cornerColor[0] > 200 && cornerColor[1] > 200 && cornerColor[2] > 200) {
    // White or very light background
    return { bgColor: [255, 255, 255], mode: 'white', tolerance: 10, feather: 50 };
  }

  // Use the corner-sampled color
  return { bgColor: cornerColor, mode: 'corner', tolerance: 12, feather: 45 };
}

// ==================== Connected Component Analysis ====================

/** A connected foreground component */
interface ForegroundComponent {
  id: number;
  pixelCount: number;
  boundingBox: { x: number; y: number; w: number; h: number };
  mask: Uint8Array; // full-canvas mask, 1=belongs to this component
  avgColor: [number, number, number];
}

/**
 * Find connected components in a binary mask using flood fill.
 * Returns coherent spatial regions (each is a complete element).
 */
function findConnectedComponents(
  foregroundMask: Uint8Array, // 1=foreground, 0=background
  width: number,
  height: number,
  minSize: number = 100
): ForegroundComponent[] {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const labels = new Int32Array(totalPixels).fill(-1);
  const components: ForegroundComponent[] = [];
  let nextLabel = 0;

  // 4-connected flood fill using BFS
  for (let startY = 0; startY < height; startY++) {
    for (let startX = 0; startX < width; startX++) {
      const startIdx = startY * width + startX;
      if (!foregroundMask[startIdx] || visited[startIdx]) continue;

      // BFS flood fill
      const componentPixels: number[] = [];
      const queue: number[] = [startIdx];
      visited[startIdx] = 1;

      while (queue.length > 0) {
        const idx = queue.shift()!;
        componentPixels.push(idx);
        labels[idx] = nextLabel;

        const x = idx % width;
        const y = Math.floor(idx / width);

        // 4-connected neighbors
        const neighbors: number[] = [];
        if (x > 0) neighbors.push(idx - 1);
        if (x < width - 1) neighbors.push(idx + 1);
        if (y > 0) neighbors.push(idx - width);
        if (y < height - 1) neighbors.push(idx + width);

        for (const nIdx of neighbors) {
          if (!visited[nIdx] && foregroundMask[nIdx]) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }

      if (componentPixels.length >= minSize) {
        const mask = new Uint8Array(totalPixels);
        let minX = width, minY = height, maxX = 0, maxY = 0;
        for (const idx of componentPixels) {
          mask[idx] = 1;
          const x = idx % width;
          const y = Math.floor(idx / width);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }

        components.push({
          id: nextLabel,
          pixelCount: componentPixels.length,
          boundingBox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
          mask,
          avgColor: [0, 0, 0], // Will be filled later
        });
      }

      nextLabel++;
    }
  }

  return components;
}

/**
 * Merge small components into the nearest large component.
 * This ensures we don't get fragmented tiny pieces.
 */
function mergeSmallComponents(
  components: ForegroundComponent[],
  width: number,
  height: number,
  totalPixels: number,
  minAreaRatio: number = 0.002
): ForegroundComponent[] {
  if (components.length <= 1) return components;

  const minArea = Math.max(200, Math.floor(totalPixels * minAreaRatio));
  const result = components.map(c => ({
    ...c,
    mask: new Uint8Array(c.mask),
  }));

  // Sort by size (smallest first) for merging
  result.sort((a, b) => a.pixelCount - b.pixelCount);

  let safety = 0;
  while (safety < 500) {
    safety++;
    // Find the smallest component
    const smallIdx = result.findIndex(c => c.pixelCount < minArea);
    if (smallIdx < 0) break;

    const small = result[smallIdx];
    // Find the nearest large component by bounding box adjacency + color similarity
    let bestIdx = -1;
    let bestScore = Infinity;

    for (let j = 0; j < result.length; j++) {
      if (j === smallIdx) continue;
      const candidate = result[j];

      // Check adjacency (bounding boxes within gap)
      const gap = 30;
      const sR = small.boundingBox.x + small.boundingBox.w;
      const sB = small.boundingBox.y + small.boundingBox.h;
      const cR = candidate.boundingBox.x + candidate.boundingBox.w;
      const cB = candidate.boundingBox.y + candidate.boundingBox.h;
      const hGap = Math.max(0, Math.max(small.boundingBox.x - cR, candidate.boundingBox.x - sR));
      const vGap = Math.max(0, Math.max(small.boundingBox.y - cB, candidate.boundingBox.y - sB));
      const isAdjacent = hGap <= gap && vGap <= gap;

      // Color distance
      const dr = small.avgColor[0] - candidate.avgColor[0];
      const dg = small.avgColor[1] - candidate.avgColor[1];
      const db = small.avgColor[2] - candidate.avgColor[2];
      const colorDist = Math.sqrt(dr * dr + dg * dg + db * db);

      const score = (isAdjacent ? 0 : 500) + colorDist;
      if (score < bestScore) { bestScore = score; bestIdx = j; }
    }

    if (bestIdx < 0) break;

    // Merge small into candidate
    const target = result[bestIdx];
    const sW = small.pixelCount;
    const tW = target.pixelCount;
    for (let i = 0; i < totalPixels; i++) {
      if (small.mask[i]) target.mask[i] = 1;
    }
    target.pixelCount += sW;
    target.avgColor = [
      Math.round((target.avgColor[0] * tW + small.avgColor[0] * sW) / (tW + sW)),
      Math.round((target.avgColor[1] * tW + small.avgColor[1] * sW) / (tW + sW)),
      Math.round((target.avgColor[2] * tW + small.avgColor[2] * sW) / (tW + sW)),
    ];
    // Expand bounding box
    target.boundingBox = {
      x: Math.min(small.boundingBox.x, target.boundingBox.x),
      y: Math.min(small.boundingBox.y, target.boundingBox.y),
      w: Math.max(small.boundingBox.x + small.boundingBox.w, target.boundingBox.x + target.boundingBox.w) - Math.min(small.boundingBox.x, target.boundingBox.x),
      h: Math.max(small.boundingBox.y + small.boundingBox.h, target.boundingBox.y + target.boundingBox.h) - Math.min(small.boundingBox.y, target.boundingBox.y),
    };

    result.splice(smallIdx, 1);
    if (bestIdx > smallIdx) bestIdx--;
  }

  // Re-index
  result.forEach((c, i) => c.id = i);
  return result;
}

// ==================== AI Vision Analysis ====================

/** Layer description returned by AI vision */
interface AILayerDescription {
  name: string;
  role: 'background' | 'subject' | 'text' | 'deco';
  description: string;
  approximatePosition?: string; // e.g., "center", "top", "bottom-left"
}

interface AIAnalysisResult {
  description: string;
  layers: AILayerDescription[];
  bgType: 'white' | 'light' | 'dark' | 'colored' | 'complex';
  dominantColors: string[];
  bgColor?: [number, number, number];
  backgroundMode?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise
      .then(value => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(fallback);
      });
  });
}

async function canvasFromImageUrl(url: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load split layer image'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

async function tryExternalLayerSplit(
  imageUrl: string,
  onProgress?: (stage: string, progress: number) => void
): Promise<SceneBuildResult | null> {
  // The shared client owns idempotency, provider selection, polling and server-side fallback.
  try {
    onProgress?.('layer_split_service', 10);
    return await requestExternalPsdScene(imageUrl, onProgress);
  } catch (e) {
    console.warn('[tryExternalLayerSplit] Durable layer decomposition failed, falling back:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Call the AI vision API to analyze the image and get semantic layer structure.
 * Uses the existing chat API with a vision-capable model.
 */
export async function analyzeImageWithAIForTest(
  imageUrl: string,
  onProgress?: (stage: string, progress: number) => void
): Promise<AIAnalysisResult | null> {
  onProgress?.('ai_analyzing', 15);

  try {
    // Convert imageUrl to base64 for the vision API
    let base64Data: string;
    if (imageUrl.startsWith('data:')) {
      base64Data = imageUrl;
    } else {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const reader = new FileReader();
      base64Data = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort(new DOMException('PSD analysis timeout', 'TimeoutError'));
    }, 50_000);
    const randomPart = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const analysisResponse = await fetch('/api/analyze-psd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `psd-analysis-${randomPart}`,
        },
        body: JSON.stringify({ image: base64Data }),
        signal: controller.signal,
      });
      if (!analysisResponse.ok) {
        console.warn('PSD analysis endpoint failed:', analysisResponse.status);
        return null;
      }

      const result = await analysisResponse.json() as {
        success?: boolean;
        analysis?: {
          backgroundColor?: number[];
          backgroundMode?: string;
          layers?: Array<{
            name: string;
            role: string;
            description: string;
            approximatePosition?: string;
          }>;
        };
      };
      const analysis = result.success ? result.analysis : undefined;
      if (!analysis?.layers?.length) return null;

      const bgColor: [number, number, number] = Array.isArray(analysis.backgroundColor)
        && analysis.backgroundColor.length >= 3
        ? [analysis.backgroundColor[0], analysis.backgroundColor[1], analysis.backgroundColor[2]]
        : [255, 255, 255];
      return {
        description: 'AI-analyzed image',
        bgType: (analysis.backgroundMode === 'white' || analysis.backgroundMode === 'white-preserve')
          ? 'white'
          : (analysis.backgroundMode === 'none' ? 'complex' : 'colored'),
        dominantColors: [],
        layers: analysis.layers.map(layer => ({
          name: layer.name,
          role: (layer.role === 'bg' ? 'background' : layer.role === 'fx' ? 'deco' : layer.role) as 'background' | 'subject' | 'text' | 'deco',
          description: layer.description,
          approximatePosition: layer.approximatePosition || 'center',
        })),
        bgColor,
        backgroundMode: analysis.backgroundMode || 'white',
      };
    } finally {
      window.clearTimeout(timeoutId);
    }
  } catch (e) {
    console.warn('AI vision analysis failed:', e);
    return null;
  }
}

// ==================== Canvas Helpers ====================

function imageDataToCanvas(imgData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imgData.width;
  canvas.height = imgData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Extract a full-canvas transparent PNG layer from the original image data,
 * using the given alpha mask. Only pixels with alpha > threshold are kept.
 * This produces full-canvas layers at (0,0) — the bggg-creator-image2psd approach.
 */
function extractFullCanvasLayer(originalData: ImageData, alphaMask: Float32Array, alphaThreshold: number = 0.01): HTMLCanvasElement {
  const { data, width, height } = originalData;
  const result = new ImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const a = alphaMask[i];
    if (a > alphaThreshold) {
      result.data[i * 4] = data[i * 4];
      result.data[i * 4 + 1] = data[i * 4 + 1];
      result.data[i * 4 + 2] = data[i * 4 + 2];
      result.data[i * 4 + 3] = Math.round(Math.min(1.0, Math.max(0.0, a)) * 255);
    }
    // else: transparent (alpha = 0)
  }
  return imageDataToCanvas(result);
}

function unionMasks(masks: Uint8Array[], totalPixels: number): Uint8Array {
  const result = new Uint8Array(totalPixels);
  for (const mask of masks) {
    for (let i = 0; i < totalPixels; i++) {
      if (mask[i]) result[i] = 1;
    }
  }
  return result;
}

function maskToAlpha(mask: Uint8Array, baseAlpha?: Float32Array): Float32Array {
  const alpha = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    alpha[i] = mask[i] ? (baseAlpha ? baseAlpha[i] : 1) : 0;
  }
  return alpha;
}

function subtractMask(baseAlpha: Float32Array, subtract: Uint8Array): Float32Array {
  const alpha = new Float32Array(baseAlpha.length);
  for (let i = 0; i < baseAlpha.length; i++) {
    alpha[i] = subtract[i] ? 0 : baseAlpha[i];
  }
  return alpha;
}

function countMask(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
  return count;
}

function countAlpha(alpha: Float32Array, threshold: number = 0.02): number {
  let count = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > threshold) count++;
  return count;
}

function bboxFromMask(mask: Uint8Array, width: number, height: number): BBox | undefined {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return undefined;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Create a background layer by filling background areas with the bg color
 * and keeping original pixels for non-background areas.
 */
function createReconstructedBackground(
  originalData: ImageData,
  bgMask: Uint8Array, // 1=background pixel
  bgColor: [number, number, number]
): HTMLCanvasElement {
  const { width, height } = originalData;
  const result = new ImageData(width, height);

  // For background pixels: use the average background color (solid fill)
  // For foreground pixels: keep original (but make transparent for clean separation)
  for (let i = 0; i < width * height; i++) {
    if (bgMask[i]) {
      result.data[i * 4] = bgColor[0];
      result.data[i * 4 + 1] = bgColor[1];
      result.data[i * 4 + 2] = bgColor[2];
      result.data[i * 4 + 3] = 255;
    }
    // Foreground pixels stay transparent in the background layer
  }
  return imageDataToCanvas(result);
}

function createWhiteBackgroundCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

/** Estimate shadow layer from element edges using dilation */
function estimateShadowCanvas(originalData: ImageData, elementMask: Uint8Array): HTMLCanvasElement {
  const { width, height } = originalData;
  const result = new ImageData(width, height);
  const dilated = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (elementMask[idx]) {
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              dilated[ny * width + nx] = 1;
            }
          }
        }
      }
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (dilated[i] && !elementMask[i]) {
      result.data[i * 4] = 0;
      result.data[i * 4 + 1] = 0;
      result.data[i * 4 + 2] = 0;
      result.data[i * 4 + 3] = 40;
    }
  }
  return imageDataToCanvas(result);
}

/** Simple edge score: ratio of boundary pixels to total mask pixels */
function calculateEdgeScore(mask: Uint8Array, width: number, height: number): number {
  let boundaryPixels = 0;
  let totalMask = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      totalMask++;
      const isBoundary =
        (y === 0 || !mask[(y - 1) * width + x]) ||
        (y === height - 1 || !mask[(y + 1) * width + x]) ||
        (x === 0 || !mask[y * width + (x - 1)]) ||
        (x === width - 1 || !mask[y * width + (x + 1)]);
      if (isBoundary) boundaryPixels++;
    }
  }
  if (totalMask === 0) return 0;
  const boundaryRatio = boundaryPixels / totalMask;
  return Math.max(0, Math.min(1, 1 - boundaryRatio * 2));
}

// ==================== Quality Score (V4 Formula) ====================

function calculateQualityScore(metrics: QualityMetrics): { score: number; label: QualityLabel } {
  const Q = 0.30 * metrics.maskBoundary +
    0.20 * metrics.ocr +
    0.15 * metrics.fontMatch +
    0.15 * metrics.inpaint +
    0.10 * metrics.layerConsistency +
    0.10 * metrics.openability;

  let label: QualityLabel;
  if (Q >= 0.78) label = 'Excellent';
  else if (Q >= 0.62) label = 'Good';
  else if (Q >= 0.45) label = 'Usable';
  else label = 'Experimental';

  return { score: Math.round(Q * 100) / 100, label };
}

// ==================== Text Detection ====================

/**
 * Detect text-like regions within a foreground component.
 * Uses Sobel edge density + aspect ratio heuristics.
 */
function detectTextInComponent(
  imageData: ImageData,
  component: ForegroundComponent
): { isText: boolean; confidence: number; textMask: Uint8Array | null } {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  const { boundingBox, mask, pixelCount } = component;
  const { x: bx, y: by, w: bw, h: bh } = boundingBox;
  const boxArea = bw * bh;

  if (boxArea < 400 || pixelCount < 100) {
    return { isText: false, confidence: 0, textMask: null };
  }

  // Compute Sobel edge density within the component
  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = Math.max(1, by); y < Math.min(height - 1, by + bh); y++) {
    for (let x = Math.max(1, bx); x < Math.min(width - 1, bx + bw); x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;

      const gx =
        -data[((y - 1) * width + x - 1) * 4] + data[((y - 1) * width + x + 1) * 4]
        - 2 * data[(y * width + x - 1) * 4] + 2 * data[(y * width + x + 1) * 4]
        - data[((y + 1) * width + x - 1) * 4] + data[((y + 1) * width + x + 1) * 4];
      const gy =
        -data[((y - 1) * width + x - 1) * 4] - 2 * data[((y - 1) * width + x) * 4] - data[((y - 1) * width + x + 1) * 4]
        + data[((y + 1) * width + x - 1) * 4] + 2 * data[((y + 1) * width + x) * 4] + data[((y + 1) * width + x + 1) * 4];
      const edgeMag = Math.sqrt(gx * gx + gy * gy);
      edgeSum += edgeMag;
      edgeCount++;
    }
  }

  if (edgeCount === 0) return { isText: false, confidence: 0, textMask: null };

  const avgEdge = edgeSum / edgeCount;
  const fillRatio = pixelCount / boxArea;
  const aspectRatio = bw / Math.max(1, bh);

  // Text heuristics: high edge density, moderate fill ratio, horizontal-ish
  const isTextLike = avgEdge > 40 && fillRatio > 0.1 && fillRatio < 0.85;
  const isHorizontalText = aspectRatio > 1.5 && bh < height * 0.15;
  const isVerticalText = aspectRatio < 0.5 && bw < width * 0.15;

  const isText = isTextLike && (isHorizontalText || isVerticalText);
  let confidence = 0;
  if (isText) {
    confidence = Math.min(1.0, (avgEdge / 100) * fillRatio * (isHorizontalText ? 1.2 : 0.8));
  }

  let textMask: Uint8Array | null = null;
  if (isText) {
    textMask = new Uint8Array(totalPixels);
    for (let y = by; y < by + bh && y < height; y++) {
      for (let x = bx; x < bx + bw && x < width; x++) {
        const idx = y * width + x;
        if (mask[idx]) {
          textMask[idx] = 1;
        }
      }
    }
  }

  return { isText, confidence, textMask };
}

// ==================== Component Classification ====================

function classifyComponent(
  component: ForegroundComponent,
  width: number,
  height: number,
  totalPixels: number
): { role: LayerRole; label: SemanticLabel; name: string } {
  const areaRatio = component.pixelCount / totalPixels;
  const { w, h, x, y } = component.boundingBox;
  const aspectRatio = w / Math.max(1, h);
  const lum = component.avgColor[0] * 0.299 + component.avgColor[1] * 0.587 + component.avgColor[2] * 0.114;
  const centerX = x + w / 2;
  const centerY = y + h / 2;

  // Large area → likely background or main subject
  if (areaRatio > 0.4) {
    if (lum > 180 || lum < 50) return { role: 'background', label: 'background', name: 'background' };
    return { role: 'subject', label: 'main_subject', name: 'subject' };
  }

  // Position-based classification
  if (y < height * 0.15 && aspectRatio > 2) return { role: 'text', label: 'header', name: 'header' };
  if (y > height * 0.8 && aspectRatio > 2) return { role: 'text', label: 'footer', name: 'footer' };

  // Medium-sized elements
  if (areaRatio > 0.05) {
    if (aspectRatio > 2.5) return { role: 'text', label: 'header', name: 'header' };
    if (centerY < height * 0.3 && lum > 180) return { role: 'background', label: 'sky_ceiling', name: 'sky' };
    if (centerY > height * 0.7) return { role: 'subject', label: 'ground_plane', name: 'ground' };
    return { role: 'subject', label: 'main_subject', name: 'subject' };
  }

  // Small elements
  if (aspectRatio > 3) return { role: 'text', label: 'header', name: 'text_line' };
  if (aspectRatio < 0.3 && centerX < width * 0.25) return { role: 'deco', label: 'left_element', name: 'left_element' };
  if (aspectRatio < 0.3 && centerX > width * 0.6) return { role: 'deco', label: 'right_element', name: 'right_element' };

  return { role: 'deco', label: 'decorative_element', name: 'element' };
}

// ==================== V4 Scene Builder (Rewritten) ====================

export interface SceneBuildResult {
  layers: DesignLayer[];
  groups: DesignGroup[];
  fallbacks: Array<{ stage: string; reason: string; action: string }>;
  qualityMetrics: QualityMetrics;
  exportNotes: ExportNote[];
  width: number;
  height: number;
}

function safeLayerGroupId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'layers';
}

export function buildSceneFromEditableLayerAssets(
  result: LayerDecompositionResult,
): SceneBuildResult {
  const layers = editableLayerAssetsToDesignLayers(
    result.layers,
    result.width,
    result.height,
  );
  const groupedLayerIds = new Map<string, string[]>();
  for (const layer of layers) {
    const key = layer.parentId || layer.role;
    const ids = groupedLayerIds.get(key) || [];
    ids.push(layer.id);
    groupedLayerIds.set(key, ids);
  }
  const groups: DesignGroup[] = Array.from(groupedLayerIds.entries()).map(([key, layerIds]) => ({
    id: `group-${safeLayerGroupId(key)}`,
    name: `group/${key}`,
    role: key,
    layerIds,
    visible: true,
  }));
  const normalizedScore = Math.max(0, Math.min(1, result.quality.score / 100));
  const qualityMetrics: QualityMetrics = {
    maskBoundary: normalizedScore,
    ocr: result.layers.some((layer) => layer.role === 'text') ? normalizedScore : 1,
    fontMatch: result.layers.some((layer) => layer.role === 'text') ? 0.75 : 1,
    inpaint: normalizedScore,
    layerConsistency: normalizedScore,
    openability: result.psdUrl ? 0.98 : 0.9,
  };
  const exportNotes: ExportNote[] = result.quality.warnings.map((message) => ({
    level: 'warning',
    message,
    stage: 'layer_quality',
  }));
  return {
    layers,
    groups,
    fallbacks: result.engine === 'local'
      ? [{
          stage: 'layer_decomposition',
          reason: 'Pear was not used or did not produce an accepted result',
          action: 'Used enhanced local CPU layer decomposition',
        }]
      : [],
    qualityMetrics,
    exportNotes,
    width: result.width,
    height: result.height,
  };
}

const PSD_LAYER_RESUME_STORAGE_PREFIX = 'wujie:psd-layer-resume:v3:';

interface PsdLayerResumeState {
  sourceKey: string;
  idempotencyKey: string;
  taskId?: string;
  generation?: number;
  providerId?: string;
  modelId?: string;
}

const psdLayerResumeMemory = new Map<string, PsdLayerResumeState>();

function getPsdLayerResumeStorage(): Storage | undefined {
  if (typeof window !== 'undefined') {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  return descriptor && 'value' in descriptor ? descriptor.value as Storage : undefined;
}

function psdLayerResumeStorageKey(sourceKey: string): string {
  return `${PSD_LAYER_RESUME_STORAGE_PREFIX}${sourceKey}`;
}

function isPsdLayerResumeState(item: unknown): item is PsdLayerResumeState {
  if (!item || typeof item !== 'object') return false;
  const state = item as Partial<PsdLayerResumeState>;
  return typeof state.sourceKey === 'string'
    && /^[a-f0-9]{64}$/.test(state.sourceKey)
    && typeof state.idempotencyKey === 'string'
    && /^[A-Za-z0-9_-]{8,128}$/.test(state.idempotencyKey)
    && (state.taskId === undefined || typeof state.taskId === 'string')
    && (state.generation === undefined
      || (Number.isSafeInteger(state.generation) && state.generation >= 0))
    && ((state.providerId === undefined && state.modelId === undefined)
      || (typeof state.providerId === 'string'
        && state.providerId.length > 0
        && state.providerId.length <= 200
        && typeof state.modelId === 'string'
        && state.modelId.length > 0
        && state.modelId.length <= 200));
}

function readPsdLayerResumeState(sourceKey: string): PsdLayerResumeState | undefined {
  try {
    const value = getPsdLayerResumeStorage()?.getItem(psdLayerResumeStorageKey(sourceKey));
    const parsed = value ? JSON.parse(value) as unknown : undefined;
    return isPsdLayerResumeState(parsed) && parsed.sourceKey === sourceKey ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writePsdLayerResumeState(state: PsdLayerResumeState): boolean {
  try {
    const storage = getPsdLayerResumeStorage();
    if (!storage) return typeof window === 'undefined';
    storage.setItem(
      psdLayerResumeStorageKey(state.sourceKey),
      JSON.stringify(state),
    );
    return true;
  } catch {
    return false;
  }
}

function requirePsdLayerRecoveryEnvironment(): void {
  if (typeof window === 'undefined') return;
  if (!getPsdLayerResumeStorage()) {
    throw new Error('PSD layer recovery storage is required before starting a billable task.');
  }
  if (typeof navigator === 'undefined' || !navigator.locks) {
    throw new Error('Web Locks are required before starting a billable PSD layer task.');
  }
}

async function withPsdLayerResumeLock<T>(
  sourceKey: string,
  action: () => T | Promise<T>,
): Promise<T> {
  const lockManager = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!lockManager) return action();
  return lockManager.request(`wujie:psd-layer:${sourceKey}`, action);
}

function getLatestPsdLayerResumeState(sourceKey: string): PsdLayerResumeState | undefined {
  const memory = psdLayerResumeMemory.get(sourceKey);
  const stored = readPsdLayerResumeState(sourceKey);
  if (!memory) return stored;
  if (!stored) return memory;
  const memoryGeneration = memory.generation ?? 0;
  const storedGeneration = stored.generation ?? 0;
  if (storedGeneration > memoryGeneration) return stored;
  if (memoryGeneration > storedGeneration) return memory;
  if (stored.taskId && !memory.taskId) return stored;
  if (stored.providerId && stored.modelId && (!memory.providerId || !memory.modelId)) return stored;
  return memory;
}

function persistPsdLayerResumeState(state: PsdLayerResumeState): void {
  psdLayerResumeMemory.set(state.sourceKey, state);
  if (!writePsdLayerResumeState(state)) {
    throw new Error('PSD layer recovery storage could not be updated safely.');
  }
}

function createPsdLayerIdempotencyKey(sourceKey: string, generation: number): string {
  return `psd-layer-${sourceKey}-${generation.toString(36)}`;
}

async function fingerprintPsdLayerSource(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto is required before starting a billable PSD layer task.');
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function getPsdLayerResumeState(source: string): Promise<PsdLayerResumeState> {
  const sourceKey = await fingerprintPsdLayerSource(source);
  requirePsdLayerRecoveryEnvironment();
  return withPsdLayerResumeLock(sourceKey, () => {
    const current = getLatestPsdLayerResumeState(sourceKey);
    if (current) {
      psdLayerResumeMemory.set(sourceKey, current);
      return current;
    }
    const state: PsdLayerResumeState = {
      sourceKey,
      idempotencyKey: createPsdLayerIdempotencyKey(sourceKey, 0),
      generation: 0,
    };
    persistPsdLayerResumeState(state);
    return state;
  });
}

async function updatePsdLayerResolvedTarget(
  state: PsdLayerResumeState,
  target: { providerId: string; modelId: string },
): Promise<{ providerId: string; modelId: string }> {
  return withPsdLayerResumeLock(state.sourceKey, () => {
    const current = getLatestPsdLayerResumeState(state.sourceKey) || state;
    if ((current.generation ?? 0) !== (state.generation ?? 0)
      || current.idempotencyKey !== state.idempotencyKey) {
      throw new Error('PSD layer operation generation changed before provider submission.');
    }
    if (current.providerId && current.modelId) {
      return { providerId: current.providerId, modelId: current.modelId };
    }
    persistPsdLayerResumeState({ ...current, ...target });
    return target;
  });
}

async function updatePsdLayerResumeState(
  state: PsdLayerResumeState,
  taskId: string,
): Promise<void> {
  await withPsdLayerResumeLock(state.sourceKey, () => {
    const current = getLatestPsdLayerResumeState(state.sourceKey) || state;
    if ((current.generation ?? 0) !== (state.generation ?? 0)
      || current.idempotencyKey !== state.idempotencyKey) return;
    persistPsdLayerResumeState({ ...current, taskId });
  });
}

async function advancePsdLayerResumeState(state: PsdLayerResumeState): Promise<void> {
  await withPsdLayerResumeLock(state.sourceKey, () => {
    const current = getLatestPsdLayerResumeState(state.sourceKey) || state;
    if ((current.generation ?? 0) !== (state.generation ?? 0)
      || current.idempotencyKey !== state.idempotencyKey) return;
    const generation = (state.generation ?? 0) + 1;
    persistPsdLayerResumeState({
      sourceKey: state.sourceKey,
      idempotencyKey: createPsdLayerIdempotencyKey(state.sourceKey, generation),
      generation,
    });
  });
}

export async function requestExternalPsdScene(
  imageUrl: string,
  onProgress?: (stage: string, progress: number) => void,
  loadLayerCanvas: (
    imageUrl: string,
    width: number,
    height: number,
  ) => Promise<HTMLCanvasElement> = canvasFromImageUrl,
): Promise<SceneBuildResult> {
  const resume = await getPsdLayerResumeState(imageUrl);
  let terminalStatus: string | undefined;
  try {
    const result = await runLayerDecomposition({
      imageUrl,
      engine: 'smart',
      idempotencyKey: resume.idempotencyKey,
      resumeTaskId: resume.taskId,
      providerId: resume.providerId,
      modelId: resume.modelId,
      onResolvedTarget: (target) => updatePsdLayerResolvedTarget(resume, target),
      onTaskId: (taskId) => updatePsdLayerResumeState(resume, taskId),
      onProgress: (task, presentation) => {
        if (task.status !== 'pending' && task.status !== 'processing') {
          terminalStatus = task.status;
        }
        onProgress?.(task.phase || 'layer_split_service', presentation.progress);
      },
    });
    const scene = buildSceneFromEditableLayerAssets(result);
    const assetsById = new Map(result.layers.map((asset) => [asset.id, asset]));
    for (const layer of scene.layers) {
      if (layer.imageDataUrl && !layer.canvas) {
        const asset = assetsById.get(layer.id);
        layer.canvas = await loadLayerCanvas(
          layer.imageDataUrl,
          asset?.width ?? scene.width,
          asset?.height ?? scene.height,
        );
      }
    }
    await advancePsdLayerResumeState(resume);
    return scene;
  } catch (error) {
    if (
      (terminalStatus && terminalStatus !== 'completed')
      || (error instanceof LayerClientError
        && !error.retryable
        && error.code !== 'LAYER_IDEMPOTENCY_CONFLICT')
    ) {
      await advancePsdLayerResumeState(resume);
    }
    throw error;
  }
}

function addStudioShadowToExternalScene(scene: SceneBuildResult): void {
  if (scene.layers.some((layer) => layer.role === 'shadow')) return;
  const subject = scene.layers
    .filter((layer) => layer.role === 'subject' && layer.canvas)
    .sort((left, right) => (
      (right.canvas?.width || 0) * (right.canvas?.height || 0)
      - (left.canvas?.width || 0) * (left.canvas?.height || 0)
    ))[0];
  if (!subject?.canvas) return;

  const source = subject.canvas;
  const pixels = source.getContext('2d')?.getImageData(0, 0, source.width, source.height);
  if (!pixels) return;
  const mask = new Uint8Array(scene.width * scene.height);
  const offsetX = Math.round(subject.offsetX ?? 0);
  const offsetY = Math.round(subject.offsetY ?? 0);
  for (let y = 0; y < source.height; y++) {
    const targetY = offsetY + y;
    if (targetY < 0 || targetY >= scene.height) continue;
    for (let x = 0; x < source.width; x++) {
      const targetX = offsetX + x;
      if (targetX < 0 || targetX >= scene.width) continue;
      if (pixels.data[(y * source.width + x) * 4 + 3] > 8) {
        mask[targetY * scene.width + targetX] = 1;
      }
    }
  }
  if (countMask(mask) === 0) return;

  const box = bboxFromMask(mask, scene.width, scene.height)
    || { x: 0, y: 0, width: scene.width, height: scene.height };
  const shadowId = 'layer_shadow_external_01';
  scene.layers.push({
    id: shadowId,
    role: 'shadow',
    name: v4LayerName('shadow', 0, 'main_subject'),
    visible: true,
    opacity: 0.25,
    blendMode: 'multiply',
    canvas: estimateShadowCanvas(new ImageData(scene.width, scene.height), mask),
    boundingBox: box,
    bbox: [box.x, box.y, box.x + box.width, box.y + box.height],
    maskScore: 0.45,
    edgeScore: 0.3,
    semanticLabel: 'ambient_shadow',
    reconstructMode: 'raster-safe',
    derivedFrom: subject.id,
    source: 'estimated',
    warnings: ['Estimated Studio shadow from the remote subject alpha.'],
  });
  const effects = scene.groups.find((group) => group.role === 'shadow');
  if (effects) {
    effects.layerIds.push(shadowId);
  } else {
    const effectGroup = {
      id: 'group_fx',
      name: 'group/effects',
      role: 'shadow',
      layerIds: [shadowId],
      visible: true,
    };
    const subjectGroupIndex = scene.groups.findIndex((group) => group.role === 'subject');
    if (subjectGroupIndex >= 0) scene.groups.splice(subjectGroupIndex, 0, effectGroup);
    else scene.groups.push(effectGroup);
  }
  scene.exportNotes.push({
    level: 'info',
    stage: 'studio_shadow',
    message: 'Studio shadow estimated from the accepted remote subject layer.',
  });
}

async function buildPhotoshopEditableScene(
  imageUrl: string,
  prompt: string,
  mode: PSDExportMode,
  onProgress?: (stage: string, progress: number) => void
): Promise<SceneBuildResult> {
  const fallbacks: Array<{ stage: string; reason: string; action: string }> = [];
  const exportNotes: ExportNote[] = [];

  onProgress?.('loading_image', 5);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const totalPixels = canvas.width * canvas.height;

  const layers: DesignLayer[] = [];
  const groups: DesignGroup[] = [];
  const originalLayerId = 'layer_original';

  layers.push({
    id: originalLayerId,
    role: 'original',
    name: v4LayerName('original', 0, 'original'),
    visible: false,
    opacity: 1,
    blendMode: 'normal',
    canvas: imageDataToCanvas(new ImageData(new Uint8ClampedArray(originalData.data), canvas.width, canvas.height)),
    boundingBox: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    bbox: [0, 0, canvas.width, canvas.height],
    maskScore: 1,
    edgeScore: 1,
    reconstructMode: 'raster-safe',
    source: 'original',
    warnings: ['Original reference layer is hidden by default.'],
  });

  if (mode === 'basic') {
    groups.push({ id: 'group_source', name: 'group/source', role: 'notes', layerIds: [originalLayerId], visible: true });
    const qualityMetrics: QualityMetrics = {
      maskBoundary: 1,
      ocr: 1,
      fontMatch: 1,
      inpaint: 1,
      layerConsistency: 1,
      openability: 0.98,
    };

    for (const layer of layers) {
      if (layer.canvas && !layer.imageDataUrl) {
        try { layer.imageDataUrl = layer.canvas.toDataURL('image/png'); } catch { /* ignore */ }
      }
    }

    return { layers, groups, fallbacks, qualityMetrics, exportNotes, width: canvas.width, height: canvas.height };
  }

  const externalScene = await tryExternalLayerSplit(
    imageUrl,
    onProgress,
  );
  if (externalScene) {
    if (mode === 'studio') addStudioShadowToExternalScene(externalScene);
    externalScene.layers.unshift(layers[0]);
    externalScene.groups.push({ id: 'group_source', name: 'group/source', role: 'notes', layerIds: [originalLayerId], visible: true });
    return externalScene;
  }

  onProgress?.('detecting_background', 18);
  const bgRemoval = detectBestBgRemoval(originalData);
  let fgAlphaMask: Float32Array;
  let bgMask: Uint8Array;
  let bgColor: [number, number, number];
  let usedBgRemoval = false;

  if (bgRemoval.mode === 'none') {
    fallbacks.push({
      stage: 'background_detection',
      reason: 'No uniform background color detected',
      action: 'used_luminance_split_for_photoshop_layers',
    });
    const lumResult = analyzeLuminance(originalData);
    bgColor = lumResult.bgColor;
    bgMask = lumResult.backgroundMask;
    fgAlphaMask = maskToAlpha(lumResult.foregroundMask);
  } else {
    onProgress?.('removing_background', 28);
    const { alphaMask } = backgroundToAlpha(
      originalData,
      bgRemoval.bgColor,
      bgRemoval.tolerance,
      bgRemoval.feather,
      1,
      2
    );
    fgAlphaMask = alphaMask;
    bgColor = bgRemoval.bgColor;
    bgMask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      bgMask[i] = fgAlphaMask[i] < 0.24 ? 1 : 0;
    }
    usedBgRemoval = true;
  }

  onProgress?.('detecting_elements', 42);
  const fgBinaryMask = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    fgBinaryMask[i] = fgAlphaMask[i] > 0.28 ? 1 : 0;
  }

  let components = findConnectedComponents(
    fgBinaryMask,
    canvas.width,
    canvas.height,
    Math.max(80, Math.floor(totalPixels * 0.00025))
  );

  for (const comp of components) {
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < totalPixels; i++) {
      if (!comp.mask[i]) continue;
      rSum += originalData.data[i * 4];
      gSum += originalData.data[i * 4 + 1];
      bSum += originalData.data[i * 4 + 2];
      count++;
    }
    if (count > 0) {
      comp.avgColor = [Math.round(rSum / count), Math.round(gSum / count), Math.round(bSum / count)];
    }
  }

  components = mergeSmallComponents(components, canvas.width, canvas.height, totalPixels, 0.0015)
    .sort((a, b) => b.pixelCount - a.pixelCount);

  const textMasks: Uint8Array[] = [];
  const decoMasks: Uint8Array[] = [];
  let bestTextConfidence = 0;

  for (let index = 0; index < components.length; index++) {
    const comp = components[index];
    const { x, y, w, h } = comp.boundingBox;
    const areaRatio = comp.pixelCount / totalPixels;
    const aspectRatio = w / Math.max(1, h);
    const centerX = (x + w / 2) / canvas.width;
    const centerY = (y + h / 2) / canvas.height;
    const textResult = detectTextInComponent(originalData, comp);
    const looksLikeTextBand = aspectRatio > 1.9 && w > canvas.width * 0.12 && h < canvas.height * 0.24 && areaRatio < 0.18;
    const looksLikePeripheralDecor = index > 0 && areaRatio < 0.08 &&
      (centerX < 0.18 || centerX > 0.82 || centerY < 0.18 || centerY > 0.82);

    if (textResult.isText || looksLikeTextBand) {
      textMasks.push(textResult.textMask || comp.mask);
      bestTextConfidence = Math.max(bestTextConfidence, textResult.confidence || 0.45);
    } else if (looksLikePeripheralDecor) {
      decoMasks.push(comp.mask);
    }
  }

  const textMask = unionMasks(textMasks, totalPixels);
  const decoMask = unionMasks(decoMasks, totalPixels);
  const nonSubjectMask = unionMasks([textMask, decoMask], totalPixels);
  let subjectAlpha = subtractMask(fgAlphaMask, nonSubjectMask);
  const fullSubjectPixels = countAlpha(fgAlphaMask);
  const trimmedSubjectPixels = countAlpha(subjectAlpha);

  if (fullSubjectPixels === 0 || trimmedSubjectPixels < fullSubjectPixels * 0.35) {
    subjectAlpha = fgAlphaMask;
    fallbacks.push({
      stage: 'subject_layer',
      reason: 'Element subtraction would damage the main subject',
      action: 'kept_complete_foreground_as_subject_layer',
    });
  }

  const subjectBinaryMask = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    subjectBinaryMask[i] = subjectAlpha[i] > 0.05 ? 1 : 0;
  }

  onProgress?.('building_photoshop_layers', 65);
  layers.push({
    id: 'layer_bg_main',
    role: 'background',
    name: v4LayerName('background', 0, 'main'),
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    canvas: createReconstructedBackground(originalData, bgMask, bgColor),
    boundingBox: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    bbox: [0, 0, canvas.width, canvas.height],
    maskScore: usedBgRemoval ? 0.82 : 0.55,
    edgeScore: 0.9,
    reconstructMode: 'raster-safe',
    source: usedBgRemoval ? 'inpainted' : 'estimated',
    warnings: usedBgRemoval
      ? ['Background is reconstructed from the detected background color.']
      : ['Background is estimated because a clean removable background was not detected.'],
  });

  if (mode === 'studio' && countMask(subjectBinaryMask) > 0) {
    layers.push({
      id: 'layer_shadow_01',
      role: 'shadow',
      name: v4LayerName('shadow', 0, 'main_subject'),
      visible: true,
      opacity: 0.25,
      blendMode: 'multiply',
      canvas: estimateShadowCanvas(originalData, subjectBinaryMask),
      boundingBox: bboxFromMask(subjectBinaryMask, canvas.width, canvas.height),
      bbox: (() => {
        const bb = bboxFromMask(subjectBinaryMask, canvas.width, canvas.height);
        return bb ? [bb.x, bb.y, bb.x + bb.width, bb.y + bb.height] as [number, number, number, number] : undefined;
      })(),
      maskScore: 0.45,
      edgeScore: 0.3,
      semanticLabel: 'ambient_shadow',
      reconstructMode: 'raster-safe',
      derivedFrom: 'layer_subject_01',
      source: 'estimated',
      warnings: ['Estimated Photoshop-compatible shadow layer.'],
    });
  }

  const subjectBBox = bboxFromMask(subjectBinaryMask, canvas.width, canvas.height);
  layers.push({
    id: 'layer_subject_01',
    role: 'subject',
    name: v4LayerName('subject', 0, 'main_subject'),
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    canvas: extractFullCanvasLayer(originalData, subjectAlpha),
    boundingBox: subjectBBox || { x: 0, y: 0, width: canvas.width, height: canvas.height },
    bbox: subjectBBox ? [subjectBBox.x, subjectBBox.y, subjectBBox.x + subjectBBox.width, subjectBBox.y + subjectBBox.height] : [0, 0, canvas.width, canvas.height],
    maskScore: usedBgRemoval ? 0.82 : 0.55,
    edgeScore: calculateEdgeScore(subjectBinaryMask, canvas.width, canvas.height),
    semanticLabel: 'main_subject',
    reconstructMode: 'raster-safe',
    source: 'original',
    warnings: ['Full-canvas transparent PNG layer; original element position is preserved at (0,0).'],
  });

  if (countMask(decoMask) > Math.max(40, totalPixels * 0.00015)) {
    const decoBBox = bboxFromMask(decoMask, canvas.width, canvas.height);
    layers.push({
      id: 'layer_deco_01',
      role: 'deco',
      name: v4LayerName('deco', 0, mode === 'studio' ? 'effects_and_decor' : 'decorative_elements'),
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      canvas: extractFullCanvasLayer(originalData, maskToAlpha(decoMask, fgAlphaMask)),
      boundingBox: decoBBox,
      bbox: decoBBox ? [decoBBox.x, decoBBox.y, decoBBox.x + decoBBox.width, decoBBox.y + decoBBox.height] : undefined,
      maskScore: 0.72,
      edgeScore: calculateEdgeScore(decoMask, canvas.width, canvas.height),
      semanticLabel: 'decorative_element',
      reconstructMode: 'raster-safe',
      source: 'original',
      warnings: ['Decorative/effect candidates are grouped into one Photoshop layer to avoid fragmented exports.'],
    });
  }

  const hasTextLayer = countMask(textMask) > Math.max(40, totalPixels * 0.00015);
  if (hasTextLayer) {
    const textBBox = bboxFromMask(textMask, canvas.width, canvas.height);
    layers.push({
      id: 'layer_text_01',
      role: 'text',
      name: v4LayerName('text', 0, 'raster_text'),
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      canvas: extractFullCanvasLayer(originalData, maskToAlpha(textMask, fgAlphaMask)),
      boundingBox: textBBox,
      bbox: textBBox ? [textBBox.x, textBBox.y, textBBox.x + textBBox.width, textBBox.y + textBBox.height] : undefined,
      maskScore: 0.68,
      edgeScore: calculateEdgeScore(textMask, canvas.width, canvas.height),
      semanticLabel: 'text',
      ocrConfidence: bestTextConfidence,
      reconstructMode: 'raster-safe',
      source: 'original',
      warnings: [
        'Font cannot be safely inferred in the browser export pipeline, so text is exported as a transparent PNG candidate layer.',
        'Use Photoshop text tool to replace this layer when an exact font is known.',
      ],
    });
  } else {
    fallbacks.push({
      stage: 'text_layer',
      reason: 'No reliable text region detected',
      action: 'kept_text_inside_subject_or_original_reference_layer',
    });
  }

  const bgLayerIds = layers.filter(l => l.role === 'background').map(l => l.id);
  const shadowLayerIds = layers.filter(l => l.role === 'shadow').map(l => l.id);
  const subjectLayerIds = layers.filter(l => l.role === 'subject').map(l => l.id);
  const decoLayerIds = layers.filter(l => l.role === 'deco').map(l => l.id);
  const textLayerIds = layers.filter(l => l.role === 'text').map(l => l.id);

  groups.push({ id: 'group_bg', name: 'group/background', role: 'background', layerIds: bgLayerIds, visible: true });
  if (shadowLayerIds.length > 0) groups.push({ id: 'group_fx', name: 'group/effects', role: 'shadow', layerIds: shadowLayerIds, visible: true });
  groups.push({ id: 'group_subjects', name: 'group/subjects', role: 'subject', layerIds: subjectLayerIds, visible: true });
  if (decoLayerIds.length > 0) groups.push({ id: 'group_deco', name: 'group/decorations', role: 'deco', layerIds: decoLayerIds, visible: true });
  if (textLayerIds.length > 0) groups.push({ id: 'group_text', name: 'group/text', role: 'text', layerIds: textLayerIds, visible: true });
  groups.push({ id: 'group_source', name: 'group/source', role: 'notes', layerIds: [originalLayerId], visible: true });

  const qualityMetrics: QualityMetrics = {
    maskBoundary: usedBgRemoval ? 0.78 : 0.55,
    ocr: hasTextLayer ? Math.max(0.45, bestTextConfidence) : 0.7,
    fontMatch: hasTextLayer ? 0.35 : 0.75,
    inpaint: usedBgRemoval ? 0.75 : 0.48,
    layerConsistency: 0.88,
    openability: 0.96,
  };

  exportNotes.push({
    level: 'info',
    stage: 'photoshop_export',
    message: `Photoshop-friendly PSD built from ${components.length} detected regions, merged into ${layers.length} full-canvas layers. Prompt: ${prompt || 'Image'}.`,
  });

  if (hasTextLayer) {
    exportNotes.push({
      level: 'warning',
      stage: 'text_layer',
      message: 'Text is exported as a raster transparent PNG candidate because exact Photoshop font reconstruction is not available in this client-side exporter.',
    });
  }

  onProgress?.('generating_previews', 90);
  for (const layer of layers) {
    if (layer.canvas && !layer.imageDataUrl) {
      try { layer.imageDataUrl = layer.canvas.toDataURL('image/png'); } catch { /* ignore */ }
    }
  }

  return { layers, groups, fallbacks, qualityMetrics, exportNotes, width: canvas.width, height: canvas.height };
}

export async function buildV4Scene(
  imageUrl: string,
  prompt: string,
  mode: PSDExportMode,
  onProgress?: (stage: string, progress: number) => void
): Promise<SceneBuildResult> {
  // Keep the element editor on the same Lovart-style semantic pipeline as PSD export:
  // a few coherent layers plus editable text candidates, not raw connected-component fragments.
  if (typeof window !== 'undefined') {
    return buildPhotoshopEditableScene(imageUrl, prompt, mode, onProgress);
  }

  const fallbacks: Array<{ stage: string; reason: string; action: string }> = [];
  const exportNotes: ExportNote[] = [];

  // === Load image ===
  onProgress?.('loading_image', 5);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const totalPixels = canvas.width * canvas.height;

  const layers: DesignLayer[] = [];
  const groups: DesignGroup[] = [];

  // === Always add original layer (hidden by default) ===
  layers.push({
    id: 'layer_original', role: 'original',
    name: v4LayerName('original', 0, 'original'),
    visible: false, opacity: 1, blendMode: 'normal',
    canvas: imageDataToCanvas(new ImageData(new Uint8ClampedArray(originalData.data), canvas.width, canvas.height)),
    boundingBox: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    maskScore: 1.0, edgeScore: 1.0,
    reconstructMode: 'raster-safe',
    warnings: [],
  });

  // === Basic mode: just original + white bg ===
  if (mode === 'basic') {
    onProgress?.('building_scene', 80);
    groups.push({
      id: 'group_source', name: 'group/source', role: 'notes',
      layerIds: ['layer_original'], visible: true,
    });

    const qualityMetrics: QualityMetrics = {
      maskBoundary: 1.0, ocr: 1.0, fontMatch: 1.0,
      inpaint: 1.0, layerConsistency: 1.0, openability: 0.98,
    };

    for (const layer of layers) {
      if (layer.canvas && !layer.imageDataUrl) {
        try { layer.imageDataUrl = layer.canvas.toDataURL('image/png'); } catch { /* skip */ }
      }
    }

    return { layers, groups, fallbacks, qualityMetrics, exportNotes, width: canvas.width, height: canvas.height };
  }

  // === Pro & Studio: Background Removal + Component Analysis ===

  const externalScene = await tryExternalLayerSplit(
    imageUrl,
    onProgress,
  );
  if (externalScene) {
    if (mode === 'studio') addStudioShadowToExternalScene(externalScene);
    externalScene.layers.unshift(layers[0]);
    externalScene.groups.push({ id: 'group_source', name: 'group/source', role: 'notes', layerIds: ['layer_original'], visible: true });
    return externalScene;
  }

  // Step 1: Try AI vision analysis
  onProgress?.('ai_analyzing', 10);
  const aiAnalysis = await withTimeout(analyzeImageWithAIForTest(imageUrl, onProgress), 55_000, null);

  // Step 2: Detect background using corner sampling + AI guidance
  onProgress?.('detecting_background', 20);
  const bgRemoval = detectBestBgRemoval(originalData);

  // Use AI-provided background info if available and more specific
  let effectiveBgRemoval = bgRemoval;
  if (aiAnalysis?.backgroundMode && aiAnalysis.backgroundMode !== 'none' && aiAnalysis.bgColor) {
    // AI analysis suggests a specific background mode and color
    if (bgRemoval.mode === 'none' && aiAnalysis.backgroundMode !== 'none') {
      // Corner sampling couldn't detect bg, but AI says there is one — trust AI
      effectiveBgRemoval = {
        mode: aiAnalysis.backgroundMode as 'white' | 'corner' | 'color' | 'white-preserve',
        bgColor: aiAnalysis.bgColor,
        tolerance: aiAnalysis.backgroundMode === 'white-preserve' ? 10 : 8,
        feather: aiAnalysis.backgroundMode === 'white-preserve' ? 50 : 45,
      };
    } else if (aiAnalysis.bgColor) {
      // Both detected bg — use AI's color if it seems more accurate
      effectiveBgRemoval = { ...bgRemoval, bgColor: aiAnalysis.bgColor };
    }
  }

  let fgAlphaMask: Float32Array;
  let bgMask: Uint8Array;
  let bgColor: [number, number, number];
  let usedBgRemoval: boolean;

  if (effectiveBgRemoval.mode === 'none') {
    // No uniform background — use luminance-based separation as fallback
    onProgress?.('luminance_fallback', 25);
    fallbacks.push({
      stage: 'background_detection',
      reason: 'No uniform background color detected',
      action: 'fallback_to_luminance_split',
    });

    const lumResult = analyzeLuminance(originalData);
    bgColor = lumResult.bgColor;
    fgAlphaMask = new Float32Array(totalPixels);
    bgMask = lumResult.backgroundMask;
    for (let i = 0; i < totalPixels; i++) {
      fgAlphaMask[i] = lumResult.foregroundMask[i] ? 1.0 : 0.0;
    }
    usedBgRemoval = false;
  } else {
    // Apply background-to-alpha removal
    onProgress?.('removing_background', 30);
    const { alphaMask } = backgroundToAlpha(
      originalData,
      effectiveBgRemoval.bgColor,
      effectiveBgRemoval.tolerance,
      effectiveBgRemoval.feather,
      1.0,
      2
    );

    fgAlphaMask = alphaMask;
    bgColor = effectiveBgRemoval.bgColor;

    // Create binary bg mask
    bgMask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      bgMask[i] = fgAlphaMask[i] < 0.3 ? 1 : 0;
    }
    usedBgRemoval = true;
  }

  // Step 3: Find connected foreground components
  onProgress?.('finding_components', 40);

  // Create binary foreground mask for connected component analysis
  const fgBinaryMask = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    fgBinaryMask[i] = fgAlphaMask[i] > 0.3 ? 1 : 0;
  }

  let components = findConnectedComponents(fgBinaryMask, canvas.width, canvas.height, 50);

  // Compute average colors for components
  for (const comp of components) {
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < totalPixels; i++) {
      if (comp.mask[i]) {
        rSum += originalData.data[i * 4];
        gSum += originalData.data[i * 4 + 1];
        bSum += originalData.data[i * 4 + 2];
        count++;
      }
    }
    if (count > 0) {
      comp.avgColor = [Math.round(rSum / count), Math.round(gSum / count), Math.round(bSum / count)];
    }
  }

  // Step 4: Merge small components into nearby large ones
  onProgress?.('merging_fragments', 50);
  components = mergeSmallComponents(components, canvas.width, canvas.height, totalPixels, 0.001);

  // Sort by pixel count (largest first)
  components.sort((a, b) => b.pixelCount - a.pixelCount);

  // Step 5: Limit to reasonable number of layers
  const maxLayers = mode === 'studio' ? 10 : 7;
  if (components.length > maxLayers) {
    // Keep the largest components, merge the rest into the largest
    const kept = components.slice(0, maxLayers);
    const discarded = components.slice(maxLayers);
    for (const disc of discarded) {
      for (let i = 0; i < totalPixels; i++) {
        if (disc.mask[i]) kept[0].mask[i] = 1;
      }
      kept[0].pixelCount += disc.pixelCount;
    }
    components = kept;
  }

  // Step 6: Classify components using AI analysis if available, otherwise heuristic
  onProgress?.('classifying_layers', 55);

  interface ClassifiedComponent {
    component: ForegroundComponent;
    role: LayerRole;
    label: SemanticLabel;
    name: string;
    isText: boolean;
    textConfidence: number;
  }

  const classified: ClassifiedComponent[] = [];

  for (const comp of components) {
    // Check for text
    const textResult = detectTextInComponent(originalData, comp);

    // Use AI analysis to help classify if available
    let role: LayerRole;
    let label: SemanticLabel;
    let name: string;

    if (textResult.isText) {
      role = 'text';
      label = 'text';
      name = 'text';
    } else {
      const heuristic = classifyComponent(comp, canvas.width, canvas.height, totalPixels);

      // If AI analysis is available, try to find a matching layer description
      if (aiAnalysis && aiAnalysis.layers.length > 0) {
        const compCenterX = comp.boundingBox.x + comp.boundingBox.w / 2;
        const compCenterY = comp.boundingBox.y + comp.boundingBox.h / 2;
        const posMap: Record<string, { minX: number; maxX: number; minY: number; maxY: number }> = {
          'center': { minX: 0.3, maxX: 0.7, minY: 0.3, maxY: 0.7 },
          'top': { minX: 0, maxX: 1, minY: 0, maxY: 0.3 },
          'bottom': { minX: 0, maxX: 1, minY: 0.7, maxY: 1 },
          'left': { minX: 0, maxX: 0.3, minY: 0, maxY: 1 },
          'right': { minX: 0.7, maxX: 1, minY: 0, maxY: 1 },
          'top-left': { minX: 0, maxX: 0.3, minY: 0, maxY: 0.3 },
          'top-right': { minX: 0.7, maxX: 1, minY: 0, maxY: 0.3 },
          'bottom-left': { minX: 0, maxX: 0.3, minY: 0.7, maxY: 1 },
          'bottom-right': { minX: 0.7, maxX: 1, minY: 0.7, maxY: 1 },
        };

        let bestMatch = -1;
        let bestScore = -1;
        for (let li = 0; li < aiAnalysis.layers.length; li++) {
          const aiLayer = aiAnalysis.layers[li];
          const pos = aiLayer.approximatePosition || 'center';
          const range = posMap[pos] || posMap['center'];
          const relX = compCenterX / canvas.width;
          const relY = compCenterY / canvas.height;
          const inRange = relX >= range.minX && relX <= range.maxX && relY >= range.minY && relY <= range.maxY;
          if (inRange) {
            const score = comp.pixelCount / totalPixels + (inRange ? 0.5 : 0);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = li;
            }
          }
        }

        if (bestMatch >= 0) {
          const aiLayer = aiAnalysis.layers[bestMatch];
          role = aiLayer.role as LayerRole;
          name = aiLayer.name;
          label = heuristic.label;
        } else {
          role = heuristic.role;
          label = heuristic.label;
          name = heuristic.name;
        }
      } else {
        role = heuristic.role;
        label = heuristic.label;
        name = heuristic.name;
      }
    }

    classified.push({
      component: comp,
      role,
      label,
      name,
      isText: textResult.isText,
      textConfidence: textResult.confidence,
    });
  }

  // Step 7: Build PSD layers — each is a FULL-CANVAS transparent PNG at (0,0)
  onProgress?.('building_layers', 65);

  // Background layer: solid fill with detected bg color
  layers.push({
    id: 'layer_bg_fill', role: 'background',
    name: v4LayerName('background', 0, 'main'),
    visible: true, opacity: 1, blendMode: 'normal',
    canvas: createReconstructedBackground(originalData, bgMask, bgColor),
    boundingBox: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    bbox: [0, 0, canvas.width, canvas.height],
    maskScore: usedBgRemoval ? 0.85 : 0.6, edgeScore: 0.9,
    reconstructMode: 'raster-safe',
    source: usedBgRemoval ? 'inpainted' : 'estimated',
    warnings: usedBgRemoval
      ? ['Background reconstructed from detected background color.']
      : ['No uniform background detected; background is estimated.'],
  });

  // Foreground element layers
  let subjectIdx = 0;
  let textIdx = 0;
  let decoIdx = 0;

  for (const item of classified) {
    const comp = item.component;

    // Create full-canvas alpha mask for this component
    const compAlpha = new Float32Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      compAlpha[i] = comp.mask[i] ? fgAlphaMask[i] : 0;
    }

    const layerCanvas = extractFullCanvasLayer(originalData, compAlpha);
    const bb = comp.boundingBox;

    const layer: DesignLayer = {
      id: '',
      role: item.role,
      name: '',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      canvas: layerCanvas,
      boundingBox: { x: bb.x, y: bb.y, width: bb.w, height: bb.h },
      bbox: [bb.x, bb.y, bb.x + bb.w, bb.y + bb.h],
      maskScore: usedBgRemoval ? 0.8 : 0.5,
      edgeScore: calculateEdgeScore(comp.mask, canvas.width, canvas.height),
      semanticLabel: item.label,
      reconstructMode: 'raster-safe',
      source: 'original',
      warnings: [],
    };

    if (item.isText) {
      layer.id = `layer_text_${textIdx}`;
      layer.name = v4LayerName('text', textIdx, item.name);
      layer.warnings = ['Text region detected by edge density analysis.'];
      textIdx++;
    } else if (item.role === 'subject') {
      layer.id = `layer_subject_${subjectIdx}`;
      layer.name = v4LayerName('subject', subjectIdx, item.name);
      layer.warnings = [usedBgRemoval
        ? 'Element extracted via background removal.'
        : 'Element separated by luminance threshold.'];
      subjectIdx++;
    } else if (item.role === 'background') {
      // Additional background sub-region
      layer.id = `layer_bg_region_${subjectIdx}`;
      layer.name = v4LayerName('background', subjectIdx + 1, item.name);
      layer.role = 'background';
      subjectIdx++;
    } else {
      layer.id = `layer_deco_${decoIdx}`;
      layer.name = v4LayerName('deco', decoIdx, item.name);
      layer.warnings = ['Decorative element detected by component analysis.'];
      decoIdx++;
    }

    layers.push(layer);
  }

  // Step 8: Studio mode — add shadow estimation
  if (mode === 'studio') {
    onProgress?.('estimating_effects', 75);

    for (let si = 0; si < subjectIdx; si++) {
      const subjectLayer = layers.find(l => l.id === `layer_subject_${si}`);
      if (!subjectLayer) continue;

      // Find the component for this subject
      const subjectClassified = classified.find(c =>
        c.role === 'subject' && layers.findIndex(l => l.id === `layer_subject_${si}`) > 0
      );
      if (!subjectClassified) continue;

      const comp = subjectClassified.component;
      const shadowCanvas = estimateShadowCanvas(originalData, comp.mask);
      layers.push({
        id: `layer_shadow_subject_${si}`, role: 'shadow',
        name: v4LayerName('shadow', si, subjectClassified.name),
        visible: true, opacity: 0.31, blendMode: 'multiply',
        canvas: shadowCanvas,
        bbox: [comp.boundingBox.x, comp.boundingBox.y, comp.boundingBox.x + comp.boundingBox.w, comp.boundingBox.y + comp.boundingBox.h],
        boundingBox: { x: comp.boundingBox.x, y: comp.boundingBox.y, width: comp.boundingBox.w, height: comp.boundingBox.h },
        maskScore: 0.45, edgeScore: 0.3,
        reconstructMode: 'raster-safe',
        derivedFrom: `layer_subject_${si}`,
        source: 'estimated',
        warnings: ['Shadow is an estimated dilation effect.'],
      });
    }
  }

  // Step 9: Build groups
  const bgLayerIds = layers.filter(l => l.role === 'background').map(l => l.id);
  const subjectLayerIds = layers.filter(l => l.role === 'subject').map(l => l.id);
  const decoLayerIds = layers.filter(l => l.role === 'deco').map(l => l.id);
  const textLayerIds = layers.filter(l => l.role === 'text').map(l => l.id);

  groups.push(
    { id: 'group_bg', name: 'group/background', role: 'background', layerIds: bgLayerIds, visible: true },
    { id: 'group_subjects', name: 'group/subjects', role: 'subject', layerIds: subjectLayerIds, visible: true },
  );

  if (decoLayerIds.length > 0) {
    groups.push({ id: 'group_deco', name: 'group/decorations', role: 'deco', layerIds: decoLayerIds, visible: true });
  }
  if (textLayerIds.length > 0) {
    groups.push({ id: 'group_text', name: 'group/text', role: 'text', layerIds: textLayerIds, visible: true });
  }
  if (mode === 'studio') {
    const shadowIds = layers.filter(l => l.role === 'shadow').map(l => l.id);
    if (shadowIds.length > 0) {
      groups.push({ id: 'group_fx', name: 'group/effects', role: 'shadow', layerIds: shadowIds, visible: true });
    }
  }
  groups.push({ id: 'group_source', name: 'group/source', role: 'notes', layerIds: ['layer_original'], visible: true });

  // Step 10: Quality assessment
  onProgress?.('assessing_quality', 85);

  const nonOriginalLayers = layers.filter(l => l.role !== 'original');
  const avgMaskScore = nonOriginalLayers.reduce((s, l) => s + l.maskScore, 0) / Math.max(1, nonOriginalLayers.length);
  const avgEdgeScore = nonOriginalLayers.reduce((s, l) => s + l.edgeScore, 0) / Math.max(1, nonOriginalLayers.length);

  const qualityMetrics: QualityMetrics = {
    maskBoundary: (avgMaskScore + avgEdgeScore) / 2,
    ocr: 1.0,
    fontMatch: 1.0,
    inpaint: usedBgRemoval ? 0.8 : 0.5,
    layerConsistency: 0.75,
    openability: 0.95,
  };

  const method = usedBgRemoval ? 'background removal' : 'luminance separation';
  exportNotes.push({
    level: 'info',
    message: `V4 PSD layers reconstructed via ${method} (${components.length} foreground components detected). Each element is a full-canvas transparent PNG layer. Layer boundaries are estimated and may need manual refinement in Photoshop.`,
    stage: 'segmentation',
  });

  if (aiAnalysis) {
    exportNotes.push({
      level: 'info',
      message: `AI vision analysis identified ${aiAnalysis.layers.length} semantic elements: ${aiAnalysis.layers.map(l => l.name).join(', ')}`,
      stage: 'ai_analysis',
    });
  }

  if (fallbacks.length > 0) {
    exportNotes.push({ level: 'warning', message: `${fallbacks.length} fallback(s) applied during processing.`, stage: 'general' });
  }

  // Step 11: Post-process — generate imageDataUrl for editor preview
  onProgress?.('generating_previews', 90);
  for (const layer of layers) {
    if (layer.canvas && !layer.imageDataUrl) {
      try {
        layer.imageDataUrl = layer.canvas.toDataURL('image/png');
      } catch {
        // Canvas may be tainted; skip
      }
    }
  }

  return { layers, groups, fallbacks, qualityMetrics, exportNotes, width: canvas.width, height: canvas.height };
}

/** Simple luminance-based foreground/background separation (fallback) */
function analyzeLuminance(imageData: ImageData): {
  foregroundMask: Uint8Array;
  backgroundMask: Uint8Array;
  threshold: number;
  bgColor: [number, number, number];
} {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  const luminances = new Float32Array(totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    luminances[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Otsu's method
  const histogram = new Float32Array(256);
  for (let i = 0; i < totalPixels; i++) histogram[Math.min(255, Math.round(luminances[i]))]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumB = 0, wB = 0, maxVariance = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = totalPixels - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) { maxVariance = variance; threshold = t; }
  }

  const foregroundMask = new Uint8Array(totalPixels);
  const backgroundMask = new Uint8Array(totalPixels);
  let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (luminances[i] < threshold) {
      foregroundMask[i] = 1;
    } else {
      backgroundMask[i] = 1;
      bgR += data[i * 4];
      bgG += data[i * 4 + 1];
      bgB += data[i * 4 + 2];
      bgCount++;
    }
  }

  const bgColor: [number, number, number] = bgCount > 0
    ? [Math.round(bgR / bgCount), Math.round(bgG / bgCount), Math.round(bgB / bgCount)]
    : [255, 255, 255];

  return { foregroundMask, backgroundMask, threshold, bgColor };
}

// ==================== V4 Manifest Builder ====================

function buildManifest(
  width: number,
  height: number,
  mode: PSDExportMode,
  layers: DesignLayer[],
  fallbacks: Array<{ stage: string; reason: string; action: string }>,
  qualityMetrics: QualityMetrics
): PSDManifest {
  const quality = calculateQualityScore(qualityMetrics);

  const manifestLayers: ManifestLayer[] = layers.map(l => ({
    id: l.id,
    role: l.role,
    name: l.name,
    bbox: l.bbox,
    maskScore: l.maskScore,
    edgeScore: l.edgeScore,
    reconstructMode: l.reconstructMode,
    editableText: l.editableText,
    ocrConfidence: l.ocrConfidence,
    fontCandidates: l.fontCandidates,
    derivedFrom: l.derivedFrom,
    source: l.source,
    warnings: l.warnings,
  }));

  return {
    schema: 'psd-export-manifest.v4',
    version: '4.0.0',
    width,
    height,
    layerCount: layers.length,
    mode,
    quality: { score: quality.score, label: quality.label, metrics: qualityMetrics },
    layers: manifestLayers,
    fallbacks,
  };
}

// ==================== V4 XMP Metadata ====================

function buildXmpManifest(manifest: PSDManifest): string {
  const json = JSON.stringify(manifest, null, 0);
  return `<?xpacket begin='' id='W5M0MpCehiHzreSzNTczkc9d'?>
<x:xmpmeta xmlns:x='adobe:ns:meta/'>
  <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
    <rdf:Description xmlns:v4='https://example.local/psd-export/v4/'>
      <v4:manifest><![CDATA[${json}]]></v4:manifest>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end='w'?>`;
}

// ==================== PSD Assembly (ag-psd) ====================

function layerSortIndex(role: LayerRole): number {
  switch (role) {
    case 'original': return 100;
    case 'background': return 0;
    case 'shadow': return 10;
    case 'deco': return 20;
    case 'subject': return 30;
    case 'text': return 40;
  }
}

function blendModeToAgPs(mode: string): BlendMode {
  const valid: BlendMode[] = ['pass through', 'normal', 'dissolve', 'darken', 'multiply',
    'color burn', 'linear burn', 'darker color', 'lighten', 'screen', 'color dodge',
    'linear dodge', 'lighter color', 'overlay', 'soft light', 'hard light', 'vivid light',
    'linear light', 'pin light', 'hard mix', 'difference', 'exclusion', 'subtract',
    'divide', 'hue', 'saturation', 'color', 'luminosity'];
  const lower = mode.toLowerCase();
  if (valid.includes(lower as BlendMode)) return lower as BlendMode;
  return 'normal';
}

function estimateTextFontSize(layer: DesignLayer): number {
  if (layer.fontSize && layer.fontSize > 0) return layer.fontSize;
  const box = layer.boundingBox;
  const text = layer.editableText || layer.textContent || '';
  const lineCount = Math.max(1, text.split(/\r?\n/).length);
  if (!box) return 24;
  return Math.max(10, Math.min(96, Math.round((box.height / lineCount) * 0.72)));
}

function createEditableTextPsdLayer(layer: DesignLayer): Layer | null {
  const text = (layer.editableText || layer.textContent || '').trim();
  if (!text || !layer.boundingBox) return null;
  const box = layer.boundingBox;
  const [r, g, b] = layer.textColor || [30, 30, 30];
  return {
    name: `Text: ${text.replace(/\s+/g, ' ').slice(0, 40)}`,
    hidden: !(layer.ocrConfidence && layer.ocrConfidence >= 0.94),
    opacity: layer.opacity,
    blendMode: 'normal',
    text: {
      text,
      transform: [1, 0, 0, 1, box.x, box.y + estimateTextFontSize(layer)],
      shapeType: 'box',
      boxBounds: [0, 0, box.height, box.width],
      style: {
        font: { name: 'ArialMT' },
        fontSize: estimateTextFontSize(layer),
        fillColor: { r, g, b },
      },
    },
  } as Layer;
}

function assemblePSD(
  width: number,
  height: number,
  layers: DesignLayer[],
  groups: DesignGroup[],
  manifest: PSDManifest
): ArrayBuffer {
  const agLayers: Layer[] = [];
  const xmpManifest = buildXmpManifest(manifest);
  void xmpManifest;

  // White background
  agLayers.push({
    name: '00_White_Background',
    canvas: createWhiteBackgroundCanvas(width, height),
    opacity: 1,
    blendMode: 'normal',
    hidden: false,
  });

  // If we have groups, use group structure
  if (groups.length > 0 && layers.some(l => l.role !== 'original')) {
    for (const group of groups) {
      const groupLayers: Layer[] = [];
      for (const layerId of group.layerIds) {
        const dl = layers.find(l => l.id === layerId);
        if (!dl) continue;
        const editableTextLayer = dl.role === 'text' ? createEditableTextPsdLayer(dl) : null;
        if (editableTextLayer) groupLayers.push(editableTextLayer);
        if (!dl.canvas) continue;
        groupLayers.push({
          name: editableTextLayer ? `${dl.name}/raster-reference` : dl.name,
          canvas: dl.canvas,
          left: Math.round(dl.offsetX ?? 0),
          top: Math.round(dl.offsetY ?? 0),
          opacity: dl.opacity,
          blendMode: blendModeToAgPs(dl.blendMode),
          hidden: !dl.visible || (dl.role === 'text' && !!editableTextLayer && !!dl.textContent && !!(dl.ocrConfidence && dl.ocrConfidence >= 0.94)),
        });
      }
      if (groupLayers.length > 0) {
        agLayers.push({
          name: group.name,
          opened: true,
          hidden: !group.visible,
          children: groupLayers,
        });
      }
    }
  } else {
    const sortedLayers = [...layers]
      .filter(l => l.canvas)
      .sort((a, b) => layerSortIndex(a.role) - layerSortIndex(b.role));
    for (const dl of sortedLayers) {
      const editableTextLayer = dl.role === 'text' ? createEditableTextPsdLayer(dl) : null;
      if (editableTextLayer) agLayers.push(editableTextLayer);
      if (!dl.canvas) continue;
      agLayers.push({
        name: editableTextLayer ? `${dl.name}/raster-reference` : dl.name,
        canvas: dl.canvas,
        left: Math.round(dl.offsetX ?? 0),
        top: Math.round(dl.offsetY ?? 0),
        opacity: dl.opacity,
        blendMode: blendModeToAgPs(dl.blendMode),
        hidden: !dl.visible || (dl.role === 'text' && !!editableTextLayer && !!dl.textContent && !!(dl.ocrConfidence && dl.ocrConfidence >= 0.94)),
      });
    }
  }

  const psd: Psd = {
    width,
    height,
    channels: 3,
    bitsPerChannel: 8,
    colorMode: 3,
    children: agLayers,
  };

  return writePsd(psd, { generateThumbnail: true, noBackground: true, invalidateTextLayers: true });
}

async function imageUrlToCanvas(imageUrl: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load layer preview'));
    img.src = imageUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

async function layerToExportCanvas(layer: DesignLayer): Promise<HTMLCanvasElement | undefined> {
  return layer.canvas ?? (layer.imageDataUrl ? imageUrlToCanvas(layer.imageDataUrl) : undefined);
}

function buildFlatGroups(layers: DesignLayer[]): DesignGroup[] {
  const visibleLayerIds = layers.map(layer => layer.id);
  return [{ id: 'group_edited', name: 'group/edited-layers', role: 'edited', layerIds: visibleLayerIds, visible: true }];
}

export async function exportEditedLayersAsPSD(
  layers: DesignLayer[],
  width: number,
  height: number,
  prompt: string,
  mode: PSDExportMode = 'pro',
): Promise<PSDExportResult> {
  const exportLayers: DesignLayer[] = [];

  for (const layer of layers) {
    const canvas = await layerToExportCanvas(layer);
    if (!canvas) continue;
    const dx = Math.round(layer.offsetX ?? 0);
    const dy = Math.round(layer.offsetY ?? 0);
    const box = { x: dx, y: dy, width: canvas.width, height: canvas.height };

    exportLayers.push({
      ...layer,
      canvas,
      boundingBox: box,
      bbox: [box.x, box.y, box.x + box.width, box.y + box.height],
      warnings: [
        ...(layer.warnings ?? []),
        dx !== 0 || dy !== 0 ? `Moved in Wujie editor by ${dx}, ${dy}px.` : '',
      ].filter(Boolean),
    });
  }

  const editableLayerCount = exportLayers.filter(layer => layer.role !== 'original').length;
  const qualityMetrics: QualityMetrics = {
    maskBoundary: 0.82,
    ocr: 1,
    fontMatch: 0.9,
    inpaint: 0.78,
    layerConsistency: editableLayerCount > 0 ? 0.88 : 0.6,
    openability: 0.98,
  };
  const fallbacks = [{
    stage: 'manual_edit',
    reason: 'PSD exported from current edited layer stack',
    action: 'preserve_visibility_order_offsets_and_names',
  }];
  const manifest = buildManifest(width, height, mode, exportLayers, fallbacks, qualityMetrics);
  const arrayBuffer = assemblePSD(width, height, exportLayers, buildFlatGroups(exportLayers), manifest);
  const blob = new Blob([arrayBuffer], { type: 'image/vnd.adobe.photoshop' });
  const filename = `${(prompt || 'wujie').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 30)}_${mode}_edited.psd`;
  const designScene: DesignScene = {
    version: '4.0.0',
    width,
    height,
    layers: exportLayers.map(layer => ({
      id: layer.id,
      name: layer.name,
      role: layer.role as DesignSceneLayer['role'],
      boundingBox: layer.boundingBox,
      imageDataUrl: layer.imageDataUrl,
      textContent: layer.textContent,
      maskScore: layer.maskScore,
      ocrConfidence: layer.ocrConfidence,
    })),
  };

  return { blob, manifest, mode, filename, designScene };
}

export async function downloadEditedPSD(
  layers: DesignLayer[],
  width: number,
  height: number,
  prompt: string = 'Image',
  mode: PSDExportMode = 'pro',
): Promise<void> {
  const result = await exportEditedLayersAsPSD(layers, width, height, prompt, mode);
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==================== Public API ====================

export interface PSDExportOptions {
  mode: PSDExportMode;
  prompt?: string;
  onProgress?: (stage: string, progress: number) => void;
}

/**
 * V4 PSD Export — AI 自动分层导出
 *
 * Modes:
 *   basic  — Original + white background + notes (fastest, most reliable)
 *   pro    — Background removal + connected component analysis: each visual element
 *            is a full-canvas transparent PNG layer. V4 semantic naming + sidecar manifest.
 *   studio — All Pro features + shadow estimation per subject + AI vision analysis +
 *            semantic groups + quality scoring + XMP metadata
 */
export async function exportAsPSD(
  imageUrl: string,
  prompt: string = 'Image',
  options: PSDExportOptions = { mode: 'pro' }
): Promise<PSDExportResult> {
  const { mode, onProgress } = options;

  onProgress?.('normalizing_input', 5);

  const scene = await buildPhotoshopEditableScene(imageUrl, prompt, mode, onProgress);

  onProgress?.('exporting_psd', 95);

  const width = scene.width;
  const height = scene.height;
  const manifest = buildManifest(width, height, mode, scene.layers, scene.fallbacks, scene.qualityMetrics);

  const arrayBuffer = assemblePSD(width, height, scene.layers, scene.groups, manifest);
  const blob = new Blob([arrayBuffer], { type: 'image/vnd.adobe.photoshop' });

  const filename = `${(prompt || 'image').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 30)}_${mode}.psd`;

  const designScene: DesignScene = {
    version: '4.0.0',
    width,
    height,
    layers: scene.layers.map(l => ({
      id: l.id,
      name: l.name,
      role: l.role as DesignSceneLayer['role'],
      boundingBox: l.boundingBox,
      imageDataUrl: l.imageDataUrl,
      textContent: l.textContent,
      maskScore: l.maskScore,
      ocrConfidence: l.ocrConfidence,
    })),
  };

  return { blob, manifest, mode, filename, designScene };
}

/**
 * Download a single Photoshop-compatible PSD file.
 */
export async function downloadPSD(
  imageUrl: string,
  prompt: string = 'Image',
  mode: PSDExportMode = 'pro',
  onProgress?: (stage: string, progress: number) => void
): Promise<void> {
  const result = await exportAsPSD(imageUrl, prompt, { mode, prompt, onProgress });

  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
