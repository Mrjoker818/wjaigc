import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AssetServiceError } from '@/lib/asset-core/service';
import { readAuthorizedExportSources } from '@/lib/multi-platform-export/source-reader';
import { S3BoundedReadError } from '@/lib/s3-storage';
import { SafeImageInputError } from '@/lib/safe-image-input';

const fixtureRoot = path.join(
  process.cwd(),
  'src',
  '__tests__',
  'fixtures',
  'multi-platform-export',
);

function dependenciesFor(
  reference: {
    url: string;
    kind?: 'image';
    name?: string;
    storageKey?: string;
    checksum?: string;
    mimeType?: string;
    byteSize?: number;
  } = {
    url: '/api/serve-upload/uploads/source.png',
    kind: 'image',
    name: '来源图片',
  },
  loadImage = vi.fn(),
) {
  return {
    resolveAssetReference: vi.fn().mockResolvedValue(reference),
    loadImage,
    readS3: vi.fn().mockResolvedValue(null),
  };
}

describe('readAuthorizedExportSources', () => {
  it('resolves every source through the authorized AssetService boundary before reading bytes', async () => {
    const buffer = await readFile(path.join(fixtureRoot, 'transparent.png'));
    const dependencies = dependenciesFor(undefined, vi.fn().mockResolvedValue({
      buffer,
      mimeType: 'image/png',
    }));

    const [source] = await readAuthorizedExportSources({
      actorUserId: 'user-1',
      projectId: 'project-1',
      sourceVersionIds: ['asset-version-1'],
      dependencies,
    });

    expect(dependencies.resolveAssetReference).toHaveBeenCalledExactlyOnceWith({
      actorUserId: 'user-1',
      projectId: 'project-1',
      assetVersionId: 'asset-version-1',
    });
    expect(dependencies.loadImage).toHaveBeenCalledExactlyOnceWith(
      '/api/serve-upload/uploads/source.png',
      expect.objectContaining({ maxBytes: expect.any(Number), maxPixels: expect.any(Number) }),
    );
    expect(source).toMatchObject({
      versionId: 'asset-version-1',
      assetName: '来源图片',
      mimeType: 'image/png',
      width: 3,
      height: 5,
      hasTransparency: true,
    });
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the same ASSET_NOT_FOUND boundary for cross-user or cross-project sources', async () => {
    const dependencies = dependenciesFor();
    dependencies.resolveAssetReference.mockRejectedValue(new AssetServiceError('ASSET_NOT_FOUND'));

    await expect(readAuthorizedExportSources({
      actorUserId: 'other-user',
      projectId: 'other-project',
      sourceVersionIds: ['asset-version-1'],
      dependencies,
    })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    expect(dependencies.loadImage).not.toHaveBeenCalled();
  });

  it('reads only the exact storage key returned by the authorized asset reference', async () => {
    const buffer = await readFile(path.join(fixtureRoot, 'portrait.png'));
    const dependencies = dependenciesFor({
      url: '/api/serve-upload/uploads/source.png',
      kind: 'image',
      name: 'S3 source',
      storageKey: 'images/owners/user-1/exact.png',
      mimeType: 'image/png',
      byteSize: buffer.length,
    });
    dependencies.readS3.mockResolvedValue(buffer);

    await expect(readAuthorizedExportSources({
      actorUserId: 'user-1',
      projectId: 'project-1',
      sourceVersionIds: ['asset-version-1'],
      dependencies,
    })).resolves.toHaveLength(1);

    expect(dependencies.readS3).toHaveBeenCalledExactlyOnceWith(
      'images/owners/user-1/exact.png',
      expect.any(Number),
      expect.any(Number),
      { signal: undefined, strict: true },
    );
    expect(dependencies.loadImage).not.toHaveBeenCalled();
  });

  it('fails closed when an authorized exact storage key cannot be read', async () => {
    const dependencies = dependenciesFor({
      url: 'https://mutable.example/source.png',
      kind: 'image',
      storageKey: 'images/owners/user-1/exact.png',
      mimeType: 'image/png',
    });
    dependencies.readS3.mockResolvedValue(null);

    await expect(readAuthorizedExportSources({
      actorUserId: 'user-1',
      projectId: 'project-1',
      sourceVersionIds: ['asset-version-1'],
      dependencies,
    })).rejects.toMatchObject({ code: 'EXPORT_SOURCE_UNAVAILABLE' });
    expect(dependencies.loadImage).not.toHaveBeenCalled();
  });

  it('keeps safe-loader byte limit failures in the source byte error class', async () => {
    const dependencies = dependenciesFor(undefined, vi.fn().mockRejectedValue(
      new SafeImageInputError('Managed image exceeds the size limit'),
    ));

    await expect(readAuthorizedExportSources({
      actorUserId: 'user-1',
      projectId: 'project-1',
      sourceVersionIds: ['asset-version-1'],
      dependencies,
    })).rejects.toMatchObject({ code: 'EXPORT_SOURCE_BYTE_LIMIT' });
  });

  it('reports an exact S3 read timeout as source unavailability, not corrupt image bytes', async () => {
    const dependencies = dependenciesFor({
      url: '/api/serve-upload/uploads/source.png',
      kind: 'image',
      storageKey: 'images/owners/user-1/exact.png',
      mimeType: 'image/png',
    });
    dependencies.readS3.mockRejectedValue(new S3BoundedReadError('S3_READ_TIMEOUT'));

    await expect(readAuthorizedExportSources({
      actorUserId: 'user-1',
      projectId: 'project-1',
      sourceVersionIds: ['asset-version-1'],
      dependencies,
    })).rejects.toMatchObject({ code: 'EXPORT_SOURCE_UNAVAILABLE' });
  });

  it('maps a strict S3 byte overflow to the source byte error class', async () => {
    const dependencies = dependenciesFor({
      url: '/api/serve-upload/uploads/source.png',
      kind: 'image',
      storageKey: 'images/owners/user-1/exact.png',
      mimeType: 'image/png',
    });
    dependencies.readS3.mockRejectedValue(new S3BoundedReadError('S3_READ_SIZE_LIMIT'));

    await expect(readAuthorizedExportSources({
      actorUserId: 'user-1',
      projectId: 'project-1',
      sourceVersionIds: ['asset-version-1'],
      dependencies,
    })).rejects.toMatchObject({ code: 'EXPORT_SOURCE_BYTE_LIMIT' });
  });

  it('rejects a declared PNG whose real signature is JPEG', async () => {
    const jpeg = await readFile(path.join(fixtureRoot, 'landscape.jpg'));
    const dependencies = dependenciesFor(undefined, vi.fn().mockResolvedValue({
      buffer: jpeg,
      mimeType: 'image/png',
    }));

    await expect(readAuthorizedExportSources({
      actorUserId: 'user-1',
      projectId: 'project-1',
      sourceVersionIds: ['asset-version-1'],
      dependencies,
    })).rejects.toThrow('EXPORT_SOURCE_FORMAT_INVALID');
  });

  it('rejects decoded dimensions above the source pixel budget', async () => {
    const png = await readFile(path.join(fixtureRoot, 'portrait.png'));
    const dependencies = dependenciesFor(undefined, vi.fn().mockResolvedValue({
      buffer: png,
      mimeType: 'image/png',
    }));

    await expect(readAuthorizedExportSources({
      actorUserId: 'user-1',
      projectId: 'project-1',
      sourceVersionIds: ['asset-version-1'],
      dependencies,
      limits: { maxSourcePixels: 4 },
    })).rejects.toThrow('EXPORT_SOURCE_PIXEL_LIMIT');
  });

  it('uses the existing SSRF-safe downloader and rejects a private remote source', async () => {
    const dependencies = {
      resolveAssetReference: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1/private.png',
        kind: 'image' as const,
      }),
    };

    await expect(readAuthorizedExportSources({
      actorUserId: 'user-1',
      projectId: 'project-1',
      sourceVersionIds: ['asset-version-1'],
      dependencies,
    })).rejects.toThrow('REMOTE_MEDIA_PRIVATE_ADDRESS');
  });

  it('honors an already aborted signal before resolving or reading a source', async () => {
    const controller = new AbortController();
    controller.abort();
    const dependencies = dependenciesFor();

    await expect(readAuthorizedExportSources({
      actorUserId: 'user-1',
      projectId: 'project-1',
      sourceVersionIds: ['asset-version-1'],
      signal: controller.signal,
      dependencies,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(dependencies.resolveAssetReference).not.toHaveBeenCalled();
  });
});
