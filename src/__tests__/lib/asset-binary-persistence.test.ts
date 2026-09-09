import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  uploadBinaryToS3: vi.fn(),
  getServerDataRoot: vi.fn(),
}));

vi.mock('@/lib/s3-storage', () => ({
  uploadBinaryToS3: mocks.uploadBinaryToS3,
}));
vi.mock('@/lib/server-data-root', () => ({
  getServerDataRoot: mocks.getServerDataRoot,
}));

import { persistAssetBytes } from '@/lib/asset-core/binary-persistence';

describe('generic asset binary persistence', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wujie-export-bytes-'));
    mocks.getServerDataRoot.mockReturnValue(root);
    mocks.uploadBinaryToS3.mockResolvedValue('/exports/report.zip');
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('persists an allowed ZIP without using image validation and returns integrity metadata', async () => {
    const bytes = Buffer.from('PK\u0003\u0004archive');
    const file = await persistAssetBytes({
      bytes,
      filename: 'delivery.zip',
      mimeType: 'application/zip',
    });

    expect(file).toMatchObject({
      storageKey: '/exports/report.zip',
      availability: 'ready',
      mimeType: 'application/zip',
      byteSize: bytes.length,
    });
    expect(file.checksum).toMatch(/^[a-f0-9]{64}$/);
    const storedFilename = `${file.checksum?.slice(0, 16)}-delivery.zip`;
    expect(file.url).toBe(`/api/serve-upload/exports/${storedFilename}`);
    expect(await readFile(join(root, 'exports', storedFilename))).toEqual(bytes);
    expect(mocks.uploadBinaryToS3).toHaveBeenCalledWith(
      bytes,
      storedFilename,
      'application/zip',
      expect.any(AbortSignal),
    );
  });

  it.each([
    [{ bytes: 'not-buffer', filename: 'a.zip', mimeType: 'application/zip' }, 'ASSET_BYTES_INVALID'],
    [{ bytes: Buffer.from('x'), filename: '../a.zip', mimeType: 'application/zip' }, 'ASSET_FILENAME_INVALID'],
    [{ bytes: Buffer.from('x'), filename: 'a.exe', mimeType: 'application/octet-stream' }, 'ASSET_MIME_TYPE_INVALID'],
    [{ bytes: Buffer.from('x'), filename: 'a.png', mimeType: 'application/zip' }, 'ASSET_FILENAME_MIME_MISMATCH'],
  ])('rejects invalid binary input %#', async (input, code) => {
    await expect(persistAssetBytes(input as never)).rejects.toThrow(code);
  });

  it('does not leave a temporary or final file when already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(persistAssetBytes({
      bytes: Buffer.from('{}'), filename: 'manifest.json', mimeType: 'application/json',
      signal: controller.signal,
    })).rejects.toThrow('cancelled');
    expect(await readdir(root)).toEqual([]);
    expect(mocks.uploadBinaryToS3).not.toHaveBeenCalled();
  });

  it('uses an ASCII storage name while preserving a valid Unicode input filename contract', async () => {
    const file = await persistAssetBytes({
      bytes: Buffer.from('{}'), filename: '平台清单.json', mimeType: 'application/json',
    });
    expect(file.url).toMatch(/^\/api\/serve-upload\/exports\/[a-f0-9]{16}-_+\.json$/);
    expect(decodeURIComponent(file.url)).not.toContain('平台');
  });

  it('does not delete a previously committed content-addressed file when an S3 retry fails', async () => {
    const input = { bytes: Buffer.from('{}'), filename: 'manifest.json', mimeType: 'application/json' };
    const first = await persistAssetBytes(input);
    mocks.uploadBinaryToS3.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(persistAssetBytes(input)).rejects.toThrow('storage unavailable');
    expect(await readFile(join(root, 'exports', first.url.split('/').at(-1)!))).toEqual(input.bytes);
  });
});
