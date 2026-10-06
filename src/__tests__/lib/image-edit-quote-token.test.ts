import { describe, expect, it } from 'vitest';

import { issueImageEditQuoteToken, verifyImageEditQuoteToken } from '@/lib/task-core/image-edit-quote-token';

const quote = {
  actorUserId: 'owner-a', requestDigest: 'request-sha256-a', creditOp: 'image_upscale',
  total: 11, components: { upscale: 7, enhance: 4 },
  targets: [
    { phase: 'upscale', providerId: 'source-302', modelId: '302-esrgan' },
    { phase: 'enhance', providerId: 'enhance-provider', modelId: 'enhance-image' },
  ],
  pricingDigest: 'price-sha256-a', catalogDigest: 'catalog-sha256-a',
};
const secret = 'server-only-quote-signing-secret-at-least-32-chars';

describe('image edit short-lived confirmed quote identity', (): void => {
  it('accepts the same actor, request, service and price inside the short lifetime', (): void => {
    const token = issueImageEditQuoteToken(quote, secret, 1_000);
    expect(verifyImageEditQuoteToken(token, quote, secret, 1_001)).toBe(true);
  });

  it('rejects changed amount, provider, pricing, actor or request', (): void => {
    const token = issueImageEditQuoteToken(quote, secret, 1_000);
    const changes = [
      { ...quote, total: 12 },
      { ...quote, components: { upscale: 7, enhance: 5 } },
      { ...quote, targets: [{ ...quote.targets[0], providerId: 'other' }, quote.targets[1]] },
      { ...quote, pricingDigest: 'price-sha256-b' },
      { ...quote, catalogDigest: 'catalog-sha256-b' },
      { ...quote, actorUserId: 'owner-b' },
      { ...quote, requestDigest: 'request-sha256-b' },
    ];
    for (const changed of changes) {
      expect(verifyImageEditQuoteToken(token, changed, secret, 1_001)).toBe(false);
    }
  });

  it('refuses to sign a quote without an execution pair', (): void => {
    expect(() => issueImageEditQuoteToken({ ...quote, targets: [] }, secret, 1_000))
      .toThrow('Invalid image edit quote identity');
  });

  it('rejects expired, forged and malformed identities', (): void => {
    const token = issueImageEditQuoteToken(quote, secret, 1_000);
    expect(verifyImageEditQuoteToken(token, quote, secret, 301_001)).toBe(false);
    const [payload, signature] = token.split('.');
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    (forged.quote as Record<string, unknown>).total = 1;
    const forgedPayload = Buffer.from(JSON.stringify(forged)).toString('base64url');
    expect(verifyImageEditQuoteToken(`${forgedPayload}.${signature}`, quote, secret, 1_001)).toBe(false);
    expect(verifyImageEditQuoteToken(`${token}.extra`, quote, secret, 1_001)).toBe(false);
    expect(verifyImageEditQuoteToken('x'.repeat(8_193), quote, secret, 1_001)).toBe(false);
  });
});
