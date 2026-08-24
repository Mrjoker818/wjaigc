import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { sanitizeAdminProvider, sanitizeProvider } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';

describe('sanitizeProvider', () => {
  it('removes API and balance credentials from public provider data', () => {
    const provider = {
      id: 'provider-1',
      name: 'Example',
      baseUrl: 'https://api.example.com',
      apiKey: 'test-api-key',
      isEnabled: true,
      type: 'image',
      createdAt: 1,
      updatedAt: 1,
      balanceUsername: 'balance-user',
      balancePassword: 'balance-password',
      balance_password: 'legacy-balance-password',
      advancedParams: { internalToken: 'hidden' },
    } as ApiProvider & { balance_password: string };

    const publicProvider = sanitizeProvider(provider);

    expect(publicProvider).toMatchObject({ id: 'provider-1', name: 'Example', isEnabled: true });
    expect(publicProvider).not.toHaveProperty('apiKey');
    expect(publicProvider).not.toHaveProperty('apiKeyPreview');
    expect(publicProvider).not.toHaveProperty('balanceUsername');
    expect(publicProvider).not.toHaveProperty('balancePassword');
    expect(publicProvider).not.toHaveProperty('balance_password');
    expect(publicProvider).not.toHaveProperty('advancedParams');
  });

  it('keeps editable advanced parameters for administrators without exposing credentials', () => {
    const provider = {
      id: 'provider-1',
      name: 'Example',
      baseUrl: 'https://api.example.com',
      apiKey: 'test-api-key',
      isEnabled: true,
      type: 'image',
      createdAt: 1,
      updatedAt: 1,
      balanceUsername: 'balance-user',
      balancePassword: 'balance-password',
      advancedParams: {
        compatProfile: 'pearapi',
        customHeader: 'x-client',
        taskModelCapabilities: '{"version":1,"models":{}}',
      },
    } as ApiProvider;

    const adminProvider = sanitizeAdminProvider(provider);

    expect(adminProvider.advancedParams).toEqual(provider.advancedParams);
    expect(adminProvider).not.toHaveProperty('apiKey');
    expect(adminProvider).not.toHaveProperty('balanceUsername');
    expect(adminProvider).not.toHaveProperty('balancePassword');
  });
});
