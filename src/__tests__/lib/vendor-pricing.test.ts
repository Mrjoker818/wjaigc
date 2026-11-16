import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbGetSystemSetting, findProviderById } = vi.hoisted(() => ({
  dbGetSystemSetting: vi.fn(),
  findProviderById: vi.fn(),
}));

vi.mock('@/lib/db-storage', () => ({ dbGetSystemSetting, dbSetSystemSetting: vi.fn() }));
vi.mock('@/lib/server-api-config', () => ({ findProviderById }));

import { calculateConfiguredCreditCost } from '@/lib/credits';
import { VENDOR_PRICES, getVendorPrice, vendorCreditCost } from '@/lib/vendor-pricing';

const PROVIDERS: Record<string, { id: string; baseUrl: string }> = {
  apib: { id: 'apib', baseUrl: 'https://api.apimart.ai/v1' },
  pear: { id: 'pear', baseUrl: 'https://api.pearapi.ai/v1' },
  other: { id: 'other', baseUrl: 'https://example.com/v1' },
};

describe('vendor pricing', () => {
  beforeEach(() => {
    dbGetSystemSetting.mockReset();
    dbGetSystemSetting.mockResolvedValue(null);
    findProviderById.mockReset();
    findProviderById.mockImplementation(async (id: string) => PROVIDERS[id] ?? null);
  });

  it('charges the vendor price in CNY × 1.01, rounded up to whole credits', () => {
    expect(vendorCreditCost({ currency: 'CNY', unit: 'call', price: 1 })).toBe(101);
    expect(vendorCreditCost({ currency: 'CNY', unit: 'call', price: 0.032 })).toBe(4);
    // ¥0.32/s × 5 s × 1.01 = ¥1.616
    expect(vendorCreditCost({ currency: 'CNY', unit: 'second', price: 0.32 })).toBe(162);
    expect(vendorCreditCost({ currency: 'CNY', unit: 'second', price: 0.32 }, { durationSeconds: 10 })).toBe(324);
    // $0.0085 × 7.3 × 1.01 = ¥0.0627
    expect(vendorCreditCost({ currency: 'USD', unit: 'call', price: 0.0085 })).toBe(7);
  });

  it('looks up the price by provider family and lowercase model id', () => {
    expect(getVendorPrice('pear', 'Image-Layered')).toEqual({ currency: 'CNY', unit: 'call', price: 0.3 });
    expect(getVendorPrice('apib', 'gpt-image-2')?.tiers).toEqual({ '1K': 0.0085, '2K': 0.015, '4K': 0.022 });
    expect(getVendorPrice('302', 'gpt-image-2')).toBeUndefined();
    for (const entry of Object.values(VENDOR_PRICES)) expect(entry.price).toBeGreaterThan(0);
  });

  it('prices Pear and APIMart requests from the vendor table with resolution tiers and duration', async () => {
    await expect(calculateConfiguredCreditCost('image_generate', 'gpt-image-2', { providerId: 'pear' })).resolves.toBe(4);
    await expect(calculateConfiguredCreditCost('segment', 'Image-Layered', { providerId: 'pear' })).resolves.toBe(31);
    await expect(calculateConfiguredCreditCost('image_generate', 'gpt-image-2', { providerId: 'apib', resolution: '2K' })).resolves.toBe(12);
    await expect(calculateConfiguredCreditCost('image_generate', 'gpt-image-2', { providerId: 'apib', resolution: '4k' })).resolves.toBe(17);
    // Flux 档位按百万像素：2K 映射到 4MP（$0.06）
    await expect(calculateConfiguredCreditCost('image_generate', 'flux-2-pro', { providerId: 'apib', resolution: '2K' })).resolves.toBe(45);
    // $0.142/s × 7.3 × 5 s × 1.01
    await expect(calculateConfiguredCreditCost('video_generate', 'seedance-2.0', { providerId: 'apib', resolution: '720p' })).resolves.toBe(524);
    await expect(calculateConfiguredCreditCost('video_generate', 'seedance-2.0', { providerId: 'apib', resolution: '480p' })).resolves.toBe(244);
  });

  it('charges the sound tier when audio is on and the 2K tier for Pear minimax-h3', async () => {
    // kling-v3-omni 1080P：pro $0.0896/s，pro-sound $0.112/s；× 7.3 × 5 s × 1.01
    await expect(calculateConfiguredCreditCost('video_generate', 'kling-v3-omni', { providerId: 'apib', resolution: '1080p' })).resolves.toBe(331);
    await expect(calculateConfiguredCreditCost('video_generate', 'kling-v3-omni', { providerId: 'apib', resolution: '1080p', audio: true })).resolves.toBe(413);
    await expect(calculateConfiguredCreditCost('video_generate', 'kling-v3-omni', { providerId: 'apib', resolution: '720p', audio: true })).resolves.toBe(331);
    // 未指定清晰度按默认 std 档的有声价 $0.0896/s
    await expect(calculateConfiguredCreditCost('video_generate', 'kling-v3-omni', { providerId: 'apib', audio: true })).resolves.toBe(331);
    await expect(calculateConfiguredCreditCost('video_generate', 'kling-v3-omni', { providerId: 'apib', resolution: '4k', audio: true })).resolves.toBe(1580);
    // 不区分声音的模型开声音不加价
    await expect(calculateConfiguredCreditCost('video_generate', 'seedance-2.0', { providerId: 'apib', resolution: '720p', audio: true })).resolves.toBe(524);
    // Pear minimax-h3：768P ¥0.2/s，2K ¥0.29/s
    await expect(calculateConfiguredCreditCost('video_generate', 'minimax-h3', { providerId: 'pear', resolution: '768P' })).resolves.toBe(101);
    await expect(calculateConfiguredCreditCost('video_generate', 'minimax-h3', { providerId: 'pear', resolution: '2K', durationSeconds: 10 })).resolves.toBe(293);
  });

  it('keeps provider-scoped admin prices first and falls back for other providers', async () => {
    dbGetSystemSetting.mockResolvedValue(JSON.stringify({ modelCredits: { 'pear::gpt-image-2': 9, 'gpt-image-2': 50 } }));
    await expect(calculateConfiguredCreditCost('image_generate', 'gpt-image-2', { providerId: 'pear' })).resolves.toBe(9);
    await expect(calculateConfiguredCreditCost('image_generate', 'gpt-image-2', { providerId: 'apib' })).resolves.toBe(7);
    await expect(calculateConfiguredCreditCost('image_generate', 'gpt-image-2', { providerId: 'other' })).resolves.toBe(50);

    findProviderById.mockRejectedValueOnce(new Error('db down'));
    await expect(calculateConfiguredCreditCost('image_generate', 'gpt-image-2', { providerId: 'apib' })).resolves.toBe(50);
  });
});
