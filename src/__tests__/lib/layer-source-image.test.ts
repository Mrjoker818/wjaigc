import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
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

  it('allows direct PSD artifacts up to the same 128 MiB extraction limit', async () => {
    const psd = Buffer.from('8BPS-direct');
    const download = vi.fn().mockResolvedValue({
      buffer: psd,
      mimeType: 'image/vnd.adobe.photoshop',
    });

    await expect(downloadPearPsd(
      'https://cdn.example.com/result.psd',
      { download },
    )).resolves.toMatchObject({ buffer: psd });
    expect(download).toHaveBeenCalledWith(
      'https://cdn.example.com/result.psd',
      expect.objectContaining({
        maxBytes: 128 * 1024 * 1024,
        rangeChunkBytes: 1024 * 1024,
      }),
    );
  });

  it('retries one transient Pear artifact download timeout before falling back', async () => {
    const psd = Buffer.from('8BPS-recovered-after-timeout');
    const download = vi.fn()
      .mockRejectedValueOnce(new Error('Remote image download timed out'))
      .mockResolvedValueOnce({
        buffer: psd,
        mimeType: 'image/vnd.adobe.photoshop',
      });

    await expect(downloadPearPsd(
      'https://cdn.pearapi.ai/result.psd',
      { download },
    )).resolves.toMatchObject({ buffer: psd });
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent Pear artifact downloads under one memory budget', async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstDownload = vi.fn(async () => {
      markFirstStarted();
      await firstBlocked;
      return {
        buffer: Buffer.from('8BPS-first'),
        mimeType: 'image/vnd.adobe.photoshop',
      };
    });
    const secondDownload = vi.fn(async () => ({
      buffer: Buffer.from('8BPS-second'),
      mimeType: 'image/vnd.adobe.photoshop',
    }));

    const first = downloadPearPsd('https://cdn.example.com/first.psd', {
      download: firstDownload,
    });
    await firstStarted;
    const second = downloadPearPsd('https://cdn.example.com/second.psd', {
      download: secondDownload,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(secondDownload).not.toHaveBeenCalled();
    releaseFirst();
    await Promise.all([first, second]);
    expect(secondDownload).toHaveBeenCalledTimes(1);
  });

  it('extracts the primary PSD from a bounded Pear ZIP artifact', async () => {
    const primaryPsd = Buffer.concat([Buffer.from('8BPS'), Buffer.from('primary')]);
    const depthPsd = Buffer.concat([Buffer.from('8BPS'), Buffer.from('depth')]);
    const zip = new JSZip();
    zip.file('Image-Layered_00001.psd', primaryPsd);
    zip.file('Image-Layered_00001_depth.psd', depthPsd);
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const download = vi.fn().mockResolvedValue({
      buffer: zipBuffer,
      mimeType: 'application/zip',
    });

    await expect(downloadPearPsd(
      'https://cdn.example.com/result.zip',
      { download },
    )).resolves.toMatchObject({
      buffer: primaryPsd,
      mimeType: 'image/vnd.adobe.photoshop',
    });
    expect(download).toHaveBeenCalledWith(
      'https://cdn.example.com/result.zip',
      expect.objectContaining({
        allowedMimeTypes: expect.arrayContaining(['application/zip']),
      }),
    );
  });

  it('rejects a Pear ZIP artifact without a PSD', async () => {
    const zip = new JSZip();
    zip.file('preview.png', Buffer.from('not-a-psd'));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(downloadPearPsd(
      'https://cdn.example.com/result.zip',
      {
        download: vi.fn().mockResolvedValue({
          buffer: zipBuffer,
          mimeType: 'application/zip',
        }),
      },
    )).rejects.toMatchObject({ code: 'LAYER_ZIP_PSD_MISSING' });
  });

  it('does not decompress an unselected depth PSD while loading the ZIP index', async () => {
    const primaryPsd = Buffer.concat([Buffer.from('8BPS'), Buffer.from('primary')]);
    const depthPayload = Buffer.from('8BPS-depth-payload-that-will-be-corrupted');
    const zip = new JSZip();
    zip.file('Image-Layered_00001.psd', primaryPsd);
    zip.file('Image-Layered_00001_depth.psd', depthPayload);
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const depthOffset = zipBuffer.indexOf(depthPayload);
    expect(depthOffset).toBeGreaterThan(-1);
    zipBuffer[depthOffset + depthPayload.length - 1] ^= 0xff;

    await expect(downloadPearPsd(
      'https://cdn.example.com/result.zip',
      {
        download: vi.fn().mockResolvedValue({
          buffer: zipBuffer,
          mimeType: 'application/zip',
        }),
      },
    )).resolves.toMatchObject({
      buffer: primaryPsd,
      mimeType: 'image/vnd.adobe.photoshop',
    });
  });

  it('rejects the original unsafe ZIP path even when JSZip sanitizes the entry name', async () => {
    const zip = new JSZip();
    zip.file('../Image-Layered_00001.psd', Buffer.from('8BPS-primary'));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(downloadPearPsd(
      'https://cdn.example.com/result.zip',
      {
        download: vi.fn().mockResolvedValue({
          buffer: zipBuffer,
          mimeType: 'application/zip',
        }),
      },
    )).rejects.toMatchObject({ code: 'LAYER_ZIP_PATH_INVALID' });
  });

  it('rejects a ZIP that contains only a depth PSD', async () => {
    const zip = new JSZip();
    zip.file('Image-Layered_00001_depth.psd', Buffer.from('8BPS-depth'));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(downloadPearPsd(
      'https://cdn.example.com/result.zip',
      {
        download: vi.fn().mockResolvedValue({
          buffer: zipBuffer,
          mimeType: 'application/zip',
        }),
      },
    )).rejects.toMatchObject({ code: 'LAYER_ZIP_PSD_MISSING' });
  });

  it('rejects a ZIP with multiple possible primary PSD files', async () => {
    const zip = new JSZip();
    zip.file('first.psd', Buffer.from('8BPS-first'));
    zip.file('second.psd', Buffer.from('8BPS-second'));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(downloadPearPsd(
      'https://cdn.example.com/result.zip',
      {
        download: vi.fn().mockResolvedValue({
          buffer: zipBuffer,
          mimeType: 'application/zip',
        }),
      },
    )).rejects.toMatchObject({ code: 'LAYER_ZIP_PSD_AMBIGUOUS' });
  });

  it('rejects a ZIP with more than the allowed number of files', async () => {
    const zip = new JSZip();
    zip.file('Image-Layered_00001.psd', Buffer.from('8BPS-primary'));
    for (let index = 0; index < 16; index += 1) {
      zip.file(`preview-${index}.txt`, Buffer.from('preview'));
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(downloadPearPsd(
      'https://cdn.example.com/result.zip',
      {
        download: vi.fn().mockResolvedValue({
          buffer: zipBuffer,
          mimeType: 'application/zip',
        }),
      },
    )).rejects.toMatchObject({ code: 'LAYER_ZIP_ENTRY_LIMIT' });
  });

  it('rejects a ZIP whose selected PSD has an invalid signature', async () => {
    const zip = new JSZip();
    zip.file('Image-Layered_00001.psd', Buffer.from('not-a-psd'));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(downloadPearPsd(
      'https://cdn.example.com/result.zip',
      {
        download: vi.fn().mockResolvedValue({
          buffer: zipBuffer,
          mimeType: 'application/zip',
        }),
      },
    )).rejects.toMatchObject({ code: 'LAYER_PSD_SIGNATURE_INVALID' });
  });

  it('stops before ZIP extraction when the task has been cancelled', async () => {
    const zip = new JSZip();
    zip.file('Image-Layered_00001.psd', Buffer.from('8BPS-primary'));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const controller = new AbortController();
    controller.abort(new Error('cancelled by test'));

    await expect(downloadPearPsd(
      'https://cdn.example.com/result.zip',
      {
        signal: controller.signal,
        download: vi.fn().mockResolvedValue({
          buffer: zipBuffer,
          mimeType: 'application/zip',
        }),
      },
    )).rejects.toThrow('cancelled by test');
  });
});
