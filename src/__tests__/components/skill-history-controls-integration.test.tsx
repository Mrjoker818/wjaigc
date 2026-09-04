// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SkillRunHistory } from '@/components/skill-runtime/SkillRunHistory';
import { SkillRunProgress } from '@/components/skill-runtime/SkillRunProgress';
import { useSkillRun } from '@/components/skill-runtime/use-skill-run';
import type { AgentEvent } from '@/lib/agent-runtime/types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function HistoryControls(): React.ReactElement {
  const run = useSkillRun();
  return <>
    <SkillRunHistory projectId="p1" surface="canvas" skillId="food" accountKey="u1"
      busy={run.busy} activeRunId={run.runId} onSelect={record => { void run.restoreRun(record); }} />
    <SkillRunProgress projection={run.projection} busy={run.busy} stale={run.stale}
      onCancel={() => { void run.cancel(); }} />
  </>;
}

it('restores a persisted paused task from UI, then cancels only that task and renders its terminal event', async () => {
  let cancelled = false;
  const record = { runId: 'old-run', projectId: 'p1', surface: 'canvas', skillId: 'food',
    sourceVersionIds: [], status: 'paused', createdAt: 1 };
  const event = (sequence: number, type: AgentEvent['type']): AgentEvent => ({
    eventId: `e${sequence}`, runId: 'old-run', sequence, type, timestamp: new Date().toISOString(), payload: {},
  });
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(url);
    if (init?.method === 'PATCH') {
      expect(path).toBe('/api/skill-runs/old-run');
      expect(JSON.parse(String(init.body))).toEqual({ action: 'cancel' });
      cancelled = true;
      return Response.json({ accepted: true });
    }
    expect(init?.method || 'GET').toBe('GET');
    if (path.startsWith('/api/skill-runs?')) return Response.json({ runs: [record] });
    if (path === '/api/skill-runs/old-run?observeOnly=true') return Response.json({ run: record });
    expect(path).toContain('/api/agent-runs/old-run/events?after=');
    return Response.json({ events: [event(1, 'run.created'), event(2, 'run.paused'),
      ...(cancelled ? [event(3, 'run.cancelled')] : [])] });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<HistoryControls />);
  fireEvent.click(await screen.findByRole('button', { name: '查看任务 old-run' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '取消' })).toBeNull());
  expect(screen.getByText('已取消')).toBeTruthy();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
