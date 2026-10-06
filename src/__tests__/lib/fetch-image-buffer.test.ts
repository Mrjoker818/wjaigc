import fsSync from 'fs';
import fs from 'fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readExactRecoveryMedia: vi.fn(),
  getImageSourceUrl: vi.fn(),
  s3Available: vi.fn((): boolean => false),
  boundedS3: vi.fn(),
  unboundedS3: vi.fn(),
  publicDownload: vi.fn(),
  dataRoot: 'C:/wujie-data',
}));

vi.mock('@/lib/asset-core/recovery-media', () => ({
  readExactRecoveryMedia: mocks.readExactRecoveryMedia,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/image-source-map', () => ({ getImageSourceUrl: mocks.getImageSourceUrl }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => mocks.dataRoot }));
vi.mock('@/lib/safe-image-download', async original => {
  const actual = await original<typeof import('@/lib/safe-image-download')>();
  return {
    ...actual,
    downloadPublicImage: (input: string | URL, options?: Parameters<typeof actual.downloadPublicImage>[1]) =>
      String(input).includes('127.0.0.1')
        ? actual.downloadPublicImage(input, options)
        : mocks.publicDownload(input, options),
  };
});
vi.mock('@/lib/s3-storage', async original => ({
  ...await original<typeof import('@/lib/s3-storage')>(),
  isS3Available: mocks.s3Available,
  readImageFromS3Bounded: mocks.boundedS3,
  downloadImageFromS3: mocks.unboundedS3,
}));

import { fetchImageBuffer, normalizeLocalImagePath } from '@/lib/fetch-image-buffer';
import { SafeImageDownloadError } from '@/lib/safe-image-download';
import { getServerDataRoot } from '@/lib/server-data-root';

beforeEach(() => {
  vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared network'); });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mocks.readExactRecoveryMedia.mockReset();
  mocks.getImageSourceUrl.mockReset();
  mocks.s3Available.mockClear();
  mocks.boundedS3.mockReset();
  mocks.unboundedS3.mockReset();
  mocks.publicDownload.mockReset();
  mocks.dataRoot = 'C:/wujie-data';
});

describe('normalizeLocalImagePath', () => {
  it('keeps an allowed serve-upload path relative to its storage root', () => {
    expect(normalizeLocalImagePath('/api/serve-upload/uploads/job/image.png')).toBe('uploads/job/image.png');
  });

  it('rejects decoded directory traversal instead of rewriting it', () => {
    expect(() => normalizeLocalImagePath('/api/serve-upload/uploads/%2e%2e/%2e%2e/.env')).toThrow('Unsafe local image path');
  });

  it('rejects malformed percent-encoded paths', () => {
    expect(() => normalizeLocalImagePath('/uploads/%E0%A4%A')).toThrow('Unsafe local image path');
  });

  it.each(['/api/serve-upload/uploads/bad%20name.png', '/api/serve-upload/uploads/private.txt'])(
    'rejects a local path the public media route would not serve: %s', (input) => {
      expect(() => normalizeLocalImagePath(input)).toThrow('Unsafe local image path');
    },
  );

  it.each([
    '/api/serve-upload/uploads/image..old.png',
    'http://localhost:5000/api/serve-upload/uploads/image..old.png',
    '/api/serve-upload/Exports/not-content-addressed.png',
    'http://localhost:5000/api/serve-upload/Exports/not-content-addressed.png',
  ])('rejects a path variant the public media route refuses: %s', async (input) => {
    await expect(fetchImageBuffer(input)).rejects.toThrow('Unsafe local image path');
  });

  it.each([
    '/api/serve-upload/system/private.png',
    'http://localhost:5000/api/serve-upload/system/private.png',
  ])('does not read a private serve-upload root through %s', async (input) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'image-edit-private-root-'));
    const filePath = path.join(workspace, 'public', 'system', 'private.png');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'private-image');
    vi.stubEnv('COZE_WORKSPACE_PATH', workspace);
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => new Response('private-image')));
    try {
      await expect(fetchImageBuffer(input)).rejects.toThrow('Unsafe local image path');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('accepts only a content-addressed image export whose bytes match its filename', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'image-edit-export-'));
    mocks.dataRoot = workspace;
    const image = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const validName = `${createHash('sha256').update(image).digest('hex').slice(0, 16)}-image.png`;
    const invalidName = `${'0'.repeat(16)}-image.png`;
    await fs.mkdir(path.join(workspace, 'exports'));
    await fs.writeFile(path.join(workspace, 'exports', validName), image);
    await fs.writeFile(path.join(workspace, 'exports', invalidName), image);
    try {
      await expect(fetchImageBuffer(`/api/serve-upload/exports/${validName}`)).resolves.toEqual(image);
      await expect(fetchImageBuffer(`/api/serve-upload/exports/${invalidName}`)).rejects.toThrow();
      await expect(fetchImageBuffer('http://localhost:5000/api/serve-upload/exports/not-content-addressed.png'))
        .rejects.toThrow('Unsafe local image path');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('does not fall back to an unrelated local file when exact recovery validation fails', async () => {
    mocks.readExactRecoveryMedia.mockResolvedValue(null);
    vi.spyOn(fsSync, 'existsSync').mockReturnValue(true);
    const readFile = vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('stale-image'));

    await expect(fetchImageBuffer('/api/serve-upload/recovery/version-a/attempt-a.png'))
      .rejects.toThrow('Recovered media is unavailable or failed validation');
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('opt-in bounded image reads', () => {
  it('rejects a direct private URL before ordinary fetch can access it', async () => {
    const fetcher = vi.fn(async (): Promise<Response> => new Response('private-image'));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchImageBuffer('http://127.0.0.1/private.png')).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects non-image bytes from a public direct URL before a caller can process them', async () => {
    mocks.publicDownload.mockResolvedValue({ buffer: Buffer.from('not an image'), mimeType: 'application/octet-stream' });
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => new Response('not an image')));
    await expect(fetchImageBuffer('https://media.invalid/not-an-image.png')).rejects.toThrow();
  });

  it('accepts a valid raster image from a public direct URL with generic MIME', async () => {
    const image = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer();
    mocks.publicDownload.mockResolvedValue({ buffer: image, mimeType: 'application/octet-stream' });
    const fetcher = vi.fn(async (): Promise<Response> => Response.json({}, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchImageBuffer('https://media.invalid/generic')).resolves.toEqual(image);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads a same-port absolute serve-upload URL from its managed local file without network', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'image-edit-local-url-'));
    const filePath = path.join(workspace, 'public', 'uploads', 'local.png');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'local-image');
    vi.stubEnv('COZE_WORKSPACE_PATH', workspace);
    const fetcher = vi.fn(async (): Promise<never> => { throw new Error('Network is unavailable'); });
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(fetchImageBuffer('http://localhost:5000/api/serve-upload/uploads/local.png'))
        .resolves.toEqual(Buffer.from('local-image'));
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('rejects oversized data before base64 decoding but retains the old unlimited call', async () => {
    const url = `data:image/png;base64,${Buffer.from('12345').toString('base64')}`;
    await expect(fetchImageBuffer(url, { maxBytes: 4 })).rejects.toMatchObject({ code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
    expect(await fetchImageBuffer(url)).toEqual(Buffer.from('12345'));
  });

  it('maps a bounded remote download size failure to the image-edit size contract', async () => {
    mocks.publicDownload.mockRejectedValue(new SafeImageDownloadError('Remote image exceeds the size limit'));
    const fetcher = vi.fn(async (): Promise<never> => { throw new Error('Ordinary fetch is forbidden'); });
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchImageBuffer('https://media.invalid/declared.png', { maxBytes: 4 }))
      .rejects.toMatchObject({ code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks a real local file size before reading and verifies recovery bytes', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'image-edit-bounded-'));
    const filePath = path.join(workspace, 'public', 'uploads', 'large.png');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '12345');
    vi.stubEnv('COZE_WORKSPACE_PATH', workspace);
    const handle = await fs.open(filePath, 'r');
    const openSpy = vi.spyOn(fs, 'open').mockResolvedValue(handle);
    const readSpy = vi.spyOn(handle, 'read');
    const readFileSpy = vi.spyOn(fs, 'readFile');
    try {
      await expect(fetchImageBuffer('/uploads/large.png', { maxBytes: 4 }))
        .rejects.toMatchObject({ code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
      expect(openSpy).toHaveBeenCalledWith(filePath, 'r');
      expect(readSpy).not.toHaveBeenCalled();
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
      readSpy.mockRestore();
      readFileSpy.mockRestore();
      await handle.close();
      await fs.rm(workspace, { recursive: true, force: true });
    }
    mocks.readExactRecoveryMedia.mockResolvedValue({ buffer: Buffer.from('12345'), mimeType: 'image/png' });
    await expect(fetchImageBuffer('/api/serve-upload/recovery/version-a/attempt-a.png', { maxBytes: 4 }))
      .rejects.toMatchObject({ code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
  });

  it('passes the opt-in budget into exact recovery before its storage read', async () => {
    let unboundedBytesRead = 0;
    mocks.readExactRecoveryMedia.mockImplementation(async (_path: string, maxBytes?: number) => {
      if (maxBytes === undefined) {
        unboundedBytesRead += 8;
        return { buffer: Buffer.from('12345678'), mimeType: 'image/png' };
      }
      throw Object.assign(new Error('Recovery input exceeds the supplied budget'),
        { code: 'RECOVERY_MEDIA_SIZE_LIMIT' });
    });
    const url = '/api/serve-upload/recovery/version-a/attempt-a.png';
    await expect(fetchImageBuffer(url, { maxBytes: 4 }))
      .rejects.toMatchObject({ code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
    expect(unboundedBytesRead).toBe(0);
    expect(mocks.readExactRecoveryMedia).toHaveBeenCalledExactlyOnceWith(
      'recovery/version-a/attempt-a.png', 4,
    );
    expect(await fetchImageBuffer(url)).toEqual(Buffer.from('12345678'));
  });

  it('bounds a real file that grows after its size check without readFile allocation', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'image-edit-bounded-'));
    const filePath = path.join(workspace, 'public', 'uploads', 'growing.png');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '1234');
    vi.stubEnv('COZE_WORKSPACE_PATH', workspace);
    const realStat = fs.stat.bind(fs);
    const handle = await fs.open(filePath, 'r');
    const realHandleStat = handle.stat.bind(handle);
    let grew = false;
    const growAfterStat = async (): Promise<void> => {
      if (!grew) {
        grew = true;
        await fs.appendFile(filePath, '56789012');
      }
    };
    const pathStatSpy = vi.spyOn(fs, 'stat').mockImplementation(async (...args) => {
      const stat = await realStat(...args);
      await growAfterStat();
      return stat;
    });
    vi.spyOn(handle, 'stat').mockImplementation(async () => {
      const stat = await realHandleStat();
      await growAfterStat();
      return stat;
    });
    const openSpy = vi.spyOn(fs, 'open').mockResolvedValue(handle);
    const readFileSpy = vi.spyOn(fs, 'readFile');
    const readSpy = vi.spyOn(handle, 'read');
    try {
      await expect(fetchImageBuffer('/uploads/growing.png', { maxBytes: 4 }))
        .rejects.toMatchObject({ code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
      expect(grew).toBe(true);
      expect(readFileSpy).not.toHaveBeenCalled();
      expect(openSpy).toHaveBeenCalledWith(filePath, 'r');
      expect(readSpy).toHaveBeenCalled();
      expect(readSpy.mock.calls.every(call => {
        const readArgs = call as unknown[];
        return typeof readArgs[2] === 'number' && readArgs[2] <= 5;
      })).toBe(true);
      expect(await fetchImageBuffer('/uploads/growing.png')).toEqual(Buffer.from('123456789012'));
      expect(readFileSpy).toHaveBeenCalledTimes(1);
    } finally {
      pathStatSpy.mockRestore();
      openSpy.mockRestore();
      readFileSpy.mockRestore();
      readSpy.mockRestore();
      await handle.close();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('does not swallow an oversized source-map fallback into localhost or domain', async () => {
    vi.spyOn(fsSync, 'existsSync').mockReturnValue(false);
    mocks.getImageSourceUrl.mockResolvedValue('https://media.invalid/original.png');
    mocks.publicDownload.mockRejectedValue(new SafeImageDownloadError('Remote image exceeds the size limit'));
    const fetcher = vi.fn(async (): Promise<Response> => Response.json({}, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchImageBuffer('/uploads/original.png', { maxBytes: 4 }))
      .rejects.toMatchObject({ code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never fetches a private source-map URL through ordinary fetch', async () => {
    vi.spyOn(fsSync, 'existsSync').mockReturnValue(false);
    mocks.getImageSourceUrl.mockResolvedValue('http://127.0.0.1/private.png');
    const fetcher = vi.fn(async (input: string): Promise<Response> => input.startsWith('http://127.0.0.1/')
      ? new Response('private-image') : Response.json({}, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);

    await expect(fetchImageBuffer('/uploads/private.png')).rejects.toThrow('无法获取原始图片');
    expect(fetcher.mock.calls.every(([input]) => !input.includes('127.0.0.1'))).toBe(true);
  });

  it('recovers a valid public source-map image without ordinary fetch', async () => {
    const image = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer();
    vi.spyOn(fsSync, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    mocks.getImageSourceUrl.mockResolvedValue('https://media.invalid/original.png');
    mocks.publicDownload.mockResolvedValue({ buffer: image, mimeType: 'image/png' });
    const fetcher = vi.fn(async (): Promise<Response> => Response.json({}, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);

    await expect(fetchImageBuffer('/uploads/original.png')).resolves.toEqual(image);
    expect(fetcher).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledWith(path.resolve(getServerDataRoot(), 'uploads', 'original.png'), image);
  });

  it('rejects a public source-map image whose MIME disagrees with its saved extension', async () => {
    const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    vi.spyOn(fsSync, 'existsSync').mockReturnValue(false);
    mocks.getImageSourceUrl.mockResolvedValue('https://media.invalid/original.jpg');
    mocks.publicDownload.mockResolvedValue({ buffer: image, mimeType: 'image/jpeg' });
    vi.stubGlobal('fetch', vi.fn(async (input: string): Promise<Response> => input.startsWith('https://media.invalid/')
      ? new Response(new Uint8Array(image), { headers: { 'content-type': 'image/jpeg' } })
      : Response.json({}, { status: 404 })));

    await expect(fetchImageBuffer('/uploads/original.png')).rejects.toThrow('无法获取原始图片');
  });

  it('does not swallow oversized localhost or domain fallback', async () => {
    vi.spyOn(fsSync, 'existsSync').mockReturnValue(false);
    mocks.getImageSourceUrl.mockResolvedValue(null);
    const fetcher = vi.fn(async (url: string): Promise<Response> => {
      expect(url).toContain('http://localhost:');
      return new Response('12345', { headers: { 'content-length': '5' } });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchImageBuffer('/uploads/local.png', { maxBytes: 4 }))
      .rejects.toMatchObject({ code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'https://example.invalid');
    fetcher.mockImplementation(async (url: string): Promise<Response> => url.startsWith('http://localhost:')
      ? Response.json({}, { status: 404 })
      : new Response('12345', { headers: { 'content-length': '5' } }));
    await expect(fetchImageBuffer('/uploads/domain.png', { maxBytes: 4 }))
      .rejects.toMatchObject({ code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses bounded S3 reads without invoking the old unbounded download', async () => {
    vi.spyOn(fsSync, 'existsSync').mockReturnValue(false);
    mocks.s3Available.mockReturnValue(true);
    mocks.boundedS3.mockResolvedValue(Buffer.from('12345'));
    await expect(fetchImageBuffer('/uploads/s3.png', { maxBytes: 4 }))
      .rejects.toMatchObject({ code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
    expect(mocks.boundedS3).toHaveBeenCalledWith('images/uploads/s3.png', 4, 5000,
      { strict: true });
    expect(mocks.unboundedS3).not.toHaveBeenCalled();
  });
});
