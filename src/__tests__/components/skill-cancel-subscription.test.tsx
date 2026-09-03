// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSkillRun } from '@/components/skill-runtime/use-skill-run';
import type { AgentEvent } from '@/lib/agent-runtime/types';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('reloads cancellation events even when React batches the refresh timer', async () => {
  let cancelled = false;
  const event = (sequence: number, type: AgentEvent['type']): AgentEvent => ({
    eventId: `event-${sequence}`, runId: 'run-1', sequence, type,
    timestamp: new Date().toISOString(), payload: {},
  });
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ runId: 'run-1' });
    if (init?.method === 'PATCH') {
      cancelled = true;
      return Response.json({ accepted: true });
    }
    expect(String(url)).toContain('/events?after=');
    return Response.json({ events: [event(1, 'run.created'), event(2, 'run.paused'),
      ...(cancelled ? [event(3, 'run.cancelled')] : [])] });
  });
  vi.stubGlobal('fetch', fetcher);
  const { result, unmount } = renderHook(() => useSkillRun());
  await act(async () => { await result.current.startRun({
    skillId: 'test', skillVersion: 1, surface: 'canvas', projectId: 'project-1',
    workspaceId: 'workspace-1', inputValues: {}, sourceVersionIds: [],
    modelBindings: {}, idempotencyKey: 'test-cancel',
  }); });
  await waitFor(() => expect(result.current.projection?.status).toBe('paused'));
  vi.useFakeTimers();
  await act(async () => {
    await result.current.cancel();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(result.current.projection?.status).toBe('cancelled');
  unmount();
});
