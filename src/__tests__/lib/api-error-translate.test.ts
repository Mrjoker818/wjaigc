import { describe, expect, it } from 'vitest';

import { toUserFacingError, translateApiError } from '@/lib/api-error-translate';

describe('translateApiError', () => {
  it('distinguishes an upstream pricing or mapping configuration error from an aspect ratio error', () => {
    expect(translateApiError('ratio or price not configured for this model'))
      .toBe('当前供应商尚未配置该模型的价格或规格映射，请联系管理员检查模型配置');
  });

  it('keeps a genuine aspect-ratio rejection actionable for the user', () => {
    expect(translateApiError('invalid aspect ratio: 21:9'))
      .toBe('当前模型不支持此画面比例，请尝试切换到标准比例');
  });
  it('keeps provider text for internal callers but hides it from the user-facing message', () => {
    expect(translateApiError('Unexpected token < in JSON')).toBe('API 返回错误: Unexpected token < in JSON');
    expect(toUserFacingError('Unexpected token < in JSON')).toBe('服务暂时出错，请稍后重试或切换模型');
    expect(toUserFacingError('{"code":"E1001"}')).toBe('服务暂时出错，请稍后重试或切换模型');
    expect(toUserFacingError('rate limit exceeded')).toBe('请求过于频繁，请稍后再试');
    expect(toUserFacingError('参考图数量超过模型上限')).toBe('参考图数量超过模型上限');
  });
});
