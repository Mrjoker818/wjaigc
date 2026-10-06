import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Fixture { rgba: Buffer; mask: Buffer; raw: Buffer }

async function fixture(red: number, foreground: number[]): Promise<Fixture> {
  const raw = Buffer.alloc(4 * 4 * 4);
  const maskRaw = Buffer.alloc(4 * 4);
  for (let pixel = 0; pixel < 16; pixel += 1) {
    raw[pixel * 4] = red;
    raw[pixel * 4 + 1] = 130;
    raw[pixel * 4 + 2] = 220;
    raw[pixel * 4 + 3] = foreground.includes(pixel) ? 255 : 0;
    maskRaw[pixel] = foreground.includes(pixel) ? 255 : 0;
  }
  return {
    rgba: await sharp(raw, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer(),
    mask: await sharp(maskRaw, { raw: { width: 4, height: 4, channels: 1 } }).png().toBuffer(),
    raw,
  };
}

describe('removeBG persisted file identity', () => {
  let parent: string;
  let root: string;
  let processOutput: typeof import('@/lib/remove-bg-postprocess').postProcessLocalRemoveBG;

  beforeEach(async () => {
    const configured = process.env.WUJIE_DATA_DIR;
    if (!configured) throw new Error('This test requires the configured isolated data root');
    parent = path.resolve(configured);
    root = await mkdtemp(path.join(parent, 'stage7-removebg-identity-'));
    vi.stubEnv('WUJIE_DATA_DIR', root);
    vi.stubEnv('SERVER_DATA_ROOT', root);
    vi.resetModules();
    processOutput = (await import('@/lib/remove-bg-postprocess')).postProcessLocalRemoveBG;
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (!root) return;
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('stage7-removebg-identity-')) {
      throw new Error('Refusing to remove an unexpected fixture root');
    }
    await rm(resolved, { recursive: true, force: true });
  });

  async function bytes(url: string): Promise<Buffer> {
    if (!url.startsWith('/api/serve-upload/removebg/')) throw new Error('Unexpected persisted URL');
    const filename = url.slice('/api/serve-upload/removebg/'.length);
    if (filename !== path.basename(filename)) throw new Error('Unexpected fixture filename');
    return readFile(path.join(root, 'removebg', filename));
  }

  it('keeps both concurrent unlabelled subject/mask pairs when their timestamp is identical', async () => {
    const first = await fixture(40, [5, 6, 9, 10]);
    const second = await fixture(180, [0, 1, 4, 5]);
    const results = await Promise.all([first, second].map(input => processOutput(
      input.rgba.toString('base64'), input.mask.toString('base64'), input.rgba,
    )));
    expect(results.every(result => result?.quality.ok)).toBe(true);
    expect(new Set(results.flatMap(result => [result!.imageUrl, result!.maskUrl])).size).toBe(4);
    expect(await readdir(path.join(root, 'removebg'))).toHaveLength(4);
    for (const [index, input] of [first, second].entries()) {
      expect(await sharp(await bytes(results[index]!.imageUrl)).ensureAlpha().raw().toBuffer()).toEqual(input.raw);
      expect(await bytes(results[index]!.maskUrl)).toEqual(input.mask);
    }
  });

  it('preserves distinct explicit output identities and a subject-only legacy result', async () => {
    const input = await fixture(40, [5, 6, 9, 10]);
    const first = await processOutput(input.rgba.toString('base64'), input.mask.toString('base64'), input.rgba, 'request-a');
    const second = await processOutput(input.rgba.toString('base64'), undefined, input.rgba, 'request-b');
    expect(first?.quality.ok).toBe(true);
    expect(second?.quality.ok).toBe(true);
    expect(first!.imageUrl).not.toBe(second!.imageUrl);
    expect(second!.maskUrl).toBe('');
    expect(await readdir(path.join(root, 'removebg'))).toHaveLength(3);
    expect(await bytes(first!.maskUrl)).toEqual(input.mask);
    expect(await sharp(await bytes(second!.imageUrl)).ensureAlpha().raw().toBuffer()).toEqual(input.raw);
  });
});
