import { describe, expect, it, vi } from 'vitest';
import { resolveSimpleChatCanvasReference } from '@/components/simple-chat/simple-chat-types';

const tuple = { projectId: 'shared', assetVersionId: 'version', placementId: 'placement' };
const reference = { url: '/canonical.png', assetVersionId: 'version', placementId: 'placement' };

describe('simple chat canonical reference scope', () => {
  it('sends only the exact tuple plus expected actor and abort context', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(reference)));
    await expect(resolveSimpleChatCanvasReference(tuple, fetcher, {
      expectedActorUserId: 'editor', signal: controller.signal, isCurrent: () => true,
    })).resolves.toEqual(reference);
    expect(fetcher).toHaveBeenCalledWith('/api/assets', expect.objectContaining({
      method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': 'editor' },
      body: JSON.stringify(tuple),
    }));
  });

  it('rejects scope changes during both fetch and JSON reading without a URL fallback', async () => {
    for (const phase of ['fetch', 'json']) {
      let current = true;
      const fetcher: typeof fetch = async () => {
        if (phase === 'fetch') current = false;
        return { ok: true, status: 200, json: async () => { current = false; return reference; } } as Response;
      };
      await expect(resolveSimpleChatCanvasReference(tuple, fetcher, { isCurrent: () => current }))
        .rejects.toThrow('BRIDGE_CONSUMPTION_CANCELLED');
    }
  });

  it('does not even fetch when its captured scope has been aborted', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(reference)));
    await expect(resolveSimpleChatCanvasReference(tuple, fetcher, { signal: controller.signal }))
      .rejects.toThrow('BRIDGE_CONSUMPTION_CANCELLED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps shared 403 and actor-flip 409 failures rejecting', async () => {
    for (const status of [403, 409]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'DENIED' }), { status }));
      await expect(resolveSimpleChatCanvasReference(tuple, fetcher)).rejects.toMatchObject({ status });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
});
