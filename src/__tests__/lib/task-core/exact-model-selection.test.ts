import { describe, expect, it } from 'vitest';

import { normalizeProviderModelSelection } from '@/lib/task-core/exact-model-selection';

describe('exact provider model selection', () => {
  it('uses the discovered exact id when selectedModels is empty', () => {
    expect(normalizeProviderModelSelection({
      requestedModelId: 'gpt-image-2-4k',
      selectedModels: [],
      discoveredModels: [{ id: 'gpt-image-2-4k' }],
    })).toMatchObject({
      modelId: 'gpt-image-2-4k',
      matched: true,
    });
  });

  it('normalizes a model alias against provider ids before descriptor resolution', () => {
    expect(normalizeProviderModelSelection({
      requestedModelId: 'gpt-image-2-4k',
      selectedModels: ['gpt-image-2'],
      discoveredModels: [],
    })).toMatchObject({
      modelId: 'gpt-image-2',
      matched: true,
    });
  });

  it('keeps an explicitly configured suffix variant as the submitted exact id', () => {
    expect(normalizeProviderModelSelection({
      requestedModelId: 'gpt-image-2-4k',
      selectedModels: ['gpt-image-2', 'gpt-image-2-4k'],
      discoveredModels: [],
    })).toMatchObject({
      modelId: 'gpt-image-2-4k',
      matched: true,
    });
  });
});
