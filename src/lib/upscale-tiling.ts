export interface UpscaleTileOptions {
  width: number;
  height: number;
  tileSize?: number;
  overlap?: number;
}

export interface UpscaleTile {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  hasLeftOverlap: boolean;
  hasRightOverlap: boolean;
  hasTopOverlap: boolean;
  hasBottomOverlap: boolean;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label}必须为正整数`);
  }
}

function buildAxisStarts(length: number, tileSize: number, overlap: number): number[] {
  if (length <= tileSize) return [0];

  const stride = tileSize - overlap;
  const starts: number[] = [];
  let position = 0;

  while (position + tileSize < length) {
    starts.push(position);
    position += stride;
  }

  const lastStart = Math.max(0, length - tileSize);
  if (starts.at(-1) !== lastStart) starts.push(lastStart);
  return starts;
}

export function buildOverlapTiles(options: UpscaleTileOptions): UpscaleTile[] {
  const tileSize = options.tileSize ?? 768;
  const overlap = options.overlap ?? 64;

  assertPositiveInteger(options.width, '图片宽度');
  assertPositiveInteger(options.height, '图片高度');
  assertPositiveInteger(tileSize, '瓦片尺寸');
  if (!Number.isInteger(overlap) || overlap < 0 || overlap * 2 >= tileSize) {
    throw new RangeError('重叠区域必须是小于瓦片尺寸一半的非负整数');
  }

  const xStarts = buildAxisStarts(options.width, tileSize, overlap);
  const yStarts = buildAxisStarts(options.height, tileSize, overlap);
  const tiles: UpscaleTile[] = [];

  for (const y of yStarts) {
    for (const x of xStarts) {
      const width = Math.min(tileSize, options.width - x);
      const height = Math.min(tileSize, options.height - y);
      tiles.push({
        index: tiles.length,
        x,
        y,
        width,
        height,
        hasLeftOverlap: x > 0,
        hasRightOverlap: x + width < options.width,
        hasTopOverlap: y > 0,
        hasBottomOverlap: y + height < options.height,
      });
    }
  }

  return tiles;
}

export function calculateFeatherWeight(
  coordinate: number,
  length: number,
  overlap: number,
  featherStart: boolean,
  featherEnd: boolean,
): number {
  if (length <= 0 || overlap <= 0) return 1;

  let weight = 1;
  if (featherStart && coordinate < overlap) {
    weight = Math.min(weight, Math.max(0, coordinate / overlap));
  }
  if (featherEnd && coordinate >= length - overlap) {
    weight = Math.min(weight, Math.max(0, (length - 1 - coordinate) / overlap));
  }
  return weight;
}
