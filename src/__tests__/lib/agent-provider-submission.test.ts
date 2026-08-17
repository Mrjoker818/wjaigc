import { describe, expect, it, vi } from 'vitest';

import { submitAgentImageProviderRequest } from '@/lib/agent-runtime/provider-submission';

describe('Agent image provider submission', () => {
  it.each(['json', 'multipart'] as const)(
    'preserves Exact::Model in the final %s provider payload',
    async payloadKind => {
      const provider = vi.fn(async (
        _baseUrl: string,
        _path: string,
        options: RequestInit & { skipV1Retry?: boolean },
      ) => (
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      ));
      const body = payloadKind === 'multipart'
        ? new FormData()
        : { prompt: 'make it brighter', model: 'mutated-model' };

      await submitAgentImageProviderRequest({
        baseUrl: 'https://provider.example.com',
        path: payloadKind === 'multipart' ? '/images/edits' : '/images/generations',
        exactModel: 'Exact::Model',
        body,
        headers: { 'Idempotency-Key': 'stable-provider-key' },
        strictProviderModel: true,
        fetcher: provider,
      });

      expect(provider).toHaveBeenCalledTimes(1);
      const submitted = provider.mock.calls[0][2].body;
      const capturedModel = submitted instanceof FormData
        ? submitted.get('model')
        : JSON.parse(String(submitted)).model;
      expect(capturedModel).toBe('Exact::Model');
      expect(provider.mock.calls[0][2]).toMatchObject({ skipV1Retry: true });
    },
  );
});
