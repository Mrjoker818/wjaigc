import { NextRequest } from 'next/server';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readBinaryFromS3Exact: vi.fn(),
  downloadImageFromS3: vi.fn(),
  existsSync: vi.fn(),
  getImageSourceUrl: vi.fn(),
  mkdirSync: vi.fn(),
  readExactRecoveryMedia: vi.fn(),
  writeFileSync: vi.fn(),
  recoverExportAssetBytes: vi.fn(),
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
vi.mock('@/lib/asset-core/recovery-media', () => ({
  readExactRecoveryMedia: mocks.readExactRecoveryMedia,
}));
vi.mock('@/lib/asset-core/binary-persistence', () => ({
  recoverExportAssetBytes: mocks.recoverExportAssetBytes,
}));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mocks.existsSync,
      mkdirSync: mocks.mkdirSync,
      writeFileSync: mocks.writeFileSync,
      promises: actual.promises,
    },
  };
});

import { GET } from '@/app/api/serve-upload/[...path]/route';

describe('serve-upload S3 thumbnail recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(false);
    mocks.getImageSourceUrl.mockResolvedValue(null);
    mocks.readExactRecoveryMedia.mockResolvedValue(null);
    mocks.readBinaryFromS3Exact.mockResolvedValue(null);
    mocks.recoverExportAssetBytes.mockResolvedValue(undefined);
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
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      path.join('C:/wujie-data', 'thumbnails/version-a/512.webp'),
      thumbnail,
    );
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
