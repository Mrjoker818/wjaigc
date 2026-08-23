import { describe, expect, it } from 'vitest';
import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import {
  classifyProviderCapabilityFamily,
  resolveProviderCapabilityAdapter,
} from '@/lib/task-core/provider-capability-adapters';

function provider(
  id: string,
  baseUrl: string,
  type: ApiProvider['type'],
  overrides: Partial<ApiProvider> = {},
): ApiProvider {
  return {
    id,
    name: id,
    baseUrl,
    apiKey: 'test-key',
    isEnabled: true,
    type,
    modelType: type,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function model(
  providerId: string,
  id: string,
  type: ModelInfo['type'],
): ModelInfo {
  return { id, name: id, providerId, type };
}

describe('provider capability adapters', () => {
  it('classifies only audited provider hosts or explicit presets', () => {
    expect(classifyProviderCapabilityFamily(
      provider('pear', 'https://api.pearapi.ai/v1', 'layer'),
    )).toBe('pear');
    expect(classifyProviderCapabilityFamily(
      provider('apib', 'https://api.apimart.ai/v1', 'image'),
    )).toBe('apib');
    expect(classifyProviderCapabilityFamily(
      provider('4s', 'https://api.4sapi.com/v1', 'image'),
    )).toBe('4s');
    expect(classifyProviderCapabilityFamily(
      provider('ai-link', 'https://api.ai-link.shop/v1', 'video'),
    )).toBe('ai-link');
    expect(classifyProviderCapabilityFamily(
      provider('302', 'https://api.302.ai', 'upscaler'),
    )).toBe('302');
    expect(classifyProviderCapabilityFamily(
      provider('lookalike', 'https://pearapi.example.com/v1', 'image'),
    )).toBeNull();
  });

  it('uses the audited APIMart GPT Image 2 contract', () => {
    // Source: https://docs.apib.ai/cn/api-reference/images/gpt-image-2/generation
    // Endpoint: POST /v1/images/generations; reviewed 2026-08-24.
    const adapter = resolveProviderCapabilityAdapter(
      provider('apib', 'https://api.apimart.ai/v1', 'image'),
      model('apib', 'gpt-image-2', 'image'),
    );

    expect(adapter).toMatchObject({
      protocol: 'apimart',
      executionMode: 'async',
      allowedRatios: [
        '1:1', '3:2', '2:3', '4:3', '3:4',
        '5:4', '4:5', '16:9', '9:16', '2:1',
        '1:2', '3:1', '1:3', '21:9', '9:21',
      ],
      qualityOptions: ['1K', '2K', '4K'],
      supportsReferenceImages: true,
      maxReferenceImages: 16,
      supportedOperations: ['text-to-image', 'image-to-image'],
    });
  });

  it('does not reuse APIMart capabilities for the same 4S model id', () => {
    // Source: https://4sapi.apifox.cn/447631659e0
    // Endpoint: POST /v1/images/generations and /v1/images/edits; reviewed 2026-08-24.
    const fourS = resolveProviderCapabilityAdapter(
      provider('4s', 'https://api.4sapi.com/v1', 'image'),
      model('4s', 'gpt-image-2', 'image'),
    );
    const apib = resolveProviderCapabilityAdapter(
      provider('apib', 'https://api.apimart.ai/v1', 'image'),
      model('apib', 'gpt-image-2', 'image'),
    );

    expect(fourS).toMatchObject({
      protocol: '4sapi',
      executionMode: 'sync',
      maxOutputs: 1,
      supportsReferenceImages: true,
      supportsMask: true,
    });
    expect(fourS).not.toEqual(apib);
  });

  it('uses Pear async ZIP/PSD output only for Image-Layered', () => {
    // Source: https://pearapi.apifox.cn/api-493268181
    // Endpoint: POST /v1/images/generations, task_type=async; reviewed 2026-08-24.
    const pear = provider('pear', 'https://api.pearapi.ai/v1', 'layer');
    expect(resolveProviderCapabilityAdapter(
      pear,
      model('pear', 'Image-Layered', 'layer'),
    )).toMatchObject({
      protocol: 'pearapi-layer',
      executionMode: 'async',
      supportsReferenceImages: true,
      maxReferenceImages: 1,
      outputKinds: ['zip', 'psd'],
    });
    expect(resolveProviderCapabilityAdapter(
      pear,
      model('pear', 'Image-Layered-Pro', 'layer'),
    )).toBeUndefined();
  });

  it('uses exact AI Link video ids without widening to similar names', () => {
    // Source: https://docs.ai-link.shop, AI Link /v1/videos contract.
    // Endpoint: POST /v1/videos; reviewed 2026-08-24.
    const aiLink = provider('ai-link', 'https://api.ai-link.shop/v1', 'video');
    expect(resolveProviderCapabilityAdapter(
      aiLink,
      model('ai-link', 'kling-v3', 'video'),
    )).toMatchObject({
      protocol: 'ai-link',
      executionMode: 'async',
      outputKinds: ['mp4'],
    });
    expect(resolveProviderCapabilityAdapter(
      aiLink,
      model('ai-link', 'kling-v3-copy', 'video'),
    )).toBeUndefined();
  });

  it('keeps the two documented 302 upscale models distinct', () => {
    // Sources: https://doc.302.ai/373009524e0 and https://doc.302.ai/205808838e0
    // Endpoints: /302/submit/upscale-v6 and /302/submit/super-upscale-v2; reviewed 2026-08-24.
    const threeOhTwo = provider('302', 'https://api.302.ai', 'upscaler');
    expect(resolveProviderCapabilityAdapter(
      threeOhTwo,
      model('302', '302-upscale-v6', 'upscaler'),
    )).toMatchObject({
      protocol: '302-upscale-v6',
      executionMode: 'sync',
      outputKinds: ['jpeg'],
    });
    expect(resolveProviderCapabilityAdapter(
      threeOhTwo,
      model('302', '302-super-upscale-v2', 'upscaler'),
    )).toMatchObject({
      protocol: '302-super-upscale-v2',
      executionMode: 'sync',
      outputKinds: ['png'],
    });
    expect(resolveProviderCapabilityAdapter(
      threeOhTwo,
      model('302', '302-upscale-v60', 'upscaler'),
    )).toBeUndefined();
  });
});
