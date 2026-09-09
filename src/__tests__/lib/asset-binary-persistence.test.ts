import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import sharp from 'sharp';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  uploadBinaryToS3: vi.fn(),
  getServerDataRoot: vi.fn(),
  drainPendingAssetCleanup: vi.fn(),
  recordAssetCleanupFailure: vi.fn(),
}));

vi.mock('@/lib/s3-storage', () => ({
  uploadBinaryToS3: mocks.uploadBinaryToS3,
}));
vi.mock('@/lib/server-data-root', () => ({
  getServerDataRoot: mocks.getServerDataRoot,
}));
vi.mock('@/lib/asset-core/cleanup-outbox', () => ({
  drainPendingAssetCleanup: mocks.drainPendingAssetCleanup,
  recordAssetCleanupFailure: mocks.recordAssetCleanupFailure,
}));

import { persistAssetBytes, recoverExportAssetBytes } from '@/lib/asset-core/binary-persistence';
import { assetBinaryFileOps } from '@/lib/asset-core/binary-file-ops';

describe('generic asset binary persistence', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wujie-export-bytes-'));
    mocks.getServerDataRoot.mockReturnValue(root);
    mocks.drainPendingAssetCleanup.mockResolvedValue({ completed: 0, failed: 0 });
    mocks.recordAssetCleanupFailure.mockResolvedValue(undefined);
    mocks.uploadBinaryToS3.mockImplementation(async (_bytes: Buffer, filename: string) => ({
      storageKey: `exports/${filename}`,
      createdThisCall: true,
      cleanup: vi.fn(async () => undefined),
    }));
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('persists an allowed ZIP without using image validation and returns integrity metadata', async () => {
    const bytes = await new JSZip().file('manifest.json', '{}').generateAsync({ type: 'nodebuffer' });
    const file = await persistAssetBytes({
      bytes,
      filename: 'delivery.zip',
      mimeType: 'application/zip',
    });

    expect(file).toMatchObject({
      createdThisCall: true,
      availability: 'ready',
      mimeType: 'application/zip',
      byteSize: bytes.length,
    });
    expect(file.checksum).toMatch(/^[a-f0-9]{64}$/);
    const storedFilename = file.url.split('/').at(-1)!;
    expect(storedFilename).toMatch(new RegExp(`^${file.checksum?.slice(0, 16)}-[a-f0-9-]{36}-delivery\\.zip$`));
    expect(await readFile(join(root, 'exports', storedFilename))).toEqual(bytes);
    expect(mocks.uploadBinaryToS3).toHaveBeenCalledWith(
      bytes,
      storedFilename,
      'application/zip',
      expect.any(AbortSignal),
    );
  });

  it.each([
    [Buffer.from('not a png'), 'a.png', 'image/png'],
    [Buffer.from([0xff, 0xd8, 0xff]), 'a.jpeg', 'image/jpeg'],
    [Buffer.from('RIFFxxxxNOPE'), 'a.webp', 'image/webp'],
    [Buffer.from('PK\u0003\u0004broken'), 'a.zip', 'application/zip'],
    [Buffer.from('[]'), 'a.json', 'application/json'],
    [Buffer.from('{broken'), 'a.json', 'application/json'],
  ])('rejects bytes that do not match the declared format %#', async (bytes, filename, mimeType) => {
    await expect(persistAssetBytes({ bytes, filename, mimeType })).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
    expect(mocks.uploadBinaryToS3).not.toHaveBeenCalled();
  });

  it('accepts signature-valid PNG, JPEG, and WebP bytes only under matching MIME and extension', async () => {
    for (const [format, mimeType, filename] of [
      ['png', 'image/png', 'a.png'],
      ['jpeg', 'image/jpeg', 'a.jpg'],
      ['webp', 'image/webp', 'a.webp'],
    ] as const) {
      const bytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } })
        [format]().toBuffer();
      await expect(persistAssetBytes({ bytes, filename, mimeType })).resolves.toMatchObject({ mimeType });
    }
  });

  it('rejects ZIP entries whose original path attempts traversal', async () => {
    const bytes = await new JSZip().file('../secret.txt', 'x').generateAsync({ type: 'nodebuffer' });
    await expect(persistAssetBytes({ bytes, filename: 'unsafe.zip', mimeType: 'application/zip' }))
      .rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
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
    expect(file.url).toMatch(/^\/api\/serve-upload\/exports\/[a-f0-9]{16}-[a-f0-9-]{36}-_+\.json$/);
    expect(decodeURIComponent(file.url)).not.toContain('平台');
  });

  it('does not delete a previously committed content-addressed file when an S3 retry fails', async () => {
    const input = { bytes: Buffer.from('{}'), filename: 'manifest.json', mimeType: 'application/json' };
    const first = await persistAssetBytes(input);
    mocks.uploadBinaryToS3.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(persistAssetBytes(input)).rejects.toThrow('storage unavailable');
    expect(await readFile(join(root, 'exports', first.url.split('/').at(-1)!))).toEqual(input.bytes);
  });

  it('exposes idempotent cleanup that removes only objects created by this call', async () => {
    const s3Cleanup = vi.fn(async () => undefined);
    mocks.uploadBinaryToS3.mockImplementationOnce(async (_bytes: Buffer, filename: string) => ({ storageKey: `exports/${filename}`, createdThisCall: true, cleanup: s3Cleanup }));
    const persisted = await persistAssetBytes({ bytes: Buffer.from('{}'), filename: 'manifest.json', mimeType: 'application/json' });
    const localName = persisted.url.split('/').at(-1)!;

    await persisted.cleanup();
    await persisted.cleanup();

    await expect(readFile(join(root, 'exports', localName))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(s3Cleanup).toHaveBeenCalledOnce();
  });

  it('allows cleanup to retry when S3 deletion initially fails', async () => {
    const s3Cleanup = vi.fn()
      .mockRejectedValueOnce(new Error('delete unavailable'))
      .mockResolvedValueOnce(undefined);
    mocks.uploadBinaryToS3.mockImplementationOnce(async (_bytes: Buffer, filename: string) => ({
      storageKey: `exports/${filename}`, createdThisCall: true, cleanup: s3Cleanup,
    }));
    const persisted = await persistAssetBytes({ bytes: Buffer.from('{}'), filename: 'manifest.json', mimeType: 'application/json' });
    await expect(persisted.cleanup()).rejects.toThrow('delete unavailable');
    expect(mocks.recordAssetCleanupFailure).toHaveBeenCalledWith(expect.objectContaining({
      storageKey: expect.stringMatching(/^exports\//),
      lastError: 'delete unavailable',
    }));
    await expect(persisted.cleanup()).resolves.toBeUndefined();
    expect(s3Cleanup).toHaveBeenCalledTimes(2);
  });

  it('isolates concurrent same-content persistence so one failed request cannot delete the successful object', async () => {
    const input = { bytes: Buffer.from('{}'), filename: 'manifest.json', mimeType: 'application/json' };
    const [successful, failed] = await Promise.all([persistAssetBytes(input), persistAssetBytes(input)]);
    expect(successful.url).not.toBe(failed.url);
    expect(successful.storageKey).not.toBe(failed.storageKey);
    await failed.cleanup();
    await expect(readFile(join(root, 'exports', successful.url.split('/').at(-1)!))).resolves.toEqual(input.bytes);
  });

  it('removes a just-published target when temporary unlink fails after linking', async () => {
    const originalRm = assetBinaryFileOps.rm;
    let failed = false;
    const rmSpy = vi.spyOn(assetBinaryFileOps, 'rm').mockImplementation(async (filePath, options) => {
      if (!failed && String(filePath).endsWith('.tmp')) {
        failed = true;
        throw new Error('temporary unlink failed');
      }
      return originalRm(filePath, options);
    });
    await expect(persistAssetBytes({ bytes: Buffer.from('{}'), filename: 'manifest.json', mimeType: 'application/json' }))
      .rejects.toThrow('temporary unlink failed');
    expect((await readdir(join(root, 'exports'))).filter(name => !name.startsWith('.'))).toEqual([]);
    rmSpy.mockRestore();
  });

  it('rejects recovery bytes whose digest does not match the content-addressed filename', async () => {
    await expect(recoverExportAssetBytes({
      bytes: Buffer.from('{}'),
      filename: `${'0'.repeat(16)}-manifest.json`,
      mimeType: 'application/json',
    })).rejects.toThrow('ASSET_RECOVERY_CHECKSUM_MISMATCH');
    expect(await readdir(root)).toEqual([]);
  });

  it('atomically publishes concurrent recoveries without leaving temporary files', async () => {
    const bytes = Buffer.from('{"schemaVersion":1}');
    const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-manifest.json`;
    await Promise.all(Array.from({ length: 4 }, () => recoverExportAssetBytes({
      bytes,
      filename,
      mimeType: 'application/json',
    })));
    expect(await readFile(join(root, 'exports', filename))).toEqual(bytes);
    expect(await readdir(join(root, 'exports'))).toEqual([filename]);
  });
});
