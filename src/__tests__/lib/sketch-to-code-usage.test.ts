import { describe, expect, it } from 'vitest';
import { aggregateSketchUsage, normalizeSketchStageResponse, parseSketchProviderUsage, parseSketchTokenUsage, validateSketchCodeUsage } from '@/lib/sketch-to-code/usage';

const first = { inputTokens: 101, outputTokens: 17 };
const second = { inputTokens: 203, outputTokens: 29 };
const actual = { analysis: first, reconstruction: second, total: { inputTokens: 304, outputTokens: 46 } };
const invalidNumbers: unknown[] = ['1', 1.5, -1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 10_000_001, null, undefined, true, new Number(1)];

describe('pure sketch actual usage validation', () => {
  it('copies, owns and deeply freezes the actual component-wise aggregate', () => {
    const a = { ...first }, b = { ...second };
    const result = aggregateSketchUsage(a, b);
    expect(result).toEqual(actual);
    a.inputTokens = 999; b.outputTokens = 999;
    expect(result).toEqual(actual);
    expect([result, result?.analysis, result?.reconstruction, result?.total].every(Object.isFrozen)).toBe(true);
    expect(result?.analysis).not.toBe(a); expect(Object.isFrozen(a)).toBe(false);
  });
  it('preserves reported numeric zero and exact 10M/20M boundaries', () => {
    expect(aggregateSketchUsage({ inputTokens: 0, outputTokens: 0 }, { inputTokens: 0, outputTokens: 0 })).toEqual({
      analysis: { inputTokens: 0, outputTokens: 0 }, reconstruction: { inputTokens: 0, outputTokens: 0 }, total: { inputTokens: 0, outputTokens: 0 },
    });
    expect(aggregateSketchUsage({ inputTokens: 10_000_000, outputTokens: 10_000_000 }, { inputTokens: 10_000_000, outputTokens: 10_000_000 })).toEqual({
      analysis: { inputTokens: 10_000_000, outputTokens: 10_000_000 }, reconstruction: { inputTokens: 10_000_000, outputTokens: 10_000_000 }, total: { inputTokens: 20_000_000, outputTokens: 20_000_000 },
    });
  });
  it('omits absent-both usage and distinguishes either missing phase from zero', () => {
    expect(aggregateSketchUsage(null, null)).toBeUndefined();
    expect(aggregateSketchUsage(first, null)).toEqual({ analysis: first, reconstruction: null, total: null });
    expect(aggregateSketchUsage(null, second)).toEqual({ analysis: null, reconstruction: second, total: null });
  });
  it.each(invalidNumbers)('rejects invalid normalized input/output count %s without coercion', value => {
    expect(() => parseSketchTokenUsage({ inputTokens: value, outputTokens: 2 })).toThrow('SKETCH_USAGE_INVALID');
    expect(() => parseSketchTokenUsage({ inputTokens: 1, outputTokens: value })).toThrow('SKETCH_USAGE_INVALID');
  });
  it.each([{}, null, [], { inputTokens: 1 }, { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    { ...first, [Symbol('extra')]: 1 }, Object.create(first) as unknown, new Map()])('rejects sparse/extraneous/nonplain phase data %j', value => {
    expect(() => parseSketchTokenUsage(value)).toThrow('SKETCH_USAGE_INVALID');
  });
  it('accepts owned null-prototype data and rejects pollution keys and toJSON without execution', () => {
    const value = Object.assign(Object.create(null) as Record<string, unknown>, first);
    expect(parseSketchTokenUsage(value)).toEqual(first);
    let invoked = 0;
    expect(() => parseSketchTokenUsage({ ...first, toJSON: () => { invoked++; return first; } })).toThrow('SKETCH_USAGE_INVALID');
    expect(() => parseSketchProviderUsage(JSON.parse('{"prompt_tokens":1,"completion_tokens":2,"__proto__":{}}') as unknown)).toThrow('SKETCH_USAGE_INVALID');
    expect(invoked).toBe(0);
  });
  it.each(['inputTokens', 'outputTokens'])('rejects %s getter without invocation', field => {
    let invoked = 0; const value = { ...first };
    Object.defineProperty(value, field, { get: () => { invoked++; return 1; } });
    expect(() => parseSketchTokenUsage(value)).toThrow('SKETCH_USAGE_INVALID'); expect(invoked).toBe(0);
  });
  it('normalizes only declared chat-completions counters, ignoring bounded vendor detail', () => {
    const vendor = { prompt_tokens: 101, completion_tokens: 17, total_tokens: 118, prompt_tokens_details: { cached_tokens: 999 }, input_tokens: 666 };
    const result = parseSketchProviderUsage(vendor);
    expect(result).toEqual(first); expect(Object.isFrozen(result)).toBe(true);
    vendor.prompt_tokens = 999; expect(result).toEqual(first);
    expect(parseSketchProviderUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(parseSketchProviderUsage({ prompt_tokens: 10_000_000, completion_tokens: 10_000_000, total_tokens: 20_000_000 })).toEqual({ inputTokens: 10_000_000, outputTokens: 10_000_000 });
  });
  it.each([null, undefined, {}, { input_tokens: 1, output_tokens: 2 }, { prompt_tokens: 1 },
    { prompt_tokens: 1, completion_tokens: 2, total_tokens: 4 }, { prompt_tokens: 1, completion_tokens: 2, total_tokens: undefined },
    { prompt_tokens: 1, completion_tokens: 2, total_tokens: '3' }, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3.5 },
    { prompt_tokens: 1, completion_tokens: 2, total_tokens: -3 }, { prompt_tokens: 1, completion_tokens: 2, total_tokens: Infinity },
    { prompt_tokens: 1, completion_tokens: 2, total_tokens: Number.MAX_SAFE_INTEGER + 1 }])('rejects malformed declared provider usage %j', value => {
    expect(() => parseSketchProviderUsage(value)).toThrow('SKETCH_USAGE_INVALID');
  });
  it.each(invalidNumbers)('rejects invalid provider phase counters %s', value => {
    expect(() => parseSketchProviderUsage({ prompt_tokens: value, completion_tokens: 2 })).toThrow('SKETCH_USAGE_INVALID');
    expect(() => parseSketchProviderUsage({ prompt_tokens: 1, completion_tokens: value })).toThrow('SKETCH_USAGE_INVALID');
  });
  it('does not execute even ignored provider vendor accessors', () => {
    let invoked = 0; const usage = { prompt_tokens: 1, completion_tokens: 2 };
    Object.defineProperty(usage, 'vendor_details', { get: () => { invoked++; return {}; } });
    expect(() => parseSketchProviderUsage(usage)).toThrow('SKETCH_USAGE_INVALID'); expect(invoked).toBe(0);
  });
  it('normalizes legacy strings and owns wrapped content and usage', () => {
    expect(normalizeSketchStageResponse('{}')).toEqual({ content: '{}' });
    const caller = { content: '{}', usage: { ...first } }; const result = normalizeSketchStageResponse(caller);
    caller.content = 'changed'; caller.usage.inputTokens = 999;
    expect(result).toEqual({ content: '{}', usage: first });
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.usage)).toBe(true);
    expect(normalizeSketchStageResponse({ content: '{}' })).not.toHaveProperty('usage');
  });
  it.each([null, [], {}, { content: 123 }, { content: '{}', usage: null }, { content: '{}', usage: undefined },
    { content: '{}', html: '<script>' }, { content: '{}', usage: first, price: 1 }, Object.create({ content: '{}' }) as unknown])('rejects malformed wrapper %j', value => {
    expect(() => normalizeSketchStageResponse(value)).toThrow('SKETCH_USAGE_INVALID');
  });
  it.each(['content', 'usage'])('does not execute wrapper %s getter', field => {
    let invoked = 0; const value = { content: '{}', usage: first };
    Object.defineProperty(value, field, { get: () => { invoked++; return field === 'content' ? '{}' : first; } });
    expect(() => normalizeSketchStageResponse(value)).toThrow('SKETCH_USAGE_INVALID'); expect(invoked).toBe(0);
  });
  it('validates a supplied aggregate by recomputing and owns every returned object', () => {
    const caller = structuredClone(actual); const result = validateSketchCodeUsage(caller);
    expect(result).toEqual(actual); caller.total.inputTokens = 999; caller.analysis.inputTokens = 999;
    expect(result).toEqual(actual);
    expect([result, result.analysis, result.reconstruction, result.total].every(Object.isFrozen)).toBe(true);
    expect(result.total).not.toBe(caller.total);
    expect(validateSketchCodeUsage({ analysis: first, reconstruction: null, total: null })).toEqual({ analysis: first, reconstruction: null, total: null });
    expect(validateSketchCodeUsage({ analysis: null, reconstruction: null, total: null })).toEqual({ analysis: null, reconstruction: null, total: null });
  });
  it.each([
    { ...actual, total: { inputTokens: 305, outputTokens: 46 } }, { ...actual, total: { inputTokens: 304, outputTokens: 47 } },
    { ...actual, total: null }, { ...actual, analysis: null }, { ...actual, reconstruction: null },
    { ...actual, total: { inputTokens: 20_000_001, outputTokens: 46 } }, { ...actual, extra: 1 },
    { analysis: first, reconstruction: second }, { ...actual, analysis: undefined }, Object.create(actual) as unknown,
  ])('rejects inconsistent or malformed internal aggregate %j', value => {
    expect(() => validateSketchCodeUsage(value)).toThrow('SKETCH_USAGE_INVALID');
  });
  it.each(['analysis', 'reconstruction', 'total'])('rejects aggregate %s accessor without invocation', field => {
    let invoked = 0; const value = { ...actual };
    Object.defineProperty(value, field, { get: () => { invoked++; return first; } });
    expect(() => validateSketchCodeUsage(value)).toThrow('SKETCH_USAGE_INVALID'); expect(invoked).toBe(0);
  });
});
