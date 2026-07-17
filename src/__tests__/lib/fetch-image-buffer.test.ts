import { describe, expect, it } from 'vitest';
import { normalizeLocalImagePath } from '@/lib/fetch-image-buffer';

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
});
