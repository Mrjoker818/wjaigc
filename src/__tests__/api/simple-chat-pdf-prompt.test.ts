import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn(), findProviderForModel: vi.fn(), fetchWithTimeout: vi.fn() }));
vi.mock('server-only', () => ({}));
// Fail closed if this isolated request ever tries to open a database connection.
vi.mock('pg', () => ({ Pool: class { constructor() { throw new Error('Database access forbidden in PDF isolation test'); } } }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/server-api-config', () => ({ findProviderForModel: mocks.findProviderForModel, findProviderById: vi.fn() }));
vi.mock('@/lib/api-helpers', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api-helpers')>(), fetchWithTimeout: mocks.fetchWithTimeout,
}));
vi.mock('coze-coding-dev-sdk', () => ({ SearchClient: class {}, Config: class {}, HeaderUtils: { extractForwardHeaders: vi.fn() } }));

import { POST } from '@/app/api/simple-chat/chat/route';
import { POST as generatePdf } from '@/app/api/pdf/generate/route';
import { PDFDocument } from 'pdf-lib';
import { SIMPLE_CHAT_PRESET_SKILLS } from '@/lib/skill-runtime/simple-chat-presets';

const pdfSkill = SIMPLE_CHAT_PRESET_SKILLS.find(skill => skill.id === 'pdf-master')!;
const payload = { title: '验收', type: 'markdown', content: '# 一页中文验收\n\n这是真实生成的 PDF。', theme: 'minimal-gray' };

function request() {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'pdf-isolated:one-request' },
    body: JSON.stringify({
      model: 'chosen-model', providerId: 'chosen-provider', idempotencyKey: 'pdf-isolated:one-request',
      messages: [
        { role: 'system', content: '项目背景：项目验收背景\n输出格式：中文' },
        { role: 'system', content: pdfSkill.systemPrompt },
        { role: 'user', content: '生成一页中文可下载PDF' },
      ],
      knowledgeItems: [{ id: 'knowledge', type: 'text', title: '验收知识', content: '知识注入标记' }],
    }),
  });
}

describe('isolated PDF prompt and output boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('WUJIE_AGENT_RUNTIME_MODE', 'legacy');
    mocks.getSessionUser.mockResolvedValue({ id: 'pdf-user', role: 'admin', productType: 'chat' });
    mocks.findProviderForModel.mockResolvedValue({ id: 'chosen-provider', name: 'Isolated', apiKey: 'test-only', baseUrl: 'https://provider.example/v1' });
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real fetch in isolated PDF test'); }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it.each([
    '当前无法直接创建可下载PDF。\n# 中文正文',
    `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
  ])('preserves system messages upstream and forwards model text unchanged', async reply => {
    // Chunk inside Chinese UTF-8 as well as inside the JSON fence.
    const upstream = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
    mocks.fetchWithTimeout.mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      for (let offset = 0; offset < upstream.length; offset += 7) controller.enqueue(upstream.slice(offset, offset + 7));
      controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } }));
    const response = await POST(request());
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data:'))
      .map(line => JSON.parse(line.slice(5)));
    expect(response.status).toBe(200);
    expect(events.filter(event => event.type === 'text').map(event => event.content).join('')).toBe(reply);
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetchWithTimeout.mock.calls[0];
    expect(url).toBe('https://provider.example/v1/chat/completions');
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe('chosen-model');
    expect(sent.messages).toEqual(expect.arrayContaining([
      { role: 'system', content: pdfSkill.systemPrompt },
      { role: 'system', content: '项目背景：项目验收背景\n输出格式：中文' },
    ]));
    expect(sent.messages[0].content).toContain('知识注入标记');
    expect(init.headers['Idempotency-Key']).toBe('pdf-isolated:one-request');
  });

  it('keeps unauthenticated requests away from the provider', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('builds a real one-page Chinese PDF from the declared minimal-gray request', async () => {
    const response = await generatePdf(new NextRequest('http://localhost/api/pdf/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    const bytes = await response.arrayBuffer();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it.each([
    [{ type: 'split', pageRanges: [{ start: 0, end: 1 }] }, [200, 300]],
    [{ type: 'extract', pageNumbers: [0, 2] }, [200, 400]],
  ])('uses zero-based page indices for %j', async (operation, expectedWidths) => {
    const source = await PDFDocument.create();
    for (const width of [200, 300, 400]) source.addPage([width, 500]);
    const bytes = await source.save();
    const pdfUrl = 'data:application/pdf;base64,' + Buffer.from(bytes).toString('base64');
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      expect(input).toBe(pdfUrl);
      return new Response(new Uint8Array(bytes).buffer);
    }));
    const response = await generatePdf(new NextRequest('http://localhost/api/pdf/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...operation, pdfUrl, title: '页码测试' }),
    }));
    expect(response.status).toBe(200);
    const result = await PDFDocument.load(await response.arrayBuffer());
    expect(result.getPages().map(page => page.getWidth())).toEqual(expectedWidths);
  });
});
