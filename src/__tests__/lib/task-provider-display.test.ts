import { describe, expect, it } from 'vitest';

import { resolveTaskProviderDisplayName } from '@/lib/task-provider-display';

describe('resolveTaskProviderDisplayName', () => {
  it('prefers the exact persisted provider identity over a stale task display name', () => {
    expect(resolveTaskProviderDisplayName(
      'pear-provider',
      {
        id: 'pear-provider',
        name: 'PearAPI',
        displayName: 'PearAPI 图像',
      },
      'FHL图像模型',
    )).toBe('PearAPI 图像');
  });

  it('keeps a legacy display name when an exact provider lookup is unavailable', () => {
    expect(resolveTaskProviderDisplayName(
      'deleted-provider',
      null,
      '历史提供商',
    )).toBe('历史提供商');
  });

  it('falls back to the stable provider id when no display metadata exists', () => {
    expect(resolveTaskProviderDisplayName('provider-1', null, '')).toBe('provider-1');
  });
});
