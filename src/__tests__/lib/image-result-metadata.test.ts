import { describe, expect, it, vi } from 'vitest';

import { enrichCompletedImageResult } from '@/lib/asset-core/image-result-metadata';

describe('completed image result metadata', () => {
  it('adds authoritative metadata for every completed image URL in output order', async () => {
    const inspect = vi.fn()
      .mockResolvedValueOnce({ width: 1254, height: 1254, mimeType: 'image/png', byteSize: 456789 })
      .mockResolvedValueOnce({ width: 800, height: 534, mimeType: 'image/jpeg', byteSize: 123456 });

    const result = await enrichCompletedImageResult({
      imageUrl: '/uploads/one.png',
      imageUrls: ['/uploads/one.png', 'https://cdn.example.com/two.jpg'],
      providerId: 'provider-1',
    }, inspect);

    expect(result.images).toEqual([
      { url: '/uploads/one.png', width: 1254, height: 1254, mimeType: 'image/png', byteSize: 456789 },
      { url: 'https://cdn.example.com/two.jpg', width: 800, height: 534, mimeType: 'image/jpeg', byteSize: 123456 },
    ]);
    expect(result.providerId).toBe('provider-1');
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it('reuses complete existing metadata and does not download that image again', async () => {
    const inspect = vi.fn();
    const result = await enrichCompletedImageResult({
      imageUrls: ['/uploads/one.png'],
      images: [{ url: '/uploads/one.png', width: 640, height: 480, mimeType: 'image/png', byteSize: 99 }],
    }, inspect);

    expect(result.images).toEqual([
      { url: '/uploads/one.png', width: 640, height: 480, mimeType: 'image/png', byteSize: 99 },
    ]);
    expect(inspect).not.toHaveBeenCalled();
  });

  it('keeps provider success authoritative when metadata inspection fails', async () => {
    const inspect = vi.fn().mockRejectedValue(new Error('remote image unavailable'));
    const result = await enrichCompletedImageResult({
      imageUrl: 'https://cdn.example.com/result.png',
      imageUrls: ['https://cdn.example.com/result.png'],
    }, inspect);

    expect(result.images).toEqual([{ url: 'https://cdn.example.com/result.png' }]);
    expect(result.imageUrl).toBe('https://cdn.example.com/result.png');
  });
});
