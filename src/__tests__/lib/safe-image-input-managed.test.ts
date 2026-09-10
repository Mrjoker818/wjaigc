import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  realpath: vi.fn(async (value: string) => value),
  readManagedImageFromS3: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: mocks.stat,
  readFile: mocks.readFile,
  realpath: mocks.realpath,
}));
vi.mock('@/lib/server-data-root', () => ({
  getServerDataRoot: () => 'C:\\managed-data',
}));
vi.mock('@/lib/s3-storage', () => ({
  readManagedImageFromS3Bounded: mocks.readManagedImageFromS3,
}));

import { loadSafeImageInput } from '@/lib/safe-image-input';

describe('managed safe image reads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stats the file before reading and rejects an oversized managed file without allocation', async () => {
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 2048 });

    await expect(loadSafeImageInput('/api/serve-upload/uploads/source.png', {
      maxBytes: 1024,
    })).rejects.toThrow(/size limit/i);

    expect(mocks.stat).toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('passes AbortSignal to readFile and preserves AbortError', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('cancelled', 'AbortError');
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 100 });
    mocks.readFile.mockRejectedValue(abortError);

    await expect(loadSafeImageInput('/api/serve-upload/uploads/source.png', {
      maxBytes: 1024,
      signal: controller.signal,
    })).rejects.toBe(abortError);

    expect(mocks.readFile).toHaveBeenCalledWith(expect.any(String), {
      signal: controller.signal,
    });
  });

  it('recovers a missing managed upload from the exact bounded S3 object', async () => {
    const fixture = readFileSync(path.resolve(
      process.cwd(),
      'src/__tests__/fixtures/platform-compliance/amazon-main-pass.png',
    ));
    const controller = new AbortController();
    mocks.stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    mocks.readManagedImageFromS3.mockResolvedValue(fixture);

    const image = await loadSafeImageInput('/api/serve-upload/uploads/source.png', {
      maxBytes: 1024 * 1024,
      maxPixels: 40_000_000,
      signal: controller.signal,
    });

    expect(image.buffer).toEqual(fixture);
    expect(image.mimeType).toBe('image/png');
    expect(mocks.readManagedImageFromS3).toHaveBeenCalledWith(
      'uploads/source.png',
      1024 * 1024,
      30_000,
      { signal: controller.signal, strict: true },
    );
  });

  it('preserves caller cancellation while recovering a managed upload from S3', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('cancelled', 'AbortError');
    mocks.stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    mocks.readManagedImageFromS3.mockImplementation(async () => {
      controller.abort(abortError);
      throw new Error('S3_READ_ABORTED');
    });

    await expect(loadSafeImageInput('/api/serve-upload/uploads/source.png', {
      maxBytes: 1024,
      signal: controller.signal,
    })).rejects.toBe(abortError);
  });
});
