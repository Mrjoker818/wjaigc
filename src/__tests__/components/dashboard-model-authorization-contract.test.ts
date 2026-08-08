import { describe, expect, it } from 'vitest';
import * as dashboardModule from '@/components/dashboard/dashboard-view';
import type { ApiProvider } from '@/lib/universal-api-types';

interface ModelOption {
  id: string;
  name: string;
  providerId: string;
}

const dashboardHelpers = dashboardModule as unknown as {
  providerModelOptions?: (
    models: string[] | undefined,
    providerId: string,
    providerName: string,
  ) => ModelOption[];
  normalizeModelAssignmentsForSave?: (
    assignments: string[],
    options: ModelOption[],
  ) => string[];
  buildDashboardModelAuthorizationOptions?: (
    providers: ApiProvider[],
  ) => {
    chatModels: ModelOption[];
    imageModels: ModelOption[];
  };
};

function provider(
  id: string,
  modelType: ApiProvider['type'],
  selectedModels: string[],
  discoveredModels: ApiProvider['discoveredModels'],
): ApiProvider {
  return {
    id,
    name: id,
    displayName: `${id} label`,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'server-secret',
    isEnabled: true,
    type: modelType,
    modelType,
    selectedModels,
    discoveredModels,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('dashboard model authorization contract', () => {
  it('labels duplicate model ids with their provider while keeping exact assignment ids', () => {
    const options = dashboardHelpers.providerModelOptions?.(
      ['shared-model'],
      'provider-a',
      'Provider A',
    );

    expect(options).toEqual([{
      id: 'provider-a::shared-model',
      name: 'shared-model · Provider A',
      providerId: 'provider-a',
    }]);
  });

  it('removes a same-model legacy bare assignment when an exact provider pair is selected', () => {
    const options: ModelOption[] = [
      {
        id: 'provider-a::shared-model',
        name: 'shared-model · Provider A',
        providerId: 'provider-a',
      },
      {
        id: 'provider-b::shared-model',
        name: 'shared-model · Provider B',
        providerId: 'provider-b',
      },
    ];

    const payload = dashboardHelpers.normalizeModelAssignmentsForSave?.(
      ['shared-model', 'provider-a::shared-model', 'legacy-other', 'provider-a::shared-model'],
      options,
    );

    expect(payload).toEqual(['provider-a::shared-model', 'legacy-other']);
  });

  it('uses final effective kinds to build provider-qualified image and chat authorization options', () => {
    const providers: ApiProvider[] = [
      provider(
        'general-provider',
        'universal',
        ['flux-image-pro', 'gpt-4.1', 'qwen3-vl'],
        [
          {
            id: 'flux-image-pro',
            name: 'Flux Image Pro',
            providerId: 'general-provider',
            type: 'chat',
          },
          {
            id: 'gpt-4.1',
            name: 'GPT 4.1',
            providerId: 'general-provider',
            type: 'image',
          },
          {
            id: 'qwen3-vl',
            name: 'Qwen VLM',
            providerId: 'general-provider',
            type: 'chat',
          },
        ],
      ),
      provider('layer-provider', 'layer', ['layer-model'], [{
        id: 'layer-model',
        name: 'Layer Model',
        providerId: 'layer-provider',
        type: 'image',
      }]),
      provider('vector-provider', 'vectorize', ['vector-model'], [{
        id: 'vector-model',
        name: 'Vector Model',
        providerId: 'vector-provider',
        type: 'image',
      }]),
      provider('edit-provider', 'imageEdit', ['edit-model'], [{
        id: 'edit-model',
        name: 'Edit Model',
        providerId: 'edit-provider',
        type: 'chat',
      }]),
      provider('upscale-provider', 'upscaler', ['seedvr2-upscale'], [{
        id: 'seedvr2-upscale',
        name: 'SeedVR2',
        providerId: 'upscale-provider',
        type: 'image',
      }]),
      provider('removebg-provider', 'removebg', ['birefnet-removebg'], [{
        id: 'birefnet-removebg',
        name: 'BiRefNet',
        providerId: 'removebg-provider',
        type: 'image',
      }]),
      provider('chat-provider', 'chat', ['chat-model'], [{
        id: 'chat-model',
        name: 'Chat Model',
        providerId: 'chat-provider',
        type: 'image',
      }]),
    ];

    const options = dashboardHelpers.buildDashboardModelAuthorizationOptions?.(providers);

    expect(options?.imageModels.map(option => option.id)).toEqual([
      'general-provider::flux-image-pro',
      'layer-provider::layer-model',
      'vector-provider::vector-model',
      'edit-provider::edit-model',
      'upscale-provider::seedvr2-upscale',
      'removebg-provider::birefnet-removebg',
    ]);
    expect(options?.imageModels.map(option => option.name)).toEqual([
      'flux-image-pro · general-provider label',
      'layer-model · layer-provider label',
      'vector-model · vector-provider label',
      'edit-model · edit-provider label',
      'seedvr2-upscale · upscale-provider label',
      'birefnet-removebg · removebg-provider label',
    ]);
    expect(options?.chatModels).toEqual([
      {
        id: 'general-provider::gpt-4.1',
        name: 'gpt-4.1 · general-provider label',
        providerId: 'general-provider',
      },
      {
        id: 'chat-provider::chat-model',
        name: 'chat-model · chat-provider label',
        providerId: 'chat-provider',
      },
    ]);

    const payload = dashboardHelpers.normalizeModelAssignmentsForSave?.(
      ['flux-image-pro', 'general-provider::flux-image-pro', 'layer-provider::layer-model'],
      options?.imageModels || [],
    );
    expect(payload).toEqual([
      'general-provider::flux-image-pro',
      'layer-provider::layer-model',
    ]);
  });
});
