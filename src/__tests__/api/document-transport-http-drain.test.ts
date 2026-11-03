import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { executeDocumentRoute } from '@/lib/collaboration/document-execution-route';
import { getDocumentExecutionScope, getDocumentExecutionStats } from '@/lib/collaboration/document-execution-scope';
import { beginDocumentTransportTransition, documentTransportCanStart, finishDocumentTransportTransition } from '@/lib/collaboration/document-transport-gate';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function response(code: string, status: number): NextResponse {
  return NextResponse.json({ success: false, code }, { status });
}
function request(signal?: AbortSignal): NextRequest {
  return new NextRequest('http://fixture.invalid/api/collaboration/document-project', { signal });
}
function state(promise: Promise<void>): { value: 'pending' | 'fulfilled' | 'rejected' } {
  const result: { value: 'pending' | 'fulfilled' | 'rejected' } = { value: 'pending' };
  void promise.then(() => { result.value = 'fulfilled'; }, () => { result.value = 'rejected'; });
  return result;
}
async function assertPending(result: { value: string }): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 30));
  expect(result.value).toBe('pending');
}
const gateKey = Symbol.for('wujie.documentTransportGate.v1');

beforeEach(() => {
  expect(getDocumentExecutionStats().activeScopes).toBe(0);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
  vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true');
});
afterEach(async () => {
  const global = globalThis as unknown as Record<symbol, unknown>;
  const gate = global[gateKey] as { phase: string; participants: Set<unknown>; transition?: { timer?: unknown } } | undefined;
  await vi.waitFor(() => expect(getDocumentExecutionStats()).toMatchObject({
    activeScopes: 0, activeAcquires: 0, activeQueries: 0, activeObserved: 0, ownedClients: 0, actorAdmissions: 0,
  }));
  expect(gate?.participants.size ?? 0).toBe(0);
  expect(gate?.phase ?? 'open').toBe('open');
  expect(gate?.transition?.timer).toBeUndefined();
  delete global[gateKey];
  vi.unstubAllEnvs();
});

describe('HTTP execution ownership blocks transport drain', () => {
  it('opens the target after a completed request has no live resources', async () => {
    const result = await executeDocumentRoute(request(), async () => NextResponse.json({ success: true }), response);
    expect(result.status).toBe(200);
    expect(getDocumentExecutionStats().activeScopes).toBe(0);
    expect(documentTransportCanStart('http')).toBe(true);
    const transition = beginDocumentTransportTransition('ws');
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false');
    await transition.drained;
    finishDocumentTransportTransition(transition);
    expect(documentTransportCanStart('ws')).toBe(true);
  });

  it('keeps a cancelled request in drain until its original query and discarded client end', async () => {
    const held = deferred<{ rows: unknown[] }>();
    const started = deferred<void>();
    const abort = new AbortController();
    const lateBusiness = vi.fn();
    const raw = Object.assign(new EventEmitter(), {
      _ending: false, _ended: false, _queryable: true,
      query: vi.fn(), release: vi.fn(),
    });
    const pool = {
      ending: false, _clients: [raw],
      connect: vi.fn((callback: (error: Error | null, client: PoolClient) => void) => callback(null, raw as unknown as PoolClient)),
    };
    raw.query.mockImplementation((_sql: string, callback: (error: Error | null, result?: unknown) => void) => {
      started.resolve(); void held.promise.then(result => callback(null, result));
    });
    raw.release.mockImplementation(() => { raw._ending = true; pool._clients.length = 0; });
    const resolver = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('wujie.documentRequestPoolScope.v1')];
    expect(typeof resolver).toBe('function');
    const wrapped = resolver as (pool: Pool) => Pool;
    const pending = executeDocumentRoute(request(abort.signal), async () => {
      const scope = getDocumentExecutionScope();
      if (!scope) throw new Error('FIXTURE_SCOPE_MISSING');
      scope.admitActor('synthetic-actor');
      const client = await wrapped(pool as unknown as Pool).connect();
      try { await client.query('SELECT synthetic'); lateBusiness(); return NextResponse.json({ success: true }); }
      finally { client.release(); }
    }, response);
    let transition: ReturnType<typeof beginDocumentTransportTransition> | undefined;
    let finished = false;
    try {
      await started.promise;
      expect(getDocumentExecutionStats()).toMatchObject({ activeScopes: 1, activeQueries: 1, ownedClients: 1, actorAdmissions: 1 });
      abort.abort();
      const result = await pending;
      expect(result.status).toBe(400);
      expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_EXCHANGE_REQUEST_CANCELLED' });
      expect(raw.release).toHaveBeenCalledTimes(1);
      expect(raw.release).toHaveBeenCalledWith(true);
      transition = beginDocumentTransportTransition('ws');
      vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false');
      const drained = state(transition.drained);
      expect(documentTransportCanStart('ws')).toBe(false);
      await assertPending(drained);
      expect(() => finishDocumentTransportTransition(transition!)).toThrow();
      expect(getDocumentExecutionStats()).toMatchObject({ activeScopes: 1, activeQueries: 1, ownedClients: 1, actorAdmissions: 1 });

      held.resolve({ rows: [] });
      await vi.waitFor(() => expect(getDocumentExecutionStats().activeQueries).toBe(0));
      expect(getDocumentExecutionStats()).toMatchObject({ activeScopes: 1, activeQueries: 0, ownedClients: 1, actorAdmissions: 1 });
      await assertPending(drained);
      expect(() => finishDocumentTransportTransition(transition!)).toThrow();
      expect(lateBusiness).not.toHaveBeenCalled();

      raw._ended = true; raw.emit('end');
      await vi.waitFor(() => expect(drained.value).toBe('fulfilled'));
      expect(getDocumentExecutionStats()).toMatchObject({ activeScopes: 0, activeAcquires: 0, activeQueries: 0, activeObserved: 0, ownedClients: 0, actorAdmissions: 0 });
      finishDocumentTransportTransition(transition);
      finished = true;
      expect(documentTransportCanStart('ws')).toBe(true);
      expect(lateBusiness).not.toHaveBeenCalled();
      expect(raw.query).toHaveBeenCalledTimes(1);
      expect(raw.release).toHaveBeenCalledTimes(1);
    } finally {
      held.resolve({ rows: [] });
      if (!raw._ended) { raw._ended = true; raw.emit('end'); }
      await pending;
      if (transition && !finished) {
        await transition.drained;
        finishDocumentTransportTransition(transition);
      }
    }
  });
});
