import { describe, expect, it } from 'vitest';
import { fitImageToolSelection, indexImageToolCapabilities, resolveImageToolOptions } from '@/lib/image-tool-model-options';

const capability = {
  allowedRatios: ['1:1', '16:9'],
  allowedSizes: ['1K', '2K', '1024x1024'],
  qualityOptions: [] as string[],
  maxOutputs: 6,
};

describe('image tool model options', () => {
  it('uses the exact capability and clamps outputs to what the tools can show', () => {
    expect(resolveImageToolOptions('seedream-5-0-lite', capability)).toEqual({
      ratios: ['1:1', '16:9'],
      qualities: ['1K', '2K'],
      maxOutputs: 4,
    });
  });

  it('prefers quality options over resolution tiers and keeps a single output limit', () => {
    expect(resolveImageToolOptions('gpt-image-2-official', {
      ...capability,
      qualityOptions: ['auto', 'high'],
      maxOutputs: 1,
    })).toMatchObject({ qualities: ['auto', 'high'], maxOutputs: 1 });
  });

  it('falls back to auto when the model exposes no tiers', () => {
    expect(resolveImageToolOptions('grok-imagine-2.0-ext', {
      ...capability,
      allowedSizes: [],
    }).qualities).toEqual(['auto']);
  });

  it('falls back to the name tables without a capability', () => {
    const options = resolveImageToolOptions('unknown-model');
    expect(options.ratios.length).toBeGreaterThan(0);
    expect(options.qualities.length).toBeGreaterThan(0);
    expect(options.maxOutputs).toBe(4);
  });

  it('indexes a task model catalog array by provider and model', () => {
    const index = indexImageToolCapabilities([
      { providerId: 'apib', modelId: 'qwen-image-3.0-pro', ...capability },
      { providerId: 'apib', modelId: 'broken', allowedRatios: 'x' },
      null,
    ]);
    expect(Object.keys(index)).toEqual(['apib::qwen-image-3.0-pro']);
    expect(index['apib::qwen-image-3.0-pro'].maxOutputs).toBe(6);
  });

  it('accepts an already indexed object and ignores other input', () => {
    expect(indexImageToolCapabilities({ 'apib::a': capability })).toEqual({ 'apib::a': capability });
    expect(indexImageToolCapabilities(undefined)).toEqual({});
  });

  it('fits a requested selection to the model and leaves it alone without a capability', () => {
    expect(fitImageToolSelection('m', capability, { aspectRatio: '21:9', quality: '4K', count: 9 }))
      .toEqual({ aspectRatio: '1:1', quality: '1K', count: 4 });
    expect(fitImageToolSelection('m', capability, { aspectRatio: '16:9', quality: '2K' }))
      .toEqual({ aspectRatio: '16:9', quality: '2K', count: undefined });
    expect(fitImageToolSelection('m', undefined, { aspectRatio: '21:9', quality: '4K' }))
      .toEqual({ aspectRatio: '21:9', quality: '4K' });
  });
});
