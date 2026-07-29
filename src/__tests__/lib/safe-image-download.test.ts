import { describe, expect, it } from 'vitest';

import {
  isAllowedRemoteImageAddress,
  isAllowedRemoteMimeType,
  isPublicIpAddress,
  selectAllowedRemoteAddress,
} from '@/lib/safe-image-download';

describe('safe remote image download address policy', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '100.64.1.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '::1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ])('rejects private or reserved address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700:4700::1111',
  ])('allows public address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it('allows the Coze transparent egress proxy only for a domain name', () => {
    expect(isAllowedRemoteImageAddress(
      'images.unsplash.com',
      '198.18.0.241',
      { allowCozeEgressProxy: true },
    )).toBe(true);
    expect(isAllowedRemoteImageAddress(
      '198.18.0.241',
      '198.18.0.241',
      { allowCozeEgressProxy: true },
    )).toBe(false);
  });

  it('keeps the Coze proxy range blocked outside the Coze runtime', () => {
    expect(isAllowedRemoteImageAddress(
      'images.unsplash.com',
      '198.18.0.241',
      { allowCozeEgressProxy: false },
    )).toBe(false);
  });

  it('pins an allowed Coze proxy address when DNS also returns an unusable private IPv6 address', () => {
    expect(selectAllowedRemoteAddress(
      'cdn.pearapi.ai',
      [
        { address: '198.18.1.22', family: 4 },
        { address: 'fdfe:dcba:9876::f8', family: 6 },
      ],
      { allowCozeEgressProxy: true },
    )).toEqual({ address: '198.18.1.22', family: 4 });
  });

  it('keeps SVG blocked by default and allows it only through an explicit safe allowlist', () => {
    expect(isAllowedRemoteMimeType('image/svg+xml')).toBe(false);
    expect(isAllowedRemoteMimeType('image/svg+xml', ['image/svg+xml'])).toBe(true);
    expect(isAllowedRemoteMimeType('text/html', ['text/html'])).toBe(false);
  });

  it('keeps PSD blocked by default and allows it only through an explicit safe allowlist', () => {
    expect(isAllowedRemoteMimeType('image/vnd.adobe.photoshop')).toBe(false);
    expect(isAllowedRemoteMimeType(
      'image/vnd.adobe.photoshop',
      ['image/vnd.adobe.photoshop'],
    )).toBe(true);
    expect(isAllowedRemoteMimeType(
      'application/octet-stream',
      ['application/octet-stream'],
    )).toBe(true);
  });

  it.each([
    'application/zip',
    'application/x-zip-compressed',
  ])('allows Pear ZIP artifacts only through an explicit safe allowlist: %s', (mimeType) => {
    expect(isAllowedRemoteMimeType(mimeType)).toBe(false);
    expect(isAllowedRemoteMimeType(mimeType, [mimeType])).toBe(true);
  });
});
