// @vitest-environment jsdom

import { afterEach as afterMediaApis, beforeEach as beforeMediaApis } from 'vitest';
import { installJsdomMediaQueries, runJsdomFixtureCleanup } from '../helpers/jsdom-browser-apis';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ChatPanel } from '@/components/chat-panel';
import type { CanvasImage } from '@/components/infinite-canvas';

const image: CanvasImage = { id: 'shared-id', url: '/source.png', x: 0, y: 0, width: 20, height: 20 };
const inputPlaceholder = '输入消息，@ 引用图片/品牌，/ 使用模板...';
const pendingPlaceholder = /描述你想对这1张图片/;
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  const values = new Map<string, string>();
  const storage = { get length() { return values.size; }, clear: () => values.clear(), getItem: (key: string) => values.get(key) ?? null, key: (i: number) => [...values.keys()][i] ?? null, removeItem: (key: string) => { values.delete(key); }, setItem: (key: string, value: string) => { values.set(key, value); } };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { if (init?.method && init.method !== 'GET') throw Error('NETWORK_BLOCKED'); return Response.json({}); }));
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('selected canvas image scope and lifetime', () => {
  it('rejects a late project A result and resolves the same ID in project B, preserving the draft', async () => {
    const old = deferred<CanvasImage>(); const current = deferred<CanvasImage>();
    const resolve = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = (project: string, selected: CanvasImage | null) => <ChatPanel themeStyle="gold" projectId={project} canvasImages={[image]} chatTabOpen selectedCanvasImage={selected} onResolveCanvasImageForChat={resolve} />;
    const mounted = render(view('A', null));
    const input = await screen.findByPlaceholderText(inputPlaceholder) as HTMLTextAreaElement;
    input.focus(); fireEvent.change(input, { target: { value: '保留草稿' } });
    mounted.rerender(view('A', image)); await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    mounted.rerender(view('B', image));
    await act(async () => { old.resolve({ ...image, url: '/old-project.png' }); await old.promise; });
    expect(screen.queryByPlaceholderText(pendingPlaceholder)).toBeNull();
    expect(input.value).toBe('保留草稿');
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    await act(async () => { current.resolve({ ...image, url: '/new-project.png' }); await current.promise; });
    await screen.findByPlaceholderText(pendingPlaceholder);
    expect(mounted.container.querySelector('img[src="/new-project.png"]')).not.toBeNull();
    expect(mounted.container.querySelector('img[src="/old-project.png"]')).toBeNull();
    expect(input.value).toBe('保留草稿');
  });
  it('rejects old A and B results after returning to project A with the same ID', async () => {
    const first = deferred<CanvasImage>(); const middle = deferred<CanvasImage>(); const last = deferred<CanvasImage>();
    const resolve = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(middle.promise).mockReturnValueOnce(last.promise);
    const view = (project: string, selected: CanvasImage | null) => <ChatPanel themeStyle="gold" projectId={project} chatTabOpen selectedCanvasImage={selected} onResolveCanvasImageForChat={resolve} />;
    const mounted = render(view('A', null)); const input = await screen.findByPlaceholderText(inputPlaceholder) as HTMLTextAreaElement;
    input.focus(); mounted.rerender(view('A', image)); await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    mounted.rerender(view('B', image)); await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    mounted.rerender(view('A', image)); await waitFor(() => expect(resolve).toHaveBeenCalledTimes(3));
    await act(async () => { first.resolve({ ...image, url: '/stale-a.png' }); middle.resolve({ ...image, url: '/stale-b.png' }); await Promise.all([first.promise, middle.promise]); });
    expect(input.value).toBe(''); expect(screen.queryByPlaceholderText(pendingPlaceholder)).toBeNull();
    await act(async () => { last.resolve({ ...image, url: '/current-a.png' }); await last.promise; });
    await screen.findByPlaceholderText(pendingPlaceholder);
    expect(mounted.container.querySelector('img[src="/current-a.png"]')).not.toBeNull();
  });
  it.each(['panel', 'tab'] as const)('ignores a result while the %s is closed and permits explicit reselection', async closed => {
    const old = deferred<CanvasImage>(); const current = deferred<CanvasImage>();
    const resolve = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = (selected: CanvasImage | null, open: boolean) => <ChatPanel themeStyle="gold" projectId="A" canvasImages={[image]} isVisible={closed !== 'panel' || open} chatTabOpen={closed !== 'tab' || open} selectedCanvasImage={selected} onResolveCanvasImageForChat={resolve} />;
    const mounted = render(view(null, true));
    const input = await screen.findByPlaceholderText(inputPlaceholder) as HTMLTextAreaElement;
    input.focus(); mounted.rerender(view(image, true)); await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    mounted.rerender(view(image, false));
    await act(async () => { old.resolve({ ...image, url: '/stale.png' }); await old.promise; });
    expect(input.value).toBe(''); expect(screen.queryByPlaceholderText(pendingPlaceholder)).toBeNull();
    mounted.rerender(view(null, true)); input.focus(); mounted.rerender(view(image, true));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    await act(async () => { current.resolve({ ...image, url: '/retry.png' }); await current.promise; });
    await screen.findByPlaceholderText(pendingPlaceholder);
    expect(mounted.container.querySelector('img[src="/retry.png"]')).not.toBeNull();
  });
  it('does not show a late error after unmount', async () => {
    const old = deferred<CanvasImage>(); const resolve = vi.fn().mockReturnValue(old.promise);
    const error = vi.spyOn(toast, 'error');
    const view = (selected: CanvasImage | null) => <ChatPanel themeStyle="gold" projectId="A" chatTabOpen selectedCanvasImage={selected} onResolveCanvasImageForChat={resolve} />;
    const mounted = render(view(null)); const input = await screen.findByPlaceholderText(inputPlaceholder) as HTMLTextAreaElement;
    input.focus(); mounted.rerender(view(image)); await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    mounted.unmount(); await act(async () => { old.reject(Error('late failure')); await old.promise.catch(() => undefined); });
    expect(error).not.toHaveBeenCalled();
  });
});

// Explicit file-local browser API fixture; business mocks and original tests are unchanged.
let restoreMediaApis: (() => void) | undefined;
beforeMediaApis((): void => { restoreMediaApis = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false }); });
afterMediaApis((): void => { runJsdomFixtureCleanup([cleanup, (): void => { const restore = restoreMediaApis; restoreMediaApis = undefined; restore?.(); }]); });
