import type { TokenUsage } from '@/lib/credits';

export interface SketchStageResponse {
  readonly content: string;
  readonly usage?: Readonly<TokenUsage>;
}
export interface SketchCodeUsage {
  readonly analysis: Readonly<TokenUsage> | null;
  readonly reconstruction: Readonly<TokenUsage> | null;
  readonly total: Readonly<TokenUsage> | null;
}

const MAX_PHASE_TOKENS = 10_000_000;
const MAX_TOTAL_TOKENS = 20_000_000;
function invalid(): never { throw new Error('SKETCH_USAGE_INVALID'); }

/** Copy own data descriptors only. Provider vendor fields may be ignored. */
function dataRecord(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)
      || fields && !fields.includes(key) || !descriptor || !('value' in descriptor)) invalid();
    copy[key] = descriptor.value as unknown;
  }
  return copy;
}
function tokenCount(value: unknown, limit: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > limit) invalid();
  return value;
}
function counts(value: unknown, limit: number): Readonly<TokenUsage> {
  const raw = dataRecord(value, ['inputTokens', 'outputTokens']);
  return Object.freeze({ inputTokens: tokenCount(raw.inputTokens, limit), outputTokens: tokenCount(raw.outputTokens, limit) });
}
export function parseSketchTokenUsage(value: unknown): Readonly<TokenUsage> {
  return counts(value, MAX_PHASE_TOKENS);
}
/** Supplied usage must contain the two declared chat-completions counters. */
export function parseSketchProviderUsage(value: unknown): Readonly<TokenUsage> {
  const raw = dataRecord(value);
  const inputTokens = tokenCount(raw.prompt_tokens, MAX_PHASE_TOKENS);
  const outputTokens = tokenCount(raw.completion_tokens, MAX_PHASE_TOKENS);
  if (Object.hasOwn(raw, 'total_tokens') && tokenCount(raw.total_tokens, MAX_TOTAL_TOKENS) !== inputTokens + outputTokens) invalid();
  return Object.freeze({ inputTokens, outputTokens });
}
export function normalizeSketchStageResponse(value: unknown): Readonly<SketchStageResponse> {
  if (typeof value === 'string') return Object.freeze({ content: value });
  const raw = dataRecord(value, ['content', 'usage']);
  if (typeof raw.content !== 'string') invalid();
  return Object.freeze({ content: raw.content, ...(Object.hasOwn(raw, 'usage') ? { usage: parseSketchTokenUsage(raw.usage) } : {}) });
}
function sum(analysis: Readonly<TokenUsage> | null, reconstruction: Readonly<TokenUsage> | null): Readonly<TokenUsage> | null {
  if (!analysis || !reconstruction) return null;
  return Object.freeze({ inputTokens: tokenCount(analysis.inputTokens + reconstruction.inputTokens, MAX_TOTAL_TOKENS),
    outputTokens: tokenCount(analysis.outputTokens + reconstruction.outputTokens, MAX_TOTAL_TOKENS) });
}
export function aggregateSketchUsage(analysis: Readonly<TokenUsage> | null, reconstruction: Readonly<TokenUsage> | null): Readonly<SketchCodeUsage> | undefined {
  if (analysis === null && reconstruction === null) return undefined;
  const a = analysis === null ? null : parseSketchTokenUsage(analysis);
  const r = reconstruction === null ? null : parseSketchTokenUsage(reconstruction);
  return Object.freeze({ analysis: a, reconstruction: r, total: sum(a, r) });
}
export function validateSketchCodeUsage(value: unknown): Readonly<SketchCodeUsage> {
  const raw = dataRecord(value, ['analysis', 'reconstruction', 'total']);
  const analysis = raw.analysis === null ? null : parseSketchTokenUsage(raw.analysis);
  const reconstruction = raw.reconstruction === null ? null : parseSketchTokenUsage(raw.reconstruction);
  const total = sum(analysis, reconstruction);
  if (total === null) { if (raw.total !== null) invalid(); }
  else {
    const supplied = counts(raw.total, MAX_TOTAL_TOKENS);
    if (supplied.inputTokens !== total.inputTokens || supplied.outputTokens !== total.outputTokens) invalid();
  }
  return Object.freeze({ analysis, reconstruction, total });
}
