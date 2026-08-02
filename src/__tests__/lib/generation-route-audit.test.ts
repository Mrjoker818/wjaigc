import { describe, expect, it } from 'vitest';
import { buildGenerationRouteAudit } from '@/lib/generation-route-audit';

describe('generation route audit', () => {
  it('keeps the user requested route separate from the route that executed', () => {
    expect(buildGenerationRouteAudit({
      requested: {
        providerId: 'ai-link',
        providerName: 'AI Link Image',
        modelId: 'gpt-image-2',
        modelName: 'GPT Image 2',
      },
      actual: {
        providerId: 'fhl',
        providerName: 'FHL Image',
        modelId: 'flux-1',
        modelName: 'Flux 1',
      },
      fallbackReason: 'AI Link Image returned a retryable 503 error',
    })).toEqual({
      requested: {
        providerId: 'ai-link',
        providerName: 'AI Link Image',
        modelId: 'gpt-image-2',
        modelName: 'GPT Image 2',
      },
      actual: {
        providerId: 'fhl',
        providerName: 'FHL Image',
        modelId: 'flux-1',
        modelName: 'Flux 1',
      },
      fallbackReason: 'AI Link Image returned a retryable 503 error',
    });
  });

  it('does not label the primary route as a fallback', () => {
    expect(buildGenerationRouteAudit({
      requested: {
        providerId: 'ai-link',
        providerName: 'AI Link Image',
        modelId: 'gpt-image-2',
        modelName: 'GPT Image 2',
      },
      actual: {
        providerId: 'ai-link',
        providerName: 'AI Link Image',
        modelId: 'gpt-image-2',
        modelName: 'GPT Image 2',
      },
      fallbackReason: 'should not be exposed',
    })).toEqual({
      requested: {
        providerId: 'ai-link',
        providerName: 'AI Link Image',
        modelId: 'gpt-image-2',
        modelName: 'GPT Image 2',
      },
      actual: {
        providerId: 'ai-link',
        providerName: 'AI Link Image',
        modelId: 'gpt-image-2',
        modelName: 'GPT Image 2',
      },
    });
  });

  it('rejects incomplete routing metadata rather than creating misleading audit data', () => {
    expect(buildGenerationRouteAudit({
      requested: {
        providerId: '',
        providerName: '',
        modelId: '',
        modelName: '',
      },
      actual: {
        providerId: 'fhl',
        providerName: 'FHL Image',
        modelId: 'flux-1',
        modelName: 'Flux 1',
      },
    })).toBeNull();
  });
});
