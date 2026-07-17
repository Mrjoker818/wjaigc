import { dbGetSystemSetting, dbSetSystemSetting } from '@/lib/db-storage';

export const CREDIT_PRICING_CONFIG_KEY = 'credit_pricing_config';

export interface CreditPricingConfig {
  modelCredits: Record<string, number>;
  updatedAt?: number;
}

const EMPTY_CONFIG: CreditPricingConfig = { modelCredits: {} };

function normalizeModelCredits(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const normalized: Record<string, number> = {};
  for (const [model, credits] of Object.entries(value as Record<string, unknown>)) {
    const numeric = Number(credits);
    if (!model.trim() || !Number.isInteger(numeric) || numeric < 0 || numeric > 100_000) {
      throw new Error(`Invalid credit price for model: ${model}`);
    }
    normalized[model.trim()] = numeric;
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

export function resolveConfiguredCreditCost(config: CreditPricingConfig, model: string, fallback: number): number {
  if (!model) return fallback;
  const configured = config.modelCredits[model];
  return Number.isInteger(configured) && configured >= 0 ? configured : fallback;
}
