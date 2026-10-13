import { describe, expect, it, vi } from 'vitest';
import { copySketchPricingConfig, parseSketchAdmissionPricing, quoteSketchTokenSettlement,
  SketchTokenBillingRejectedError } from '@/lib/sketch-to-code/token-billing';
vi.mock('server-only', () => ({}));
const pricing = { mode: 'token', calls: 2, perCallCredits: 7, totalCredits: 14, tokenPricing: { input: 1, output: 1 } };
const usage = { analysis: { inputTokens: 1, outputTokens: 1 }, reconstruction: { inputTokens: 1, outputTokens: 1 }, total: { inputTokens: 2, outputTokens: 2 } };
describe('Token quote and strict frozen original pricing', () => {
  it('aggregates once, applies one minimum and owns a deeply frozen copy', () => {
    const source = structuredClone({ pricing, usage });
    const quote = quoteSketchTokenSettlement('t', source.pricing, source.usage, 'charge');
    expect(quote).toMatchObject({ reserveCredits: 14, actualCredits: 1, deltaCredits: -13, chargedTransactionId: 'charge' });
    source.usage.total.inputTokens = 100; source.pricing.tokenPricing.input = 100;
    expect(quote.usage.total?.inputTokens).toBe(2);
    expect([quote, quote.usage, quote.usage.analysis, quote.usage.reconstruction, quote.usage.total].every(Object.isFrozen)).toBe(true);
  });
  it.each([0, 7, 10])('uses a single original calculation for zero/delta0/topup at phase count %s', count => {
    const u = { analysis: { inputTokens: count, outputTokens: 0 }, reconstruction: { inputTokens: count, outputTokens: 0 }, total: { inputTokens: count * 2, outputTokens: 0 } };
    const quote = quoteSketchTokenSettlement('t', { ...pricing, tokenPricing: { input: 1_000_000, output: 1 } }, u, 'charge');
    expect(quote.actualCredits).toBe(count === 0 ? 1 : count * 2);
    expect(quote.adjustmentTransactionId === null).toBe(count === 7);
  });
  it('accepts both directional aggregate limits and the exact maximum cost', () => {
    const phase = { inputTokens: 10_000_000, outputTokens: 10_000_000 };
    const u = { analysis: phase, reconstruction: phase, total: { inputTokens: 20_000_000, outputTokens: 20_000_000 } };
    expect(quoteSketchTokenSettlement('t', { ...pricing, tokenPricing: { input: 10_000_000, output: 10_000_000 } }, u, 'charge').actualCredits).toBe(400_000_000);
  });
  it.each([undefined, null, {}, { analysis: null, reconstruction: null, total: null },
    { ...usage, reconstruction: null, total: null }, { ...usage, total: { inputTokens: 3, outputTokens: 2 } },
    { ...usage, analysis: { inputTokens: 10_000_001, outputTokens: 1 } }])('refuses missing, partial or malformed metering %j', u => {
    expect(() => quoteSketchTokenSettlement('t', pricing, u, 'charge')).toThrow(SketchTokenBillingRejectedError);
  });
  it('requires reserve1 for token base0 and preserves flat base0', () => {
    expect(parseSketchAdmissionPricing({ ...pricing, perCallCredits: 0, totalCredits: 1 })).toHaveProperty('totalCredits', 1);
    expect(parseSketchAdmissionPricing({ calls: 2, perCallCredits: 0, totalCredits: 0 })).toEqual({ calls: 2, perCallCredits: 0, totalCredits: 0 });
    expect(() => parseSketchAdmissionPricing({ ...pricing, perCallCredits: 0, totalCredits: 0 })).toThrow();
  });
  it.each(['extra', 'prototype', 'getter', 'symbol', 'toJSON', 'string', 'rate0', 'rate-over', 'base-over', 'reserve'])(
    'rejects frozen pricing %s without executing code', variant => {
      const p = structuredClone(pricing); let calls = 0;
      if (variant === 'extra') Object.assign(p, { extra: 1 });
      if (variant === 'prototype') Object.setPrototypeOf(p, { inherited: 1 });
      if (variant === 'getter') Object.defineProperty(p.tokenPricing, 'input', { get: () => { calls++; return 1; } });
      if (variant === 'symbol') Object.assign(p, { [Symbol('rate')]: 1 });
      if (variant === 'toJSON') Object.assign(p, { toJSON: () => { calls++; return p; } });
      if (variant === 'string') Object.assign(p, { perCallCredits: '7' });
      if (variant === 'rate0') p.tokenPricing.input = 0;
      if (variant === 'rate-over') p.tokenPricing.output = 10_000_001;
      if (variant === 'base-over') p.perCallCredits = 100_001;
      if (variant === 'reserve') p.totalCredits = 15;
      expect(() => parseSketchAdmissionPricing(p)).toThrow(); expect(calls).toBe(0);
    });
  it.each(['getter', 'prototype', 'string', 'extra', 'rate-extra', 'toJSON'])(
    'rejects original config %s before normalization can erase it', variant => {
      const entry = { credits: 7, tokenPricing: { input: 1, output: 1 } }; let calls = 0;
      const config = { modelCredits: { 'p::m': entry } };
      if (variant === 'getter') Object.defineProperty(entry, 'credits', { get: () => { calls++; return 7; } });
      if (variant === 'prototype') Object.setPrototypeOf(entry.tokenPricing, { inherited: 1 });
      if (variant === 'string') Object.assign(entry.tokenPricing, { input: '1' });
      if (variant === 'extra') Object.assign(entry, { extra: true });
      if (variant === 'rate-extra') Object.assign(entry.tokenPricing, { unit: 'token' });
      if (variant === 'toJSON') Object.assign(config, { toJSON: () => { calls++; return config; } });
      expect(() => copySketchPricingConfig(config)).toThrow(); expect(calls).toBe(0);
    });
  it('copies the whole original config without keeping caller prices', () => {
    const config = { modelCredits: { 'p::m': { credits: 7, quality: { high: 8 }, tokenPricing: { input: 1, output: 2 } } }, updatedAt: 1 };
    const frozen = copySketchPricingConfig(config); config.modelCredits['p::m'].tokenPricing.output = 9;
    expect(frozen.modelCredits['p::m']).toMatchObject({ tokenPricing: { input: 1, output: 2 } });
    expect(Object.isFrozen(frozen.modelCredits['p::m'])).toBe(true);
  });
});
