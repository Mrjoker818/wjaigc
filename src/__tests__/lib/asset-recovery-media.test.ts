import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withAssetCoreTransaction: vi.fn(),
  readImageFromS3Bounded: vi.fn(),
  dataRoot: '',
}));

vi.mock('@/lib/asset-core/storage', () => ({ withAssetCoreTransaction: mocks.withAssetCoreTransaction }));
vi.mock('@/lib/s3-storage', () => ({ readImageFromS3Bounded: mocks.readImageFromS3Bounded }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => mocks.dataRoot }));

import { readExactRecoveryMedia } from '@/lib/asset-core/recovery-media';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('exact recovery media reader', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wujie-recovery-read-'));
  });

  afterEach(async () => {
    await fs.rm(mocks.dataRoot, { recursive: true, force: true });
  });

  it('maps the exact recovery URL to the recorded storage key and validates bytes', async () => {
    const query = vi.fn(async () => ({ rows: [{
      storage_key: 'images/owner/exact.png',
      checksum: `sha256:${createHash('sha256').update(png).digest('hex')}`,
      mime_type: 'image/png',
      byte_size: String(png.byteLength),
    }], rowCount: 1 }));
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));
    mocks.readImageFromS3Bounded.mockResolvedValue(png);

    await expect(readExactRecoveryMedia('recovery/version-a/attempt-a.png')).resolves.toEqual({
      buffer: png,
      mimeType: 'image/png',
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('file_url = $2'), [
      'version-a',
      '/api/serve-upload/recovery/version-a/attempt-a.png',
    ]);
    expect(mocks.readImageFromS3Bounded).toHaveBeenCalledExactlyOnceWith(
      'images/owner/exact.png',
      80 * 1024 * 1024,
      30_000,
    );
  });

  it('fails closed for a same-key payload that violates the recorded checksum', async () => {
    const query = vi.fn(async () => ({ rows: [{
      storage_key: 'images/owner/exact.png',
      checksum: `sha256:${'0'.repeat(64)}`,
      mime_type: 'image/png',
      byte_size: String(png.byteLength),
    }], rowCount: 1 }));
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));
    mocks.readImageFromS3Bounded.mockResolvedValue(png);

    await expect(readExactRecoveryMedia('recovery/version-a/attempt-a.png')).resolves.toBeNull();
  });

  it('reads the exact attempt file from a durable local data root when object storage is unavailable', async () => {
    const relativePath = 'recovery/version-local/attempt-local.png';
    const localPath = path.join(mocks.dataRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, png);
    const query = vi.fn(async () => ({ rows: [{
      storage_key: 'images/recovery/version-local/attempt-local.png',
      checksum: `sha256:${createHash('sha256').update(png).digest('hex')}`,
      mime_type: 'image/png',
      byte_size: String(png.byteLength),
    }], rowCount: 1 }));
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));
    mocks.readImageFromS3Bounded.mockResolvedValue(null);

    await expect(readExactRecoveryMedia(relativePath)).resolves.toEqual({
      buffer: png,
      mimeType: 'image/png',
    });
    expect(mocks.readImageFromS3Bounded).toHaveBeenCalledExactlyOnceWith(
      'images/recovery/version-local/attempt-local.png',
      80 * 1024 * 1024,
      30_000,
    );
  });

  it('rejects a declared over-budget recovery image before any storage read', async () => {
    const query = vi.fn(async () => ({ rows: [{
      storage_key: 'images/recovery/version-a/attempt-a.png',
      checksum: null,
      mime_type: 'image/png',
      byte_size: String(png.byteLength),
    }], rowCount: 1 }));
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));
    mocks.readImageFromS3Bounded.mockResolvedValue(png);

    await expect(readExactRecoveryMedia('recovery/version-a/attempt-a.png', 4))
      .rejects.toMatchObject({ code: 'RECOVERY_MEDIA_SIZE_LIMIT' });
    expect(mocks.readImageFromS3Bounded).not.toHaveBeenCalled();
  });

  it('classifies a declaration above both the supplied budget and legacy cap as over-budget', async () => {
    const query = vi.fn(async () => ({ rows: [{
      storage_key: 'images/recovery/version-a/attempt-a.png',
      checksum: null,
      mime_type: 'image/png',
      byte_size: String(80 * 1024 * 1024 + 1),
    }], rowCount: 1 }));
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));

    await expect(readExactRecoveryMedia('recovery/version-a/attempt-a.png', 4))
      .rejects.toMatchObject({ code: 'RECOVERY_MEDIA_SIZE_LIMIT' });
    expect(mocks.readImageFromS3Bounded).not.toHaveBeenCalled();
  });

  it('uses a strict supplied S3 limit and rejects bytes larger than a smaller declaration', async () => {
    const query = vi.fn(async () => ({ rows: [{
      storage_key: 'images/recovery/version-a/attempt-a.png',
      checksum: null,
      mime_type: 'image/png',
      byte_size: '4',
    }], rowCount: 1 }));
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));
    mocks.readImageFromS3Bounded.mockResolvedValue(png);

    await expect(readExactRecoveryMedia('recovery/version-a/attempt-a.png', 4))
      .rejects.toMatchObject({ code: 'RECOVERY_MEDIA_SIZE_LIMIT' });
    expect(mocks.readImageFromS3Bounded).toHaveBeenCalledExactlyOnceWith(
      'images/recovery/version-a/attempt-a.png', 4, 30_000, { strict: true },
    );
  });

  it('does not turn a bounded S3 size rejection into a local fallback', async () => {
    const relativePath = 'recovery/version-local/attempt-local.png';
    const localPath = path.join(mocks.dataRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, png);
    const query = vi.fn(async () => ({ rows: [{
      storage_key: 'images/recovery/version-local/attempt-local.png',
      checksum: null,
      mime_type: 'image/png',
      byte_size: String(png.byteLength),
    }], rowCount: 1 }));
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));
    mocks.readImageFromS3Bounded.mockRejectedValue(Object.assign(new Error('S3 size limit'),
      { code: 'S3_READ_SIZE_LIMIT' }));
    const openSpy = vi.spyOn(fs, 'open');
    try {
      await expect(readExactRecoveryMedia(relativePath, png.byteLength))
        .rejects.toMatchObject({ code: 'RECOVERY_MEDIA_SIZE_LIMIT' });
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });

  it('retains exact local fallback on a non-size S3 failure with a supplied budget', async () => {
    const relativePath = 'recovery/version-local/attempt-local.png';
    const localPath = path.join(mocks.dataRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, png);
    const query = vi.fn(async () => ({ rows: [{
      storage_key: 'images/recovery/version-local/attempt-local.png',
      checksum: `sha256:${createHash('sha256').update(png).digest('hex')}`,
      mime_type: 'image/png',
      byte_size: String(png.byteLength),
    }], rowCount: 1 }));
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));
    mocks.readImageFromS3Bounded.mockRejectedValue(Object.assign(new Error('S3 timeout'),
      { code: 'S3_READ_TIMEOUT' }));

    await expect(readExactRecoveryMedia(relativePath, png.byteLength)).resolves.toEqual({
      buffer: png, mimeType: 'image/png',
    });
    expect(mocks.readImageFromS3Bounded).toHaveBeenCalledExactlyOnceWith(
      'images/recovery/version-local/attempt-local.png', png.byteLength, 30_000, { strict: true },
    );
  });

  it('bounds a real local attempt that grows after stat on the same handle', async () => {
    const relativePath = 'recovery/version-local/attempt-local.png';
    const localPath = path.join(mocks.dataRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, '1234');
    const query = vi.fn(async () => ({ rows: [{
      storage_key: null,
      checksum: null,
      mime_type: 'image/png',
      byte_size: '4',
    }], rowCount: 1 }));
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));
    const realStat = fs.stat.bind(fs);
    const handle = await fs.open(localPath, 'r');
    const realHandleStat = handle.stat.bind(handle);
    let grew = false;
    const appendAfterStat = async (): Promise<void> => {
      if (!grew) {
        grew = true;
        await fs.appendFile(localPath, '5678');
      }
    };
    const pathStatSpy = vi.spyOn(fs, 'stat').mockImplementation(async (...args) => {
      const stat = await realStat(...args);
      await appendAfterStat();
      return stat;
    });
    vi.spyOn(handle, 'stat').mockImplementation(async () => {
      const stat = await realHandleStat();
      await appendAfterStat();
      return stat;
    });
    const openSpy = vi.spyOn(fs, 'open').mockResolvedValue(handle);
    const readFileSpy = vi.spyOn(fs, 'readFile');
    const readSpy = vi.spyOn(handle, 'read');
    try {
      await expect(readExactRecoveryMedia(relativePath, 4))
        .rejects.toMatchObject({ code: 'RECOVERY_MEDIA_SIZE_LIMIT' });
      expect(grew).toBe(true);
      expect(readFileSpy).not.toHaveBeenCalled();
      expect(openSpy).toHaveBeenCalledWith(localPath, 'r');
      expect(readSpy).toHaveBeenCalled();
      expect(readSpy.mock.calls.every(call => {
        const args = call as unknown[];
        return typeof args[2] === 'number' && args[2] <= 5;
      })).toBe(true);
    } finally {
      pathStatSpy.mockRestore();
      openSpy.mockRestore();
      readFileSpy.mockRestore();
      readSpy.mockRestore();
      await handle.close();
    }
  });
});
