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
});
