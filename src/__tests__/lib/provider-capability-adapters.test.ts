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
      provider('apib', 'https://api.apib.ai/v1', 'image'),
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
      provider('apib', 'https://api.apib.ai/v1', 'image'),
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
      allowedSizes: ['1K', '2K', '4K'],
      qualityOptions: [],
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
      provider('apib', 'https://api.apib.ai/v1', 'image'),
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

  // Source: docs.apib.ai/cn/api-reference/images/* (reviewed 2026-11-09).
  it.each([
    ['gpt-image-2-official', { allowedSizes: ['1K', '2K', '4K'], qualityOptions: ['auto', 'low', 'medium', 'high'], maxOutputs: 4, maxReferenceImages: 16 }],
    ['gpt-image-2.5-flare', { allowedSizes: ['1K', '2K', '4K'], maxOutputs: 4, maxReferenceImages: 16 }],
    ['gemini-3-pro-image-preview', { allowedSizes: ['1K', '2K', '4K'], maxOutputs: 1, maxReferenceImages: 14 }],
    ['gemini-3.1-flash-lite-image', { allowedSizes: [], maxOutputs: 4 }],
    ['seedream-5-0-pro', { allowedSizes: ['1K', '2K'], maxOutputs: 1, maxReferenceImages: 10 }],
    ['seedream-5-0-lite', { allowedSizes: ['2K', '3K', '4K'], maxOutputs: 15 }],
    ['qwen-image-3.0-pro', { allowedSizes: ['1K', '2K'], maxOutputs: 6, maxReferenceImages: 3 }],
    ['grok-imagine-2.0-ext', { allowedSizes: [], maxOutputs: 12, supportsReferenceImages: false, supportedOperations: ['text-to-image'] }],
    ['grok-imagine-image-2.0', { allowedSizes: ['1K', '2K'], maxOutputs: 10, maxReferenceImages: 3 }],
  ] as const)('uses the documented APIMart limits for %s', (modelId, expected) => {
    const adapter = resolveProviderCapabilityAdapter(
      provider('apib', 'https://api.apib.ai/v1', 'image'),
      model('apib', modelId, 'image'),
    );
    expect(adapter).toMatchObject(expected);
    expect(adapter?.allowedRatios?.length).toBeGreaterThan(0);
  });

  it('keeps per-model ratio lists distinct for APIMart image models', () => {
    const apib = provider('apib', 'https://api.apib.ai/v1', 'image');
    const ratios = (id: string) => resolveProviderCapabilityAdapter(apib, model('apib', id, 'image'))?.allowedRatios;
    expect(ratios('gemini-3.1-flash-image-preview')).toContain('8:1');
    expect(ratios('gemini-3-pro-image-preview')).not.toContain('8:1');
    expect(ratios('seedream-5-0-lite')).not.toContain('auto');
    expect(ratios('grok-imagine-2.0-ext')).not.toContain('auto');
    expect(ratios('grok-imagine-image-2.0')).toContain('19.5:9');
  });
  it('derives Pear image capabilities from the documented model specs', () => {
    const pear = provider('pear', 'https://api.pearapi.ai', 'image');
    const caps = (id: string) => resolveProviderCapabilityAdapter(pear, model('pear', id, 'image'));
    expect(caps('gpt-image-2')).toMatchObject({
      allowedSizes: ['1K', '2K', '4K'], qualityOptions: ['auto', 'low', 'medium', 'high'],
      maxOutputs: 4, maxReferenceImages: 16,
    });
    expect(caps('gpt-image-2.5')?.qualityOptions).toContain('max');
    expect(caps('nano-banana-2')?.allowedSizes).toEqual(['1K', '2K', '4K']);
    expect(caps('nano-banana')).toMatchObject({ allowedSizes: ['1K'], qualityOptions: [], maxReferenceImages: 14 });
    expect(caps('doubao-seedream-5-0-260128')).toMatchObject({ allowedSizes: ['2K'], maxReferenceImages: 10 });
    expect(caps('z-image')).toMatchObject({
      allowedSizes: [], supportsReferenceImages: false, supportedOperations: ['text-to-image'],
    });
    expect(caps('firered-image-edit1.1')?.supportedOperations).toEqual(['image-to-image']);
    expect(caps('gpt-image-2-4k')).toBeUndefined();
  });

  it('derives Pear video capabilities without touching AI Link specs for the same id', () => {
    const pear = provider('pear', 'https://api.pearapi.ai', 'video');
    const caps = (id: string) => resolveProviderCapabilityAdapter(pear, model('pear', id, 'video'));
    expect(caps('doubao-seedance-2-0-260128')).toMatchObject({
      allowedRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'], allowedSizes: ['720p', '480p'],
      maxDurationSeconds: 15, maxReferenceImages: 9,
    });
    expect(caps('doubao-seedance-2-5-260628')?.allowedDurationsSeconds).toHaveLength(27);
    expect(caps('hailuo-2.3')).toMatchObject({
      allowedDurationsSeconds: [6, 10], allowedSizes: ['768p'], supportedOperations: ['image-to-video'],
    });
    expect(caps('minimax-h3')?.allowedSizes).toEqual(['768p', '2K', '480p', '720p']);
    const aiLink = provider('ai', 'https://api.ai-link.shop', 'video');
    expect(resolveProviderCapabilityAdapter(aiLink, model('ai', 'doubao-seedance-2-0-260128', 'video'))).toBeUndefined();
  });
});
