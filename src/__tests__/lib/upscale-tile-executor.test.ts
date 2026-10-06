import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { executeOverlapTileUpscale } from '@/lib/upscale-tile-executor';

describe('overlap tile upscale executor', () => {
  it('processes overlapping tiles and returns the exact target dimensions', async () => {
    const source = await sharp({
      create: {
        width: 96,
        height: 64,
        channels: 3,
        background: { r: 80, g: 120, b: 160 },
      },
    }).png().toBuffer();
    const progress: number[] = [];

    const result = await executeOverlapTileUpscale({
      source,
      targetWidth: 192,
      targetHeight: 128,
      tileSize: 48,
      overlap: 8,
      concurrency: 2,
      processTile: async ({ input, targetWidth, targetHeight }) => sharp(input)
        .resize(targetWidth, targetHeight, { kernel: sharp.kernel.nearest })
        .png()
        .toBuffer(),
      onProgress: async value => {
        progress.push(value);
      },
    });

    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.width).toBe(192);
    expect(metadata.height).toBe(128);
    expect(result.tileCount).toBeGreaterThan(1);
    expect(progress.at(-1)).toBe(100);
  });

  it('stops before dispatching more tiles when cancellation is requested', async () => {
    const source = await sharp({
      create: {
        width: 96,
        height: 64,
        channels: 3,
        background: { r: 20, g: 30, b: 40 },
      },
    }).png().toBuffer();
    let calls = 0;

    await expect(executeOverlapTileUpscale({
      source,
      targetWidth: 192,
      targetHeight: 128,
      tileSize: 48,
      overlap: 8,
      concurrency: 1,
      isCancelled: () => calls >= 1,
      processTile: async ({ input, targetWidth, targetHeight }) => {
        calls += 1;
        return sharp(input).resize(targetWidth, targetHeight).png().toBuffer();
      },
    })).rejects.toThrowError(/取消/);

    expect(calls).toBe(1);
  });

  it('waits for an in-flight tile and starts no new tiles before reporting another tile failure', async () => {
    const source = await sharp({ create: { width: 96, height: 64, channels: 3,
      background: '#345678' } }).png().toBuffer();
    let releaseSecond: () => void = () => {};
    let markSecondStarted: () => void = () => {};
    const heldSecond = new Promise<void>(resolve => { releaseSecond = resolve; });
    const secondStarted = new Promise<void>(resolve => { markSecondStarted = resolve; });
    const calls: number[] = [];
    const pending = executeOverlapTileUpscale({
      source, targetWidth: 192, targetHeight: 128,
      tileSize: 48, overlap: 8, concurrency: 2,
      processTile: async ({ input, tile, targetWidth, targetHeight }) => {
        calls.push(tile.index);
        if (tile.index === 0) {
          await secondStarted;
          throw new Error('injected first tile failure');
        }
        if (tile.index === 1) {
          markSecondStarted();
          await heldSecond;
        }
        return sharp(input).resize(targetWidth, targetHeight).png().toBuffer();
      },
    });
    try {
      await secondStarted;
      const state = await Promise.race([
        pending.then(() => 'settled', () => 'settled'),
        new Promise<string>(resolve => setTimeout(() => resolve('in-flight'), 30)),
      ]);
      expect(state).toBe('in-flight');
    } finally {
      releaseSecond();
    }
    await expect(pending).rejects.toThrowError('injected first tile failure');
    expect([...calls].sort((a, b) => a - b)).toEqual([0, 1]);
  });
});
