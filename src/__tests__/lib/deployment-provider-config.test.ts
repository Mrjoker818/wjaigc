import { describe, expect, it } from 'vitest';
import { parseDeploymentProviders } from '@/lib/deployment-provider-config';

const provider = {
  id: 'isolated-chat',
  name: 'Isolated Chat',
  baseUrl: 'https://model-provider.invalid/v1',
  apiKey: 'synthetic-provider-credential',
  modelType: 'chat',
  selectedModels: ['fixture-chat-2026', 'fixture-chat-mini'],
  requestStyle: 'chat-completions',
  advancedParams: { compatProfile: 'openai' },
};

describe('deployment provider configuration', () => {
  it('preserves exact provider and model identities with deployment defaults', () => {
    expect(parseDeploymentProviders(JSON.stringify([provider]))).toEqual([
      { ...provider, isEnabled: true, isDefault: false },
    ]);
  });

  it.each([
    [provider, { ...provider, name: 'Duplicate ID' }],
    [{ ...provider, baseUrl: 'file:///tmp/test-provider' }],
    [{ ...provider, selectedModels: [''] }],
    [{ ...provider, unexpected: 'synthetic-unsupported-field' }],
  ])('rejects invalid input without reporting its values', (...invalid) => {
    expect(() => parseDeploymentProviders(JSON.stringify(invalid))).toThrow(
      /^DEPLOYMENT_PROVIDER_CONFIGURATION_INVALID$/,
    );
  });
});
