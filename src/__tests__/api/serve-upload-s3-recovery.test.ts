import { NextRequest } from 'next/server';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadImageFromS3: vi.fn(),
  existsSync: vi.fn(),
  getImageSourceUrl: vi.fn(),
  mkdirSync: vi.fn(),
  readExactRecoveryMedia: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => 'C:/wujie-data' }));
vi.mock('@/lib/s3-storage', () => ({
  deriveS3Key: vi.fn((value: string) => `images/${value}`),
  downloadImageFromS3: mocks.downloadImageFromS3,
  getS3PresignedUrl: vi.fn(),
  resolveS3Key: vi.fn(),
}));
vi.mock('@/lib/image-source-map', () => ({ getImageSourceUrl: mocks.getImageSourceUrl }));
vi.mock('@/lib/asset-core/recovery-media', () => ({
  readExactRecoveryMedia: mocks.readExactRecoveryMedia,
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
});
