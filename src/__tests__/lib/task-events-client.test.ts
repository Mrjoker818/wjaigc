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
});
