// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemorySimpleChatEnvelopeStore, envelope, project } from '@/__tests__/fixtures/simple-chat-sync';
import DashboardView from '@/components/dashboard/dashboard-view';

const state = vi.hoisted(() => ({ mode: 'network', store: null as ReturnType<typeof createMemorySimpleChatEnvelopeStore> | null, resolveFetch: null as null | ((response: Response) => void), resolveLocal: null as null | (() => void), oldSignal: null as AbortSignal | null }));
vi.mock('@/lib/simple-chat-sync-storage', () => ({ createIndexedDbSimpleChatEnvelopeStore: () => ({
  ...state.store!, get: async (id: string) => { if (state.mode === 'local') await new Promise<void>(resolve => { state.resolveLocal = resolve; }); return state.store!.get(id); },
}) }));
const user = (id = 'A') => ({ id, name: id, productType: 'chat', createdAt: 1, updatedAt: 1 });
const props = (id = 'A') => ({ user: user(id), onOpenProject: () => {}, onNewProject: () => {} });
const response = (name: string) => Response.json({ success: true, value: [{ ...project('same'), name }], syncRevision: 1 });

beforeEach(async () => {
  state.mode = 'network'; state.resolveFetch = null; state.resolveLocal = null; state.oldSignal = null;
  state.store = createMemorySimpleChatEnvelopeStore();
  await state.store.put({ ...envelope('A'), currentProjects: [{ ...project('same'), name: '缓慢本机项目' }] });
  const values = new Map<string,string>();
  vi.stubGlobal('localStorage', { get length() { return values.size; }, key: (i:number) => [...values.keys()][i] ?? null, getItem: (k:string) => values.get(k) ?? null, setItem: (k:string,v:string) => values.set(k,v), removeItem: (k:string) => values.delete(k), clear: () => values.clear() });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes('chat_simple_projects')) return Response.json({ success: false });
    if (state.mode === 'network') { state.oldSignal = init?.signal ?? null; return new Promise<Response>(resolve => { state.resolveFetch = resolve; }); }
    if (state.mode === 'local') throw Error('synthetic offline');
    return response(state.mode === 'B' ? 'B新项目' : '重试新项目');
  }));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { state.resolveFetch?.(response('清理')); state.resolveLocal?.(); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function flush() { await act(async () => { for (let i=0; i<8; i++) await Promise.resolve(); }); }

it('slow network shows a notice at three seconds but its original fourth-second success appears', async () => {
  render(<DashboardView {...props()} />); await flush(); expect(state.resolveFetch).not.toBeNull();
  await advance(3000); expect(screen.getByText('读取较慢，仍在进行；完成后会自动显示，也可以重试。')).toBeTruthy();
  expect(screen.getByText('读取较慢，仍在进行；完成后会自动显示，也可以重试。')).toBeTruthy();
  expect(state.oldSignal?.aborted).toBe(false);
  await advance(1000); await act(async () => { state.resolveFetch!(response('缓慢远端项目')); await Promise.resolve(); }); await flush();
  expect(screen.getByText('缓慢远端项目')).toBeTruthy(); expect(screen.queryByText('读取较慢，仍在进行；完成后会自动显示，也可以重试。')).toBeNull();
});

it('slow local fallback shows its fourth-second data without a second read', async () => {
  state.mode='local'; render(<DashboardView {...props()} />); await flush(); expect(state.resolveLocal).not.toBeNull();
  await advance(3000); expect(screen.getByText('读取较慢，仍在进行；完成后会自动显示，也可以重试。')).toBeTruthy();
  await advance(1000); await act(async () => { state.resolveLocal!(); await Promise.resolve(); }); await flush();
  expect(screen.getByText('缓慢本机项目')).toBeTruthy(); expect(screen.getByText('同步暂不可用，当前显示本机副本，远端状态未确认。')).toBeTruthy();
});

it('retry cancels the prior attempt and ignores its fourth-second reply', async () => {
  render(<DashboardView {...props()} />); await flush(); const old=state.resolveFetch!; const signal=state.oldSignal!;
  await advance(3000); state.mode='retry'; fireEvent.click(screen.getByRole('button', {name:'重试读取'})); await flush();
  expect(signal.aborted).toBe(true); expect(screen.getByText('重试新项目')).toBeTruthy();
  await advance(1000); await act(async () => { old(response('过期A项目')); await Promise.resolve(); }); await flush();
  expect(screen.queryByText('过期A项目')).toBeNull(); expect(screen.getByText('重试新项目')).toBeTruthy();
});

it('account switch cancels the prior attempt and ignores its fourth-second reply', async () => {
  const view=render(<DashboardView {...props()} />); await flush(); const old=state.resolveFetch!; const signal=state.oldSignal!;
  await advance(3000); state.mode='B'; view.rerender(<DashboardView {...props('B')} />); await flush();
  expect(signal.aborted).toBe(true); expect(screen.getByText('B新项目')).toBeTruthy();
  await advance(1000); await act(async () => { old(response('过期A项目')); await Promise.resolve(); }); await flush();
  expect(screen.queryByText('过期A项目')).toBeNull(); expect(screen.getByText('B新项目')).toBeTruthy();
});

it('offers a retry target of at least 44px in each dimension', async () => {
  render(<DashboardView {...props()} />); await flush(); await advance(3000);
  const button=screen.getByRole('button', {name:'重试读取'});
  expect(button.className).toContain('min-h-[44px]'); expect(button.className).toContain('min-w-[44px]');
});
