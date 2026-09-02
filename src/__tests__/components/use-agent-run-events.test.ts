import { describe, expect, it, vi } from 'vitest';

import {
  cancelAgentRunRequest,
  createAgentRunEventPoller,
  initialAgentRunProjection,
  loadAgentRunEvents,
  pauseAgentRunRequest,
  resumeAgentRunRequest,
} from '@/components/agent-runtime/use-agent-run-events';
import type { AgentEvent, AgentRunProjection } from '@/lib/agent-runtime/types';

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

  it.each([
    ['pause', { action: 'pause', nextStepId: 'generate-2' }],
    ['resume', { action: 'resume' }],
  ] as const)('sends %s through the existing run PATCH endpoint', async (_name, body) => {
    const projection = {
      ...initialAgentRunProjection('run-1'),
      status: body.action === 'pause' ? 'paused' as const : 'queued' as const,
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projection }),
    });

    const controlled = body.action === 'pause'
      ? pauseAgentRunRequest('run-1', 'generate-2', fetcher as unknown as typeof fetch)
      : resumeAgentRunRequest('run-1', fetcher as unknown as typeof fetch);
    await expect(controlled).resolves.toMatchObject({
      runId: 'run-1', status: projection.status,
    });
    expect(fetcher).toHaveBeenCalledWith('/api/agent-runs/run-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  });

  it('stops polling at paused so resume can start a fresh poller generation', async () => {
    const load = vi.fn().mockResolvedValue([{
      eventId: 'paused', runId: 'run-1', sequence: 1, type: 'run.paused',
      timestamp: new Date(1).toISOString(), payload: { nextStepId: 'generate-2' },
    } satisfies AgentEvent]);
    const poller = createAgentRunEventPoller({
      runId: 'run-1', load, onProjection: vi.fn(), onStale: vi.fn(),
    });

    await poller.poll();
    await poller.poll();

    expect(load).toHaveBeenCalledTimes(1);
    expect(poller.isActive()).toBe(false);
  });

  it('serializes in-flight polling and stops permanently on a terminal projection', async () => {
    let resolveRequest!: (value: AgentEvent[]) => void;
    const load = vi.fn(() => new Promise<AgentEvent[]>(resolve => { resolveRequest = resolve; }));
    const projections: AgentRunProjection[] = [];
    const poller = createAgentRunEventPoller({
      runId: 'run-1',
      load,
      onProjection: projection => projections.push(projection),
      onStale: vi.fn(),
    });

    const first = poller.poll();
    const overlapping = poller.poll();
    expect(load).toHaveBeenCalledTimes(1);
    resolveRequest([{
      eventId: 'completed', runId: 'run-1', sequence: 1, type: 'run.completed',
      timestamp: new Date(1).toISOString(), payload: { result: { ok: true } },
    }]);
    await Promise.all([first, overlapping]);

    expect(projections.at(-1)?.status).toBe('completed');
    await poller.poll();
    expect(load).toHaveBeenCalledTimes(1);
    expect(poller.isActive()).toBe(false);
  });

  it('aborts cleanup and ignores a late response from the stopped run generation', async () => {
    let resolveRequest!: (value: AgentEvent[]) => void;
    let requestSignal: AbortSignal | undefined;
    const load = vi.fn((_runId: string, _after: number, signal: AbortSignal) => {
      requestSignal = signal;
      return new Promise<AgentEvent[]>(resolve => { resolveRequest = resolve; });
    });
    const onProjection = vi.fn();
    const onStale = vi.fn();
    const poller = createAgentRunEventPoller({
      runId: 'run-old', load, onProjection, onStale,
    });

    const pending = poller.poll();
    poller.stop();
    expect(requestSignal?.aborted).toBe(true);
    resolveRequest([{
      eventId: 'old-progress', runId: 'run-old', sequence: 1, type: 'tool.progress',
      timestamp: new Date(1).toISOString(), payload: { progress: 50 },
    }]);
    await pending;

    expect(onProjection).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
  });
});
