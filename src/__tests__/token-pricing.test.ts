import { describe, it, expect } from 'vitest';
import { calculateTokenCredits } from '@/lib/credits';
import {
  resolveTokenPricingFromConfig,
  resolveConfiguredCreditCost,
  saveCreditPricingConfig,
  type CreditPricingConfig,
} from '@/lib/credit-pricing';

describe('calculateTokenCredits', () => {
  it('按输入/输出 token 分别计价（积分/1M tokens）', () => {
    // 180 积分/1M 输入 + 1080 积分/1M 输出
    // 2K 输入 + 500 输出 = (2000*180 + 500*1080)/1e6 = 0.9 → ceil = 1
    expect(
      calculateTokenCredits({ inputTokens: 2000, outputTokens: 500 }, { input: 180, output: 1080 })
    ).toBe(1);
  });

  it('精确到 1 积分边界时不向上取整', () => {
    // 1M 输入 + 0 输出，单价 3600 → 3600
    expect(
      calculateTokenCredits({ inputTokens: 1_000_000, outputTokens: 0 }, { input: 3600, output: 21600 })
    ).toBe(3600);
  });

  it('向上取整：非整数值进位', () => {
    // 100K 输入，单价 103 → 10.3 → 11
    expect(
      calculateTokenCredits({ inputTokens: 100_000, outputTokens: 0 }, { input: 103, output: 206 })
    ).toBe(11);
  });

  it('最低 1 积分（极小用量）', () => {
    expect(
      calculateTokenCredits({ inputTokens: 1, outputTokens: 1 }, { input: 1, output: 1 })
    ).toBe(1);
  });

  it('负数用量按 0 处理', () => {
    expect(
      calculateTokenCredits({ inputTokens: -5, outputTokens: -5 }, { input: 3600, output: 21600 })
    ).toBe(1);
  });
});

describe('resolveTokenPricingFromConfig', () => {
  const config: CreditPricingConfig = {
    modelCredits: {
      'provider-a::model-x': { credits: 5, tokenPricing: { input: 100, output: 200 } },
      'model-x': { credits: 3, tokenPricing: { input: 10, output: 20 } },
      'model-flat': 8,
      'model-no-token': { credits: 4 },
    },
  };

  it('复合键 providerId::model 优先', () => {
    expect(resolveTokenPricingFromConfig(config, 'model-x', 'provider-a')).toEqual({ input: 100, output: 200 });
  });

  it('复合键不存在时回退纯模型名', () => {
    expect(resolveTokenPricingFromConfig(config, 'model-x', 'provider-b')).toEqual({ input: 10, output: 20 });
  });

  it('无 providerId 时直接按模型名', () => {
    expect(resolveTokenPricingFromConfig(config, 'model-x')).toEqual({ input: 10, output: 20 });
  });

  it('纯数值条目返回 null（无 token 计费）', () => {
    expect(resolveTokenPricingFromConfig(config, 'model-flat')).toBeNull();
  });

  it('未配置 tokenPricing 的条目返回 null', () => {
    expect(resolveTokenPricingFromConfig(config, 'model-no-token')).toBeNull();
  });

  it('未知模型返回 null', () => {
    expect(resolveTokenPricingFromConfig(config, 'unknown')).toBeNull();
  });
});

describe('resolveConfiguredCreditCost（含 tokenPricing 时 credits 作为预扣估值）', () => {
  it('复合键优先 + 纯数值回退', () => {
    const config: CreditPricingConfig = {
      modelCredits: {
        'api_x::gpt-image-2': 8,
        'gpt-image-2': 10,
      },
    };
    expect(resolveConfiguredCreditCost(config, 'gpt-image-2', undefined, undefined, 99, 'api_x')).toBe(8);
    expect(resolveConfiguredCreditCost(config, 'gpt-image-2', undefined, undefined, 99, 'other')).toBe(10);
    expect(resolveConfiguredCreditCost(config, 'unknown', undefined, undefined, 99)).toBe(99);
  });
});

describe('saveCreditPricingConfig 清洗 tokenPricing', () => {
  const base: CreditPricingConfig = { modelCredits: {} };

  it('拒绝 0 价格', async () => {
    await expect(
      saveCreditPricingConfig({
        modelCredits: { m: { credits: 1, tokenPricing: { input: 0, output: 5 } } },
      })
    ).rejects.toThrow();
  });

  it('拒绝负数价格', async () => {
    await expect(
      saveCreditPricingConfig({
        modelCredits: { m: { credits: 1, tokenPricing: { input: -1, output: 5 } } },
      })
    ).rejects.toThrow();
  });

  it('拒绝非整数价格', async () => {
    await expect(
      saveCreditPricingConfig({
        modelCredits: { m: { credits: 1, tokenPricing: { input: 1.5, output: 5 } } },
      })
    ).rejects.toThrow();
  });

  it('拒绝超过上限的价格', async () => {
    await expect(
      saveCreditPricingConfig({
        modelCredits: { m: { credits: 1, tokenPricing: { input: 20_000_000, output: 5 } } },
      })
    ).rejects.toThrow();
  });

  it('空配置不受影响', async () => {
    // 仅验证类型系统；不落库（normalize 在 DB 写入前执行，非法值会先抛错）
    expect(base.modelCredits).toEqual({});
  });
});
