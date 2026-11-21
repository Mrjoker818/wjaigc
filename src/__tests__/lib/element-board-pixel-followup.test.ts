import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const io = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/layer-decomposition/source-image', () => ({ resolveLayerSourceImage: io.read }));
vi.mock('@/lib/server-data-root', () => ({ saveImageFile: io.save }));
import { finalizeElementBoardResult } from '@/lib/element-decomposition/board-result';

const SOURCE = '/api/serve-upload/element-sources/frozen.png';
const RESULT = 'https://synthetic-result.invalid/board.png';
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
let original: Buffer;
let reencoded: Buffer;
let transparent: Buffer;
let changed: Buffer;
let input: { sourceHash: string; resultUrl: string; modelId: string; providerId: string; sourceUrl: string };
beforeAll(async () => {
  const pixels = Buffer.alloc(300 * 300 * 4);
  for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) {
    const offset = (y * 300 + x) * 4;
    pixels[offset] = x < 180 && y < 200 ? 220 : 238;
    pixels[offset + 1] = x > 110 && y > 100 ? 70 : 238;
    pixels[offset + 2] = x > 110 && y > 100 ? 200 : 238;
    pixels[offset + 3] = 255;
  }
  original = await sharp(pixels, { raw: { width: 300, height: 300, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
  reencoded = await sharp(pixels, { raw: { width: 300, height: 300, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  const different = Buffer.from(pixels);
  for (let index = 0; index < 300 * 300; index++) { different[index * 4] = 25; different[index * 4 + 3] = index < 45_000 ? 0 : 255; }
  transparent = await sharp(different, { raw: { width: 300, height: 300, channels: 4 } }).png().toBuffer();
  changed = await sharp({ create: { width: 300, height: 300, channels: 4, background: '#eeeeee' } }).png().toBuffer();
});
beforeEach(() => {
  vi.clearAllMocks();
  input = { sourceHash: sha(original), resultUrl: RESULT, modelId: 'synthetic-image', providerId: 'synthetic-provider', sourceUrl: SOURCE };
  io.save.mockReturnValue('/api/serve-upload/element-boards/synthetic.png');
  io.read.mockImplementation(async (url: string) => ({ buffer: url === SOURCE ? original : reencoded,
    mimeType: 'image/png', width: 300, height: 300 }));
});

it('rejects the unchanged decoded scene even when the PNG encoding and byte hash differ (P2)', async () => {
  expect(sha(original)).not.toBe(sha(reencoded));
  expect((await sharp(original).ensureAlpha().raw().toBuffer()).equals(await sharp(reencoded).ensureAlpha().raw().toBuffer())).toBe(true);
  await expect(finalizeElementBoardResult({ ...input, background: 'light-gray' })).rejects.toMatchObject({ code: 'BOARD_RESULT_ECHOED_SOURCE' });
  expect(io.save).not.toHaveBeenCalled();
});

it.each(['transparent', 'light-gray'] as const)('keeps a genuinely changed %s result and its actual alpha', async background => {
  io.read.mockImplementation(async (url: string) => ({ buffer: url === SOURCE ? original : background === 'transparent' ? transparent : changed,
    mimeType: 'image/png', width: 300, height: 300 }));
  const result = await finalizeElementBoardResult({ ...input, background });
  expect(result).toMatchObject({ width: 300, height: 300, report: { background } });
  expect(result.report.transparentPixelRatio).toBe(background === 'transparent' ? 0.5 : 0);
  expect(io.save.mock.calls[0][0]).toEqual(background === 'transparent' ? transparent : changed);
});

it('rejects decoded dimensions above the established source pixel budget before saving', async () => {
  io.read.mockResolvedValue({ buffer: reencoded, mimeType: 'image/png', width: 8193, height: 8192 });
  await expect(finalizeElementBoardResult({ ...input, background: 'light-gray' })).rejects.toMatchObject({ code: 'BOARD_RESULT_UNREADABLE' });
  expect(io.save).not.toHaveBeenCalled();
});

it('does not compare against a source whose encoded hash no longer matches the frozen identity', async () => {
  io.read.mockImplementation(async (url: string) => ({ buffer: url === SOURCE ? changed : transparent,
    mimeType: 'image/png', width: 300, height: 300 }));
  await expect(finalizeElementBoardResult({ ...input, background: 'transparent' })).rejects.toMatchObject({ code: 'BOARD_SOURCE_MISMATCH' });
  expect(io.save).not.toHaveBeenCalled();
});

it('requires the frozen source locator instead of silently skipping pixel comparison', async () => {
  const { sourceUrl: _sourceUrl, ...withoutSource } = input;
  void _sourceUrl;
  await expect(finalizeElementBoardResult({ ...withoutSource, background: 'light-gray' } as Parameters<typeof finalizeElementBoardResult>[0]))
    .rejects.toMatchObject({ code: 'BOARD_SOURCE_MISMATCH' });
  expect(io.save).not.toHaveBeenCalled();
});
