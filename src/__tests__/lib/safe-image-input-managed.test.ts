import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  realpath: vi.fn(async (value: string) => value),
}));

vi.mock('node:fs/promises', () => ({
  stat: mocks.stat,
  readFile: mocks.readFile,
  realpath: mocks.realpath,
}));
vi.mock('@/lib/server-data-root', () => ({
  getServerDataRoot: () => 'C:\\managed-data',
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
});
