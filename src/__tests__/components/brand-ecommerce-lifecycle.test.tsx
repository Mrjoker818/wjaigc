// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandEcommercePanel } from '@/components/brand-ecommerce-panel';

const templates = [
  { id: 'white-bg', name: 'White product', icon: '', description: '', promptTemplate: '{SUBJECT}', negativePrompt: '', aspectRatio: '1:1', category: 'product' },
  { id: 'scene-lifestyle', name: 'Lifestyle product', icon: '', description: '', promptTemplate: '{SUBJECT}', negativePrompt: '', aspectRatio: '1:1', category: 'product' },
];
const providers = ['pear-test', 'apimart-test'].map(id => ({ id, name: id, isEnabled: true, modelType: 'image' }));
const success = (templateId = 'white-bg', url = '/one.png', providerId = 'apimart-test') => ({
  templateId, templateName: templateId, imageUrl: url, variantIndex: 0,
  providerId, providerName: providerId, modelName: 'gpt-image-2',
});
const failure = { templateId: 'white-bg', templateName: 'White product', error: 'LOCAL_TEST_FAILURE' };
const message = 'The account has insufficient credits for this exact request. Please verify your balance before trying again; no task was created.';

describe('brand ecommerce generation lifecycle', () => {
  let replies: Array<() => Promise<Response>>;
  let pollReplies: Array<() => Promise<Response>>;
  let requests: Array<Record<string, unknown>>;
  let polls: Array<Record<string, unknown>>;
  let cancelRequests: Array<Record<string, unknown>>;
  let generationIdempotencyKeys: string[];
  let addImages: ReturnType<typeof vi.fn>;
  let availableTemplates: typeof templates;

  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    replies = [];
    pollReplies = [];
    requests = [];
    polls = [];
    cancelRequests = [];
    generationIdempotencyKeys = [];
    addImages = vi.fn();
    availableTemplates = templates;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === '/api/models?type=image') return Response.json({ providers, models: providers.map(p => ({ id: 'gpt-image-2', name: 'Gpt Image 2', providerId: p.id })) });
      if (url === '/api/models?type=chat') return Response.json({ providers: [], models: [] });
      if (url.startsWith('/api/brand-assets?')) return Response.json({ success: true, assets: [] });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (url === '/api/brand-ecommerce' && body.action === 'templates') return Response.json({ success: true, templates: availableTemplates });
      if (url === '/api/brand-ecommerce' && body.action === 'generate') {
        requests.push(body);
        generationIdempotencyKeys.push(new Headers(init?.headers).get('idempotency-key') || '');
        const reply = replies.shift();
        if (!reply) throw new Error('Unexpected extra generation');
        return reply();
      }
      if (url === '/api/poll-task') {
        polls.push(body);
        return pollReplies.length ? pollReplies.shift()!() : Response.json({ success: true, status: 'processing', progress: 10 });
      }
      if (url === '/api/cancel-task') {
        cancelRequests.push(body);
        return Response.json({ success: true, cancelled: true });
      }
      throw new Error(`Unexpected test request: ${url}`);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function reply(data: unknown, status = 200): () => Promise<Response> {
    return async () => Response.json(data, { status });
  }
  async function open(): Promise<void> {
    render(<BrandEcommercePanel onClose={vi.fn()} onAddImages={addImages} />);
    await screen.findByText('White product');
    fireEvent.click(screen.getByRole('button', { name: '生成设置' }));
    fireEvent.change(screen.getByPlaceholderText(/描述你的商品/), { target: { value: 'Local contract test cup' } });
    await waitFor(() => expect((screen.getByRole('button', { name: '批量生成' }) as HTMLButtonElement).disabled).toBe(false));
    vi.useFakeTimers();
  }
  async function click(name: string | RegExp): Promise<void> {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
  }
  async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }
  function expectIdle(): void {
    expect((screen.getByRole('button', { name: '批量生成' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
  }
  async function prepareRetry(): Promise<void> {
    replies.push(reply({ success: true, results: [failure] }));
    await open();
    await click('批量生成');
  }

  it('keeps a complete business error and retries a real template rather than error', async () => {
    replies.push(reply({ success: false, error: message }, 402), reply({ results: [failure] }));
    await open();
    await click('批量生成');
    expect(screen.queryAllByText(message).length).toBeGreaterThan(0);
    expectIdle();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '重新生成' })[0]); });
    expect(requests[1].templateIds).toEqual(['white-bg']);
    expect(generationIdempotencyKeys.every(Boolean)).toBe(true);
    expect(new Set(generationIdempotencyKeys).size).toBe(2);
  });

  it('ends repeated HTTP failures on a single-template retry', async () => {
    await prepareRetry();
    for (let attempt = 0; attempt < 2; attempt++) {
      replies.push(reply({ success: false, error: message }, 402));
      await click('重新生成');
      expectIdle();
      expect(screen.getByText(message)).toBeTruthy();
    }
    expect(requests).toHaveLength(3);
    expect(requests.slice(1).every(r => JSON.stringify(r.templateIds) === '["white-bg"]')).toBe(true);
  });

  it('ends a synchronous retry with a real result and enables the next operation', async () => {
    await prepareRetry();
    replies.push(reply({ success: true, results: [success()] }));
    await click('重新生成');
    expectIdle();
    expect(screen.getByRole('img').getAttribute('src')).toBe('/one.png');
  });

  it('does not treat HTTP 200 business rejection as a running retry', async () => {
    await prepareRetry();
    replies.push(reply({ success: false, error: { message: 'Provider rejected this request' } }));
    await click('重新生成');
    expectIdle();
    expect(screen.getByText('Provider rejected this request')).toBeTruthy();
  });

  it('ends malformed responses without displaying proxy HTML', async () => {
    await prepareRetry();
    replies.push(async () => new Response('<html>private proxy trace</html>', { status: 502 }));
    await click('重新生成');
    expectIdle();
    expect(screen.getByText(/502/)).toBeTruthy();
    expect(screen.queryByText(/private proxy trace/)).toBeNull();
  });

  it('cleans the submission progress timer after transport rejection', async () => {
    replies.push(async () => { throw new Error('Network interrupted'); });
    await open();
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    await click('批量生成');
    expectIdle();
    await advance(0);
    const activeIntervals = intervals.mock.results.map(result => result.value)
      .filter(id => !cleared.mock.calls.some(([clearedId]) => clearedId === id));
    expect(activeIntervals).toEqual([]);
  });

  it('retains partial images and displays a later task failure', async () => {
    replies.push(reply({ success: true, taskId: 'task-partial' }));
    pollReplies.push(reply({ success: true, status: 'processing', partialResults: [success()] }), reply({ success: true, status: 'failed', error: message }));
    await open();
    await click('批量生成');
    await advance(1000);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/one.png');
    await advance(1000);
    expectIdle();
    expect(screen.queryAllByText(message).length).toBeGreaterThan(0);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/one.png');
  });

  it('stops a retry at the existing polling limit instead of polling forever', async () => {
    await prepareRetry();
    replies.push(reply({ success: true, taskId: 'task-limit' }));
    await click('重新生成');
    await advance(260000);
    expectIdle();
    expect(polls.length).toBeLessThanOrEqual(120);
    expect(screen.getByText(/超时/)).toBeTruthy();
  });

  it('registers the retry task for cancellation and ignores its late result', async () => {
    await prepareRetry();
    replies.push(reply({ success: true, taskId: 'retry-task' }));
    let complete!: (response: Response) => void;
    pollReplies.push(() => new Promise<Response>(resolve => { complete = resolve; }));
    await click('重新生成');
    await advance(1000);
    await click('取消');
    expect(cancelRequests).toEqual([{ taskId: 'retry-task' }]);
    expectIdle();
    await act(async () => { complete(Response.json({ success: true, status: 'completed', result: { results: [success()] } })); });
    expect(screen.queryByRole('img')).toBeNull();
    await advance(5000);
    expect(polls).toHaveLength(1);
  });

  it('does not dispatch another retry while one is already running', async () => {
    await prepareRetry();
    replies.push(reply({ success: true, taskId: 'retry-busy' }));
    await click('重新生成');
    const retry = screen.queryByRole('button', { name: '重新生成' });
    if (retry) await act(async () => { fireEvent.click(retry); });
    expect(requests).toHaveLength(2);
  });

  it('uses immutable server result identity after the user changes selection', async () => {
    replies.push(reply({ success: true, results: [success()] }));
    await open();
    await click('批量生成');
    await click('生成设置');
    const section = screen.getByText('生成模型').parentElement!;
    await act(async () => { fireEvent.click(within(section).getByRole('button')); });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: /Gpt Image 2.*apimart-test/ })); });
    await act(async () => { fireEvent.click(within(section).getByRole('button')); });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: /Gpt Image 2.*pear-test/ })); });
    await click(/生成结果/);
    await click(/全部添加到画布/);
    expect(addImages).toHaveBeenCalledWith(['/one.png'], { modelName: 'gpt-image-2', apiProvider: 'apimart-test' });
  });

  it('groups mixed-provider results without losing per-image source', async () => {
    replies.push(reply({ success: true, results: [success(), success('scene-lifestyle', '/two.png', 'pear-test')] }));
    await open();
    await click('批量生成');
    await click(/全部添加到画布/);
    expect(addImages.mock.calls).toEqual([
      [['/one.png'], { modelName: 'gpt-image-2', apiProvider: 'apimart-test' }],
      [['/two.png'], { modelName: 'gpt-image-2', apiProvider: 'pear-test' }],
    ]);
  });

  it('does not invent a provider or model for a legacy result', async () => {
    replies.push(reply({ success: true, results: [{ templateId: 'white-bg', templateName: 'Legacy', imageUrl: '/legacy.png' }] }));
    await open();
    await click('批量生成');
    await click(/全部添加到画布/);
    expect(addImages).toHaveBeenCalledWith(['/legacy.png'], {});
  });

  it('preserves other template results when a retry fails', async () => {
    replies.push(reply({ results: [failure, success('scene-lifestyle', '/kept.png')] }));
    await open();
    await click('批量生成');
    replies.push(reply({ success: false, error: message }, 402));
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '重新生成' })[0]); });
    expectIdle();
    expect(screen.getByRole('img').getAttribute('src')).toBe('/kept.png');
  });

  it('reads partial images even when the terminal business status is false', async () => {
    replies.push(reply({ success: true, taskId: 'terminal-partial' }));
    pollReplies.push(reply({ success: false, status: 'failed', error: message, partialResults: [success()] }));
    await open();
    await click('批量生成');
    await advance(1000);
    expectIdle();
    expect(screen.getByRole('img').getAttribute('src')).toBe('/one.png');
    expect(screen.queryAllByText(message).length).toBeGreaterThan(0);
  });

  it('cleans local polling on unmount without sending a remote cancel', async () => {
    replies.push(reply({ success: true, taskId: 'unmount-task' }));
    await open();
    await click('批量生成');
    cleanup();
    await advance(5000);
    expect(polls).toEqual([]);
    expect(cancelRequests).toEqual([]);
  });

  it('keeps reading the same task after transient status HTTP errors', async () => {
    replies.push(reply({ success: true, taskId: 'transient-task' }));
    pollReplies.push(reply({ error: 'Temporarily unavailable' }, 503), reply({ success: true, status: 'completed', result: { results: [success()] } }));
    await open();
    await click('批量生成');
    await advance(2000);
    expectIdle();
    expect(requests).toHaveLength(1);
    expect(polls.map(p => p.taskId)).toEqual(['transient-task', 'transient-task']);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/one.png');
  });

  it('does not accept an empty completed result as success', async () => {
    replies.push(reply({ success: true, taskId: 'empty-task' }));
    pollReplies.push(reply({ success: true, status: 'completed', result: { results: [] } }));
    await open();
    await click('批量生成');
    await advance(1000);
    expectIdle();
    expect(screen.queryAllByText(/没有返回有效结果/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it.each([false, true])('keeps a successful variant alongside its error (error first: %s)', async errorFirst => {
    const image = success();
    const error = { ...failure, variantIndex: 0 };
    const rows = errorFirst ? [error, image] : [image, error];
    replies.push(reply({ success: true, taskId: 'boundary-task' }));
    pollReplies.push(reply({ success: true, status: 'completed', result: { results: rows } }));
    await open();
    await click('批量生成');
    await advance(1000);
    expectIdle();
    expect(screen.getByRole('img').getAttribute('src')).toBe('/one.png');
    expect(screen.getByText(failure.error)).toBeTruthy();
    await click(/全部添加到画布/);
    expect(addImages).toHaveBeenCalledWith(['/one.png'], { modelName: 'gpt-image-2', apiProvider: 'apimart-test' });
  });

  it('retries an existing appended detail page after template selection is cleared', async () => {
    availableTemplates = [...templates, { ...templates[0], id: 'detail-vertical', name: 'Detail page', category: 'detail' }];
    replies.push(reply({ success: true, results: [success('detail-vertical-2', '/detail.png')] }));
    await open();
    await click('模板选择');
    await click(/Detail page/);
    await click('生成设置');
    await click('添加详情页');
    await click('批量生成');
    expect(requests[0].templateIds).toContain('detail-vertical-2');
    await click('模板选择');
    await click('清空');
    await click(/生成结果/);
    replies.push(reply({ success: true, results: [success('detail-vertical-2', '/detail-new.png')] }));
    await click('重新生成');
    expect(requests).toHaveLength(2);
    expect(requests[1].templateIds).toEqual(['detail-vertical-2']);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/detail-new.png');
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
  });

  it('preserves the old image identity when another provider retry reports a partial error', async () => {
    replies.push(reply({ results: [success('white-bg', '/pear-original.png', 'pear-test')] }));
    await open();
    await click('批量生成');
    await click('生成设置');
    const section = screen.getByText('生成模型').parentElement!;
    await act(async () => { fireEvent.click(within(section).getByRole('button')); });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: /Gpt Image 2.*apimart-test/ })); });
    await click(/生成结果/);
    replies.push(reply({ success: true, taskId: 'new-provider-retry' }));
    pollReplies.push(reply({ status: 'processing', partialResults: [{ ...failure, variantIndex: 0, providerId: 'apimart-test', modelName: 'new-model' }] }));
    await click('重新生成');
    await advance(1000);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/pear-original.png');
    await click(/全部添加到画布/);
    expect(addImages).toHaveBeenCalledWith(['/pear-original.png'], { modelName: 'gpt-image-2', apiProvider: 'pear-test' });
    expect(screen.getByText(failure.error)).toBeTruthy();
  });
});
