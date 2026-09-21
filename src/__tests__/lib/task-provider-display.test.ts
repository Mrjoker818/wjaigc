import { describe, expect, it } from 'vitest';

import {
  resolveCanvasProviderDisplayName,
  resolveTaskProviderDisplayName,
} from '@/lib/task-provider-display';

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

describe('resolveCanvasProviderDisplayName', () => {
  const providerNames = new Map([
    ['ailink-provider', 'AILINK 图像'],
    ['apimart-provider', 'APImart imgae'],
    ['ailink-provider::gpt-image-2', 'AILINK 图像'],
    ['apimart-provider::gpt-image-2', 'APImart imgae'],
    ['gpt-image-2', 'AILINK 图像'],
  ]);

  it('uses the persisted provider id before an ambiguous model-only mapping', () => {
    expect(resolveCanvasProviderDisplayName({
      providerId: 'apimart-provider',
      modelId: 'gpt-image-2',
    }, providerNames)).toBe('APImart imgae');
  });

  it('keeps a canonical provider name returned by the task when no exact id mapping exists', () => {
    expect(resolveCanvasProviderDisplayName({
      providerId: 'deleted-provider',
      providerName: '历史提供商',
      modelId: 'gpt-image-2',
    }, providerNames)).toBe('历史提供商');
  });
});
