import { describe, expect, it } from 'vitest';
import {
  isModelAssignedToUser,
  parseExactModelKey,
  readPersistedImageModelSelection,
  resolvePersistedModelSelection,
  resolveQuickCreateModel,
  selectInitialModel,
} from '@/lib/model-defaults';

describe('persisted image model record', () => {
  it('reads the legacy apiProvider field written by the canvas chat model selector', () => {
    expect(readPersistedImageModelSelection({
      model: 'gpt-image-2',
      apiProvider: 'pear-image',
    })).toEqual({
      compositeKey: 'pear-image::gpt-image-2',
      modelId: 'gpt-image-2',
      providerId: 'pear-image',
    });
  });

  it('prefers the canonical providerId and preserves namespaced model ids', () => {
    expect(readPersistedImageModelSelection({
      model: 'vendor::image-v2',
      providerId: 'provider-a',
      apiProvider: 'stale-provider',
    })).toEqual({
      compositeKey: 'provider-a::vendor::image-v2',
      modelId: 'vendor::image-v2',
      providerId: 'provider-a',
    });
  });

  it('rejects records without an exact provider identity', () => {
    expect(readPersistedImageModelSelection({ model: 'gpt-image-2' })).toBeNull();
    expect(readPersistedImageModelSelection('gpt-image-2')).toBeNull();
  });
});

describe('persisted model selection resolution', () => {
  const candidates = [
    { id: 'shared-model', providerId: 'provider-a' },
    { id: 'shared-model', providerId: 'provider-b' },
    { id: 'unique-model', providerId: 'provider-c' },
  ];

  it('rejects an ambiguous legacy bare id without selecting a provider', () => {
    expect(resolvePersistedModelSelection('shared-model', candidates)).toEqual({
      status: 'ambiguous',
      compositeKey: null,
      modelId: 'shared-model',
      providerId: null,
    });
  });

  it('migrates a legacy bare id only when exactly one provider candidate is visible', () => {
    expect(resolvePersistedModelSelection('unique-model', candidates)).toEqual({
      status: 'migrated',
      compositeKey: 'provider-c::unique-model',
      modelId: 'unique-model',
      providerId: 'provider-c',
    });
  });

  it('preserves a valid exact provider and model key', () => {
    expect(resolvePersistedModelSelection('provider-b::shared-model', candidates)).toEqual({
      status: 'exact',
      compositeKey: 'provider-b::shared-model',
      modelId: 'shared-model',
      providerId: 'provider-b',
    });
  });

  it('parses an exact key at the first separator without truncating a namespaced model id', () => {
    expect(parseExactModelKey('provider-a::vendor::shared-model')).toEqual({
      providerId: 'provider-a',
      modelId: 'vendor::shared-model',
    });
  });

  it('migrates a unique legacy bare model id that itself contains separators', () => {
    expect(resolvePersistedModelSelection('vendor::shared-model', [
      { id: 'vendor::shared-model', providerId: 'provider-a' },
    ])).toEqual({
      status: 'migrated',
      compositeKey: 'provider-a::vendor::shared-model',
      modelId: 'vendor::shared-model',
      providerId: 'provider-a',
    });
  });

  it('rejects an ambiguous legacy bare namespaced model id', () => {
    expect(resolvePersistedModelSelection('vendor::shared-model', [
      { id: 'vendor::shared-model', providerId: 'provider-a' },
      { id: 'vendor::shared-model', providerId: 'provider-b' },
    ])).toEqual({
      status: 'ambiguous',
      compositeKey: null,
      modelId: 'vendor::shared-model',
      providerId: null,
    });
  });

  it('does not write back a bare id with no visible provider candidate', () => {
    expect(resolvePersistedModelSelection('missing-model', candidates)).toEqual({
      status: 'not-found',
      compositeKey: null,
      modelId: 'missing-model',
      providerId: null,
    });
  });
});

describe('initial model selection', () => {
  const models = [
    { id: 'provider-a::model-a', isDefault: false },
    { id: 'provider-b::model-b', isDefault: true },
  ];

  it('uses the administrator default when the user has not selected a model', () => {
    expect(selectInitialModel('', models)).toBe('provider-b::model-b');
  });

  it('keeps an existing valid user selection', () => {
    expect(selectInitialModel('provider-a::model-a', models)).toBe('provider-a::model-a');
  });

  it('does not keep a model that is no longer available', () => {
    expect(selectInitialModel('provider-c::model-c', models)).toBe('provider-b::model-b');
  });

  it('falls back to the first model only when no configured default is available', () => {
    expect(selectInitialModel('', [{ id: 'provider-a::model-a', isDefault: false }])).toBe('provider-a::model-a');
  });
});

describe('quick create model resolution', () => {
  const models = [
    {
      id: 'provider-a::model-a',
      providerId: 'provider-a',
      modelId: 'model-a',
      name: 'Model A',
    },
    {
      id: 'provider-b::model-b',
      providerId: 'provider-b',
      modelId: 'model-b',
      name: 'Model B',
    },
  ];

  it('uses a valid task override before every configured default', () => {
    expect(resolveQuickCreateModel({
      taskOverride: 'provider-b::model-b',
      quickCreateDefault: 'provider-a::model-a',
      globalDefault: 'provider-a::model-a',
      recentSelection: 'provider-a::model-a',
      models,
    })).toMatchObject({ id: 'provider-b::model-b', source: 'task-override' });
  });

  it('falls back from an invalid task override to the quick create default', () => {
    expect(resolveQuickCreateModel({
      taskOverride: 'provider-c::model-c',
      quickCreateDefault: 'provider-b::model-b',
      globalDefault: 'provider-a::model-a',
      models,
    })).toMatchObject({ id: 'provider-b::model-b', source: 'quick-create-default' });
  });

  it('uses the global default when the quick create default is unavailable', () => {
    expect(resolveQuickCreateModel({
      quickCreateDefault: 'provider-c::model-c',
      globalDefault: 'provider-a::model-a',
      recentSelection: 'provider-b::model-b',
      models,
    })).toMatchObject({ id: 'provider-a::model-a', source: 'global-default' });
  });

  it('uses a recent valid selection after configured defaults are unavailable', () => {
    expect(resolveQuickCreateModel({
      quickCreateDefault: 'provider-c::model-c',
      globalDefault: 'provider-d::model-d',
      recentSelection: 'provider-b::model-b',
      models,
    })).toMatchObject({ id: 'provider-b::model-b', source: 'recent-selection' });
  });

  it('uses the first available model when all explicit candidates are invalid', () => {
    expect(resolveQuickCreateModel({
      taskOverride: 'provider-x::model-x',
      quickCreateDefault: 'provider-y::model-y',
      globalDefault: 'provider-z::model-z',
      recentSelection: 'provider-q::model-q',
      models,
    })).toMatchObject({ id: 'provider-a::model-a', source: 'first-available' });
  });

  it('returns an explicit none result when the account has no available models', () => {
    expect(resolveQuickCreateModel({ models: [] })).toEqual({ id: '', model: null, source: 'none' });
  });

  it('does not fall back to the first model when automatic routing is disabled', () => {
    expect(resolveQuickCreateModel({
      globalDefault: 'provider-a::model-a',
      recentSelection: 'provider-b::model-b',
      models,
      allowFirstAvailable: false,
    })).toMatchObject({ id: 'provider-a::model-a', source: 'global-default' });

    expect(resolveQuickCreateModel({
      models,
      allowFirstAvailable: false,
    })).toEqual({ id: '', model: null, source: 'none' });
  });

  it('still accepts task and quick-create fixed models when first-model fallback is disabled', () => {
    expect(resolveQuickCreateModel({
      taskOverride: 'provider-b::model-b',
      models,
      allowFirstAvailable: false,
    })).toMatchObject({ id: 'provider-b::model-b', source: 'task-override' });

    expect(resolveQuickCreateModel({
      quickCreateDefault: 'provider-a::model-a',
      models,
      allowFirstAvailable: false,
    })).toMatchObject({ id: 'provider-a::model-a', source: 'quick-create-default' });
  });
});

describe('user model assignment', () => {
  it('inherits the enabled system catalog when no per-user allowlist is configured', () => {
    expect(isModelAssignedToUser(undefined, 'provider-a', 'model-a')).toBe(true);
    expect(isModelAssignedToUser([], 'provider-a', 'model-a')).toBe(true);
  });

  it('accepts legacy bare model identifiers', () => {
    expect(isModelAssignedToUser(['model-a'], 'provider-a', 'model-a')).toBe(true);
  });

  it('accepts provider-bound model identifiers', () => {
    expect(isModelAssignedToUser(['provider-a::model-a'], 'provider-a', 'model-a')).toBe(true);
  });

  it('does not grant a provider-bound assignment to a different provider with the same model id', () => {
    expect(isModelAssignedToUser(['provider-a::shared-model'], 'provider-b', 'shared-model')).toBe(false);
  });
});
