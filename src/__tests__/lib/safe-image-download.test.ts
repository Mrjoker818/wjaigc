import { describe, expect, it } from 'vitest';

import { isPublicIpAddress } from '@/lib/safe-image-download';

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
});
