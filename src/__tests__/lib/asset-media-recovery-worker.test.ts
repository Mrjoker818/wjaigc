import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadPublicImage: vi.fn(),
  readImageFromS3Bounded: vi.fn(),
  uploadImageToS3: vi.fn(),
  isServerDataRootDurable: vi.fn(),
  dataRoot: '',
}));

vi.mock('@/lib/safe-image-download', () => ({
  downloadPublicImage: mocks.downloadPublicImage,
}));
vi.mock('@/lib/server-data-root', () => ({
  getServerDataRoot: () => mocks.dataRoot,
  isServerDataRootDurable: mocks.isServerDataRootDurable,
}));
vi.mock('@/lib/s3-storage', () => ({
  readImageFromS3Bounded: mocks.readImageFromS3Bounded,
  uploadImageToS3: mocks.uploadImageToS3,
}));

import { executeAssetMediaRecovery } from '@/lib/asset-core/media-recovery-worker';

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
]);

function target(overrides: Partial<Parameters<typeof executeAssetMediaRecovery>[0]> = {}) {
  return {
    fileUrl: '/api/serve-upload/uploads/recovered.png',
    recoverySourceUrl: 'https://source.test/recovered.png',
    storageKey: null,
    checksum: null,
    mimeType: 'image/png',
    assetVersionId: 'version-source',
    attemptId: 'attempt-source',
    ...overrides,
  };
}

describe('asset media recovery worker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wujie-media-recovery-'));
    mocks.isServerDataRootDurable.mockReturnValue(true);
    mocks.readImageFromS3Bounded.mockResolvedValue(null);
    mocks.uploadImageToS3.mockResolvedValue('/images/recovery/version-source/attempt-source.png');
  });

  afterEach(async () => {
    if (mocks.dataRoot) await fs.rm(mocks.dataRoot, { recursive: true, force: true });
  });

  it('physically probes an existing controlled managed image without remote download', async () => {
    const localPath = path.join(mocks.dataRoot, 'uploads', 'existing.png');
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, png);

    await expect(executeAssetMediaRecovery(target({
      fileUrl: '/api/serve-upload/uploads/existing.png',
      storageKey: 'images/owners/owner-a/existing.png',
    }))).resolves.toMatchObject({
      success: true,
      method: 'managed-storage',
      url: '/api/serve-upload/uploads/existing.png',
      storageKey: 'images/owners/owner-a/existing.png',
    });

    expect(mocks.downloadPublicImage).not.toHaveBeenCalled();
    expect(mocks.readImageFromS3Bounded).not.toHaveBeenCalled();
  });

  it('reads only the exact recorded S3 key without basename fallback', async () => {
    mocks.readImageFromS3Bounded.mockResolvedValue(png);

    await expect(executeAssetMediaRecovery(target({
      fileUrl: '/api/serve-upload/uploads/from-s3.png',
      storageKey: 'images/owners/owner-a/from-s3.png',
    }))).resolves.toMatchObject({
      success: true,
      method: 'managed-storage',
      url: '/api/serve-upload/recovery/version-source/attempt-source.png',
      storageKey: 'images/owners/owner-a/from-s3.png',
    });

    expect(mocks.readImageFromS3Bounded).toHaveBeenCalledExactlyOnceWith(
      'images/owners/owner-a/from-s3.png',
      80 * 1024 * 1024,
      30_000,
    );
    expect(mocks.downloadPublicImage).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(mocks.dataRoot, 'uploads', 'from-s3.png'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers the exact object again after the version uses its authenticated stable URL', async () => {
    mocks.readImageFromS3Bounded.mockResolvedValue(png);

    await expect(executeAssetMediaRecovery(target({
      fileUrl: '/api/serve-upload/recovery/version-source/previous-attempt.png',
      storageKey: 'images/recovery/version-source/previous-attempt.png',
      recoverySourceUrl: null,
    }))).resolves.toMatchObject({
      success: true,
      url: '/api/serve-upload/recovery/version-source/attempt-source.png',
      storageKey: 'images/recovery/version-source/previous-attempt.png',
    });
  });

  it('downloads safely and publishes to an attempt-isolated path', async () => {
    mocks.downloadPublicImage.mockResolvedValue({ buffer: png, mimeType: 'image/png' });

    await expect(executeAssetMediaRecovery(target())).resolves.toEqual({
      success: true,
      method: 'source-url',
      url: '/api/serve-upload/recovery/version-source/attempt-source.png',
      storageKey: 'images/recovery/version-source/attempt-source.png',
      checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      mimeType: 'image/png',
      byteSize: png.byteLength,
    });

    await expect(fs.readFile(path.join(
      mocks.dataRoot,
      'recovery',
      'version-source',
      'attempt-source.png',
    ))).resolves.toEqual(png);
    expect(mocks.downloadPublicImage).toHaveBeenCalledWith('https://source.test/recovered.png', {
      maxBytes: 80 * 1024 * 1024,
      timeoutMs: 30_000,
    });
  });

  it.each([
    '/api/serve-upload/../outside.png',
    '/api/serve-upload/uploads/not-image.txt',
    'https://foreign.test/uploads/image.png',
  ])('rejects an uncontrolled recovery destination: %s', async (fileUrl) => {
    await expect(executeAssetMediaRecovery(target({ fileUrl }))).resolves.toEqual({
      success: false,
      method: 'none',
      retryable: false,
      error: 'No controlled media destination is available',
    });
    expect(mocks.downloadPublicImage).not.toHaveBeenCalled();
  });

  it('keeps terminal failure explicit when neither managed media nor a source exists', async () => {
    await expect(executeAssetMediaRecovery(target({
      fileUrl: '/api/serve-upload/uploads/missing.png',
      recoverySourceUrl: null,
      storageKey: 'images/owners/owner-a/missing.png',
    }))).resolves.toEqual({
      success: false,
      method: 'managed-storage',
      error: 'Managed media and recovery source are unavailable',
    });
  });

  it('rejects downloaded image bytes that do not match the destination extension', async () => {
    mocks.downloadPublicImage.mockResolvedValue({ buffer: png, mimeType: 'image/png' });

    await expect(executeAssetMediaRecovery(target({
      fileUrl: '/api/serve-upload/uploads/mismatch.jpg',
      mimeType: 'image/jpeg',
    }))).resolves.toEqual({
      success: false,
      method: 'source-url',
      retryable: false,
      error: 'Recovery source type does not match the managed destination',
    });
  });

  it('does not publish ready when object storage and the local root are non-durable', async () => {
    mocks.isServerDataRootDurable.mockReturnValue(false);
    mocks.uploadImageToS3.mockResolvedValue(null);
    mocks.downloadPublicImage.mockResolvedValue({ buffer: png, mimeType: 'image/png' });

    await expect(executeAssetMediaRecovery(target({
      fileUrl: '/api/serve-upload/uploads/ephemeral.png',
    }))).resolves.toEqual({
      success: false,
      method: 'source-url',
      error: 'Recovery output could not be persisted durably',
    });
  });

  it('promotes valid local bytes from a non-durable root into attempt-isolated durable storage', async () => {
    mocks.isServerDataRootDurable.mockReturnValue(false);
    mocks.uploadImageToS3.mockResolvedValue('/images/recovery/version-source/attempt-source.png');
    const localPath = path.join(mocks.dataRoot, 'uploads', 'local-only.png');
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, png);

    await expect(executeAssetMediaRecovery(target({
      fileUrl: '/api/serve-upload/uploads/local-only.png',
      recoverySourceUrl: null,
    }))).resolves.toMatchObject({
      success: true,
      method: 'managed-storage',
      url: '/api/serve-upload/recovery/version-source/attempt-source.png',
      storageKey: 'images/recovery/version-source/attempt-source.png',
    });
    expect(mocks.uploadImageToS3).toHaveBeenCalledWith(
      png,
      'recovery/version-source/attempt-source.png',
      'image/png',
    );
  });

  it('keeps concurrent recovery attempts on isolated candidate paths', async () => {
    mocks.downloadPublicImage.mockResolvedValue({ buffer: png, mimeType: 'image/png' });

    const first = await executeAssetMediaRecovery(target({ attemptId: 'attempt-old' }));
    const second = await executeAssetMediaRecovery(target({ attemptId: 'attempt-new' }));

    expect(first.url).toBe('/api/serve-upload/recovery/version-source/attempt-old.png');
    expect(second.url).toBe('/api/serve-upload/recovery/version-source/attempt-new.png');
    expect(mocks.uploadImageToS3.mock.calls.map((call) => call[1])).toEqual([
      'recovery/version-source/attempt-old.png',
      'recovery/version-source/attempt-new.png',
    ]);
  });

  it('rejects bytes that do not match the recorded checksum', async () => {
    mocks.readImageFromS3Bounded.mockResolvedValue(png);

    await expect(executeAssetMediaRecovery(target({
      fileUrl: '/api/serve-upload/uploads/checksum.png',
      recoverySourceUrl: null,
      storageKey: 'images/owners/owner-a/checksum.png',
      checksum: `sha256:${'0'.repeat(64)}`,
    }))).resolves.toMatchObject({ success: false, retryable: false });
  });

  it('fails closed when the recorded checksum is malformed', async () => {
    mocks.readImageFromS3Bounded.mockResolvedValue(png);

    await expect(executeAssetMediaRecovery(target({
      fileUrl: '/api/serve-upload/uploads/checksum.png',
      recoverySourceUrl: null,
      storageKey: 'images/owners/owner-a/checksum.png',
      checksum: 'legacy-not-a-checksum',
    }))).resolves.toEqual({
      success: false,
      method: 'none',
      retryable: false,
      error: 'Asset version checksum is invalid',
    });
  });
});
