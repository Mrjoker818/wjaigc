// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSkillRun } from '@/components/skill-runtime/use-skill-run';

vi.mock('@/components/agent-runtime/use-agent-run-events', () => ({
  useAgentRunEvents: vi.fn(() => ({ projection: undefined, stale: false })),
}));

const identity = {
  runId: 'paused-run', projectId: 'project-1', surface: 'canvas' as const,
  skillId: 'preset-food-photography',
};

function response(body: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => body } as Response;
}

describe('restore an existing Skill run after remount', () => {
  it('reattaches an owned scoped run without creating or resuming it', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ run: identity }));
    const { result } = renderHook(() => useSkillRun({ fetcher }));

    await act(async () => { await result.current.restoreRun(identity); });

    expect(result.current.runId).toBe(identity.runId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/skill-runs/paused-run?observeOnly=true',
      expect.objectContaining({ method: 'GET' }));
  });

  it.each([
    { projectId: 'another-project' },
    { surface: 'simple-chat' },
    { skillId: 'another-skill' },
    { runId: 'another-run' },
  ])('rejects a response from another scope: %j', async mismatch => {
    const fetcher = vi.fn().mockResolvedValue(response({ run: { ...identity, ...mismatch } }));
    const { result } = renderHook(() => useSkillRun({ fetcher }));

    await act(async () => { await result.current.restoreRun(identity); });

    expect(result.current.runId).toBeUndefined();
    expect(result.current.error).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not reattach a late response after leaving the project', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    const { result } = renderHook(() => useSkillRun({ fetcher }));
    let restoring!: Promise<string | undefined>;
    act(() => { restoring = result.current.restoreRun(identity); });
    act(() => { result.current.reset(); });
    await act(async () => { resolve(response({ run: identity })); await restoring; });

    expect(result.current.runId).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it('keeps ownership rejection visible without creating a replacement run', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: 'Run not found' }, 404));
    const { result } = renderHook(() => useSkillRun({ fetcher }));
    await act(async () => { await result.current.restoreRun(identity); });
    expect(result.current.error).toBe('Run not found');
    expect(result.current.runId).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
