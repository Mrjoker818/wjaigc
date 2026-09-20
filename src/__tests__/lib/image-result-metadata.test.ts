import { describe, expect, it, vi } from 'vitest';

import * as imageResultMetadata from '@/lib/asset-core/image-result-metadata';

const { createCachedCompletedImageInspector, enrichCompletedImageResult } = imageResultMetadata;

describe('completed image result metadata', () => {
  it('inspects authoritative MIME, byte size, and dimensions from image bytes', async () => {
    const inspectCompletedImage = Reflect.get(imageResultMetadata, 'inspectCompletedImage') as
      | undefined
      | ((url: string) => Promise<{ width?: number; height?: number; mimeType?: string; byteSize?: number }>);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgaPgPQhAKACX2Bf2gcp/LAAAAAElFTkSuQmCC';

    expect(inspectCompletedImage).toBeTypeOf('function');
    if (!inspectCompletedImage) return;
    await expect(inspectCompletedImage(png)).resolves.toEqual({
      width: 2,
      height: 2,
      mimeType: 'image/png',
      byteSize: 72,
    });
  });

  it('accepts BMP bytes used by ordinary canvas uploads', async () => {
    const bmp = Buffer.from(
      '424d3a0000000000000036000000280000000100000001000000010018000000000004000000130b0000130b000000000000000000000000ff00',
      'hex',
    );
    const url = `data:image/bmp;base64,${bmp.toString('base64')}`;

    await expect(imageResultMetadata.inspectCompletedImage(url)).resolves.toMatchObject({
      width: 1,
      height: 1,
      mimeType: 'image/bmp',
      byteSize: bmp.byteLength,
    });
  });

  it('caches only successful server inspections by immutable managed URL', async () => {
    const inspect = vi.fn().mockResolvedValue({
      width: 2,
      height: 2,
      mimeType: 'image/png',
      byteSize: 72,
    });
    const cachedInspect = createCachedCompletedImageInspector(inspect, 2);

    const first = '/api/serve-upload/uploads/first.png';
    const second = '/api/serve-upload/uploads/second.png';
    const third = '/api/serve-upload/uploads/third.png';
    await expect(Promise.all([
      cachedInspect(first),
      cachedInspect(first),
    ])).resolves.toHaveLength(2);
    await cachedInspect(second);
    await cachedInspect(first);
    await cachedInspect(third);
    await cachedInspect(second);

    expect(inspect).toHaveBeenCalledTimes(4);
  });

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
