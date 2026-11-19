// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDramaScriptResponse } from '@/lib/drama/planner';
import { setSceneShots } from '@/lib/drama/workbench-state';
import type { DramaProjectV1, DramaShot } from '@/lib/drama/types';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const catalog = vi.hoisted(() => ({ voice: true }));
vi.mock('@/hooks/use-task-model-catalog', () => ({
  useTaskModelCatalog: (type: string) => ({
    models: type === 'audio' && !catalog.voice ? [] : [{ id: 'kling', name: 'Kling', providerId: 'pear', providerName: 'Pear', isDefault: true }],
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
  catalog.voice = true;
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
    if (url === '/api/generate') return json({ success: true, imageUrl: `/g/${body.aspectRatio === '2:3' ? 'cast' : 'other'}-${requests.filter(r => r.url === '/api/generate').length}.png` });
    if (url === '/api/drama/music') return json({ success: true, audioUrl: '/api/serve-upload/generated-audio/tts_1.mp3', name: '雨夜.mp3' });
    if (url === '/api/drama/clip') return json({ success: true, videoUrl: '/c/clip-1.mp4' });
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

  it('imports a production package as a new drama and explains a file that is not one', async () => {
    const onDramaIdChange = vi.fn();
    const { buildEpisodePackage } = await import('@/lib/drama/export-client');
    const doc = projectDoc();
    const exported = await buildEpisodePackage(doc, doc.episodes[0].id, { fetch: async url => new Response(`bytes:${url}`) });
    render(<DramaWorkbench dramaId={null} projectId="p1" onDramaIdChange={onDramaIdChange} onExit={() => undefined} />);
    expect(screen.getByRole('button', { name: '选择制作包' })).toBeTruthy();
    const input = document.querySelector('input[accept=".zip,application/zip"]') as HTMLInputElement;

    const notZip = new File(['hello'], 'a.zip', { type: 'application/zip' });
    Object.defineProperty(notZip, 'arrayBuffer', { value: async () => new TextEncoder().encode('hello').buffer });
    fireEvent.change(input, { target: { files: [notZip] } });
    expect((await screen.findByRole('alert')).textContent).toContain('不是 ZIP 压缩包');

    // jsdom's Blob has no arrayBuffer(); FileReader reads it the way an older browser would.
    const bytes = await new Promise<ArrayBuffer>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(exported.blob);
    });
    const pack = new File([bytes], '雨夜来信_制作包.zip', { type: 'application/zip' });
    Object.defineProperty(pack, 'arrayBuffer', { value: async () => bytes });
    fireEvent.change(input, { target: { files: [pack] } });
    await waitFor(() => expect(onDramaIdChange).toHaveBeenCalledWith('drama_1'));
    const created = requests.find(r => r.url === '/api/drama/projects' && r.method === 'POST')?.body as { doc: DramaProjectV1; projectId: string };
    expect(created.projectId).toBe('p1');
    expect(created.doc.title).toBe('雨夜来信');
    expect(requests.filter(r => r.url === '/api/drama/clip')).toHaveLength(1);
    expect(created.doc.episodes[0].scenes[0].shots[0].takes[0].videoUrl).toBe('/c/clip-1.mp4');
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

  it('shows four angles per character and draws the others from the front image', async () => {
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined} />);
    await screen.findByRole('heading', { name: /咖啡馆·内·夜/ });
    goTo(/^2\s*设定/);
    for (const label of ['生成正面', '生成侧面', '生成背面', '生成面部']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    // Without a front image the side view is drawn from the description alone.
    fireEvent.click(screen.getByRole('button', { name: '生成侧面' }));
    expect(await screen.findByRole('img', { name: '侧面定妆图' })).toBeTruthy();
    expect((requests.find(r => r.url === '/api/generate')?.body as { referenceImages?: string[] }).referenceImages).toBeUndefined();
    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'front.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('img', { name: '正面定妆图' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '生成背面' }));
    expect(await screen.findByRole('img', { name: '背面定妆图' })).toBeTruthy();
    const back = requests.filter(r => r.url === '/api/generate').at(-1)?.body as { prompt: string; referenceImages?: string[]; model?: string };
    expect(back.referenceImages).toEqual(['/u/upload-1.png']);
    expect(back.model).toBe('pear::kling');
    expect(back.prompt).toContain('back view');
    await waitFor(() => expect(saved?.cast[0]).toMatchObject({ imageUrlFront: '/u/upload-1.png', imageUrlBack: '/g/cast-2.png' }), { timeout: 3000 });
  });

  it('picks a canvas picture as a character view and sends images and shots back to the canvas', async () => {
    const onPlaceImageOnCanvas = vi.fn();
    const onPlaceOnCanvas = vi.fn();
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined}
      canvasMedia={[{ url: '/canvas/rain.png', prompt: '雨夜街景' }, { url: 'blob:x' }]}
      onPlaceImageOnCanvas={onPlaceImageOnCanvas} onPlaceOnCanvas={onPlaceOnCanvas} />);
    await screen.findByRole('heading', { name: /咖啡馆·内·夜/ });
    goTo(/^2\s*设定/);
    fireEvent.click(screen.getByRole('button', { name: '从素材库选正面' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('heading', { name: '从素材库选林夏正面' })).toBeTruthy();
    await waitFor(() => expect(dialog.queryByText('正在读取同项目的其他短剧')).toBeNull());
    fireEvent.click(dialog.getByRole('button', { name: '选用 雨夜街景' }));
    expect((await screen.findByRole('img', { name: '正面定妆图' })).getAttribute('src')).toBe('/canvas/rain.png');
    await waitFor(() => expect(saved?.cast[0].imageUrlFront).toBe('/canvas/rain.png'), { timeout: 3000 });
    expect(requests.some(r => r.url === '/api/generate' || r.url === '/api/upload')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '把正面放到画布' }));
    expect(onPlaceImageOnCanvas).toHaveBeenCalledWith({ url: '/canvas/rain.png', name: '林夏正面' });

    goTo(/^4\s*镜头/);
    fireEvent.click(screen.getByRole('button', { name: '把镜头 1 放到画布' }));
    expect(onPlaceOnCanvas).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: '/v/1.mp4', label: '雨夜来信 镜头 01', aspectRatio: '9:16' }));
    expect(screen.queryByRole('button', { name: '把镜头 2 放到画布' })).toBeNull();
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

  it('trims and speeds up the selected take for the film and can undo it', async () => {
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined} />);
    await screen.findByRole('heading', { name: /咖啡馆·内·夜/ });
    fireEvent.click(screen.getByRole('button', { name: '镜头 1，场 1，5 秒，已有视频' }));
    const panel = within(await screen.findByRole('region', { name: '剪辑' }));
    expect(panel.getByText('成片里约 5 秒 · 原片 5 秒')).toBeTruthy();
    fireEvent.change(panel.getByRole('spinbutton', { name: '入点 秒' }), { target: { value: '1' } });
    fireEvent.click(panel.getByRole('button', { name: '2×' }));
    expect(panel.getByText('成片里约 2 秒 · 原片 5 秒')).toBeTruthy();
    // The timeline follows the cut length.
    expect(screen.getByRole('button', { name: '镜头 1，场 1，2 秒，已有视频' })).toBeTruthy();
    await waitFor(() => expect(saved?.episodes[0].scenes[0].shots[0].clipEdit).toEqual({ trimStartSec: 1, speed: 2 }), { timeout: 3000 });
    fireEvent.click(panel.getByRole('button', { name: '还原' }));
    await waitFor(() => expect(saved?.episodes[0].scenes[0].shots[0]).not.toHaveProperty('clipEdit'), { timeout: 3000 });
    // A shot without a video has nothing to cut.
    fireEvent.click(screen.getByRole('button', { name: /^镜头 2，/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '剪辑' })).toBeNull());
  });

  it('puts a shot with only a first frame into the film as a moving still', async () => {
    const base = globalThis.fetch;
    // s2 has a keyframe but no video yet.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const response = await base(url, init);
      if (url !== '/api/drama/projects/drama_1' || init?.method) return response;
      const data = await response.json();
      data.project.doc.episodes[0].scenes[0].shots[1].firstFrameUrl = '/f/2.png';
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined} />);
    await screen.findByRole('heading', { name: /咖啡馆·内·夜/ });
    fireEvent.click(screen.getByRole('button', { name: '镜头 2，场 1，5 秒，待拍' }));
    const panel = within(await screen.findByRole('region', { name: '静帧镜头' }));
    fireEvent.click(panel.getByRole('checkbox', { name: '成片里用首帧加运镜代替视频' }));
    fireEvent.click(panel.getByRole('button', { name: '左移' }));
    expect(screen.getByRole('button', { name: '镜头 2，场 1，5 秒，静帧' })).toBeTruthy();
    await waitFor(() => expect(saved?.episodes[0].scenes[0].shots[1].still).toEqual({ motion: 'pan-left' }), { timeout: 3000 });

    goTo(/^5\s*成片/);
    expect((screen.getByRole('button', { name: '渲染成片' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/个镜头没有可用的视频/)).toBeNull();

    fireEvent.click(panel.getByRole('checkbox', { name: '成片里用首帧加运镜代替视频' }));
    await waitFor(() => expect(saved?.episodes[0].scenes[0].shots[1]).not.toHaveProperty('still'), { timeout: 3000 });
  });
  it('uploads a first frame without credits, which then offers the still', async () => {
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined} />);
    await screen.findByRole('heading', { name: /咖啡馆·内·夜/ });
    fireEvent.click(screen.getByRole('button', { name: '镜头 2，场 1，5 秒，待拍' }));
    const inspector = within(await screen.findByRole('complementary', { name: '镜头检查器' }));
    expect(inspector.queryByRole('region', { name: '静帧镜头' })).toBeNull();
    expect(inspector.getByRole('button', { name: '上传首帧' })).toBeTruthy();
    const input = inspector.getByRole('region', { name: '关键帧' }).querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'f.png', { type: 'image/png' })] } });
    expect(await inspector.findByRole('img', { name: '这一镜的关键帧' })).toBeTruthy();
    expect(inspector.getByRole('region', { name: '静帧镜头' })).toBeTruthy();
    await waitFor(() => expect(saved?.episodes[0].scenes[0].shots[1].firstFrameUrl).toBe('/u/upload-1.png'), { timeout: 3000 });
    expect(requests.some(r => r.url === '/api/generate')).toBe(false);
  });

  it('says a voice model is missing instead of sending lines that will fail', async () => {
    catalog.voice = false;
    render(<DramaWorkbench dramaId="drama_1" projectId="p1" onDramaIdChange={() => undefined} onExit={() => undefined} />);
    await screen.findByRole('heading', { name: /咖啡馆·内·夜/ });
    goTo(/^5\s*成片/);
    expect((screen.getByRole('button', { name: '为 1 句台词生成配音' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/后台还没有可用的语音模型/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清点还缺什么' }));
    const panel = within(screen.getByRole('region', { name: '一键成片' }));
    expect(await panel.findByText('后台没有语音模型，跳过')).toBeTruthy();
    expect(requests.some(r => r.url === '/api/audio/generate')).toBe(false);
  });
});
