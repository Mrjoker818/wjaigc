import fsSync from 'fs';
import fs from 'fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readExactRecoveryMedia: vi.fn(),
}));

vi.mock('@/lib/asset-core/recovery-media', () => ({
  readExactRecoveryMedia: mocks.readExactRecoveryMedia,
}));

import { fetchImageBuffer, normalizeLocalImagePath } from '@/lib/fetch-image-buffer';

afterEach(() => {
  vi.restoreAllMocks();
  mocks.readExactRecoveryMedia.mockReset();
});

describe('normalizeLocalImagePath', () => {
  it('keeps an allowed serve-upload path relative to its storage root', () => {
    expect(normalizeLocalImagePath('/api/serve-upload/uploads/job/image.png')).toBe('uploads/job/image.png');
  });

  it('rejects decoded directory traversal instead of rewriting it', () => {
    expect(() => normalizeLocalImagePath('/api/serve-upload/uploads/%2e%2e/%2e%2e/.env')).toThrow('Unsafe local image path');
  });

  it('rejects malformed percent-encoded paths', () => {
    expect(() => normalizeLocalImagePath('/uploads/%E0%A4%A')).toThrow('Unsafe local image path');
  });

  it('does not fall back to an unrelated local file when exact recovery validation fails', async () => {
    mocks.readExactRecoveryMedia.mockResolvedValue(null);
    vi.spyOn(fsSync, 'existsSync').mockReturnValue(true);
    const readFile = vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('stale-image'));

    await expect(fetchImageBuffer('/api/serve-upload/recovery/version-a/attempt-a.png'))
      .rejects.toThrow('Recovered media is unavailable or failed validation');
    expect(readFile).not.toHaveBeenCalled();
  });
});
