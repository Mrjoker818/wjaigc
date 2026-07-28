import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import {
  downloadPearPsd,
  resolveLayerSourceImage,
} from '@/lib/layer-decomposition/source-image';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('layer source image loading', () => {
  it('decodes and validates a bounded PNG data URL', async () => {
    const png = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 1 },
      },
    }).png().toBuffer();

    await expect(resolveLayerSourceImage(
      `data:image/png;base64,${png.toString('base64')}`,
    )).resolves.toMatchObject({
      mimeType: 'image/png',
      width: 3,
      height: 2,
    });
  });

  it('rejects malformed image data and traversal outside controlled roots', async () => {
    await expect(resolveLayerSourceImage('data:image/png;base64,%%%%'))
      .rejects.toThrow(/base64|image/i);
    await expect(resolveLayerSourceImage('/api/serve-upload/../../secret.png', {
      dataRoot: 'C:\\safe-root',
      workspaceRoot: 'C:\\workspace',
    })).rejects.toThrow(/path|media/i);
  });

  it('reads an uploaded image only from the controlled media root', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'wujie-layer-source-'));
    temporaryRoots.push(dataRoot);
    await mkdir(path.join(dataRoot, 'uploads'), { recursive: true });
    const png = await sharp({
      create: {
        width: 4,
        height: 5,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).png().toBuffer();
    await writeFile(path.join(dataRoot, 'uploads', 'source.png'), png);

    await expect(resolveLayerSourceImage('/api/serve-upload/uploads/source.png', {
      dataRoot,
      workspaceRoot: dataRoot,
    })).resolves.toMatchObject({ width: 4, height: 5 });
  });

  it('uses the safe downloader for public images', async () => {
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#ffffff',
      },
    }).png().toBuffer();
    const download = vi.fn().mockResolvedValue({
      buffer: png,
      mimeType: 'image/png',
    });

    await expect(resolveLayerSourceImage('https://cdn.example.com/source.png', {
      download,
    })).resolves.toMatchObject({ width: 2, height: 2 });
    expect(download).toHaveBeenCalledWith(
      'https://cdn.example.com/source.png',
      expect.objectContaining({ allowedMimeTypes: expect.arrayContaining(['image/png']) }),
    );
  });

  it('rejects a PSD download blocked by DNS address validation', async () => {
    const download = vi.fn().mockRejectedValue(
      new Error('The image host resolves to a private or reserved address'),
    );
    await expect(downloadPearPsd(
      'https://attacker.example/result.psd',
      { download },
    )).rejects.toThrow(/private|reserved/i);
  });
});
