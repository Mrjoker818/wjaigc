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
    if (url === '/api/drama/from-chat') return json({ success: true, project: { id: 'drama_1', projectId: 'p1', title: doc.title, doc, version: 1, createdAt: 1, updatedAt: 1 } }, 201);
    if (url === '/api/drama/projects' && init?.method === 'POST') return json({ success: true, project: { id: 'drama_1', projectId: 'p1', title: body.doc.title, doc: body.doc, version: 1, createdAt: 1, updatedAt: 1 } }, 201);
    if (url === '/api/drama/estimate') return json({ success: true, total: 50, perShot: { s2: 50 }, balance: 20 });
    if (url === '/api/drama/music') return json({ success: true, audioUrl: '/api/serve-upload/generated-audio/tts_1.mp3', name: '雨夜.mp3' });
    if (url === '/api/upload') return json({ success: true, url: `/u/upload-${requests.filter(r => r.url === '/api/upload').length}.png` });
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

  it('writes a simple chat message into one draft and opens it', async () => {
    const onDramaIdChange = vi.fn();
    const onChatHandoffDone = vi.fn();
    const chatHandoff = { targetProjectId: 'p1', chatProjectId: 'cp', chatTaskId: 'ct', chatMessageId: 'cm' };
    const { rerender } = render(<DramaWorkbench dramaId={null} projectId="p1" onDramaIdChange={onDramaIdChange} onExit={() => undefined}
      chatHandoff={chatHandoff} onChatHandoffDone={onChatHandoffDone} />);
    expect(screen.getByText(/正在把对话内容写成分场剧本/)).toBeTruthy();
    rerender(<DramaWorkbench dramaId={null} projectId="p1" onDramaIdChange={onDramaIdChange} onExit={() => undefined}
      chatHandoff={chatHandoff} onChatHandoffDone={onChatHandoffDone} />);
    await waitFor(() => expect(onDramaIdChange).toHaveBeenCalledWith('drama_1'));
    expect(onChatHandoffDone).toHaveBeenCalledOnce();
    expect(requests.filter(r => r.url === '/api/drama/from-chat')).toEqual([{ url: '/api/drama/from-chat', method: 'POST', body: chatHandoff }]);
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

  it('prices what one-click film would fill and will not start without enough credits', async () => {
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined} />);
    await screen.findByRole('heading', { name: /咖啡馆·内·夜/ });
    goTo(/^5\s*成片/);
    fireEvent.click(screen.getByRole('button', { name: '清点还缺什么' }));
    // The mock prices every stage at 50: bible images, s2's keyframe and s2's video.
    const start = await screen.findByRole('button', { name: '花约 150 积分开始' });
    const panel = within(screen.getByRole('region', { name: '一键成片' }));
    // The cast member and the location have no image, s2 has no first frame or video, s1's line has no recording.
    expect(panel.getByText('2 张')).toBeTruthy();
    expect(panel.getByText('1 张')).toBeTruthy();
    expect(panel.getByText('1 个')).toBeTruthy();
    expect(panel.getByText('1 句')).toBeTruthy();
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(panel.getByText(/还差 130，充值后再开始/)).toBeTruthy();
    const priced = requests.filter(r => r.url === '/api/drama/estimate').map(r => (r.body as { shots: Array<{ shotId: string }> }).shots.map(item => item.shotId));
    expect(priced).toContainEqual(['bible:cast:lin', 'bible:location:cafe']);
    expect(requests.some(r => r.url === '/api/generate' || r.url === '/api/video/generate')).toBe(false);

    // Leaving out the paid extras lowers the price to the shot videos alone.
    fireEvent.click(panel.getAllByRole('checkbox', { name: '要做' })[0]);
    fireEvent.click(panel.getAllByRole('checkbox', { name: '要做' })[1]);
    expect(panel.getByRole('button', { name: '花约 50 积分开始' })).toBeTruthy();
  });

  it('uploads a reference image without credits and keeps the replaced one to restore', async () => {
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined} />);
    await screen.findByRole('heading', { name: /咖啡馆·内·夜/ });
    goTo(/^2\s*设定/);
    const upload = (n: number) => {
      const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
      fireEvent.change(input, { target: { files: [new File([new Uint8Array([n])], `me${n}.png`, { type: 'image/png' })] } });
    };
    upload(1);
    expect(await screen.findByRole('img', { name: '正面定妆图' })).toBeTruthy();
    upload(2);
    const restore = await screen.findByRole('button', { name: '换回正面第 1 个旧版本' });
    await waitFor(() => expect(saved?.cast[0].imageUrlFront).toBe('/u/upload-2.png'), { timeout: 3000 });
    expect(saved?.cast[0].imageHistory).toEqual({ front: ['/u/upload-1.png'] });
    fireEvent.click(restore);
    await waitFor(() => expect(saved?.cast[0].imageUrlFront).toBe('/u/upload-1.png'), { timeout: 3000 });
    expect(saved?.cast[0].imageHistory).toEqual({ front: ['/u/upload-2.png'] });
    expect(requests.some(r => r.url === '/api/generate')).toBe(false);
  });

  it('adds background music with a level and ducking, and removes it again', async () => {
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined} />);
    await screen.findByRole('heading', { name: /咖啡馆·内·夜/ });
    goTo(/^5\s*成片/);
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="audio"]')!;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], '雨夜.mp3', { type: 'audio/mpeg' })] } });
    expect(await screen.findByText('雨夜.mp3')).toBeTruthy();
    await waitFor(() => expect(saved?.timeline.music).toEqual({ url: '/api/serve-upload/generated-audio/tts_1.mp3', name: '雨夜.mp3', volume: 0.3, ducking: true }), { timeout: 3000 });
    fireEvent.change(screen.getByRole('slider', { name: '背景音乐音量' }), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '有台词和原声时自动压低音乐' }));
    await waitFor(() => expect(saved?.timeline.music).toMatchObject({ volume: 0.6, ducking: false }), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: '去掉背景音乐' }));
    await waitFor(() => expect(saved?.timeline).not.toHaveProperty('music'), { timeout: 3000 });
  });
});
