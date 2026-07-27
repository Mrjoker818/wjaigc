import { describe, expect, it } from 'vitest';

import {
  assertSafePixelDimensions,
  decodeSafeImageInput,
  normalizeTrustedManagedMediaInput,
  resolveManagedMediaPath,
} from '@/lib/safe-image-input';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zlq0AAAAASUVORK5CYII=',
  'base64',
);

describe('safe edit image inputs', () => {
  it('accepts a valid image data URL and verifies its real format', () => {
    const decoded = decodeSafeImageInput(
      `data:image/png;base64,${PNG_1X1.toString('base64')}`,
      { maxBytes: 1024 },
    );
    expect(decoded.mimeType).toBe('image/png');
    expect(decoded.buffer.equals(PNG_1X1)).toBe(true);
  });

  it.each([
    'data:text/plain;base64,aGVsbG8=',
    'data:image/png;base64,aGVsbG8=',
    'not-valid-base64***',
  ])('rejects forged or malformed image input', (input) => {
    expect(() => decodeSafeImageInput(input, { allowRawBase64: true }))
      .toThrow();
  });

  it('rejects decoded bytes over the configured limit', () => {
    expect(() => decodeSafeImageInput(
      `data:image/png;base64,${PNG_1X1.toString('base64')}`,
      { maxBytes: 16 },
    )).toThrow(/size limit/i);
  });

  it('rejects pixel-bomb dimensions before Sharp transforms run', () => {
    expect(() => assertSafePixelDimensions(100_000, 100_000, 40_000_000))
      .toThrow(/pixel/i);
  });

  it('allows only managed upload paths without traversal', () => {
    expect(resolveManagedMediaPath('/uploads/image.png')).toEqual({
      namespace: 'uploads',
      relativePath: 'image.png',
    });
    expect(() => resolveManagedMediaPath('/uploads/../secret.png')).toThrow();
    expect(() => resolveManagedMediaPath('/api/serve-upload/%2e%2e/secret.png')).toThrow();
    expect(() => resolveManagedMediaPath('/api/serve-upload/system/private.png')).toThrow();
    expect(() => resolveManagedMediaPath('/api/serve-upload/users/private.png')).toThrow();
  });

  it('normalizes only same-host managed media URLs to local managed paths', () => {
    expect(normalizeTrustedManagedMediaInput(
      'https://preview.example:8443/api/serve-upload/generated/image.png?download=1',
      ['preview.example:8443'],
    )).toBe('/api/serve-upload/generated/image.png');
    expect(normalizeTrustedManagedMediaInput(
      'https://preview.example/uploads/image.png',
      ['preview.example'],
    )).toBe('/uploads/image.png');
  });

  it.each([
    'https://attacker.example/api/serve-upload/image.png',
    'https://preview.example.attacker.test/api/serve-upload/image.png',
    'https://user@preview.example/api/serve-upload/image.png',
    'https://preview.example/not-managed/image.png',
  ])('does not trust an external or malformed managed-looking URL: %s', (input) => {
    expect(normalizeTrustedManagedMediaInput(input, ['preview.example'])).toBe(input);
  });
});
