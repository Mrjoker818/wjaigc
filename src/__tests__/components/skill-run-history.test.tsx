// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillRunHistory } from '@/components/skill-runtime/SkillRunHistory';

afterEach(cleanup);
const scope = { projectId: 'p1', surface: 'canvas' as const, skillId: 'food', accountKey: 'u1' };
const run = { runId: 'old-run', projectId: 'p1', surface: 'canvas', skillId: 'food',
  skillVersion: 2, workspaceId: 'old-session', sourceVersionIds: ['version-1'],
  inputValues: { platform: 'Amazon' },
  modelBindings: { vision: { providerId: 'pear', modelId: 'vision-1' } },
  status: 'paused', createdAt: 1, updatedAt: 2 };
const response = (runs: unknown[]): Response => ({ ok: true, json: async () => ({ runs }) }) as Response;

describe('Skill run history list', () => {
  it('loads scoped history read-only and requires a click to observe an old run', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([run]));
    const onSelect = vi.fn();
    render(<SkillRunHistory {...scope} fetcher={fetcher} onSelect={onSelect} />);
    const button = await screen.findByRole('button', { name: /查看任务 old-run/ });
    expect(onSelect).not.toHaveBeenCalled();
    const url = new URL(fetcher.mock.calls[0][0], 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({ projectId: 'p1', surface: 'canvas', skillId: 'food', observeOnly: 'true', limit: '20' });
    expect(fetcher.mock.calls[0][1].method).toBe('GET');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ runId: 'old-run', workspaceId: 'old-session' }));
  });

  it.each(['projectId', 'accountKey'] as const)('ignores a late history response after %s changes', async key => {
    let resolveOld!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValue(response([]));
    const view = render(<SkillRunHistory {...scope} fetcher={fetcher} onSelect={vi.fn()} />);
    view.rerender(<SkillRunHistory {...scope} {...{ [key]: 'different' }} fetcher={fetcher} onSelect={vi.fn()} />);
    await screen.findByText('暂无运行记录');
    await act(async () => resolveOld(response([run])));
    expect(screen.queryByRole('button', { name: /查看任务 old-run/ })).toBeNull();
  });

  it('rejects invalid history data and offers an explicit retry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ runs: 'invalid' }) })
      .mockResolvedValue(response([run]));
    render(<SkillRunHistory {...scope} fetcher={fetcher} onSelect={vi.fn()} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '刷新运行记录' }));
    await screen.findByRole('button', { name: /查看任务 old-run/ });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it('does not expose records from a different project or Skill', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([{ ...run, projectId: 'p2' }, { ...run, skillId: 'other' }]));
    render(<SkillRunHistory {...scope} fetcher={fetcher} onSelect={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /查看任务/ })).toBeNull();
  });

  it('keeps old and new records observable when one old summary has no workspaceId', async () => {
    const legacy = { ...run, runId: 'legacy-run', apiKey: 'must-not-reach-the-view' } as Record<string, unknown>;
    delete legacy.workspaceId;
    const onSelect = vi.fn();
    render(<SkillRunHistory {...scope} fetcher={vi.fn().mockResolvedValue(response([legacy, run]))} onSelect={onSelect} />);

    const legacyButton = await screen.findByRole('button', { name: /查看任务 legacy-run/ });
    expect(screen.getByRole('button', { name: /查看任务 old-run/ })).toBeTruthy();
    fireEvent.click(legacyButton);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ runId: 'legacy-run' }));
    expect(onSelect.mock.calls[0][0]).not.toHaveProperty('apiKey');
    expect(onSelect.mock.calls[0][0]).not.toHaveProperty('workspaceId');
  });

  it.each(['inputValues', 'modelBindings'] as const)(
    'keeps history without frozen %s observable for report-only restore',
    async field => {
      const legacy = { ...run } as Record<string, unknown>;
      delete legacy[field];
      const onSelect = vi.fn();
      render(<SkillRunHistory {...scope} fetcher={vi.fn().mockResolvedValue(response([legacy]))} onSelect={onSelect} />);
      fireEvent.click(await screen.findByRole('button', { name: /查看任务 old-run/ }));
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ runId: 'old-run' }));
    },
  );
});
