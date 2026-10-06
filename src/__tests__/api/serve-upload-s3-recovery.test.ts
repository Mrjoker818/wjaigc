import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readBinaryFromS3Exact: vi.fn(),
  downloadImageFromS3: vi.fn(),
  getImageSourceUrl: vi.fn(),
  publicDownload: vi.fn(),
  readExactRecoveryMedia: vi.fn(),
  readServeUploadExportLocal: vi.fn(),
  readServeUploadMediaLocal: vi.fn(),
  cacheServeUploadMediaLocal: vi.fn(),
  recoverExportAssetBytes: vi.fn(),
  validateExportAssetBytes: vi.fn(),
}));

vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => 'C:/wujie-data' }));
vi.mock('@/lib/s3-storage', () => ({
  deriveS3Key: vi.fn((value: string) => `images/${value}`),
  downloadImageFromS3: mocks.downloadImageFromS3,
  readBinaryFromS3Exact: mocks.readBinaryFromS3Exact,
  getS3PresignedUrl: vi.fn(),
  resolveS3Key: vi.fn(),
}));
vi.mock('@/lib/image-source-map', () => ({ getImageSourceUrl: mocks.getImageSourceUrl }));
vi.mock('@/lib/safe-image-download', async original => {
  const actual = await original<typeof import('@/lib/safe-image-download')>();
  return { ...actual, downloadPublicImage: (input: string | URL,
    options?: Parameters<typeof actual.downloadPublicImage>[1]) => String(input).includes('127.0.0.1')
      ? actual.downloadPublicImage(input, options) : mocks.publicDownload(input, options) };
});
vi.mock('@/lib/asset-core/recovery-media', () => ({
  readExactRecoveryMedia: mocks.readExactRecoveryMedia,
}));
vi.mock('@/lib/asset-core/binary-persistence', () => ({
  MAX_ASSET_BINARY_BYTES: 256 * 1024 * 1024,
  recoverExportAssetBytes: mocks.recoverExportAssetBytes,
  validateExportAssetBytes: mocks.validateExportAssetBytes,
}));
vi.mock('@/lib/serve-upload-local-storage', () => ({
  readServeUploadExportLocal: mocks.readServeUploadExportLocal,
  readServeUploadMediaLocal: mocks.readServeUploadMediaLocal,
  cacheServeUploadMediaLocal: mocks.cacheServeUploadMediaLocal,
}));

import { GET } from '@/app/api/serve-upload/[...path]/route';

describe('serve-upload S3 thumbnail recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readServeUploadExportLocal.mockResolvedValue(null);
    mocks.readServeUploadMediaLocal.mockResolvedValue(null);
    mocks.getImageSourceUrl.mockResolvedValue(null);
    mocks.publicDownload.mockReset();
    mocks.readExactRecoveryMedia.mockResolvedValue(null);
    mocks.readBinaryFromS3Exact.mockResolvedValue(null);
    mocks.recoverExportAssetBytes.mockResolvedValue(undefined);
    mocks.validateExportAssetBytes.mockResolvedValue(undefined);
  });

  it('restores a missing nested thumbnail from the exact S3 path', async () => {
    const thumbnail = Buffer.from('webp-thumbnail');
    mocks.downloadImageFromS3.mockResolvedValue(thumbnail);

    const response = await GET(
      new NextRequest('http://localhost/api/serve-upload/thumbnails/version-a/512.webp'),
      { params: Promise.resolve({ path: ['thumbnails', 'version-a', '512.webp'] }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(thumbnail);
    expect(mocks.downloadImageFromS3).toHaveBeenCalledOnce();
    expect(mocks.downloadImageFromS3).toHaveBeenCalledWith('thumbnails/version-a/512.webp');
    expect(mocks.cacheServeUploadMediaLocal).toHaveBeenCalledWith(
      'C:/wujie-data',
      'thumbnails/version-a/512.webp',
      thumbnail,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not cache an empty S3 object and falls back to the recorded source URL', async () => {
    const recoveredVideo = Buffer.from(
      await readFile('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64', 'utf8'),
      'base64',
    );
    mocks.downloadImageFromS3.mockResolvedValue(Buffer.alloc(0));
    mocks.getImageSourceUrl.mockResolvedValue('https://media.example/recovery.mp4');
    mocks.publicDownload.mockResolvedValue({ buffer: recoveredVideo, mimeType: 'video/mp4' });
    const fetchMock = vi.fn().mockRejectedValue(new Error('Ordinary fetch is forbidden for source recovery'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new NextRequest('http://localhost/api/serve-upload/video/missing.mp4'),
      { params: Promise.resolve({ path: ['video', 'missing.mp4'] }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(recoveredVideo);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.cacheServeUploadMediaLocal).toHaveBeenCalledTimes(1);
    expect(mocks.cacheServeUploadMediaLocal).toHaveBeenCalledWith(
      'C:/wujie-data',
      'video/missing.mp4',
      recoveredVideo,
    );
  });

  it('recovers a fully decoded public PNG under its matching filename', async () => {
    const recoveredImage = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer();
    mocks.downloadImageFromS3.mockResolvedValue(null);
    mocks.getImageSourceUrl.mockResolvedValue('https://media.example/recovery.png');
    mocks.publicDownload.mockResolvedValue({ buffer: recoveredImage, mimeType: 'image/png' });

    const response = await GET(
      new NextRequest('http://localhost/api/serve-upload/uploads/recovery.png'),
      { params: Promise.resolve({ path: ['uploads', 'recovery.png'] }) },
    );
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(recoveredImage);
    expect(mocks.cacheServeUploadMediaLocal).toHaveBeenCalledWith('C:/wujie-data', 'uploads/recovery.png', recoveredImage);
  });

  it.each([
    { extension: 'avi', mimeType: 'video/x-msvideo' },
    { extension: 'mkv', mimeType: 'video/x-matroska' },
  ])('recovers a valid public $extension video after bounded metadata inspection', async ({ extension, mimeType }) => {
    const recoveredVideo = Buffer.from(
      await readFile(`tests/fixtures/source-recovery-tiny-valid.${extension}.base64`, 'utf8'),
      'base64',
    );
    mocks.downloadImageFromS3.mockResolvedValue(null);
    mocks.getImageSourceUrl.mockResolvedValue(`https://media.example/recovery.${extension}`);
    mocks.publicDownload.mockResolvedValue({ buffer: recoveredVideo, mimeType });

    const response = await GET(
      new NextRequest(`http://localhost/api/serve-upload/video/recovery.${extension}`),
      { params: Promise.resolve({ path: ['video', `recovery.${extension}`] }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(mimeType);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(recoveredVideo);
    expect(mocks.cacheServeUploadMediaLocal).toHaveBeenCalledWith('C:/wujie-data', `video/recovery.${extension}`, recoveredVideo);
  });

  it('does not fetch or cache a private source-map URL when media is missing', async () => {
    mocks.downloadImageFromS3.mockResolvedValue(null);
    mocks.getImageSourceUrl.mockResolvedValue('http://127.0.0.1/private-image.png');
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('private-image'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new NextRequest('http://localhost/api/serve-upload/uploads/missing.png'),
      { params: Promise.resolve({ path: ['uploads', 'missing.png'] }) },
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.cacheServeUploadMediaLocal).not.toHaveBeenCalled();
  });

  it('does not cache source-map bytes that do not match their image MIME', async () => {
    mocks.downloadImageFromS3.mockResolvedValue(null);
    mocks.getImageSourceUrl.mockResolvedValue('https://media.example/changed.png');
    mocks.publicDownload.mockResolvedValue({ buffer: Buffer.from('not-an-image'), mimeType: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from('not-an-image'), { status: 200 })));

    const response = await GET(
      new NextRequest('http://localhost/api/serve-upload/uploads/changed.png'),
      { params: Promise.resolve({ path: ['uploads', 'changed.png'] }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.cacheServeUploadMediaLocal).not.toHaveBeenCalled();
  });

  it('does not cache a valid image under an incompatible requested extension', async () => {
    const jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    mocks.downloadImageFromS3.mockResolvedValue(null);
    mocks.getImageSourceUrl.mockResolvedValue('https://media.example/changed.jpg');
    mocks.publicDownload.mockResolvedValue({ buffer: jpeg, mimeType: 'image/jpeg' });
    const response = await GET(
      new NextRequest('http://localhost/api/serve-upload/uploads/changed.png'),
      { params: Promise.resolve({ path: ['uploads', 'changed.png'] }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.cacheServeUploadMediaLocal).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'truncated JPEG', path: ['uploads', 'truncated.jpg'], bytes: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' },
    { name: 'header-only MP4', path: ['video', 'truncated.mp4'], bytes: Buffer.from('0000ftypisom'), mimeType: 'video/mp4' },
    { name: 'header-only AVI', path: ['video', 'truncated.avi'], bytes: Buffer.from('RIFF0000AVI '), mimeType: 'video/x-msvideo' },
    { name: 'header-only MKV', path: ['video', 'truncated.mkv'], bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), mimeType: 'video/x-matroska' },
  ])('does not cache a $name recovered from a public source URL', async ({ path, bytes, mimeType }) => {
    mocks.downloadImageFromS3.mockResolvedValue(null);
    mocks.getImageSourceUrl.mockResolvedValue('https://media.example/truncated');
    mocks.publicDownload.mockResolvedValue({ buffer: bytes, mimeType });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Ordinary fetch is forbidden')));

    const response = await GET(
      new NextRequest(`http://localhost/api/serve-upload/${path.join('/')}`),
      { params: Promise.resolve({ path }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.cacheServeUploadMediaLocal).not.toHaveBeenCalled();
  });

  it.each([
    [Buffer.from('{}'), 'manifest.json', 'application/json'],
    [Buffer.from('PK\u0003\u0004'), 'export.zip', 'application/zip'],
  ])('serves a missing export document from its exact S3 key with safe download headers', async (bytes, suffix, contentType) => {
    const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-${suffix}`;
    mocks.readBinaryFromS3Exact.mockResolvedValue(bytes);

    const response = await GET(
      new NextRequest(`http://localhost/api/serve-upload/exports/${filename}`),
      { params: Promise.resolve({ path: ['exports', filename] }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(contentType);
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${filename}"`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mocks.readBinaryFromS3Exact).toHaveBeenCalledWith(`exports/${filename}`);
    expect(mocks.recoverExportAssetBytes).toHaveBeenCalledWith({ bytes, filename, mimeType: contentType });
    expect(mocks.downloadImageFromS3).not.toHaveBeenCalled();
  });

  it.each([
    [Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png', 'png'],
    [Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg', 'jpg'],
    [Buffer.from('RIFF0000WEBP'), 'image/webp', 'webp'],
  ])('recovers an exported image from the URL-matching exact key', async (bytes, contentType, extension) => {
    const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-image.${extension}`;
    mocks.readBinaryFromS3Exact.mockResolvedValue(bytes);
    const response = await GET(
      new NextRequest(`http://localhost/api/serve-upload/exports/${filename}`),
      { params: Promise.resolve({ path: ['exports', filename] }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(contentType);
    expect(mocks.readBinaryFromS3Exact).toHaveBeenCalledWith(`exports/${filename}`);
    expect(mocks.downloadImageFromS3).not.toHaveBeenCalled();
  });

  it('rejects an S3 recovery whose bytes do not match the URL hash prefix', async () => {
    const filename = `${'0'.repeat(16)}-manifest.json`;
    mocks.readBinaryFromS3Exact.mockResolvedValue(Buffer.from('{}'));
    mocks.recoverExportAssetBytes.mockRejectedValue(new Error('ASSET_RECOVERY_INTEGRITY_INVALID'));
    const response = await GET(
      new NextRequest(`http://localhost/api/serve-upload/exports/${filename}`),
      { params: Promise.resolve({ path: ['exports', filename] }) },
    );
    expect(response.status).toBe(404);
  });

  it('validates and serves a bounded local export hit without calling S3 or republishing it', async () => {
    const bytes = Buffer.from('{}');
    const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-manifest.json`;
    mocks.readServeUploadExportLocal.mockResolvedValue(bytes);
    const response = await GET(
      new NextRequest(`http://localhost/api/serve-upload/exports/${filename}`),
      { params: Promise.resolve({ path: ['exports', filename] }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.readServeUploadExportLocal).toHaveBeenCalledOnce();
    expect(mocks.readBinaryFromS3Exact).not.toHaveBeenCalled();
    expect(mocks.recoverExportAssetBytes).not.toHaveBeenCalled();
    expect(mocks.validateExportAssetBytes).toHaveBeenCalledWith({ bytes, filename, mimeType: 'application/json' });
  });

  it.each([
    [['exports', 'nested', '0123456789abcdef-a.zip']],
    [['exports', '..', '0123456789abcdef-a.zip']],
    [['exports', 'not-content-addressed.zip']],
    [['uploads', '0123456789abcdef-a.zip']],
  ])('rejects unsafe or non-export document paths %#', async (pathParts) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/serve-upload/${pathParts.join('/')}`),
      { params: Promise.resolve({ path: pathParts }) },
    );
    expect([400, 404]).toContain(response.status);
    expect(mocks.readBinaryFromS3Exact).not.toHaveBeenCalled();
  });
});
