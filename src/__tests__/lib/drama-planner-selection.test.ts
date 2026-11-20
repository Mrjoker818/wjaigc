import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ provider: null as Record<string, unknown> | null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForFeature: async () => state.provider,
  findProviderById: async (id: string) => state.provider?.id === id ? state.provider : null,
}));

import { dramaPlannerConfig, DramaPlannerSelectionError } from '@/lib/drama/draft';
import type { User } from '@/lib/user-types';

const user = { role: 'user', chatModels: ['p::chat-1'] } as User;
beforeEach(() => { state.provider = { id: 'p', type: 'chat', isEnabled: true, baseUrl: 'https://example.com/v1', apiKey: 'not-a-real-key', selectedModels: ['chat-1', 'chat-2'] }; });
describe('drama planner selection', () => {
  it('uses the exact enabled provider and authorized model, including a nonfirst selected model', async () => {
    const admin = { role: 'admin' } as User;
    expect(await dramaPlannerConfig(undefined, { user: admin, providerId: 'p', modelId: 'chat-2' })).toMatchObject({ modelId: 'chat-2' });
  });
  it('rejects partial, wrong-provider, disabled and user-revoked selections without fallback', async () => {
    for (const selection of [{ providerId: 'p' }, { providerId: 'other', modelId: 'chat-1' }, { providerId: 'p', modelId: 'chat-2' }, { providerId: 'p', modelId: 'unknown' }]) {
      await expect(dramaPlannerConfig(undefined, { user, ...selection })).rejects.toBeInstanceOf(DramaPlannerSelectionError);
    }
    state.provider!.isEnabled = false;
    await expect(dramaPlannerConfig(undefined, { user, providerId: 'p', modelId: 'chat-1' })).rejects.toBeInstanceOf(DramaPlannerSelectionError);
  });
  it('does not use a revoked default and retains the legacy system caller contract', async () => {
    expect(await dramaPlannerConfig(undefined, { user: { ...user, chatModels: ['other::chat-1'] } })).toBeNull();
    expect(await dramaPlannerConfig()).toMatchObject({ modelId: 'chat-1' });
  });
});
