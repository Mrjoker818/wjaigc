// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDramaProject, type DramaProjectV1 } from '@/lib/drama/types';

vi.mock('@/components/drama/drama-shell', () => ({ DramaShell: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import DramaWorkbench from '@/components/drama/drama-workbench';

const original = '  第1集 雨夜\r\n第1场 咖啡馆 内 夜\r\n林夏：你还在等我？\r\n';
const previewDoc = () => ({
  ...createEmptyDramaProject({ title: '雨夜' }),
  sourceScript: { originalText: original, format: 'text', importedAt: 123 },
  episodes: [{ id: 'ep1', index: 0, title: '第1集', logline: '', script: original, structuredScript: original,
    scenes: [{ id: 'sc1', heading: '咖啡馆', summary: '林夏：你还在等我？', shots: [] }] }],
});
const preview = () => ({ success: true, doc: previewDoc(), warnings: ['第 1 集的时间需复核'], stats: { episodes: 1, scenes: 1, characters: 1, dialogues: 1 } });
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
let requests: Array<{ url: string; init?: RequestInit }>;
let importReply: (init?: RequestInit) => Promise<Response>;
let createReply: ((init?: RequestInit) => Promise<Response>) | undefined;
const start = async () => {
  const onOpen = vi.fn();
  render(<DramaWorkbench dramaId={null} projectId="canvas_1" onDramaIdChange={onOpen} onExit={() => undefined} />);
  fireEvent.click(await screen.findByRole('button', { name: '导入已有剧本' }));
  return { onOpen, panel: within(screen.getByRole('region', { name: '已有剧本' })) };
};
const parse = async () => {
  fireEvent.change(screen.getByRole('textbox', { name: '剧本原文' }), { target: { value: original } });
  fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
  await screen.findByRole('button', { name: '确认创建短剧' });
};
beforeEach(() => {
  requests = [];
  importReply = async () => reply(preview());
  createReply = undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === '/api/drama/import-script') return importReply(init);
    if (url.startsWith('/api/drama/projects?projectId=')) return reply({ projects: [] });
    if (url === '/api/drama/projects' && init?.method === 'POST') {
      if (createReply) return createReply(init);
      const { doc } = JSON.parse(String(init.body)) as { doc: DramaProjectV1 };
      return reply({ project: { id: 'created_1', projectId: 'canvas_1', doc, title: doc.title, version: 1, createdAt: 1, updatedAt: 1 } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('existing-script entry and preview', () => {
  it('keeps idea, novel and package entries and previews without saving or generating', async () => {
    const { panel, onOpen } = await start();
    expect(screen.getByRole('button', { name: '生成剧本' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始改编' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择制作包' })).toBeTruthy();
    await parse();
    expect(panel.getByText('第 1 集的时间需复核')).toBeTruthy();
    expect(panel.getByLabelText('导入原文').textContent).toBe(original);
    for (const label of ['分集', '分场', '角色', '台词']) expect(panel.getByText(label)).toBeTruthy();
    const request = requests.find(item => item.url === '/api/drama/import-script')!;
    expect(JSON.parse(String(request.init?.body))).toMatchObject({ text: original.replace(/\r\n/g, '\n'), format: 'text', style: 'cinematic', aspectRatio: '9:16' });
    expect(requests.filter(item => item.init?.method === 'POST').map(item => item.url)).toEqual(['/api/drama/import-script']);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(panel.getByRole('button', { name: '确认创建短剧' }));
    await screen.findByRole('button', { name: '确认创建短剧' });
    await act(async () => undefined);
    const saved = requests.find(item => item.url === '/api/drama/projects')!;
    expect(JSON.parse(String(saved.init?.body))).toEqual({ doc: previewDoc(), projectId: 'canvas_1' });
    expect(onOpen).toHaveBeenCalledWith('created_1');
  });

  it.each(['剧本原文', '剧本片名', '剧本视觉风格'])('invalidates parsed preview after changing %s', async label => {
    await start(); await parse();
    fireEvent.change(screen.getByLabelText(label), { target: { value: label === '剧本视觉风格' ? 'anime' : '新的正文或片名' } });
    expect(screen.queryByRole('button', { name: '确认创建短剧' })).toBeNull();
    expect(requests.some(item => item.url === '/api/drama/projects')).toBe(false);
  });

  it('invalidates parsed preview when the aspect ratio changes', async () => {
    const { panel } = await start(); await parse();
    fireEvent.click(panel.getByRole('button', { name: '16:9' }));
    expect(screen.queryByRole('button', { name: '确认创建短剧' })).toBeNull();
  });

  it.each(['txt', 'docx'])('uploads %s as multipart without attempting local generation', async format => {
    await start();
    const file = new File(['fixture'], `雨夜.${format}`);
    fireEvent.change(screen.getByLabelText('剧本文件'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
    await screen.findByRole('button', { name: '确认创建短剧' });
    const body = requests.find(item => item.url === '/api/drama/import-script')!.init?.body as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('style')).toBe('cinematic');
    expect(body.get('aspectRatio')).toBe('9:16');
  });

  it('blocks empty, unsupported and oversized input before requesting parsing', async () => {
    await start();
    expect((screen.getByRole('button', { name: '解析预览' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('剧本文件'), { target: { files: [new File(['x'], 'script.pdf')] } });
    expect(screen.getByRole('alert').textContent).toMatch(/TXT.*DOCX/);
    const huge = new File(['x'], 'large.docx');
    Object.defineProperty(huge, 'size', { value: 20 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('剧本文件'), { target: { files: [huge] } });
    expect(screen.getByRole('alert').textContent).toMatch(/过大|超过/);
    fireEvent.change(screen.getByRole('textbox', { name: '剧本原文' }), { target: { value: '字'.repeat(200001) } });
    fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
    expect(requests.some(item => item.url === '/api/drama/import-script')).toBe(false);
  });

  it('ignores an obsolete response after input changes and permits a fresh preview', async () => {
    let resolve!: (response: Response) => void;
    importReply = () => new Promise(done => { resolve = done; });
    await start();
    fireEvent.change(screen.getByLabelText('剧本原文'), { target: { value: original } });
    fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
    const signal = requests.find(item => item.url === '/api/drama/import-script')!.init?.signal;
    fireEvent.change(screen.getByLabelText('剧本原文'), { target: { value: '新的剧本' } });
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(reply(preview())));
    expect(screen.queryByRole('button', { name: '确认创建短剧' })).toBeNull();
    importReply = async () => reply(preview());
    fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
    expect(await screen.findByRole('button', { name: '确认创建短剧' })).toBeTruthy();
  });

  it('cancels parsing and closes without accepting a late response', async () => {
    let resolve!: (response: Response) => void;
    importReply = () => new Promise(done => { resolve = done; });
    await start();
    fireEvent.change(screen.getByLabelText('剧本原文'), { target: { value: original } });
    fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
    fireEvent.click(screen.getByRole('button', { name: '取消解析' }));
    expect(requests.find(item => item.url === '/api/drama/import-script')!.init?.signal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '关闭已有剧本' }));
    await act(async () => resolve(reply(preview())));
    expect(screen.queryByLabelText('剧本原文')).toBeNull();
    expect(screen.queryByRole('button', { name: '确认创建短剧' })).toBeNull();
  });

  it('bounds a stalled parsing request and releases other creation forms', async () => {
    await start();
    vi.useFakeTimers();
    importReply = () => new Promise(() => undefined);
    fireEvent.change(screen.getByLabelText('剧本原文'), { target: { value: original } });
    fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
    await act(async () => vi.advanceTimersByTime(31000));
    expect(screen.getByRole('alert').textContent).toMatch(/超时/);
    expect(requests.find(item => item.url === '/api/drama/import-script')!.init?.signal?.aborted).toBe(true);
    expect((screen.getByRole('button', { name: '选择制作包' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    { data: { error: '没有视频平台权限' }, status: 403, message: /视频平台权限/ },
    { data: { success: true }, status: 200, message: /解析.*(无效|不完整|失败)/ },
  ])('reports permission or malformed response errors without creating', async ({ data, status, message }) => {
    importReply = async () => reply(data, status);
    await start();
    fireEvent.change(screen.getByLabelText('剧本原文'), { target: { value: original } });
    fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    expect(screen.queryByRole('button', { name: '确认创建短剧' })).toBeNull();
    expect(requests.some(item => item.url === '/api/drama/projects')).toBe(false);
  });

  it('keeps the preview on save failure and prevents duplicate clicks while saving', async () => {
    let resolve!: (response: Response) => void;
    createReply = () => new Promise(done => { resolve = done; });
    await start(); await parse();
    const button = screen.getByRole('button', { name: '确认创建短剧' });
    fireEvent.click(button); fireEvent.click(button);
    expect(requests.filter(item => item.url === '/api/drama/projects')).toHaveLength(1);
    await act(async () => resolve(reply({ error: '保存失败，请重试' }, 400)));
    expect((await screen.findByRole('alert')).textContent).toContain('保存失败');
    expect(screen.getByRole('button', { name: '确认创建短剧' })).toBeTruthy();
    expect(screen.getByLabelText('导入原文').textContent).toBe(original);
  });

  it('releases parsing busy state when the canvas project changes', async () => {
    importReply = () => new Promise(() => undefined);
    const props = { dramaId: null, onDramaIdChange: () => undefined, onExit: () => undefined };
    const view = render(<DramaWorkbench {...props} projectId="canvas_1" />);
    fireEvent.click(await screen.findByRole('button', { name: '导入已有剧本' }));
    fireEvent.change(screen.getByLabelText('剧本原文'), { target: { value: original } });
    fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
    view.rerender(<DramaWorkbench {...props} projectId="canvas_2" />);
    expect(requests.find(item => item.url === '/api/drama/import-script')!.init?.signal?.aborted).toBe(true);
    expect((screen.getByRole('button', { name: '导入已有剧本' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('explains an uncertain save result and offers list recovery instead of a duplicate save', async () => {
    createReply = async () => { throw new TypeError('Failed to fetch'); };
    await start(); await parse();
    fireEvent.click(screen.getByRole('button', { name: '确认创建短剧' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/未确认.*列表/);
    expect((screen.getByRole('button', { name: '确认创建短剧' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '返回短剧列表' }));
    expect(screen.queryByLabelText('剧本原文')).toBeNull();
    expect(requests.filter(item => item.url.includes('/api/drama/projects?'))).toHaveLength(2);
  });

  it('blocks another creation after an unreadable successful creation response', async () => {
    createReply = async () => new Response('{"project":', { status: 201, headers: { 'Content-Type': 'application/json' } });
    await start(); await parse();
    fireEvent.click(screen.getByRole('button', { name: '确认创建短剧' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/未确认.*列表/);
    const button = screen.getByRole('button', { name: '确认创建短剧' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button);
    expect(requests.filter(item => item.url === '/api/drama/projects')).toHaveLength(1);
  });

  it('bounds a stalled save and requires checking the project list before another creation', async () => {
    createReply = () => new Promise(() => undefined);
    await start(); await parse();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '确认创建短剧' }));
    await act(async () => vi.advanceTimersByTime(31000));
    expect(screen.getByRole('alert').textContent).toMatch(/未确认.*列表/);
    expect(requests.find(item => item.url === '/api/drama/projects')!.init?.signal?.aborted).toBe(true);
    expect((screen.getByRole('button', { name: '确认创建短剧' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '选择制作包' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
