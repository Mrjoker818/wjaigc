import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  resolveTaskModelCatalogResultFromSnapshot,
} from '@/lib/task-core/model-catalog';
import {
  mergeCapabilityLayers,
  validateTaskModelSelection,
} from '@/lib/task-core/model-capability-resolution';
import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

function createProvider(input: {
  id: string;
  type: ApiProvider['type'];
  model: ModelInfo;
  capabilities: Record<string, unknown>;
}): ApiProvider {
  return {
    id: input.id,
    name: input.id,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    isEnabled: true,
    type: input.type,
    modelType: input.type,
    selectedModels: [input.model.id],
    discoveredModels: [input.model],
    advancedParams: {
      taskModelCapabilities: JSON.stringify({
        version: 1,
        models: {
          [input.model.id]: input.capabilities,
        },
      }),
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

const admin: User = {
  id: 'admin-1',
  name: 'Administrator',
  role: 'admin',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
};

describe('unified task model capability resolution', () => {
  it('merges every field independently and treats an admin empty array as explicit denial', () => {
    const merged = mergeCapabilityLayers({
      fallback: {
        allowedRatios: ['1:1'],
        allowedSizes: ['1K'],
        maxOutputs: 1,
      },
      discovery: {
        allowedRatios: ['1:1', '16:9'],
      },
      adapter: {
        allowedSizes: ['1K', '2K'],
        maxOutputs: 2,
      },
      admin: {
        allowedRatios: [],
        maxOutputs: 4,
      },
    });

    expect(merged).toEqual({
      value: {
        allowedRatios: [],
        allowedSizes: ['1K', '2K'],
        maxOutputs: 4,
      },
      sources: {
        allowedRatios: 'admin',
        allowedSizes: 'adapter',
        maxOutputs: 'admin',
      },
    });
  });

  it('returns one stable mismatch contract for unsupported task selections', () => {
    const descriptor: TaskModelDescriptor = {
      providerId: 'provider-a',
      modelId: 'image-a',
      kind: 'image' as const,
      sourceType: 'image' as const,
      protocol: 'openai',
      executionMode: 'sync' as const,
      allowedRatios: ['1:1'],
      allowedSizes: ['1024x1024'],
      qualityOptions: ['standard'],
      maxOutputs: 2,
      supportsReferenceImages: true,
      maxReferenceImages: 1,
      supportsMask: false,
      allowedDurationsSeconds: [],
      supportedOperations: ['text-to-image', 'image-to-image'],
      outputKinds: ['png'],
      capabilitySources: {},
    };

    expect(validateTaskModelSelection(descriptor, {
      aspectRatio: '16:9',
      outputCount: 3,
    })).toEqual({
      ok: false,
      error: {
        code: 'MODEL_CAPABILITY_MISMATCH',
        field: 'aspectRatio',
        received: '16:9',
        allowed: ['1:1'],
      },
    });
    expect(validateTaskModelSelection(descriptor, {
      referenceImageCount: 2,
    })).toMatchObject({
      ok: false,
      error: { field: 'referenceImages', allowed: [0, 1] },
    });
  });

  it('keeps provider-specific capabilities and field sources for the same model id', () => {
    const pearModel: ModelInfo = {
      id: 'shared-image',
      name: 'Shared Image from Pear',
      providerId: 'pear',
      type: 'image',
    };
    const model302: ModelInfo = {
      id: 'shared-image',
      name: 'Shared Image from 302',
      providerId: 'provider-302',
      type: 'image',
    };
    const pear = createProvider({
      id: 'pear',
      type: 'image',
      model: pearModel,
      capabilities: {
        allowedSizes: ['1024x1024'],
        maxOutputs: 4,
      },
    });
    const provider302 = createProvider({
      id: 'provider-302',
      type: 'image',
      model: model302,
      capabilities: {
        allowedSizes: ['1K', '2K', '4K'],
      },
    });

    const result = resolveTaskModelCatalogResultFromSnapshot(
      [pearModel, model302],
      admin,
      [pear, provider302],
    );
    const pearDescriptor = result.taskModelCatalog.find(item => item.providerId === 'pear');
    const descriptor302 = result.taskModelCatalog.find(item => item.providerId === 'provider-302');

    expect(pearDescriptor).toMatchObject({
      modelId: 'shared-image',
      allowedSizes: ['1024x1024'],
      maxOutputs: 4,
      capabilitySources: {
        allowedSizes: 'admin',
        maxOutputs: 'admin',
      },
    });
    expect(descriptor302).toMatchObject({
      modelId: 'shared-image',
      allowedSizes: ['1K', '2K', '4K'],
      maxOutputs: 1,
      capabilitySources: {
        allowedSizes: 'admin',
        maxOutputs: 'fallback',
      },
    });
  });

  it('preserves discrete video durations, operations, reference limits, and their sources', () => {
    const model: ModelInfo = {
      id: 'documented-video-model',
      name: 'Documented Video Model',
      providerId: 'video-provider',
      type: 'video',
    };
    const provider = createProvider({
      id: 'video-provider',
      type: 'video',
      model,
      capabilities: {
        allowedDurationsSeconds: [5, 10, 15],
        maxDurationSeconds: 15,
        supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame'],
        supportsReferenceImages: true,
        maxReferenceImages: 2,
      },
    });

    const result = resolveTaskModelCatalogResultFromSnapshot([model], admin, [provider]);

    expect(result.taskModelCatalog[0]).toMatchObject({
      allowedDurationsSeconds: [5, 10, 15],
      maxDurationSeconds: 15,
      supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame'],
      supportsReferenceImages: true,
      maxReferenceImages: 2,
      capabilitySources: {
        allowedDurationsSeconds: 'admin',
        maxDurationSeconds: 'admin',
        supportedOperations: 'admin',
        supportsReferenceImages: 'admin',
        maxReferenceImages: 'admin',
      },
    });
  });
});
