import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: fsMocks.readFile,
  realpath: fsMocks.realpath,
}));

import { resolvePsdAnalysisMedia } from '@/lib/psd-analysis/media';
import { AssetServiceError } from '@/lib/asset-core/service';
import { loadSafeImageInput } from '@/lib/safe-image-input';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zlq0AAAAASUVORK5CYII=',
  'base64',
);
const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1.toString('base64')}`;

describe('PSD analysis media boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.readFile.mockResolvedValue(PNG_1X1);
    fsMocks.realpath.mockImplementation(async (value: string) => path.resolve(value));
  });

  it.each([
    '/api/private/file.png',
    '/api/serve-upload/generated/file.png',
    'https://127.0.0.1/a.png',
    'https://public.example/a.png',
    'C:\\secret.png',
    'raw-base64-value',
  ])('rejects a direct non-data media source: %s', async image => {
    await expect(resolvePsdAnalysisMedia({
      request: { image, idempotencyKey: 'psd-analysis-request-1' },
      actorUserId: 'user-a',
    })).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_MEDIA_INVALID',
      status: 400,
    });
  });

  it('loads and fingerprints a valid data URL through the shared safe decoder', async () => {
    const media = await resolvePsdAnalysisMedia({
      request: { image: PNG_DATA_URL, idempotencyKey: 'psd-analysis-request-1' },
      actorUserId: 'user-a',
    });

    expect(media.mimeType).toBe('image/png');
    expect(media.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(media.dataUrl).toBe(PNG_DATA_URL);
    expect(media.buffer.equals(PNG_1X1)).toBe(true);
  });

  it('resolves an asset version inside the current actor and project boundary', async () => {
    const resolveAssetReference = vi.fn().mockResolvedValue({
      assetVersionId: 'version-a',
      url: '/api/serve-upload/generated/source.png',
    });
    const loadImage = vi.fn().mockResolvedValue({ buffer: PNG_1X1, mimeType: 'image/png' });

    const media = await resolvePsdAnalysisMedia({
      request: {
        projectId: 'project-a',
        sourceVersionId: 'version-a',
        idempotencyKey: 'psd-analysis-request-1',
      },
      actorUserId: 'user-a',
      dependencies: { resolveAssetReference, loadImage },
    });

    expect(resolveAssetReference).toHaveBeenCalledWith({
      actorUserId: 'user-a',
      projectId: 'project-a',
      assetVersionId: 'version-a',
    });
    expect(loadImage).toHaveBeenCalledWith(
      '/api/serve-upload/generated/source.png',
      expect.objectContaining({ maxBytes: 20 * 1024 * 1024, maxPixels: 40_000_000 }),
    );
    expect(media.sourceVersionId).toBe('version-a');
  });

  it('maps a missing or cross-user asset reference to a stable forbidden error', async () => {
    const resolveAssetReference = vi.fn().mockRejectedValue(
      new AssetServiceError('ASSET_NOT_FOUND'),
    );

    await expect(resolvePsdAnalysisMedia({
      request: {
        projectId: 'project-a',
        sourceVersionId: 'version-owned-by-b',
        idempotencyKey: 'psd-analysis-request-1',
      },
      actorUserId: 'user-a',
      dependencies: {
        resolveAssetReference,
        loadImage: vi.fn(),
      },
    })).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_MEDIA_FORBIDDEN',
      status: 403,
    });
  });

  it('keeps asset storage failures retryable instead of disguising them as authorization failures', async () => {
    const resolveAssetReference = vi.fn().mockRejectedValue(
      new Error('database connection reset by peer'),
    );

    await expect(resolvePsdAnalysisMedia({
      request: {
        projectId: 'project-a',
        sourceVersionId: 'version-a',
        idempotencyKey: 'psd-analysis-request-1',
      },
      actorUserId: 'user-a',
      dependencies: {
        resolveAssetReference,
        loadImage: vi.fn(),
      },
    })).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_MEDIA_UNAVAILABLE',
      status: 503,
      retryable: true,
      message: 'PSD 分析资产服务暂时不可用',
    });
  });

  it('rejects a managed-media symlink before reading bytes outside the upload root', async () => {
    fsMocks.realpath.mockImplementation(async (value: string) => {
      const resolved = path.resolve(value);
      return resolved.endsWith(`${path.sep}escape.png`)
        ? path.resolve('J:\\outside-root\\escape.png')
        : resolved;
    });

    await expect(loadSafeImageInput('/uploads/escape.png')).rejects.toMatchObject({
      code: 'UNSAFE_IMAGE_INPUT',
    });
    expect(fsMocks.readFile).not.toHaveBeenCalled();
  });
});
