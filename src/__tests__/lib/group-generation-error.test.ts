import { describe, expect, it } from 'vitest';

import { getGroupGenerationFailureMessage } from '@/lib/group-generation-error';

describe('group generation failure message', () => {
  it('keeps the first actionable provider error instead of replacing it with a generic message', () => {
    expect(getGroupGenerationFailureMessage([
      { status: 'failed', error: '当前模型不支持图生图参考图片' },
      { status: 'failed', error: '第二个任务已取消' },
    ])).toBe('当前模型不支持图生图参考图片');
  });

  it('reads a nested task result error returned by the polling route', () => {
    expect(getGroupGenerationFailureMessage([
      { status: 'failed', result: { message: '供应商拒绝了 4K 尺寸' } },
    ])).toBe('供应商拒绝了 4K 尺寸');
  });

  it('falls back to a precise generic message only when no task supplies error detail', () => {
    expect(getGroupGenerationFailureMessage([{ status: 'failed' }]))
      .toBe('生成任务失败，但服务端未返回详细原因');
  });
});
