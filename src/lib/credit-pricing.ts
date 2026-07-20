import { dbGetSystemSetting, dbSetSystemSetting } from '@/lib/db-storage';

export const CREDIT_PRICING_CONFIG_KEY = 'credit_pricing_config';

export interface ModelCreditEntry {
  credits: number;
  quality?: Record<string, number>;
  resolution?: Record<string, number>;
}

export interface CreditPricingConfig {
  modelCredits: Record<string, number | ModelCreditEntry>;
  updatedAt?: number;
}

const EMPTY_CONFIG: CreditPricingConfig = { modelCredits: {} };

function normalizeSingleEntry(model: string, value: unknown): number | ModelCreditEntry {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 100_000) {
      throw new Error(`Invalid credit price for model: ${model}`);
    }
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const credits = Number(obj.credits);
    if (!Number.isInteger(credits) || credits < 0 || credits > 100_000) {
      throw new Error(`Invalid credit price for model: ${model}`);
    }
    const entry: ModelCreditEntry = { credits };
    if (obj.quality && typeof obj.quality === 'object' && !Array.isArray(obj.quality)) {
      const quality: Record<string, number> = {};
      for (const [q, v] of Object.entries(obj.quality as Record<string, unknown>)) {
        const n = Number(v);
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
        const n = Number(v);
        if (!r.trim() || !Number.isInteger(n) || n < 0 || n > 100_000) {
          throw new Error(`Invalid resolution credit for model ${model}: ${r}`);
        }
        resolution[r.trim()] = n;
      }
      if (Object.keys(resolution).length > 0) entry.resolution = resolution;
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

export async function loadCreditPricingConfig(): Promise<CreditPricingConfig> {
  const raw = await dbGetSystemSetting(CREDIT_PRICING_CONFIG_KEY);
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

export async function saveCreditPricingConfig(input: Pick<CreditPricingConfig, 'modelCredits'>): Promise<CreditPricingConfig> {
  const config: CreditPricingConfig = {
    modelCredits: normalizeModelCredits(input.modelCredits),
    updatedAt: Date.now(),
  };
  await dbSetSystemSetting(CREDIT_PRICING_CONFIG_KEY, JSON.stringify(config));
  return config;
}

/** Resolve the configured credit cost for a model, optionally with quality tier and resolution. */
export function resolveConfiguredCreditCost(
  config: CreditPricingConfig,
  model: string,
  quality: string | undefined,
  resolution: string | undefined,
  fallback: number,
): number {
  if (!model) return fallback;
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
