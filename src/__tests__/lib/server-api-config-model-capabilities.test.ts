import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbGetApiProviders: vi.fn(),
  dbUpsertApiProvider: vi.fn(),
  dbDeleteApiProvider: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-storage', () => mocks);
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('no file fallback in this test')),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { getApiProviders, updateApiProvider } from '@/lib/server-api-config';
import {
  parseProviderCapabilityOverridesStrict,
  readProviderCapabilityOverrides,
  serializeProviderCapabilityOverrides,
} from '@/lib/task-core/model-capability-resolution';

function providerRow() {
  return {
    id: 'provider-a',
    name: 'Provider A',
    display_name: 'Provider A',
    base_url: 'https://api.example.com/v1',
    api_key: 'server-secret',
    is_enabled: true,
    type: 'video',
    model_type: 'video',
    request_style: 'auto',
    selected_models: ['video-a'],
    discovered_models: JSON.stringify([{
      id: 'video-a',
      name: 'Video A',
      type: 'video',
      supportedAspectRatios: ['1:1', '16:9'],
      supportedQualities: ['standard', 'hd'],
      maxImages: 4,
      maxReferenceImages: 3,
      allowedDurationsSeconds: [5, 10, 15],
      maxDurationSeconds: 15,
      supportedOperations: ['text-to-video', 'image-to-video'],
      outputKinds: ['mp4'],
      capabilities: ['video', 'reference-images'],
    }]),
    advanced_params: {
      compatProfile: 'provider-a',
      taskModelCapabilities: JSON.stringify({
        version: 1,
        models: {
          'video-a': {
            allowedDurationsSeconds: [5, 10, 15],
            maxDurationSeconds: 15,
          },
        },
      }),
    },
    is_default: false,
    created_at: 1,
    updated_at: 1,
    connection_status: 'success',
    sort_order: 0,
  };
}

describe('server API model capability persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbGetApiProviders.mockResolvedValue([providerRow()]);
  });

  it('restores every persisted discovery capability field from a database row', async () => {
    const providers = await getApiProviders();

    expect(providers[0].discoveredModels?.[0]).toMatchObject({
      supportedAspectRatios: ['1:1', '16:9'],
      supportedQualities: ['standard', 'hd'],
      maxImages: 4,
      maxReferenceImages: 3,
      allowedDurationsSeconds: [5, 10, 15],
      maxDurationSeconds: 15,
      supportedOperations: ['text-to-video', 'image-to-video'],
      outputKinds: ['mp4'],
      capabilities: ['video', 'reference-images'],
    });
  });

  it('reads legacy direct maps and canonical version-one wrappers identically', () => {
    expect(readProviderCapabilityOverrides(JSON.stringify({
      'gpt-image-2': { maxOutputs: 2 },
    }))).toEqual({
      version: 1,
      models: { 'gpt-image-2': { maxOutputs: 2 } },
    });

    expect(readProviderCapabilityOverrides(JSON.stringify({
      version: 1,
      models: { 'gpt-image-2': { maxOutputs: 4 } },
    }))).toEqual({
      version: 1,
      models: { 'gpt-image-2': { maxOutputs: 4 } },
    });
  });

  it('serializes a stable v1 object without changing unrelated advanced parameters', () => {
    const serialized = serializeProviderCapabilityOverrides({
      version: 1,
      models: {
        'video-b': { maxDurationSeconds: 15 },
        'image-a': { allowedRatios: ['1:1'], maxOutputs: 2 },
      },
    });

    expect(JSON.parse(serialized)).toEqual({
      version: 1,
      models: {
        'image-a': { allowedRatios: ['1:1'], maxOutputs: 2 },
        'video-b': { maxDurationSeconds: 15 },
      },
    });
    expect({
      compatProfile: 'provider-a',
      taskModelCapabilities: serialized,
    }).toHaveProperty('compatProfile', 'provider-a');
  });

  it('drops inherited, oversized, malformed, and unsupported capability values', () => {
    const inherited = Object.create({ maxOutputs: 4 }) as Record<string, unknown>;
    inherited.allowedRatios = ['1:1', 42];
    inherited.maxReferenceImages = 99;
    inherited.allowedDurationsSeconds = [5, -1, 15];
    inherited.supportedOperations = ['text-to-video', 'delete-project'];

    expect(readProviderCapabilityOverrides(JSON.stringify({
      version: 1,
      models: { unsafe: inherited },
    }))).toEqual({ version: 1, models: { unsafe: {} } });
  });

  it('strictly rejects invalid submitted v1 capabilities instead of silently dropping fields', () => {
    expect(parseProviderCapabilityOverridesStrict(JSON.stringify({
      version: 1,
      models: { 'gpt-image-2': { maxOutputs: 99 } },
    }))).toEqual({
      ok: false,
      error: expect.stringContaining('maxOutputs'),
    });
  });

  it('strictly rejects blank-after-trim and prototype-sensitive model ids', () => {
    for (const modelId of ['  ', '__proto__', 'prototype', 'constructor']) {
      expect(parseProviderCapabilityOverridesStrict(JSON.stringify({
        version: 1,
        models: { [modelId]: { maxOutputs: 1 } },
      }))).toMatchObject({ ok: false });
    }
  });

  it('does not overwrite untouched providers when one provider is updated', async () => {
    const peer = {
      ...providerRow(),
      id: 'provider-b',
      name: 'Provider B',
      display_name: 'Provider B',
      selected_models: ['video-b'],
      advanced_params: {
        compatProfile: 'provider-b',
        customHeader: 'peer-value',
      },
    };
    mocks.dbGetApiProviders.mockResolvedValue([providerRow(), peer]);

    const result = await updateApiProvider('provider-a', {
      advancedParams: {
        compatProfile: 'provider-a',
        taskModelCapabilities: serializeProviderCapabilityOverrides({
          version: 1,
          models: { 'video-a': { maxDurationSeconds: 30 } },
        }),
      },
    });

    expect(result?.advancedParams?.taskModelCapabilities).toBeTruthy();
    expect(mocks.dbUpsertApiProvider).toHaveBeenCalledTimes(1);
    expect(mocks.dbUpsertApiProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider-a' }),
    );
  });
});
