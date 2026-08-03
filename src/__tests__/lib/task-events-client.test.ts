import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskEventsClient } from '@/lib/task-events-client';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
}

describe('TaskEventsClient', () => {
  afterEach(() => {
    MockEventSource.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not create an EventSource when there is no authenticated session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, user: null }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', MockEventSource);

    new TaskEventsClient().connect();

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({ credentials: 'include' }));
    });
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('opens the SSE stream only after session verification and never exposes a user ID in its URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, user: { id: 'admin-1' } }),
    }));
    vi.stubGlobal('EventSource', MockEventSource);

    new TaskEventsClient().connect();

    await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(MockEventSource.instances[0].url).toBe('/api/task-events');
  });

  it('preserves a server cancellation error so the canvas can show the real rejection reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: '任务不存在或无权取消',
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })));

    const result = await new TaskEventsClient().cancelTask('missing-task');

    expect(result).toEqual({
      success: false,
      message: '任务不存在或无权取消',
    });
  });
});
