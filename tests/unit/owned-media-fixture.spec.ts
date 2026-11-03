import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readOwnedOneSecondVideo } from '../helpers/owned-media-fixture';

const fixture = new URL('../fixtures/owned-one-second.mp4', import.meta.url);
const expectedSha256 = 'd07de9949c1265f8d7fce2ff56cbe9778af6937b3c33948d866dae6e270cbef6';

describe('packaged synthetic video used by mobile regressions', () => {
  it('retains the exact original synthetic bytes through the portable reader', async (): Promise<void> => {
    expect(existsSync(fileURLToPath(fixture)), 'packaged fixture is required').toBe(true);
    const bytes = await readOwnedOneSecondVideo();
    expect(bytes.length).toBe(1651);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedSha256);
  });

  it('decodes all ten 160x90 frames on CPU without network or temporary files', async (): Promise<void> => {
    expect(existsSync(fileURLToPath(fixture)), 'packaged fixture is required').toBe(true);
    const bytes = await readOwnedOneSecondVideo();
    // Admit only the sealed synthetic file before sending bytes to the decoder.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedSha256);
    const result = spawnSync('ffmpeg', [
      '-v', 'error', '-protocol_whitelist', 'file,pipe', '-hwaccel', 'none',
      '-i', 'pipe:0', '-map', '0:v:0', '-an', '-sn', '-dn',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
    ], {
      input: bytes, timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true,
      env: {
        NODE_ENV: 'test',
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr?.toString()).toBe(0);
    expect(result.stderr.length).toBe(0);
    // Hand-derived: 160 * 90 * RGB24(3) * 10 frames, not a decoder-derived oracle.
    expect(result.stdout.length).toBe(432000);
  });
});
