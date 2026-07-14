import { describe, expect, it } from 'vitest';
import { isServerReadableImageUrl, resolveRequestedImageModel } from '@/lib/display3d-request-contract';

describe('display3d request contract', () => {
  it('keeps a requested Gemini image model instead of replacing it with the provider default', () => {
    expect(resolveRequestedImageModel({
      requestedModel: 'gemini-2.5-flash-image',
      providerModels: ['gpt-image-2', 'gemini-2.5-flash-image'],
      fallbackModel: 'gpt-image-2',
    })).toBe('gemini-2.5-flash-image');
  });

  it('rejects browser-only blob URLs and accepts URLs the server can forward to a provider', () => {
    expect(isServerReadableImageUrl('blob:http://localhost/asset-id')).toBe(false);
    expect(isServerReadableImageUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isServerReadableImageUrl('/api/serve-upload/reference.png')).toBe(true);
    expect(isServerReadableImageUrl('https://cdn.example.com/reference.png')).toBe(true);
  });
});
