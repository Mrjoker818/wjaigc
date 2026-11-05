// @vitest-environment jsdom
// Real public conversation view. Only two synthetic GET receipts per switch.
// No route server, credentials, database, external request or model invocation.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SharedViewClient from '@/app/shared/[shareId]/shared-view-client';

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(reason: Error): void; }
interface PlannedRead { id: string; gate: Deferred<Response>; started: boolean; }
interface ShareReply { title: string; viewCount: number; messages: Array<{ id: string; role: 'user'; content: string }>; }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const A = 'qm-owned-share-a', B = 'qm-owned-share-b';
const plans: PlannedRead[] = [], faults: string[] = [];
const unsettled = new Set<Deferred<Response>>();
const bodies = new Set<Deferred<ShareReply>>();
function plan(id: string): Deferred<Response> {
  const gate = deferred<Response>(); plans.push({ id, gate, started: false }); unsettled.add(gate); return gate;
}
function payload(id: string): ShareReply {
  return { title: 'QM分享' + id, viewCount: id === A ? 11 : 22,
    messages: [{ id: id + '-message', role: 'user', content: 'QM正文' + id }] };
}
function readOnlyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const p = plans.find(p => !p.started && url === '/api/simple-chat/share/' + p.id);
  if (!p || method !== 'GET' || init?.body != null) {
    const error = 'QM_UNEXPECTED_TRANSPORT ' + method + ' ' + url; faults.push(error); return Promise.reject(Error(error));
  }
  p.started = true;
  // Deliberately permits already-queued replies after cancellation.
  return p.gate.promise;
}
async function finish(gate: Deferred<Response>, response: Response): Promise<void> {
  await act(async (): Promise<void> => { unsettled.delete(gate); gate.resolve(response); await gate.promise; });
}
async function success(gate: Deferred<Response>, id: string): Promise<void> {
  await finish(gate, Response.json(payload(id)));
}
async function reject(gate: Deferred<Response>): Promise<void> {
  await act(async (): Promise<void> => {
    unsettled.delete(gate); gate.reject(Error('QM旧请求网络错误')); await Promise.allSettled([gate.promise]);
  });
}
function currentB(): void {
  expect(screen.getByRole('heading', { name: 'QM分享' + B }), 'QM_CURRENT_B_HEADING').toBeTruthy();
  expect(screen.getByText('QM正文' + B), 'QM_CURRENT_B_CONTENT').toBeTruthy();
  expect(screen.queryByText('QM正文' + A), 'QM_OLD_A_CANNOT_OVERWRITE_B').toBeNull();
  expect(screen.queryByRole('alert'), 'QM_OLD_ERROR_CANNOT_REPLACE_B').toBeNull();
}
beforeEach((): void => { plans.length = 0; faults.length = 0; unsettled.clear(); bodies.clear(); vi.stubGlobal('fetch', readOnlyFetch); });
afterEach(async (): Promise<void> => {
  cleanup();
  try {
    await act(async (): Promise<void> => {
      const pending = [...unsettled], pendingBodies = [...bodies];
      for (const gate of pending) { unsettled.delete(gate); gate.resolve(Response.json({ error: 'QM fixture ended' }, { status: 410 })); }
      for (const body of pendingBodies) { bodies.delete(body); body.resolve(payload(A)); }
      await Promise.allSettled([...pending.map(g => g.promise), ...pendingBodies.map(g => g.promise)]);
    });
    expect(faults, 'QM_FIXTURE_HAS_NO_UNEXPECTED_TRANSPORT').toEqual([]);
    expect(plans.every(p => p.started), 'QM_ALL_AND_ONLY_PLANNED_READS_STARTED').toBe(true);
    expect(unsettled.size + bodies.size, 'QM_ALL_DEFERRED_REPLIES_FINISHED').toBe(0);
    console.log('QM_TRANSPORT_TERMINAL ' + JSON.stringify({ reads: plans.length, methods: ['GET'], pending: 0, faults: [...faults], realNetwork: false }));
  } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
describe('QM public conversation route identity', () => {
  it('hides previous share while the next share is pending', async (): Promise<void> => {
    const a = plan(A), b = plan(B); const view = render(<SharedViewClient shareId={A} />);
    await success(a, A); expect(screen.getByText('QM正文' + A)).toBeTruthy();
    view.rerender(<SharedViewClient shareId={B} />);
    expect(screen.queryByText('QM正文' + A), 'QM_A_OLD_CONTENT_NOT_VISIBLE_DURING_B_LOAD').toBeNull();
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    await success(b, B); currentB();
  });
  it('ignores a late successful response from a previous share', async (): Promise<void> => {
    const a = plan(A), b = plan(B); const view = render(<SharedViewClient shareId={A} />);
    view.rerender(<SharedViewClient shareId={B} />); await success(b, B); currentB();
    await success(a, A); currentB();
  });
  it('ignores a late rejected response from a previous share', async (): Promise<void> => {
    const a = plan(A), b = plan(B); const view = render(<SharedViewClient shareId={A} />);
    view.rerender(<SharedViewClient shareId={B} />); await success(b, B); currentB();
    await reject(a); currentB();
  });
  it('clears the previous share error before loading a new share', async (): Promise<void> => {
    const a = plan(A), b = plan(B); const view = render(<SharedViewClient shareId={A} />);
    await finish(a, Response.json({ error: 'QM分享A已撤销' }, { status: 404 }));
    expect(screen.getByRole('alert')).toBeTruthy(); view.rerender(<SharedViewClient shareId={B} />);
    expect(screen.queryByRole('alert'), 'QM_A_ERROR_NOT_VISIBLE_DURING_B_LOAD').toBeNull();
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    await success(b, B); currentB();
  });
  it('ignores an old JSON body that completes after the next share', async (): Promise<void> => {
    const a = plan(A), b = plan(B), body = deferred<ShareReply>(); bodies.add(body);
    const view = render(<SharedViewClient shareId={A} />);
    const headersOnly = new Response(null, { status: 200 });
    Object.defineProperty(headersOnly, 'json', { value: (): Promise<ShareReply> => body.promise });
    await finish(a, headersOnly); view.rerender(<SharedViewClient shareId={B} />); await success(b, B); currentB();
    await act(async (): Promise<void> => { bodies.delete(body); body.resolve(payload(A)); await body.promise; }); currentB();
  });
  it('retains the current empty and unavailable share states', async (): Promise<void> => {
    const a = plan(A), b = plan(B); const view = render(<SharedViewClient shareId={A} />);
    await finish(a, Response.json({ title: 'QM空分享', messages: [], viewCount: 0 }));
    expect(screen.getByText('该分享暂无对话内容')).toBeTruthy(); view.rerender(<SharedViewClient shareId={B} />);
    await finish(b, Response.json({ error: 'QM当前分享不可用' }, { status: 404 }));
    expect(screen.getByRole('alert').textContent).toContain('QM当前分享不可用');
    expect(screen.queryByText('QM空分享')).toBeNull();
  });
});
