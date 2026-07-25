import sharp from 'sharp';
import { buildOverlapTiles, calculateFeatherWeight, type UpscaleTile } from '@/lib/upscale-tiling';

export interface UpscaleTileProcessInput {
  input: Buffer;
  tile: UpscaleTile;
  targetWidth: number;
  targetHeight: number;
}

export interface ExecuteOverlapTileUpscaleOptions {
  source: Buffer;
  targetWidth: number;
  targetHeight: number;
  tileSize?: number;
  overlap?: number;
  concurrency?: number;
  processTile: (input: UpscaleTileProcessInput) => Promise<Buffer>;
  onProgress?: (progress: number) => Promise<void> | void;
  isCancelled?: () => boolean | Promise<boolean>;
}

export interface ExecuteOverlapTileUpscaleResult {
  buffer: Buffer;
  tileCount: number;
}

interface ProcessedTile {
  tile: UpscaleTile;
  buffer: Buffer;
  left: number;
  top: number;
  width: number;
  height: number;
}

async function throwIfCancelled(check?: ExecuteOverlapTileUpscaleOptions['isCancelled']): Promise<void> {
  if (check && await check()) {
    throw new Error('AI 超分任务已取消');
  }
}

function createStartFeatherMask(tile: ProcessedTile, overlapX: number, overlapY: number): Buffer {
  const mask = Buffer.alloc(tile.width * tile.height);
  for (let y = 0; y < tile.height; y += 1) {
    const yWeight = calculateFeatherWeight(y, tile.height, overlapY, tile.tile.hasTopOverlap, false);
    for (let x = 0; x < tile.width; x += 1) {
      const xWeight = calculateFeatherWeight(x, tile.width, overlapX, tile.tile.hasLeftOverlap, false);
      mask[y * tile.width + x] = Math.round(255 * xWeight * yWeight);
    }
  }
  return mask;
}

export async function executeOverlapTileUpscale(
  options: ExecuteOverlapTileUpscaleOptions,
): Promise<ExecuteOverlapTileUpscaleResult> {
  const sourceMetadata = await sharp(options.source).metadata();
  const sourceWidth = sourceMetadata.width;
  const sourceHeight = sourceMetadata.height;
  if (!sourceWidth || !sourceHeight) throw new Error('无法读取待放大图片尺寸');
  if (!Number.isInteger(options.targetWidth) || !Number.isInteger(options.targetHeight)
    || options.targetWidth <= 0 || options.targetHeight <= 0) {
    throw new RangeError('瓦片超分目标尺寸必须为正整数');
  }

  const tileSize = options.tileSize ?? 768;
  const overlap = options.overlap ?? 64;
  const tiles = buildOverlapTiles({ width: sourceWidth, height: sourceHeight, tileSize, overlap });
  const scaleX = options.targetWidth / sourceWidth;
  const scaleY = options.targetHeight / sourceHeight;
  const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2)));
  const processed = new Array<ProcessedTile>(tiles.length);
  let cursor = 0;
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      await throwIfCancelled(options.isCancelled);
      const index = cursor;
      cursor += 1;
      if (index >= tiles.length) return;
      const tile = tiles[index];
      const left = Math.round(tile.x * scaleX);
      const top = Math.round(tile.y * scaleY);
      const right = tile.x + tile.width === sourceWidth
        ? options.targetWidth
        : Math.round((tile.x + tile.width) * scaleX);
      const bottom = tile.y + tile.height === sourceHeight
        ? options.targetHeight
        : Math.round((tile.y + tile.height) * scaleY);
      const targetWidth = Math.max(1, right - left);
      const targetHeight = Math.max(1, bottom - top);
      const input = await sharp(options.source)
        .extract({ left: tile.x, top: tile.y, width: tile.width, height: tile.height })
        .png()
        .toBuffer();
      const generated = await options.processTile({ input, tile, targetWidth, targetHeight });
      const normalized = await sharp(generated)
        .resize(targetWidth, targetHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .removeAlpha()
        .png()
        .toBuffer();
      processed[index] = { tile, buffer: normalized, left, top, width: targetWidth, height: targetHeight };
      completed += 1;
      await options.onProgress?.(Math.round((completed / tiles.length) * 100));
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, () => worker()));
  await throwIfCancelled(options.isCancelled);

  const composites: sharp.OverlayOptions[] = [];
  for (const item of processed) {
    const overlapX = Math.max(1, Math.round(overlap * scaleX));
    const overlapY = Math.max(1, Math.round(overlap * scaleY));
    const alpha = createStartFeatherMask(item, overlapX, overlapY);
    const rgba = await sharp(item.buffer)
      .joinChannel(alpha, { raw: { width: item.width, height: item.height, channels: 1 } })
      .png()
      .toBuffer();
    composites.push({ input: rgba, left: item.left, top: item.top });
  }

  const buffer = await sharp({
    create: {
      width: options.targetWidth,
      height: options.targetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png().toBuffer();
  const metadata = await sharp(buffer).metadata();
  if (metadata.width !== options.targetWidth || metadata.height !== options.targetHeight) {
    throw new Error(`瓦片融合输出尺寸异常：${metadata.width ?? 0}x${metadata.height ?? 0}`);
  }
  return { buffer, tileCount: tiles.length };
}
