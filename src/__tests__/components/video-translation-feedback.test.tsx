// @vitest-environment jsdom
import React from 'react';
import net from 'node:net';
import dgram from 'node:dgram';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// No backend, browser process, persistent profile or external preload is used.
type Panel = typeof import('@/components/video-generation-panel').default;
let VideoPanel: Panel;
let originalConnect: typeof net.Socket.prototype.connect;
let originalSend: typeof dgram.Socket.prototype.send;
let denied: string[] = [];
let requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
let replies: Array<() => Promise<Response>> = [];
let pending: Array<{ promise: Promise<Response>; release: (response: Response) => void }> = [];
let errors: string[] = [];
let inFlight = new Set<Promise<Response>>();

function response(status: number, payload: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}
function holdReply(): { promise: Promise<Response>; release: (response: Response) => void } {
  let release!: (value: Response) => void;
  const promise = new Promise<Response>(resolve => { release = resolve; });
  const held = { promise, release };
  pending.push(held);
  return held;
}
function blocked(kind: string): never { denied.push(kind); throw new Error(`OFFLINE_DENIED: ${kind}`); }

beforeAll(async () => {
  // Install before importing the component. A denied socket is recorded even if
  // component code catches the exception. Existing Vitest IPC is not closed.
  originalConnect = net.Socket.prototype.connect;
  originalSend = dgram.Socket.prototype.send;
  net.Socket.prototype.connect = function () { return blocked('node socket connect'); } as typeof net.Socket.prototype.connect;
  dgram.Socket.prototype.send = function () { return blocked('node datagram send'); } as typeof dgram.Socket.prototype.send;
  const memory = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, String(value)); }, removeItem: (key: string) => { memory.delete(key); }, clear: () => memory.clear() });
  vi.stubGlobal('XMLHttpRequest', class { constructor() { blocked('XMLHttpRequest'); } });
  vi.stubGlobal('WebSocket', class { constructor() { blocked('WebSocket'); } });
  vi.stubGlobal('EventSource', class { constructor() { blocked('EventSource'); } });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (url === '/api/models?type=video' && method === 'GET' && init?.body == null) {
      requests.push({ url, method });
      return response(200, { success: true, capabilityCatalogVersion: 1, providers: [], models: [], taskModelCatalog: [] });
    }
    if (url === '/api/optimize-prompt' && method === 'POST' && typeof init?.body === 'string') {
      let body: Record<string, unknown>;
      try { body = JSON.parse(init.body) as Record<string, unknown>; } catch { return blocked('invalid JSON'); }
      const headers = new Headers(init.headers);
      if (body.mode !== 'translate' || typeof body.prompt !== 'string' || typeof body.systemPrompt !== 'string' || headers.get('content-type') !== 'application/json' || !replies.length) return blocked('unexpected translation payload');
      requests.push({ url, method, body });
      const task = replies.shift()!();
      inFlight.add(task);
      void task.then(() => inFlight.delete(task), () => inFlight.delete(task));
      return task;
    }
    return blocked(`${method} ${url}`);
  });
  VideoPanel = (await import('@/components/video-generation-panel')).default;
  expect(denied, 'network attempt during component import').toEqual([]);
});

beforeEach(() => {
  expect(denied, 'network attempt before test setup').toEqual([]);
  requests = []; replies = []; pending = []; errors = []; inFlight = new Set();
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args[0] !== '提示词翻译失败:') errors.push(args.map(String).join(' '));
  });
});

afterEach(async () => {
  // Dispose the real component before releasing any intentionally held response;
  // await every response while the network guards remain active.
  try {
    try {
      cleanup();
    } finally {
      await act(async () => {
        for (const held of pending) held.release(response(503, { error: 'cleanup' }));
        await Promise.all(pending.map(held => held.promise));
        await Promise.resolve();
      });
    }
    expect(denied, 'unapproved network attempt').toEqual([]);
    expect(errors, 'unexpected React or component error').toEqual([]);
    expect(replies, 'unused expected response').toEqual([]);
    expect(inFlight.size, 'actual fetch handlers remaining after cleanup').toBe(0);
  } finally { vi.restoreAllMocks(); }
});

afterAll(() => {
  net.Socket.prototype.connect = originalConnect;
  dgram.Socket.prototype.send = originalSend;
  vi.unstubAllGlobals();
});

async function mountPanel(): Promise<HTMLTextAreaElement> {
  render(<VideoPanel floating onVideoGenerate={() => { throw new Error('UNEXPECTED_GENERATION'); }} />);
  await waitFor(() => expect(requests.filter(request => request.url === '/api/models?type=video')).toHaveLength(1));
  const area = document.querySelector<HTMLTextAreaElement>('[data-floating-panel="video"] textarea');
  if (!area) throw new Error('VIDEO_PROMPT_NOT_FOUND');
  return area;
}
function translate(): void { fireEvent.click(screen.getByRole('button', { name: '中英翻译' })); }
function translationBodies(): Array<Record<string, unknown> | undefined> { return requests.filter(request => request.url === '/api/optimize-prompt').map(request => request.body); }

describe('video translation offline guard and component behavior', () => {
  it('rejects unknown fetch, Node TCP and datagram without opening a connection', async () => {
    await expect(fetch('https://unexpected.invalid/')).rejects.toThrow('OFFLINE_DENIED');
    const socket = new net.Socket();
    try { expect(() => socket.connect(9, '127.0.0.1')).toThrow('OFFLINE_DENIED'); } finally { socket.destroy(); }
    const udp = dgram.createSocket('udp4');
    try { expect(() => udp.send(Buffer.from('x'), 9, '127.0.0.1')).toThrow('OFFLINE_DENIED'); } finally { try { udp.close(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error; } }
    expect(denied).toEqual(['GET https://unexpected.invalid/', 'node socket connect', 'node datagram send']);
    denied = [];
  });

  it('rejects unknown operations and drains a held response after real component unmount', async () => {
    const held = holdReply(); replies.push(() => held.promise);
    const remove = vi.spyOn(window, 'removeEventListener');
    const area = await mountPanel();
    fireEvent.change(area, { target: { value: '清理对照' } });
    translate();
    expect(inFlight.size).toBe(1);
    cleanup();
    expect(document.querySelector('[data-floating-panel="video"]')).toBeNull();
    expect(remove.mock.calls.some(call => call[0] === 'resize')).toBe(true);
    await act(async () => { held.release(response(503, { error: 'unmounted' })); await held.promise; });
    expect(inFlight.size).toBe(0);
    expect(denied).toEqual([]);
  });
  it('keeps the draft on 503 and retries to a successful translation', async () => {
    replies.push(async () => response(503, { error: 'unavailable' }), async () => response(200, { success: true, optimized: 'translated' }));
    const area = await mountPanel();
    fireEvent.change(area, { target: { value: '原始草稿' } });
    translate();
    expect((await screen.findByRole('alert')).textContent).toContain('提示词翻译失败');
    expect(area.value).toBe('原始草稿');
    expect((screen.getByRole('button', { name: '中英翻译' }) as HTMLButtonElement).disabled).toBe(false);
    translate();
    await waitFor(() => expect(area.value).toBe('translated'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(translationBodies().map(body => body?.prompt)).toEqual(['原始草稿', '原始草稿']);
  });

  it('does not replace an edit made while the old successful response is pending', async () => {
    const held = holdReply(); replies.push(() => held.promise);
    const area = await mountPanel();
    fireEvent.change(area, { target: { value: '原始草稿' } });
    translate();
    fireEvent.change(area, { target: { value: '等待期间的编辑' } });
    await act(async () => { held.release(response(200, { success: true, optimized: '旧翻译' })); await held.promise; });
    await waitFor(() => expect((screen.getByRole('button', { name: '中英翻译' }) as HTMLButtonElement).disabled).toBe(false));
    expect(area.value).toBe('等待期间的编辑');
    expect(translationBodies().map(body => body?.prompt)).toEqual(['原始草稿']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a failure after the parent consumes an unchanged external prompt', async () => {
    const held = holdReply(); replies.push(() => held.promise);
    const consumed = vi.fn();
    const onGenerate = (): never => { throw new Error('UNEXPECTED_GENERATION'); };
    const view = render(<VideoPanel floating externalPrompt="外部草稿" onExternalPromptConsumed={consumed} onVideoGenerate={onGenerate} />);
    await waitFor(() => expect(requests.filter(request => request.url === '/api/models?type=video')).toHaveLength(1));
    const area = document.querySelector<HTMLTextAreaElement>('[data-floating-panel="video"] textarea');
    if (!area) throw new Error('VIDEO_PROMPT_NOT_FOUND');
    await waitFor(() => expect(area.value).toBe('外部草稿'));
    expect(consumed).toHaveBeenCalledTimes(1);
    translate();
    view.rerender(<VideoPanel floating onExternalPromptConsumed={consumed} onVideoGenerate={onGenerate} />);
    await act(async () => { held.release(response(503, { error: 'unavailable' })); await held.promise; });
    expect((await screen.findByRole('alert')).textContent).toContain('提示词翻译失败');
    expect(area.value).toBe('外部草稿');
    expect(translationBodies().map(body => body?.prompt)).toEqual(['外部草稿']);
  });

  it('applies a successful translation when the draft has not changed', async () => {
    const held = holdReply(); replies.push(() => held.promise);
    const area = await mountPanel();
    fireEvent.change(area, { target: { value: '原始草稿' } });
    translate();
    await act(async () => { held.release(response(200, { success: true, optimized: '新译文' })); await held.promise; });
    await waitFor(() => expect(area.value).toBe('新译文'));
    expect(translationBodies().map(body => body?.prompt)).toEqual(['原始草稿']);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
