import { dbGetSystemSetting, dbSetSystemSetting } from '@/lib/db-storage';

export const CREDIT_PRICING_CONFIG_KEY = 'credit_pricing_config';

// LLM 模型 Token 计费价格（单位：积分 / 1M tokens）
export interface TokenCreditPricing {
  /** 输入（prompt）每 1M tokens 积分 */
  input: number;
  /** 输出（completion）每 1M tokens 积分 */
  output: number;
}

export interface ModelCreditEntry {
  /** 基础积分（Token 计费模型作为兜底/预扣价格） */
  credits: number;
  quality?: Record<string, number>;
  resolution?: Record<string, number>;
  /** Token 计费价格（可选，仅 LLM 模型，按实际 usage 结算） */
  tokenPricing?: TokenCreditPricing;
}

export interface CreditPricingConfig {
  modelCredits: Record<string, number | ModelCreditEntry>;
  updatedAt?: number;
}

const EMPTY_CONFIG: CreditPricingConfig = { modelCredits: {} };

function normalizeCreditPriceValue(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
    return Number.NaN;
  }
  return Number(value);
}

function normalizeSingleEntry(model: string, value: unknown): number | ModelCreditEntry {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 100_000) {
      throw new Error(`Invalid credit price for model: ${model}`);
    }
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const credits = normalizeCreditPriceValue(obj.credits);
    if (!Number.isInteger(credits) || credits < 0 || credits > 100_000) {
      throw new Error(`Invalid credit price for model: ${model}`);
    }
    const entry: ModelCreditEntry = { credits };
    if (obj.quality && typeof obj.quality === 'object' && !Array.isArray(obj.quality)) {
      const quality: Record<string, number> = {};
      for (const [q, v] of Object.entries(obj.quality as Record<string, unknown>)) {
        const n = normalizeCreditPriceValue(v);
        if (!q.trim() || !Number.isInteger(n) || n < 0 || n > 100_000) {
          throw new Error(`Invalid quality credit for model ${model}: ${q}`);
        }
        quality[q.trim()] = n;
      }
      if (Object.keys(quality).length > 0) entry.quality = quality;
    }
    if (obj.resolution && typeof obj.resolution === 'object' && !Array.isArray(obj.resolution)) {
      const resolution: Record<string, number> = {};
      for (const [r, v] of Object.entries(obj.resolution as Record<string, unknown>)) {
        const n = normalizeCreditPriceValue(v);
        if (!r.trim() || !Number.isInteger(n) || n < 0 || n > 100_000) {
          throw new Error(`Invalid resolution credit for model ${model}: ${r}`);
        }
        resolution[r.trim()] = n;
      }
      if (Object.keys(resolution).length > 0) entry.resolution = resolution;
    }
    if (obj.tokenPricing && typeof obj.tokenPricing === 'object' && !Array.isArray(obj.tokenPricing)) {
      const tp = obj.tokenPricing as Record<string, unknown>;
      const inputRate = normalizeCreditPriceValue(tp.input);
      const outputRate = normalizeCreditPriceValue(tp.output);
      if (
        !Number.isInteger(inputRate) || inputRate <= 0 || inputRate > 10_000_000 ||
        !Number.isInteger(outputRate) || outputRate <= 0 || outputRate > 10_000_000
      ) {
        throw new Error(`Invalid token pricing for model ${model}`);
      }
      entry.tokenPricing = { input: inputRate, output: outputRate };
    }
    return entry;
  }
  throw new Error(`Invalid credit price for model: ${model}`);
}

function normalizeModelCredits(value: unknown): Record<string, number | ModelCreditEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const normalized: Record<string, number | ModelCreditEntry> = {};
  for (const [model, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!model.trim()) continue;
    normalized[model.trim()] = normalizeSingleEntry(model.trim(), raw);
  }
  return normalized;
}

export function parseCreditPricingConfig(raw: unknown): CreditPricingConfig {
  if (!raw) return { ...EMPTY_CONFIG };

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      modelCredits: normalizeModelCredits((parsed as CreditPricingConfig).modelCredits),
      updatedAt: Number((parsed as CreditPricingConfig).updatedAt) || undefined,
    };
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

export async function loadCreditPricingConfig(): Promise<CreditPricingConfig> {
  return parseCreditPricingConfig(await dbGetSystemSetting(CREDIT_PRICING_CONFIG_KEY));
}

export async function saveCreditPricingConfig(input: Pick<CreditPricingConfig, 'modelCredits'>): Promise<CreditPricingConfig> {
  const config: CreditPricingConfig = {
    modelCredits: normalizeModelCredits(input.modelCredits),
    updatedAt: Date.now(),
  };
  await dbSetSystemSetting(CREDIT_PRICING_CONFIG_KEY, JSON.stringify(config));
  return config;
}

/**
 * Build a compound key for provider-specific model pricing.
 * Format: "providerId::model" — allows same model from different providers to have different prices.
 */
export function buildPricingKey(providerId: string | undefined, model: string): string {
  if (!providerId || !model) return model || '';
  return `${providerId}::${model}`;
}

/** Resolve the configured credit cost for a model, optionally with quality tier and resolution. */
export function resolveConfiguredCreditCost(
  config: CreditPricingConfig,
  model: string,
  quality: string | undefined,
  resolution: string | undefined,
  fallback: number,
  providerId?: string,
): number {
  if (!model) return fallback;

  // Try provider-specific key first: "providerId::model"
  if (providerId) {
    const compoundKey = buildPricingKey(providerId, model);
    const compoundEntry = config.modelCredits[compoundKey];
    if (compoundEntry !== undefined) {
      if (typeof compoundEntry === 'number') return compoundEntry;
      if (quality && compoundEntry.quality?.[quality] !== undefined) return compoundEntry.quality[quality];
      if (resolution && compoundEntry.resolution?.[resolution] !== undefined) return compoundEntry.resolution[resolution];
      return compoundEntry.credits;
    }
  }

  // Fall back to model-only key (backward compatibility)
  const entry = config.modelCredits[model];
  if (entry === undefined) return fallback;

  // Flat number entry
  if (typeof entry === 'number') return entry;

  // ModelCreditEntry with optional quality tiers
  if (quality && entry.quality?.[quality] !== undefined) {
    return entry.quality[quality];
  }

  // ModelCreditEntry with optional resolution tiers
  if (resolution && entry.resolution?.[resolution] !== undefined) {
    return entry.resolution[resolution];
  }

  return entry.credits;
}

/**
 * 解析模型的 Token 计费价格（积分 / 1M tokens）。
 * 与 resolveCreditsFromConfig 同样的键优先级：providerId::model > model。
 * 未配置 tokenPricing 时返回 null（调用方回退到按次计费）。
 */
export function resolveTokenPricingFromConfig(
  config: CreditPricingConfig,
  model: string,
  providerId?: string
): TokenCreditPricing | null {
  const findEntry = (key: string): TokenCreditPricing | null => {
    const entry = config.modelCredits[key];
    if (!entry || typeof entry === 'number') return null;
    return entry.tokenPricing || null;
  };

  if (providerId) {
    const scoped = findEntry(`${providerId}::${model}`);
    if (scoped) return scoped;
  }
  return findEntry(model);
}
