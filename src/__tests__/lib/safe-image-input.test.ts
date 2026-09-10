import { spawnSync } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import {
  assertSafePixelDimensions,
  decodeSafeImageInput,
  loadSafeImageInput,
  normalizeTrustedManagedMediaInput,
  resolveManagedMediaPath,
  SafeImageInputError,
  safeSharp,
  withSafeSharp,
} from '@/lib/safe-image-input';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zlq0AAAAASUVORK5CYII=',
  'base64',
);

describe('safe edit image inputs', () => {
  it('recognizes and safely decodes a real TIFF through the shared loader', async () => {
    const tiff = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#ffffff' },
    }).tiff().toBuffer();

    const decoded = await loadSafeImageInput(
      `data:image/tiff;base64,${tiff.toString('base64')}`,
      { maxBytes: 1024 * 1024, maxPixels: 10_000 },
    );

    expect(decoded.mimeType).toBe('image/tiff');
    expect(decoded.buffer.equals(tiff)).toBe(true);
    await expect(sharp(decoded.buffer).metadata()).resolves.toMatchObject({
      format: 'tiff', width: 32, height: 24,
    });
  });

  it('accepts a valid image data URL and verifies its real format', () => {
    const decoded = decodeSafeImageInput(
      `data:image/png;base64,${PNG_1X1.toString('base64')}`,
      { maxBytes: 1024 },
    );
    expect(decoded.mimeType).toBe('image/png');
    expect(decoded.buffer.equals(PNG_1X1)).toBe(true);
  });

  it.each([
    'data:text/plain;base64,aGVsbG8=',
    'data:image/png;base64,aGVsbG8=',
    'not-valid-base64***',
  ])('rejects forged or malformed image input', (input) => {
    expect(() => decodeSafeImageInput(input, { allowRawBase64: true }))
      .toThrow();
  });

  it('rejects decoded bytes over the configured limit', () => {
    expect(() => decodeSafeImageInput(
      `data:image/png;base64,${PNG_1X1.toString('base64')}`,
      { maxBytes: 16 },
    )).toThrow(/size limit/i);
  });

  it('rejects an oversized data URL by encoded length before base64 decoding', () => {
    const maxBytes = 25 * 1024 * 1024;
    const oversizedBase64 = `${'A'.repeat(Math.ceil((maxBytes + 1) * 4 / 3 / 4) * 4)}!`;

    let error: unknown;
    try {
      decodeSafeImageInput(`data:image/png;base64,${oversizedBase64}`, { maxBytes });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(SafeImageInputError);
    expect(error).toMatchObject({ code: 'UNSAFE_IMAGE_INPUT' });
    expect((error as Error).message).toMatch(/decoded size limit/i);
  });

  it('wraps a malformed exactly-25-MiB data URL without a native RangeError', () => {
    const maxBytes = 25 * 1024 * 1024;
    const encodedLength = Math.ceil(maxBytes / 3) * 4;
    const exactLimitPayload = `${'A'.repeat(encodedLength - 2)}==`;

    let error: unknown;
    try {
      decodeSafeImageInput(`data:image/png;base64,${exactLimitPayload}`, { maxBytes });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(SafeImageInputError);
    expect(error).not.toBeInstanceOf(RangeError);
    expect(error).toMatchObject({ code: 'UNSAFE_IMAGE_INPUT' });
  }, 20_000);

  it('keeps runtime abort errors handled in an isolated Sharp process', () => {
    const probe = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      input: `
        import sharp from 'sharp';
        import safeImageInput from './src/lib/safe-image-input.ts';
        const source = await sharp({
          create: { width: 5000, height: 5000, channels: 3, background: '#ffffff' },
        }).png().toBuffer();
        const controller = new AbortController();
        const pending = safeImageInput.withSafeSharp(source, {
          signal: controller.signal, maxPixels: 40_000_000,
        }, pipeline => pipeline.resize(7000, 7000).blur(10).raw().toBuffer());
        setImmediate(() => controller.abort(new Error('PROBE_ABORT')));
        try {
          await pending;
          controller.signal.throwIfAborted();
        } catch (error) {
          console.log('REJECTED', error instanceof Error ? error.message : String(error));
        }
        await new Promise(resolve => setTimeout(resolve, 50));
        console.log('SURVIVED');
      `,
      timeout: 15_000,
    });

    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stdout).toContain('REJECTED PROBE_ABORT');
    expect(probe.stdout).toContain('SURVIVED');
    expect(probe.stderr).not.toContain("Unhandled 'error' event");
  }, 20_000);

  it('removes its abort listener after a Sharp operation settles', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');

    await expect(withSafeSharp(
      PNG_1X1,
      { signal: controller.signal, maxPixels: 100 },
      pipeline => pipeline.metadata(),
    )).resolves.toMatchObject({ width: 1, height: 1 });

    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('does not swallow non-cancellation Sharp decode errors', async () => {
    await expect(safeSharp(Buffer.from('not-an-image')).metadata()).rejects.toThrow();
  });

  it('rejects pixel-bomb dimensions before Sharp transforms run', () => {
    expect(() => assertSafePixelDimensions(100_000, 100_000, 40_000_000))
      .toThrow(/pixel/i);
  });

  it('allows only managed upload paths without traversal', () => {
    expect(resolveManagedMediaPath('/uploads/image.png')).toEqual({
      namespace: 'uploads',
      relativePath: 'image.png',
    });
    expect(() => resolveManagedMediaPath('/uploads/../secret.png')).toThrow();
    expect(() => resolveManagedMediaPath('/api/serve-upload/%2e%2e/secret.png')).toThrow();
    expect(() => resolveManagedMediaPath('/api/serve-upload/system/private.png')).toThrow();
    expect(() => resolveManagedMediaPath('/api/serve-upload/users/private.png')).toThrow();
  });

  it('loads a built-in gallery image from the public gallery root', async () => {
    const decoded = await loadSafeImageInput('/gallery/cat-0/g1.jpg', {
      maxBytes: 1024 * 1024,
      maxPixels: 10_000_000,
    });

    expect(decoded.mimeType).toBe('image/jpeg');
    expect(decoded.buffer.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it.each([
    '/gallery/../package.json',
    '/gallery/%2e%2e/package.json',
    '/gallery/cat-0/../../package.json',
  ])('rejects gallery traversal outside the public gallery root: %s', async (input) => {
    await expect(loadSafeImageInput(input)).rejects.toBeInstanceOf(SafeImageInputError);
  });

  it('normalizes only same-host managed media URLs to local managed paths', () => {
    expect(normalizeTrustedManagedMediaInput(
      'https://preview.example:8443/api/serve-upload/generated/image.png?download=1',
      ['preview.example:8443'],
    )).toBe('/api/serve-upload/generated/image.png');
    expect(normalizeTrustedManagedMediaInput(
      'https://preview.example/uploads/image.png',
      ['preview.example'],
    )).toBe('/uploads/image.png');
  });

  it.each([
    'https://attacker.example/api/serve-upload/image.png',
    'https://preview.example.attacker.test/api/serve-upload/image.png',
    'https://user@preview.example/api/serve-upload/image.png',
    'https://preview.example/not-managed/image.png',
  ])('does not trust an external or malformed managed-looking URL: %s', (input) => {
    expect(normalizeTrustedManagedMediaInput(input, ['preview.example'])).toBe(input);
  });
});
