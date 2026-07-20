import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbGetSystemSetting, dbSetSystemSetting } = vi.hoisted(() => ({
  dbGetSystemSetting: vi.fn(),
  dbSetSystemSetting: vi.fn(),
}));

vi.mock('@/lib/db-storage', () => ({ dbGetSystemSetting, dbSetSystemSetting }));

import {
  loadCreditPricingConfig,
  resolveConfiguredCreditCost,
  saveCreditPricingConfig,
} from '@/lib/credit-pricing';
import { calculateConfiguredCreditCost } from '@/lib/credits';

describe('credit pricing configuration', () => {
  beforeEach(() => {
    dbGetSystemSetting.mockReset();
    dbSetSystemSetting.mockReset();
  });

  it('uses a persisted per-model rule before the static fallback', async () => {
    dbGetSystemSetting.mockResolvedValue(JSON.stringify({
      modelCredits: { 'gemini-3.1-flash-image-preview': 66 },
    }));

    const config = await loadCreditPricingConfig();
    expect(resolveConfiguredCreditCost(config, 'gemini-3.1-flash-image-preview', undefined, undefined, 12)).toBe(66);
    expect(resolveConfiguredCreditCost(config, 'unknown-model', undefined, undefined, 12)).toBe(12);
  });

  it('rejects invalid model prices instead of persisting malformed values', async () => {
    await expect(saveCreditPricingConfig({
      modelCredits: { 'gpt-image-1.5': -5 },
    })).rejects.toThrow('Invalid credit price');
    expect(dbSetSystemSetting).not.toHaveBeenCalled();
  });

  it('treats a configured video price as per-second without multiplying the fallback twice', async () => {
    dbGetSystemSetting.mockResolvedValue(JSON.stringify({ modelCredits: { 'kling-v3': 7 } }));
    await expect(calculateConfiguredCreditCost('video_generate', 'kling-v3', { durationSeconds: 5 })).resolves.toBe(35);

    dbGetSystemSetting.mockResolvedValue(null);
    await expect(calculateConfiguredCreditCost('video_generate', 'kling-v3', { durationSeconds: 5 })).resolves.toBe(150);
  });
});
