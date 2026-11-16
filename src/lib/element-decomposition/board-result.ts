import 'server-only';

import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { resolveLayerSourceImage } from '@/lib/layer-decomposition/source-image';
import { saveImageFile } from '@/lib/server-data-root';

// 拆解板质量闸门（设计规格 §6.4）：结果必须可解码、不能是原图回显、
// 选择透明背景时必须含真实 alpha=0 像素；通过后转存到受管存储，不保留供应商临时链接或 data: URL。

export const MIN_ELEMENT_BOARD_SIDE = 256;
export const MIN_TRANSPARENT_PIXEL_RATIO = 0.01;

export type ElementBoardQualityCode =
  | 'BOARD_RESULT_UNREADABLE'
  | 'BOARD_RESULT_TOO_SMALL'
  | 'BOARD_RESULT_ECHOED_SOURCE'
  | 'BOARD_TRANSPARENCY_MISSING';

export class ElementBoardQualityError extends Error {
  readonly code: ElementBoardQualityCode;

  constructor(code: ElementBoardQualityCode, message: string) {
    super(message);
    this.name = 'ElementBoardQualityError';
    this.code = code;
  }
}

export interface ElementBoardQualityReport {
  providerId?: string;
  modelId: string;
  width: number;
  height: number;
  sha256: string;
  sourceSha256: string;
  background: 'light-gray' | 'transparent';
  transparentPixelRatio: number;
  checks: Array<{ name: string; passed: boolean; value?: string | number }>;
}

/** 透明像素（alpha=0）占比；用最近邻缩放到 512 内再计数，避免插值产生半透明像素。 */
export async function measureTransparentPixelRatio(buffer: Buffer): Promise<number> {
  const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
  if (!metadata.hasAlpha) return 0;
  const { data, info } = await sharp(buffer, { failOn: 'error' })
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true, kernel: 'nearest' })
    .extractChannel('alpha')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  if (!total) return 0;
  let transparent = 0;
  for (const value of data) if (value === 0) transparent += 1;
  return transparent / total;
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

export async function finalizeElementBoardResult(input: {
  resultUrl: string;
  sourceHash: string;
  background: 'light-gray' | 'transparent';
  modelId: string;
  providerId?: string;
}): Promise<{ imageUrl: string; width: number; height: number; report: ElementBoardQualityReport }> {
  let resolved: Awaited<ReturnType<typeof resolveLayerSourceImage>>;
  try {
    resolved = await resolveLayerSourceImage(input.resultUrl, { signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ElementBoardQualityError('BOARD_RESULT_UNREADABLE', `拆解板结果无法下载或解码（模型 ${input.modelId}）：${reason}`);
  }
  const sha256 = createHash('sha256').update(resolved.buffer).digest('hex');
  if (resolved.width < MIN_ELEMENT_BOARD_SIDE || resolved.height < MIN_ELEMENT_BOARD_SIDE) {
    throw new ElementBoardQualityError(
      'BOARD_RESULT_TOO_SMALL',
      `拆解板尺寸过小（${resolved.width}×${resolved.height}，每边至少 ${MIN_ELEMENT_BOARD_SIDE} 像素，模型 ${input.modelId}）`,
    );
  }
  if (sha256 === input.sourceHash) {
    throw new ElementBoardQualityError('BOARD_RESULT_ECHOED_SOURCE', `模型 ${input.modelId} 原样返回了原图，未生成拆解板`);
  }
  const transparentPixelRatio = await measureTransparentPixelRatio(resolved.buffer).catch(() => 0);
  if (input.background === 'transparent' && transparentPixelRatio < MIN_TRANSPARENT_PIXEL_RATIO) {
    throw new ElementBoardQualityError(
      'BOARD_TRANSPARENCY_MISSING',
      `模型 ${input.modelId} 未返回真实透明背景（透明像素占比 ${(transparentPixelRatio * 100).toFixed(1)}%）。关闭“透明背景”可生成浅灰背景拆解板。`,
    );
  }
  const imageUrl = saveImageFile(resolved.buffer, `${sha256}.${extensionFor(resolved.mimeType)}`, 'element-boards');
  return {
    imageUrl,
    width: resolved.width,
    height: resolved.height,
    report: {
      providerId: input.providerId,
      modelId: input.modelId,
      width: resolved.width,
      height: resolved.height,
      sha256,
      sourceSha256: input.sourceHash,
      background: input.background,
      transparentPixelRatio,
      checks: [
        { name: 'decodable', passed: true },
        { name: 'min-size', passed: true, value: `${resolved.width}x${resolved.height}` },
        { name: 'not-source-echo', passed: true },
        { name: 'background-mode', passed: true, value: input.background },
        { name: 'transparent-pixel-ratio', passed: true, value: Number(transparentPixelRatio.toFixed(4)) },
      ],
    },
  };
}
