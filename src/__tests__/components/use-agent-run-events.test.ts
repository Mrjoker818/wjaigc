import { describe, expect, it, vi } from 'vitest';

import {
  cancelAgentRunRequest,
  initialAgentRunProjection,
  loadAgentRunEvents,
} from '@/components/agent-runtime/use-agent-run-events';

describe('shared Agent run event client', () => {
  it('provides visible queued progress on the first render with a real run ID', () => {
    expect(initialAgentRunProjection('run-1')).toMatchObject({
      runId: 'run-1',
      status: 'created',
      lastSequence: 0,
    });
  });

  it('recovers incremental persisted events from sequence zero after refresh', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [{
          eventId: 'created', runId: 'run-1', sequence: 1, type: 'run.created',
          timestamp: new Date(1).toISOString(), payload: { workspace: 'canvas' },
        }],
      }),
    });

    await expect(loadAgentRunEvents('run-1', 0, fetcher as unknown as typeof fetch))
      .resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith('/api/agent-runs/run-1/events?after=0');
  });

  it('cancels the exact adopted run through the shared runtime endpoint', async () => {
    const projection = initialAgentRunProjection('run-1');
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projection: { ...projection, status: 'cancelled' } }),
    });

    await expect(cancelAgentRunRequest('run-1', fetcher as unknown as typeof fetch))
      .resolves.toMatchObject({ runId: 'run-1', status: 'cancelled' });
    expect(fetcher).toHaveBeenCalledWith('/api/agent-runs/run-1', { method: 'DELETE' });
  });
});
