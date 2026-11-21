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
  it('reports an unreachable reference image URL instead of a missing editing feature', () => {
    const expected = '供应商无法读取参考图片地址，请确认服务已配置公网媒体链接或对象存储后重试';
    expect(translateApiError('image_urls[0]: Only http/https URLs or asset:// references are supported')).toBe(expected);
    expect(translateApiError('media_url 必须是有效的 HTTP(S) URL')).toBe(expected);
    expect(translateApiError('image_urls is not supported by this model')).toBe('当前模型不支持图像编辑功能，请尝试切换模型');
  });
  it('keeps provider text for internal callers but hides it from the user-facing message', () => {
    expect(translateApiError('Unexpected token < in JSON')).toBe('API 返回错误: Unexpected token < in JSON');
    expect(toUserFacingError('Unexpected token < in JSON')).toBe('服务暂时出错，请稍后重试或切换模型');
    expect(toUserFacingError('{"code":"E1001"}')).toBe('服务暂时出错，请稍后重试或切换模型');
    expect(toUserFacingError('rate limit exceeded')).toBe('请求过于频繁，请稍后再试');
    expect(toUserFacingError('参考图数量超过模型上限')).toBe('参考图数量超过模型上限');
  });
  it.each([
    '{"error":"供应商失败","token":"synthetic-private-value"}',
    '请求失败，内部令牌为 synthetic-private-value',
    '错误详情 https://provider.invalid/private?api_key=synthetic-private-value',
    '上游异常 <html>synthetic-private-value</html>',
  ])('never echoes an unrecognized mixed-language upstream payload: %s', raw => {
    expect(toUserFacingError(raw)).toBe('服务暂时出错，请稍后重试或切换模型');
    expect(translateApiError(raw)).toContain('synthetic-private-value');
  });
});
