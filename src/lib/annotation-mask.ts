import sharp from 'sharp';

import type { CanvasAnnotationV2, NormalizedPoint } from '@/features/annotations/annotation-types';
import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// 大多数图像编辑 API 限制最长边不超过 2048px
const ANNOTATION_MAX_EDGE = 2048;

export class AnnotationAssetError extends Error {
  readonly code = 'ANNOTATION_ASSET_INVALID';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AnnotationAssetError';
  }
}

export interface CompiledAnnotationAssets {
  maskDataUrl: string;
  referenceImageDataUrl: string;
  instructionList: string;
  width: number;
  height: number;
  hasMask: boolean;
}

export interface CompileAnnotationAssetsInput {
  imageUrl: string;
  annotations: CanvasAnnotationV2[];
  signal?: AbortSignal;
}

export async function loadAnnotationImageBuffer(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  try {
    const image = await loadSafeImageInput(imageUrl, {
      maxBytes: MAX_IMAGE_BYTES,
      signal,
    });
    return image.buffer;
  } catch (error) {
    throw new AnnotationAssetError('批注源图无法安全读取', {
      cause: error,
    });
  }
}

function px(point: NormalizedPoint, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.round(point.x * width),
    y: Math.round(point.y * height),
  };
}

function svgPolyline(points: NormalizedPoint[], width: number, height: number): string {
  return points
    .map((point) => {
      const pixel = px(point, width, height);
      return `${pixel.x},${pixel.y}`;
    })
    .join(' ');
}

function instructionLine(annotation: CanvasAnnotationV2, index: number): string {
  const instruction = annotation.instruction?.trim() || '按标记区域执行整体修改要求';
  const label = annotation.label?.trim() ? ` (${annotation.label.trim()})` : '';
  return `${index + 1}. [${annotation.id}] ${annotation.type}${label}: ${instruction}`;
}

function buildMaskSvg(
  annotations: CanvasAnnotationV2[],
  width: number,
  height: number,
): { svg: Buffer; hasMask: boolean } {
  const shapes: string[] = [];
  for (const annotation of annotations) {
    const geometry = annotation.geometry;
    if (!geometry || typeof geometry.kind !== 'string') continue; // 防御：缺失 geometry 的批注跳过
    if (geometry.kind === 'region' || geometry.kind === 'semantic-object') {
      shapes.push(
        `<rect x="${geometry.region.x * width}" y="${geometry.region.y * height}" `
        + `width="${geometry.region.w * width}" height="${geometry.region.h * height}" fill="white"/>`,
      );
    } else if (geometry.kind === 'brush') {
      shapes.push(
        `<polyline points="${svgPolyline(geometry.points, width, height)}" fill="none" `
        + `stroke="white" stroke-width="${Math.max(1, geometry.width * Math.min(width, height))}" `
        + 'stroke-linecap="round" stroke-linejoin="round"/>',
      );
    }
  }
  return {
    hasMask: shapes.length > 0,
    svg: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
      + `<rect width="100%" height="100%" fill="black"/>${shapes.join('')}</svg>`,
    ),
  };
}

function buildReferenceSvg(
  annotations: CanvasAnnotationV2[],
  width: number,
  height: number,
): Buffer {
  const shapes = annotations.map((annotation, index) => {
    const number = index + 1;
    const geometry = annotation.geometry;
    if (!geometry || typeof geometry.kind !== 'string') return ''; // 防御：缺失 geometry 的批注跳过
    if (geometry.kind === 'region' || geometry.kind === 'semantic-object') {
      const x = geometry.region.x * width;
      const y = geometry.region.y * height;
      return `<g><rect x="${x}" y="${y}" width="${geometry.region.w * width}" `
        + `height="${geometry.region.h * height}" fill="none" stroke="#ff3b30" stroke-width="4"/>`
        + `<circle cx="${x + 14}" cy="${y + 14}" r="13" fill="#ff3b30"/>`
        + `<text x="${x + 14}" y="${y + 19}" text-anchor="middle" font-size="15" `
        + `font-family="Arial" font-weight="700" fill="white">${number}</text></g>`;
    }
    if (geometry.kind === 'brush') {
      const first = px(geometry.points[0], width, height);
      return `<g><polyline points="${svgPolyline(geometry.points, width, height)}" fill="none" `
        + `stroke="#ff3b30" stroke-width="${Math.max(3, geometry.width * Math.min(width, height))}" `
        + `stroke-linecap="round" stroke-linejoin="round"/>`
        + `<circle cx="${first.x}" cy="${first.y}" r="13" fill="#ff3b30"/>`
        + `<text x="${first.x}" y="${first.y + 5}" text-anchor="middle" font-size="15" `
        + `font-family="Arial" font-weight="700" fill="white">${number}</text></g>`;
    }
    if (geometry.kind === 'arrow') {
      const start = px(geometry.start, width, height);
      const end = px(geometry.end, width, height);
      return `<g><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" `
        + 'stroke="#ff3b30" stroke-width="5"/>'
        + `<circle cx="${start.x}" cy="${start.y}" r="13" fill="#ff3b30"/>`
        + `<text x="${start.x}" y="${start.y + 5}" text-anchor="middle" font-size="15" `
        + `font-family="Arial" font-weight="700" fill="white">${number}</text></g>`;
    }
    const point = px(geometry.point, width, height);
    return `<g><circle cx="${point.x}" cy="${point.y}" r="13" fill="#ff3b30"/>`
      + `<text x="${point.x}" y="${point.y + 5}" text-anchor="middle" font-size="15" `
      + `font-family="Arial" font-weight="700" fill="white">${number}</text></g>`;
  });

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `${shapes.join('')}</svg>`,
  );
}

function pngDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

export async function compileAnnotationAssets({
  imageUrl,
  annotations,
  signal,
}: CompileAnnotationAssetsInput): Promise<CompiledAnnotationAssets> {
  try {
    const input = await loadAnnotationImageBuffer(imageUrl, signal);
    const normalized = await safeSharp(input, { signal })
      .rotate()
      .ensureAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });
    let width = normalized.info.width;
    let height = normalized.info.height;
    if (!width || !height) throw new Error('image dimensions are unavailable');

    // ★ 如果图片最长边超过 API 限制，等比缩小后再构建蒙版和参考图
    let workingBuffer = normalized.data;
    const maxEdge = Math.max(width, height);
    if (maxEdge > ANNOTATION_MAX_EDGE) {
      const scale = ANNOTATION_MAX_EDGE / maxEdge;
      const newWidth = Math.round(width * scale);
      const newHeight = Math.round(height * scale);
      console.debug(`[annotation-mask] image ${width}x${height} exceeds max edge ${ANNOTATION_MAX_EDGE}, resizing to ${newWidth}x${newHeight}`);
      workingBuffer = await safeSharp(normalized.data, { signal })
        .resize(newWidth, newHeight, { kernel: 'lanczos3' })
        .png()
        .toBuffer();
      width = newWidth;
      height = newHeight;
    }

    const mask = buildMaskSvg(annotations, width, height);
    const maskBuffer = await sharp(mask.svg).png().toBuffer();
    const referenceImage = await safeSharp(workingBuffer, { signal })
      .composite([{ input: buildReferenceSvg(annotations, width, height) }])
      .png()
      .toBuffer();

    return {
      maskDataUrl: pngDataUrl(maskBuffer),
      referenceImageDataUrl: pngDataUrl(referenceImage),
      instructionList: annotations.map(instructionLine).join('\n'),
      width,
      height,
      hasMask: mask.hasMask,
    };
  } catch (error) {
    if (error instanceof AnnotationAssetError) throw error;
    throw new AnnotationAssetError('批注资产生成失败', { cause: error });
  }
}
