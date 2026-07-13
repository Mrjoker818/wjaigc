import { describe, expect, it } from 'vitest';
import { normalizeBrandFactoryImageUrl, normalizeBrandFactoryImageUrls } from '@/lib/brand-factory-image-url';

describe('normalizeBrandFactoryImageUrl', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeBrandFactoryImageUrl('')).toBe('');
    expect(normalizeBrandFactoryImageUrl(null as unknown as string)).toBe('');
    expect(normalizeBrandFactoryImageUrl(undefined as unknown as string)).toBe('');
  });

  it('passes through normal http URLs unchanged', () => {
    const url = 'https://example.com/image.png';
    expect(normalizeBrandFactoryImageUrl(url)).toBe(url);
  });

  it('passes through data URLs unchanged', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(normalizeBrandFactoryImageUrl(url)).toBe(url);
  });

  it('wraps bare Base64 data with data:image/png;base64, prefix', () => {
    const bare = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = normalizeBrandFactoryImageUrl(bare);
    expect(result).toBe(`data:image/png;base64,${bare}`);
  });

  it('does not double-wrap already prefixed data', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(normalizeBrandFactoryImageUrl(url)).toBe(url);
  });
});

describe('normalizeBrandFactoryImageUrls', () => {
  it('normalizes all URLs in array', () => {
    const bare = 'iVBORw0KGgo=';
    const normal = 'https://example.com/img.png';
    const result = normalizeBrandFactoryImageUrls([bare, normal]);
    expect(result[0]).toBe(`data:image/png;base64,${bare}`);
    expect(result[1]).toBe(normal);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeBrandFactoryImageUrls([])).toEqual([]);
    expect(normalizeBrandFactoryImageUrls(null as unknown as string[])).toEqual([]);
  });
});
