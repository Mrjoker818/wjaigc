// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskModelCatalog } from '@/hooks/use-task-model-catalog';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function catalog(id: string): Response {
  return { ok: true, json: async () => ({ success: true, capabilityCatalogVersion: 1, providers: [{ id:'p', name:'合成供应商' }], models: [{ id, name:id, providerId:'p', type:'video' }], taskModelCatalog: [] }) } as Response;
}

beforeEach(() => { vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('model catalog request ordering', () => {
  it('keeps the latest model list when an earlier request completes afterwards', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let count = 0;
    vi.stubGlobal('fetch', vi.fn(() => ++count === 1 ? Promise.resolve(catalog('initial')) : count === 2 ? first.promise : second.promise));
    const hook = renderHook(() => useTaskModelCatalog('video'));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(count).toBe(3));
    await act(async () => { second.resolve(catalog('new')); await second.promise; });
    await waitFor(() => expect(hook.result.current.models[0]?.id).toBe('new'));
    await act(async () => { first.resolve(catalog('old')); await first.promise; });
    expect(hook.result.current.models.map(model => model.id)).toEqual(['new']);
    expect(hook.result.current.error).toBeNull();
  });

  it('does not let an earlier failure replace a later successful refresh', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let count = 0;
    vi.stubGlobal('fetch', vi.fn(() => ++count === 1 ? Promise.resolve(catalog('initial')) : count === 2 ? first.promise : second.promise));
    const hook = renderHook(() => useTaskModelCatalog('video'));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(count).toBe(3));
    await act(async () => { second.resolve(catalog('new')); await second.promise; });
    await waitFor(() => expect(hook.result.current.models[0]?.id).toBe('new'));
    await act(async () => { first.reject(new Error('旧请求失败')); await first.promise.catch(() => undefined); });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.models.map(model => model.id)).toEqual(['new']);
  });

  it('ends loading and rejects a cancelled manual refresh', async () => {
    const pending = deferred<Response>();
    let count = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (++count === 1) return Promise.resolve(catalog('initial'));
      init?.signal?.addEventListener('abort', () => pending.reject(new DOMException('中止', 'AbortError')));
      return pending.promise;
    }));
    const hook = renderHook(() => useTaskModelCatalog('video'));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const controller = new AbortController();
    let refresh!: Promise<void>;
    act(() => { refresh = hook.result.current.reload(controller.signal); });
    const outcome = refresh.catch(error => error);
    await act(async () => { controller.abort(); await outcome; });
    expect((await outcome).name).toBe('AbortError');
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.models.map(model => model.id)).toEqual(['initial']);
  });

  it('keeps the newest model type when an old callback tries to refresh', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL) => { calls.push(String(url)); return Promise.resolve(catalog(String(url))); }));
    const hook = renderHook(({ type }: {type:'image'|'video'}) => useTaskModelCatalog(type), {initialProps:{type:'image'} as {type:'image'|'video'}});
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const oldReload = hook.result.current.reload;
    hook.rerender({type:'video'});
    await waitFor(() => expect(hook.result.current.models[0]?.id).toBe('/api/models?type=video'));
    await act(async () => { await oldReload().catch(() => undefined); });
    expect(calls.filter(url => url === '/api/models?type=image')).toHaveLength(1);
    expect(hook.result.current.models[0]?.id).toBe('/api/models?type=video');
  });
});
