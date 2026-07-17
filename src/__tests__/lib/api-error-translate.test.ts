import { describe, expect, it } from 'vitest';

import { translateApiError } from '@/lib/api-error-translate';

describe('translateApiError', () => {
  it('distinguishes an upstream pricing or mapping configuration error from an aspect ratio error', () => {
    expect(translateApiError('ratio or price not configured for this model'))
      .toBe('当前供应商尚未配置该模型的价格或规格映射，请联系管理员检查模型配置');
  });

  it('keeps a genuine aspect-ratio rejection actionable for the user', () => {
    expect(translateApiError('invalid aspect ratio: 21:9'))
      .toBe('当前模型不支持此画面比例，请尝试切换到标准比例');
  });
});
