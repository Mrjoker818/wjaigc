// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDramaScriptResponse } from '@/lib/drama/planner';
import { setSceneShots } from '@/lib/drama/workbench-state';
import type { DramaProjectV1, DramaShot } from '@/lib/drama/types';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/hooks/use-task-model-catalog', () => ({
  useTaskModelCatalog: () => ({
    models: [{ id: 'kling', name: 'Kling', providerId: 'pear', providerName: 'Pear', isDefault: true }],
    descriptorsByKey: new Map([['pear::kling', { supportedOperations: ['text-to-video', 'image-to-video'], supportsReferenceImages: true, maxReferenceImages: 2, allowedDurationsSeconds: [5, 10] }]]),
    loading: false, error: null, reload: async () => undefined,
  }),
}));
vi.mock('@/lib/task-core/model-capability-contract', () => ({ taskModelKey: (p: string, m: string) => `${p}::${m}` }));

import DramaWorkbench from '@/components/drama/drama-workbench';

const shot = (id: string, partial: Partial<DramaShot> = {}): DramaShot => ({
  id, index: 0, title: '', purpose: '', actionBeat: '', prompt: `画面${id}`, duration: 5, durationSec: 5, aspectRatio: '9:16',
  references: [], continuityNotes: [], status: 'planned', takes: [], ...partial,
});

function projectDoc(): DramaProjectV1 {
  const doc = parseDramaScriptResponse(JSON.stringify({
    title: '雨夜来信', cast: [{ id: 'lin', name: '林夏', appearance: '短发' }], locations: [{ id: 'cafe', name: '咖啡馆' }],
    episodes: [{ title: '第一集', script: '第 1 场', scenes: [{ heading: '咖啡馆·内·夜', summary: '收到信', locationId: 'cafe', characterIds: ['lin'] }] }],
  }), { idea: '雨夜收到信' }, 1000);
  return setSceneShots(doc, doc.episodes[0].scenes[0].id, [
    shot('s1', { dialogue: '是你？', takes: [{ id: 't1', status: 'completed', videoUrl: '/v/1.mp4', createdAt: 1 }], selectedTakeId: 't1' }),
    shot('s2'),
  ]);
}

let requests: Array<{ url: string; method: string; body: unknown }>;
let saved: DramaProjectV1 | null;

beforeEach(() => {
  requests = [];
  saved = null;
  const doc = projectDoc();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url, method: init?.method ?? 'GET', body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('/api/drama/projects?')) return json({ success: true, projects: [{ id: 'drama_1', title: '雨夜来信', version: 1, updatedAt: 1 }] });
    if (url === '/api/drama/projects/drama_1' && !init?.method) return json({ success: true, project: { id: 'drama_1', projectId: 'p1', title: doc.title, doc, version: 1, createdAt: 1, updatedAt: 1 } });
    if (url === '/api/drama/projects/drama_1' && init?.method === 'PUT') {
      saved = body.doc;
      return json({ success: true, project: { id: 'drama_1', projectId: 'p1', title: body.doc.title, doc: body.doc, version: body.version + 1, createdAt: 1, updatedAt: 2 } });
    }
    if (url === '/api/drama/estimate') return json({ success: true, total: 50, perShot: { s2: 50 }, balance: 20 });
    return json({ error: 'unexpected' }, 500);
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const goTo = (step: RegExp) => fireEvent.click(within(screen.getByRole('navigation', { name: '制作步骤' })).getByRole('button', { name: step }));

describe('drama workbench', () => {
  it('shows the one-sentence start and the project list when nothing is open', async () => {
    const onDramaIdChange = vi.fn();
    render(<DramaWorkbench dramaId={null} projectId="p1" onDramaIdChange={onDramaIdChange} onExit={() => undefined} />);
    expect(screen.getByRole('heading', { name: '用一句话开始一部短剧' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '生成剧本' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: /雨夜来信/ }));
    expect(onDramaIdChange).toHaveBeenCalledWith('drama_1');
  });

  it('opens a project on the board, walks every step and saves an edit', async () => {
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined} />);
    expect(await screen.findByRole('heading', { name: /咖啡馆·内·夜/ })).toBeTruthy();
    // The estimate covers the one shot without a take and shows how much is missing.
    expect(await screen.findByText(/待拍镜头约 50 积分，还差 30/)).toBeTruthy();

    goTo(/^2\s*设定/);
    expect(screen.getByRole('heading', { name: '角色（1）' })).toBeTruthy();
    goTo(/^4\s*镜头/);
    expect(screen.getByRole('button', { name: /按顺序生成 1 个待拍镜头/ })).toBeTruthy();
    goTo(/^5\s*成片/);
    expect(screen.getByRole('heading', { name: '成片设置' })).toBeTruthy();
    // The top bar opens the final step; it does not start a render by itself.
    goTo(/^3\s*分镜/);
    fireEvent.click(screen.getByRole('button', { name: '去成片' }));
    expect(screen.getByRole('heading', { name: '成片设置' })).toBeTruthy();

    goTo(/^1\s*剧本/);
    fireEvent.change(screen.getByRole('textbox', { name: '本集标题' }), { target: { value: '第一集·改' } });
    await waitFor(() => expect(saved?.episodes[0].title).toBe('第一集·改'), { timeout: 3000 });
    expect(requests.find(r => r.method === 'PUT')?.body).toMatchObject({ version: 1 });
  });

  it('blocks rendering while a shot has no video and explains why', async () => {
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined} />);
    await screen.findByRole('heading', { name: /咖啡馆·内·夜/ });
    goTo(/^5\s*成片/);
    expect((screen.getByRole('button', { name: '渲染成片' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('还有 1 个镜头没有可用的视频，先在镜头步骤里生成。')).toBeTruthy();
    expect(screen.getByText('是你？')).toBeTruthy();
    await act(async () => undefined);
    expect(requests.some(r => r.url === '/api/drama/render')).toBe(false);
  });
});
