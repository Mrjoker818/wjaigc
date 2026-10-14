import type { SketchImageInput } from './image-contract';
import { resolveTokenPricingFromConfig, type TokenCreditPricing } from '@/lib/credit-pricing';
import { calculateConfiguredCreditCost, calculateTokenCredits, type TokenUsage } from '@/lib/credits';
import { copySketchPricingConfig } from './token-billing';
import { parseSketchTokenUsage } from './usage';

export type SketchImagePricingSelection = Pick<SketchImageInput,
  'visionProviderId' | 'visionModelId' | 'imageProviderId' | 'imageModelId' | 'quality' | 'size'>;
interface ModelPrice { readonly providerId: string; readonly modelId: string; readonly calls: 1 }
export interface SketchImagePricing {
  readonly version: 1;
  readonly vision: Readonly<ModelPrice & { mode: 'flat' | 'token'; reserveCredits: number; tokenPricing?: Readonly<TokenCreditPricing> }>;
  readonly image: Readonly<ModelPrice & { credits: number }>;
  readonly totalReserveCredits: number;
}
export interface SketchImageSettlement {
  readonly version: 1; readonly reserveCredits: number; readonly visionCredits: number;
  readonly imageCredits: number; readonly actualCredits: number; readonly deltaCredits: number;
  readonly usage?: Readonly<TokenUsage>;
}
function invalid(): never { throw new Error('SKETCH_IMAGE_PRICING_INVALID'); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !fields.includes(key) || !property || !('value' in property) || !property.enumerable) invalid();
    copy[key] = property.value as unknown;
  }
  return copy;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 256 || /\p{Cc}/u.test(value)) invalid();
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
/** Pure quotation only: neither this snapshot nor a settlement candidate grants
 * permission to charge, refund, submit a provider call or publish an asset. */
export async function quoteSketchImagePricing(selection: SketchImagePricingSelection, config: unknown): Promise<Readonly<SketchImagePricing>> {
  const raw = record(selection, ['visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId', 'quality', 'size']);
  const visionProviderId = id(raw.visionProviderId), visionModelId = id(raw.visionModelId);
  const imageProviderId = id(raw.imageProviderId), imageModelId = id(raw.imageModelId);
  const quality = Object.hasOwn(raw, 'quality') ? id(raw.quality) : undefined;
  const size = Object.hasOwn(raw, 'size') ? id(raw.size) : undefined;
  const frozenConfig = copySketchPricingConfig(config);
  // A provider entry is a complete price decision, including explicit flat/free.
  // Restrict the shared token resolver's fallback to that entry when present.
  const scopedKey = `${visionProviderId}::${visionModelId}`;
  const visionConfig = Object.hasOwn(frozenConfig.modelCredits, scopedKey)
    ? { modelCredits: { [visionModelId]: frozenConfig.modelCredits[scopedKey] } } : frozenConfig;
  const tokenPricing = resolveTokenPricingFromConfig(visionConfig, visionModelId, visionProviderId);
  const base = integer(await calculateConfiguredCreditCost('chat', visionModelId,
    { providerId: visionProviderId, pricingConfig: visionConfig }), 0, 100_000);
  const imageCredits = integer(await calculateConfiguredCreditCost('image_generate', imageModelId,
    { providerId: imageProviderId, quality, resolution: size, pricingConfig: frozenConfig }), 0, 100_000);
  const reserveCredits = tokenPricing ? Math.max(1, base) : base;
  return parseSketchImagePricing({ version: 1,
    vision: { providerId: visionProviderId, modelId: visionModelId, calls: 1, mode: tokenPricing ? 'token' : 'flat',
      reserveCredits, ...(tokenPricing ? { tokenPricing } : {}) },
    image: { providerId: imageProviderId, modelId: imageModelId, calls: 1, credits: imageCredits },
    totalReserveCredits: reserveCredits + imageCredits });
}
export function parseSketchImagePricing(value: unknown): Readonly<SketchImagePricing> {
  const raw = record(value, ['version', 'vision', 'image', 'totalReserveCredits']);
  const vision = record(raw.vision, ['providerId', 'modelId', 'calls', 'mode', 'reserveCredits', 'tokenPricing']);
  const image = record(raw.image, ['providerId', 'modelId', 'calls', 'credits']);
  if (raw.version !== 1 || Object.keys(raw).length !== 4 || vision.calls !== 1 || image.calls !== 1
    || Object.keys(image).length !== 4 || (vision.mode !== 'flat' && vision.mode !== 'token')) invalid();
  const isToken = vision.mode === 'token';
  if (Object.keys(vision).length !== (isToken ? 6 : 5) || Object.hasOwn(vision, 'tokenPricing') !== isToken) invalid();
  const reserveCredits = integer(vision.reserveCredits, isToken ? 1 : 0, 100_000);
  const credits = integer(image.credits, 0, 100_000);
  const totalReserveCredits = integer(raw.totalReserveCredits, 0, 200_000);
  if (totalReserveCredits !== reserveCredits + credits) invalid();
  let tokenPricing: Readonly<TokenCreditPricing> | undefined;
  if (isToken) {
    const rates = record(vision.tokenPricing, ['input', 'output']);
    tokenPricing = Object.freeze({ input: integer(rates.input, 1, 10_000_000), output: integer(rates.output, 1, 10_000_000) });
  }
  return Object.freeze({ version: 1,
    vision: Object.freeze({ providerId: id(vision.providerId), modelId: id(vision.modelId), calls: 1,
      mode: isToken ? 'token' : 'flat', reserveCredits, ...(tokenPricing ? { tokenPricing } : {}) }),
    image: Object.freeze({ providerId: id(image.providerId), modelId: id(image.modelId), calls: 1, credits }), totalReserveCredits });
}
export function quoteSketchImageSettlement(pricing: unknown, usage?: unknown): Readonly<SketchImageSettlement> {
  const frozen = parseSketchImagePricing(pricing);
  let counters: Readonly<TokenUsage> | undefined;
  if (usage !== undefined || frozen.vision.mode === 'token') {
    try { counters = parseSketchTokenUsage(usage); }
    catch { throw new Error('SKETCH_IMAGE_USAGE_INVALID'); }
  }
  const visionCredits = frozen.vision.mode === 'token'
    ? calculateTokenCredits(counters!, frozen.vision.tokenPricing!) : frozen.vision.reserveCredits;
  const actualCredits = integer(visionCredits + frozen.image.credits, 0, 200_100_000);
  return Object.freeze({ version: 1, reserveCredits: frozen.totalReserveCredits, visionCredits, imageCredits: frozen.image.credits,
    actualCredits, deltaCredits: actualCredits - frozen.totalReserveCredits, ...(counters ? { usage: counters } : {}) });
}
