// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatArea from '@/components/simple-chat/chat-area';
import { SkillTraceCard } from '@/components/simple-chat/skill-trace-card';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import { SIMPLE_CHAT_PRESET_SKILLS } from '@/lib/skill-runtime/simple-chat-presets';

const pdf = { title: '中文验收', type: 'markdown', content: '# 验收\n\n真实正文', theme: 'minimal-gray' };
const block = (value: unknown, language = 'json') => `\`\`\`${language}\n${JSON.stringify(value)}\n\`\`\``;
const pending = () => new Promise<Response>(() => {});

function renderChat(content?: string) {
  function Harness() {
    const [task, setTask] = useState<SimpleChatTask>({
      id: 'task-pdf', projectId: 'project-pdf', name: 'PDF', model: 'chosen-model', providerId: 'chosen-provider',
      createdAt: 1, updatedAt: 1,
      messages: content === undefined ? [] : [{
        id: 'reply-pdf', role: 'assistant', content, status: 'completed', createdAt: 2,
        skill: { id: 'pdf-master', name: 'PDF大师', source: 'command' },
      }],
    });
    const project: SimpleChatProject = {
      id: task.projectId, name: 'PDF project', createdAt: 1, updatedAt: 1, tasks: [task], agents: [], knowledgeItems: [],
      instructions: { projectBackground: '项目验收背景', outputFormat: '中文', userPreference: '', styleRules: '', forbiddenRules: '', language: 'zh-CN' },
    };
    return <ChatArea user={{ id: 'pdf-user', name: 'Tester', createdAt: 1, updatedAt: 1 }}
      project={project} task={task} onUpdateTask={setTask} onPersistTask={async () => {}}
      onUpdateProject={vi.fn()} onCreateTask={vi.fn()} onSelectTask={vi.fn()} onUpdateAgent={vi.fn()}
      onDeleteAgent={vi.fn()} onSkillToAgent={vi.fn()} onLogout={vi.fn()} onBackToWorkspace={vi.fn()}
      sidebarOpen onToggleSidebar={vi.fn()} />;
  }
  return render(<Harness />);
}

describe('standalone chat PDF output', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let createObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(pending);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    createObjectURL = vi.fn(() => 'blob:pdf-test');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each(['manual', 'command'])('preserves the PDF system instructions and exact model for %s selection', async mode => {
    renderChat();
    if (mode === 'manual') fireEvent.change(screen.getByRole('combobox', { name: '技能' }), { target: { value: 'pdf-master' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: `${mode === 'command' ? '/pdf ' : ''}生成一页中文可下载PDF` } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/simple-chat/chat')).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/simple-chat/chat')!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('chosen-model');
    expect(body.providerId).toBe('chosen-provider');
    expect(body.messages).toEqual(expect.arrayContaining([
      { role: 'system', content: SIMPLE_CHAT_PRESET_SKILLS.find(skill => skill.id === 'pdf-master')!.systemPrompt },
      { role: 'system', content: '项目背景：项目验收背景\n输出格式：中文' },
      expect.objectContaining({ role: 'user', content: '生成一页中文可下载PDF' }),
    ]));
    expect((init as RequestInit).headers).toMatchObject({ 'Idempotency-Key': body.idempotencyKey });
  });

  it.each([
    pdf,
    { ...pdf, content: '# 代码示例\n\n```ts\nconst count = 1;\n```' },
  ])('downloads the complete PDF object rather than an unrelated first JSON block: $content', async request => {
    const document = await PDFDocument.create();
    document.addPage();
    const bytes = await document.save();
    fetchMock.mockImplementation((url: unknown) => url === '/api/pdf/generate'
      ? Promise.resolve(new Response(new Uint8Array(bytes).buffer, { headers: { 'content-type': 'application/pdf' } })) : pending());
    renderChat(`${block({ summary: '说明' })}\n${block(request)}`);
    expect(within(screen.getByTestId('skill-trace')).getByText('生成 PDF').textContent).toContain('未开始');
    fireEvent.click(screen.getByTitle('下载 PDF'));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/pdf/generate')!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(request);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(within(screen.getByTestId('skill-trace')).getByText('生成 PDF').textContent).toContain('已完成');
  });

  it('accepts a complete JSON fence with an uppercase language tag', () => {
    renderChat(block(pdf, 'JSON'));
    expect(screen.queryByTitle('下载 PDF')).not.toBeNull();
  });

  it.each([
    ['structured data', block(pdf), true],
    ['refusal text', '当前无法直接创建可下载PDF。\n# 中文正文', false],
  ])('handles %s through the real SSE consumer', async (_label, reply, downloadable) => {
    const encoded = new TextEncoder().encode([
      ...Array.from(reply).map(content => `data: ${JSON.stringify({ type: 'text', content })}\n\n`),
      'data: {"type":"done"}\n\n',
    ].join(''));
    fetchMock.mockImplementation((url: unknown) => url === '/api/simple-chat/chat'
      ? Promise.resolve(new Response(new ReadableStream({ start(controller) {
        for (let offset = 0; offset < encoded.length; offset += 11) controller.enqueue(encoded.slice(offset, offset + 11));
        controller.close();
      } }), { headers: { 'content-type': 'text/event-stream' } })) : pending());
    renderChat();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/pdf 生成一页中文可下载PDF' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '停止生成' })).toBeNull());
    await waitFor(() => {
      const trace = within(screen.getByTestId('skill-trace'));
      expect(trace.getByText('生成 PDF').textContent).toContain('未开始');
      expect(Boolean(screen.queryByTitle('下载 PDF'))).toBe(downloadable);
      if (!downloadable) expect(trace.getByText(/未收到有效的 PDF 文件数据/)).not.toBeNull();
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/simple-chat/chat')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/pdf/generate')).toBe(false);
  });

  it.each([
    { type: 'merge', pdfUrls: ['https://example.test/a.pdf', 'https://example.test/b.pdf'] },
    { type: 'split', pdfUrl: 'https://example.test/a.pdf', pageRanges: [{ start: 0, end: 2 }] },
    { type: 'form', pdfUrl: 'https://example.test/a.pdf', fields: { name: '中文' } },
    { type: 'watermark', pdfUrl: 'https://example.test/a.pdf', watermarkText: '审核' },
    { type: 'extract', pdfUrl: 'https://example.test/a.pdf', pageNumbers: [0, 2] },
  ])('keeps complete $type requests downloadable', request => {
    renderChat(block(request));
    expect(screen.queryByTitle('下载 PDF')).not.toBeNull();
    expect(within(screen.getByTestId('skill-trace')).getByText('文件数据就绪').textContent).toContain('已完成');
    expect(within(screen.getByTestId('skill-trace')).getByText('生成 PDF').textContent).toContain('未开始');
  });

  it.each([
    ['malformed JSON', '```json\n{"type":"markdown","content":"正文"\n```'],
    ['missing Markdown', block({ type: 'markdown' })],
    ['empty Markdown', block({ type: 'markdown', content: '  ' })],
    ['unrelated JSON', block({ message: '尚无文件' })],
    ['missing source PDFs', block({ type: 'merge', pdfUrls: [] })],
    ['missing source PDF', block({ type: 'split' })],
    ['missing form fields', block({ type: 'form', pdfUrl: 'https://example.test/a.pdf' })],
    ['missing watermark', block({ type: 'watermark', pdfUrl: 'https://example.test/a.pdf' })],
    ['invalid page numbers', block({ type: 'extract', pdfUrl: 'https://example.test/a.pdf', pageNumbers: [-1] })],
    ['unsupported operation', block({ type: 'html', content: '<h1>正文</h1>' })],
    ['reversed page range', block({ type: 'split', pdfUrl: 'https://example.test/a.pdf', pageRanges: [{ start: 2, end: 0 }] })],
    ['plain text', '当前无法直接创建可下载PDF。\n# 中文正文'],
  ])('does not advertise a download for %s and explains missing PDF data', (_label, content) => {
    renderChat(content);
    expect(screen.queryByTitle('下载 PDF')).toBeNull();
    const trace = within(screen.getByTestId('skill-trace'));
    expect(trace.getByText(/未收到有效的 PDF 文件数据/)).not.toBeNull();
    expect(trace.getByText('生成 PDF').textContent).toContain('未开始');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/pdf/generate')).toBe(false);
  });

  it('does not mark unrelated JSON as downloadable during streaming', () => {
    render(<SkillTraceCard skill={{ id: 'pdf-master', name: 'PDF大师', source: 'command' }}
      content={block({ note: '分析中' })} finished={false} />);
    const trace = within(screen.getByTestId('skill-trace'));
    expect(trace.getByText('生成 PDF').textContent).toContain('未开始');
    expect(trace.getByText('文件数据就绪').textContent).toContain('进行中');
  });

  it('keeps PDF generation running until the endpoint actually returns valid PDF bytes', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementation((url: unknown) => url === '/api/pdf/generate'
      ? new Promise<Response>(done => { resolve = done; }) : pending());
    renderChat(block(pdf));
    expect(within(screen.getByTestId('skill-trace')).getAllByRole('listitem')[3].textContent).toContain('未开始');
    const button = screen.getByTitle('下载 PDF') as HTMLButtonElement;
    fireEvent.click(button);
    expect(within(screen.getByTestId('skill-trace')).getByText('生成 PDF').textContent).toContain('进行中');
    expect(button.disabled).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/pdf/generate')).toHaveLength(1);
    const document = await PDFDocument.create(); document.addPage();
    resolve(new Response(new Uint8Array(await document.save()).buffer, { headers: { 'content-type': 'application/pdf' } }));
    await waitFor(() => expect(within(screen.getByTestId('skill-trace')).getByText('生成 PDF').textContent).toContain('已完成'));
  });

  it.each([
    ['API rejection', () => new Response(JSON.stringify({ error: '请重新登录' }), { status: 401 }), '请重新登录'],
    ['network failure', () => Promise.reject(new Error('网络中断')), '网络中断'],
    ['unexpected content', () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }), '未收到 PDF 文件'],
    ['invalid PDF bytes', () => new Response('not a PDF', { headers: { 'content-type': 'application/pdf' } }), '不是有效 PDF'],
  ] as const)('reports %s without creating a fake PDF download', async (_label, response, error) => {
    fetchMock.mockImplementation((url: unknown) => url === '/api/pdf/generate' ? Promise.resolve().then(response) : pending());
    renderChat(block(pdf));
    fireEvent.click(screen.getByTitle('下载 PDF'));
    expect((await screen.findByRole('alert')).textContent).toContain(error);
    expect(within(screen.getByTestId('skill-trace')).getByText('生成 PDF').textContent).toContain('生成失败');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
});
