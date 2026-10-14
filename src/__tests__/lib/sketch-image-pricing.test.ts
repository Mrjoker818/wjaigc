import { describe, expect, it, vi } from 'vitest';
import { parseSketchImagePricing, quoteSketchImagePricing, quoteSketchImageSettlement } from '@/lib/sketch-to-code/image-pricing';
vi.mock('server-only', () => ({}));

const selection = { visionProviderId: 'vision-provider', visionModelId: 'same-model',
  imageProviderId: 'image-provider', imageModelId: 'same-model', quality: 'high', size: '2K' };
const config = { modelCredits: {
  'same-model': 99,
  'vision-provider::same-model': { credits: 7 },
  'image-provider::same-model': { credits: 20, quality: { high: 30 }, resolution: { '2K': 40 } },
} };
const flat = { version: 1, vision: { providerId: 'vision-provider', modelId: 'same-model', calls: 1,
  mode: 'flat', reserveCredits: 7 }, image: { providerId: 'image-provider', modelId: 'same-model', calls: 1, credits: 30 }, totalReserveCredits: 37 };
const token = { ...flat, vision: { ...flat.vision, mode: 'token', tokenPricing: { input: 1_000_000, output: 2_000_000 } } };

describe('sketch image single analysis plus single image pricing', () => {
  it('resolves independent provider-specific prices, never charges two LLM calls', async () => {
    const pricing = await quoteSketchImagePricing(selection, config);
    expect(pricing).toEqual(flat);
    expect(quoteSketchImageSettlement(pricing)).toEqual({ version: 1, reserveCredits: 37,
      visionCredits: 7, imageCredits: 30, actualCredits: 37, deltaCredits: 0 });
  });
  it('uses the original quality-before-resolution rule and exact requested size', async () => {
    const { quality: unused, ...sizeSelection } = selection; void unused;
    expect(await quoteSketchImagePricing(sizeSelection, config)).toMatchObject({ image: { credits: 40 }, totalReserveCredits: 47 });
    expect(await quoteSketchImagePricing({ ...sizeSelection, size: '1K' }, config)).toMatchObject({ image: { credits: 20 } });
  });
  it('deeply detaches caller selections and original config', async () => {
    const input = { ...selection }, source = structuredClone(config);
    const pricing = await quoteSketchImagePricing(input, source);
    input.imageProviderId = 'another'; source.modelCredits['image-provider::same-model'].quality.high = 500;
    expect(pricing).toEqual(flat);
    expect([pricing, pricing.vision, pricing.image].every(Object.isFrozen)).toBe(true);
  });
  it('preserves configured free stages without inventing a charge', async () => {
    const pricing = await quoteSketchImagePricing(selection, { modelCredits: {
      'vision-provider::same-model': 0, 'image-provider::same-model': 0,
    } });
    expect(pricing.totalReserveCredits).toBe(0);
    expect(quoteSketchImageSettlement(pricing)).toMatchObject({ visionCredits: 0, imageCredits: 0, actualCredits: 0, deltaCredits: 0 });
  });
  it.each([0, 7, { credits: 0 }, { credits: 7 }])(
    'the explicit provider entry %j determines flat mode instead of inheriting global token rates', async entry => {
      const pricing = await quoteSketchImagePricing(selection, { modelCredits: {
        'same-model': { credits: 99, tokenPricing: { input: 1_000_000, output: 2_000_000 } },
        'vision-provider::same-model': entry, 'image-provider::same-model': 0,
      } });
      const amount = typeof entry === 'number' ? entry : entry.credits;
      expect(pricing).toMatchObject({ vision: { mode: 'flat', reserveCredits: amount }, image: { credits: 0 }, totalReserveCredits: amount });
      expect(pricing.vision).not.toHaveProperty('tokenPricing');
      expect(quoteSketchImageSettlement(pricing)).toMatchObject({ actualCredits: amount, deltaCredits: 0 });
      expect(quoteSketchImageSettlement(pricing, { inputTokens: 2, outputTokens: 3 })).toMatchObject({ actualCredits: amount });
    });
  it('inherits a global token entry only when the provider entry is absent', async () => {
    const pricing = await quoteSketchImagePricing(selection, { modelCredits: {
      'same-model': { credits: 99, tokenPricing: { input: 1_000_000, output: 2_000_000 } }, 'image-provider::same-model': 0,
    } });
    expect(pricing).toMatchObject({ vision: { mode: 'token', reserveCredits: 99 }, image: { credits: 0 }, totalReserveCredits: 99 });
    expect(quoteSketchImageSettlement(pricing, { inputTokens: 2, outputTokens: 3 })).toMatchObject({ actualCredits: 8, deltaCredits: -91 });
  });
  it('uses provider token rates as a complete entry, not mixed global rates', async () => {
    const pricing = await quoteSketchImagePricing(selection, { modelCredits: {
      'same-model': { credits: 99, tokenPricing: { input: 1_000_000, output: 2_000_000 } },
      'vision-provider::same-model': { credits: 3, tokenPricing: { input: 2_000_000, output: 1_000_000 } }, 'image-provider::same-model': 0,
    } });
    expect(pricing).toMatchObject({ vision: { mode: 'token', reserveCredits: 3, tokenPricing: { input: 2_000_000, output: 1_000_000 } }, totalReserveCredits: 3 });
    expect(quoteSketchImageSettlement(pricing, { inputTokens: 2, outputTokens: 3 })).toMatchObject({ actualCredits: 7, deltaCredits: 4 });
  });
  it('reserves the original single-call base and settles only actual vision usage', async () => {
    const pricing = await quoteSketchImagePricing(selection, { modelCredits: {
      ...config.modelCredits, 'vision-provider::same-model': { credits: 7, tokenPricing: { input: 1_000_000, output: 2_000_000 } },
    } });
    expect(pricing).toEqual(token);
    expect(quoteSketchImageSettlement(pricing, { inputTokens: 2, outputTokens: 3 })).toEqual({ version: 1,
      reserveCredits: 37, visionCredits: 8, imageCredits: 30, actualCredits: 38, deltaCredits: 1, usage: { inputTokens: 2, outputTokens: 3 } });
  });
  it.each([[0, 0, 1, -6], [7, 0, 7, 0], [2, 3, 8, 1]])(
    'calculates once including a single minimum: input=%i output=%i', (inputTokens, outputTokens, visionCredits, deltaCredits) => {
      expect(quoteSketchImageSettlement(token, { inputTokens, outputTokens })).toMatchObject({ visionCredits, actualCredits: visionCredits + 30, deltaCredits });
    });
  it('reserves one for token base zero, independently of free image generation', async () => {
    const pricing = await quoteSketchImagePricing(selection, { modelCredits: {
      'vision-provider::same-model': { credits: 0, tokenPricing: { input: 1, output: 1 } }, 'image-provider::same-model': 0,
    } });
    expect(pricing).toMatchObject({ vision: { reserveCredits: 1 }, image: { credits: 0 }, totalReserveCredits: 1 });
    expect(quoteSketchImageSettlement(pricing, { inputTokens: 0, outputTokens: 0 })).toMatchObject({ actualCredits: 1, deltaCredits: 0 });
  });
  it('rounds fractional single-stage usage using the original calculator', () => {
    expect(quoteSketchImageSettlement({ ...token, vision: { ...token.vision, tokenPricing: { input: 100_001, output: 1 } } },
      { inputTokens: 10, outputTokens: 0 })).toMatchObject({ visionCredits: 2, actualCredits: 32, deltaCredits: -5 });
  });
  it('accepts exact existing rate/usage ceilings without aggregating a second stage', () => {
    expect(quoteSketchImageSettlement({ ...token, vision: { ...token.vision, tokenPricing: { input: 10_000_000, output: 10_000_000 } } },
      { inputTokens: 10_000_000, outputTokens: 10_000_000 })).toMatchObject({ visionCredits: 200_000_000, actualCredits: 200_000_030 });
  });
  it('does not fabricate missing flat usage and freezes actual supplied counters', () => {
    expect(quoteSketchImageSettlement(flat)).not.toHaveProperty('usage');
    const counters = { inputTokens: 2, outputTokens: 3 };
    const quote = quoteSketchImageSettlement(flat, counters); counters.inputTokens = 500;
    expect(quote.usage).toEqual({ inputTokens: 2, outputTokens: 3 });
    expect(Object.isFrozen(quote)).toBe(true); expect(Object.isFrozen(quote.usage)).toBe(true);
  });
  it.each([undefined, null, {}, { inputTokens: 1 }, { inputTokens: '1', outputTokens: 0 },
    { inputTokens: -1, outputTokens: 0 }, { inputTokens: 0.5, outputTokens: 0 },
    { inputTokens: 10_000_001, outputTokens: 0 }, { inputTokens: 0, outputTokens: Infinity },
    { analysis: { inputTokens: 1, outputTokens: 2 }, reconstruction: null, total: null },
    { inputTokens: 1, outputTokens: 0, extra: true }])('rejects missing or invalid token evidence %j', usage => {
    expect(() => quoteSketchImageSettlement(token, usage)).toThrow('SKETCH_IMAGE_USAGE_INVALID');
  });
  it.each(['unknown', 'getter', 'prototype', 'symbol', 'calls', 'sum', 'fraction', 'identity', 'flat-rate', 'token-rate', 'token-free'])(
    'rejects malformed persistent pricing %s without executing caller code', variant => {
      const value = structuredClone(token); let calls = 0;
      if (variant === 'unknown') Object.assign(value, { extra: true });
      if (variant === 'getter') Object.defineProperty(value.vision, 'reserveCredits', { enumerable: true, get: () => { calls++; return 7; } });
      if (variant === 'prototype') Object.setPrototypeOf(value.image, { inherited: true });
      if (variant === 'symbol') Object.assign(value, { [Symbol('price')]: 1 });
      if (variant === 'calls') Object.assign(value.vision, { calls: 2 });
      if (variant === 'sum') value.totalReserveCredits++;
      if (variant === 'fraction') value.image.credits = 1.5;
      if (variant === 'identity') value.image.providerId = 'bad\nprovider';
      if (variant === 'flat-rate') value.vision.mode = 'flat';
      if (variant === 'token-rate') value.vision.tokenPricing.output = 0;
      if (variant === 'token-free') { value.vision.reserveCredits = 0; value.totalReserveCredits = 30; }
      expect(() => parseSketchImagePricing(value)).toThrow('SKETCH_IMAGE_PRICING_INVALID'); expect(calls).toBe(0);
    });
  it('rechecks a quote on settlement instead of trusting a type assertion', () => {
    expect(() => quoteSketchImageSettlement({ ...token, totalReserveCredits: 14 }, { inputTokens: 1, outputTokens: 2 })).toThrow();
    expect(() => quoteSketchImageSettlement({ calls: 2, perCallCredits: 7, totalCredits: 14 })).toThrow();
  });
  it('does not coerce a caller-controlled pricing mode object', () => {
    let calls = 0;
    const mode = { toString: (): string => { calls++; return 'flat'; } };
    expect(() => parseSketchImagePricing({ ...flat, vision: { ...flat.vision, mode } })).toThrow('SKETCH_IMAGE_PRICING_INVALID');
    expect(calls).toBe(0);
  });
  it('rejects untrusted selection/config getters before shared normalization', async () => {
    let calls = 0;
    const badSelection = Object.defineProperty({ ...selection }, 'imageProviderId', { enumerable: true, get: () => { calls++; return 'image-provider'; } });
    await expect(quoteSketchImagePricing(badSelection, config)).rejects.toThrow();
    const badConfig = { modelCredits: Object.defineProperty({}, 'same-model', { enumerable: true, get: () => { calls++; return 7; } }) };
    await expect(quoteSketchImagePricing(selection, badConfig)).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
