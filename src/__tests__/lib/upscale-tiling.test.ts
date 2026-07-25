import { describe, expect, it } from 'vitest';
import {
  buildOverlapTiles,
  calculateFeatherWeight,
} from '@/lib/upscale-tiling';

describe('overlapping upscale tiles', () => {
  it('covers the full image with bounded overlapping tiles', () => {
    const tiles = buildOverlapTiles({
      width: 1920,
      height: 1080,
      tileSize: 768,
      overlap: 64,
    });

    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles[0]).toMatchObject({ x: 0, y: 0 });
    expect(Math.max(...tiles.map(tile => tile.x + tile.width))).toBe(1920);
    expect(Math.max(...tiles.map(tile => tile.y + tile.height))).toBe(1080);
    expect(tiles.every(tile => tile.width <= 768 && tile.height <= 768)).toBe(true);
    expect(tiles.some((tile, index) => index > 0 && tile.x < tiles[index - 1].x + tiles[index - 1].width)).toBe(true);
  });

  it('generates feather weights that soften shared edges', () => {
    expect(calculateFeatherWeight(0, 768, 64, false, true)).toBe(1);
    expect(calculateFeatherWeight(0, 768, 64, true, true)).toBeCloseTo(0, 5);
    expect(calculateFeatherWeight(32, 768, 64, true, true)).toBeCloseTo(0.5, 5);
    expect(calculateFeatherWeight(384, 768, 64, true, true)).toBe(1);
    expect(calculateFeatherWeight(767, 768, 64, true, true)).toBeLessThan(0.02);
  });

  it('rejects overlap values that leave no useful tile core', () => {
    expect(() => buildOverlapTiles({
      width: 1024,
      height: 1024,
      tileSize: 512,
      overlap: 256,
    })).toThrowError(/重叠区域/);
  });
});
