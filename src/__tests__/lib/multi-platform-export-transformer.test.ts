import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  transformPlatformImage,
  type AuthorizedExportImageSource,
} from '@/lib/multi-platform-export/transformer';
import type { SupportedImageMimeType } from '@/lib/image-tools/file';

const fixtureRoot = path.join(
  process.cwd(),
  'src',
  '__tests__',
  'fixtures',
  'multi-platform-export',
);

async function source(
  name: string,
  mimeType: SupportedImageMimeType,
): Promise<AuthorizedExportImageSource> {
  const bytes = await readFile(path.join(fixtureRoot, name));
  const metadata = await sharp(bytes).metadata();
  return {
    versionId: `version-${name}`,
    assetName: name,
    bytes,
    mimeType,
    width: metadata.width!,
    height: metadata.height!,
    hasTransparency: Boolean(metadata.hasAlpha),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function orientedJpegSource(orientation: 6 | 8): Promise<AuthorizedExportImageSource> {
  const bytes = await sharp({
    create: {
      width: 12,
      height: 6,
      channels: 3,
      background: '#336699',
    },
  })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();
  const metadata = await sharp(bytes).metadata();
  return {
    versionId: `version-orientation-${orientation}`,
    assetName: `orientation-${orientation}.jpg`,
    bytes,
    mimeType: 'image/jpeg',
    width: metadata.width!,
    height: metadata.height!,
    hasTransparency: false,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

describe('transformPlatformImage', () => {
  it('applies cover without stretching and emits exact target metadata', async () => {
    const result = await transformPlatformImage({
      source: await source('landscape.jpg', 'image/jpeg'),
      target: { width: 8, height: 8, outputFormat: 'jpeg' },
      fit: 'cover',
      background: '#ffffffff',
    });

    expect(result).toMatchObject({
      mimeType: 'image/jpeg',
      width: 8,
      height: 8,
      hasTransparency: false,
      metadata: { width: 8, height: 8, format: 'jpeg' },
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses transparent padding for contain and preserves alpha', async () => {
    const result = await transformPlatformImage({
      source: await source('portrait.png', 'image/png'),
      target: { width: 8, height: 8, outputFormat: 'png' },
      fit: 'contain',
      background: 'transparent',
    });

    expect(result).toMatchObject({
      mimeType: 'image/png',
      width: 8,
      height: 8,
      hasTransparency: true,
    });
    const alpha = await sharp(result.bytes).ensureAlpha().extractChannel('alpha').stats();
    expect(alpha.channels[0].min).toBe(0);
  });

  it('allows equal-ratio opaque PNG contain output with a transparent background request', async () => {
    const result = await transformPlatformImage({
      source: await source('landscape.jpg', 'image/jpeg'),
      target: { width: 8, height: 4, outputFormat: 'png' },
      fit: 'contain',
      background: 'transparent',
    });

    expect(result.hasTransparency).toBe(false);
    expect(result.metadata).toMatchObject({ width: 8, height: 4, format: 'png' });
  });

  it.each([6, 8] as const)(
    'uses auto-oriented dimensions for orientation %s contain padding checks',
    async (orientation) => {
      const result = await transformPlatformImage({
        source: await orientedJpegSource(orientation),
        target: { width: 6, height: 12, outputFormat: 'png' },
        fit: 'contain',
        background: 'transparent',
      });

      expect(result.hasTransparency).toBe(false);
      expect(result.metadata).toMatchObject({ width: 6, height: 12, format: 'png' });
    },
  );

  it('still requires alpha when an auto-oriented source has real contain padding', async () => {
    const result = await transformPlatformImage({
      source: await orientedJpegSource(6),
      target: { width: 12, height: 12, outputFormat: 'png' },
      fit: 'contain',
      background: 'transparent',
    });

    expect(result.hasTransparency).toBe(true);
    const alpha = await sharp(result.bytes).ensureAlpha().extractChannel('alpha').stats();
    expect(alpha.channels[0].min).toBe(0);
  });

  it('rejects source bytes whose declared sha256 was altered by an internal caller', async () => {
    const input = await source('portrait.png', 'image/png');
    input.sha256 = '0'.repeat(64);

    await expect(transformPlatformImage({
      source: input,
      target: { width: 8, height: 8, outputFormat: 'png' },
      fit: 'cover',
      background: '#ffffffff',
    })).rejects.toThrow('EXPORT_SOURCE_INTEGRITY_INVALID');
  });

  it('rejects source dimensions that disagree with decoded metadata', async () => {
    const input = await source('portrait.png', 'image/png');
    input.width += 1;

    await expect(transformPlatformImage({
      source: input,
      target: { width: 8, height: 8, outputFormat: 'png' },
      fit: 'cover',
      background: '#ffffffff',
    })).rejects.toThrow('EXPORT_SOURCE_METADATA_INVALID');
  });

  it('rejects transparent JPEG instead of silently replacing it with white', async () => {
    await expect(transformPlatformImage({
      source: await source('transparent.png', 'image/png'),
      target: { width: 8, height: 8, outputFormat: 'jpeg' },
      fit: 'contain',
      background: 'transparent',
    })).rejects.toThrow('EXPORT_TRANSPARENCY_FORMAT_CONFLICT');
  });

  it('flattens a transparent PNG onto an explicitly opaque background for JPEG presets', async () => {
    const result = await transformPlatformImage({
      source: await source('transparent.png', 'image/png'),
      target: { width: 8, height: 8, outputFormat: 'jpeg' },
      fit: 'contain',
      background: '#ffffffff',
    });
    const metadata = await sharp(result.bytes).metadata();

    expect(metadata).toMatchObject({ width: 8, height: 8, format: 'jpeg', hasAlpha: false });
    expect(result.hasTransparency).toBe(false);
  });

  it('rejects output dimensions above the single-output pixel budget', async () => {
    await expect(transformPlatformImage({
      source: await source('portrait.png', 'image/png'),
      target: { width: 8, height: 8, outputFormat: 'png' },
      fit: 'cover',
      background: '#ffffffff',
      limits: { maxOutputPixels: 32 },
    })).rejects.toThrow('EXPORT_OUTPUT_PIXEL_LIMIT');
  });

  it('honors cancellation before starting Sharp work', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(transformPlatformImage({
      source: await source('portrait.png', 'image/png'),
      target: { width: 8, height: 8, outputFormat: 'png' },
      fit: 'cover',
      background: '#ffffffff',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('revalidates the encoded bytes and reports the actual output format and digest', async () => {
    const result = await transformPlatformImage({
      source: await source('transparent.png', 'image/png'),
      target: { width: 7, height: 4, outputFormat: 'webp' },
      fit: 'cover',
      background: '#00000000',
    });
    const metadata = await sharp(result.bytes).metadata();

    expect(metadata).toMatchObject({ width: 7, height: 4, format: 'webp' });
    expect(result.mimeType).toBe('image/webp');
    expect(result.bytes.length).toBeGreaterThan(0);
  });
});
