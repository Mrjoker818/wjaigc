import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocumentExecutionScope, getDocumentExecutionStats, runDocumentExecution } from '@/lib/collaboration/document-execution-scope';
import { assertDocumentTransportAdmission, beginDocumentTransportTransition, documentTransportCanStart, finishDocumentTransportTransition, isDocumentTransportUnavailable, registerDocumentTransportGateway, withDocumentHttpAdmission, withDocumentWebSocketAdmission } from '@/lib/collaboration/document-transport-gate';
vi.mock('server-only', () => ({}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject };
}
async function tick(): Promise<void> { for (let i = 0; i < 60; i++) await Promise.resolve(); }
function setMode(mode: 'ws' | 'http'): void { vi.stubEnv('WUJIE_YJS_ENABLED', 'true'); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', mode === 'http' ? 'true' : 'false'); }
const key = Symbol.for('wujie.documentTransportGate.v1');
const registrations: Array<() => void> = [];
function register(participant: { closeDocumentSockets: () => Promise<void> }): void { registrations.push(registerDocumentTransportGateway(participant)); }
beforeEach(() => {
  expect(getDocumentExecutionStats().activeScopes).toBe(0);
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const existing = globals[key] as { phase: string; participants: Set<unknown> } | undefined;
  if (existing) { expect(existing.phase).toBe('open'); expect(existing.participants.size).toBe(0); delete globals[key]; }
  setMode('ws'); expect(documentTransportCanStart('ws')).toBe(true);
});
afterEach(() => { for (const unregister of registrations.splice(0)) unregister(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('document transport gate', () => {
  it('closes all participants synchronously on desired change and never auto opens', async () => {
    const closed = deferred<void>(); const gateway = vi.fn(() => closed.promise); register({ closeDocumentSockets: gateway });
    expect(documentTransportCanStart('ws')).toBe(true); setMode('http');
    expect(documentTransportCanStart('http')).toBe(false); expect(gateway).toHaveBeenCalledOnce();
    expect(documentTransportCanStart('ws')).toBe(false);
    const handle = beginDocumentTransportTransition('http'); closed.resolve(); await handle.drained;
    expect(documentTransportCanStart('http')).toBe(false); finishDocumentTransportTransition(handle);
    expect(documentTransportCanStart('http')).toBe(true);
  });
  it('rejects new HTTP and both WS kinds while draining before invoking work', async () => {
    const close = deferred<void>(); register({ closeDocumentSockets: () => close.promise });
    setMode('http'); const handle = beginDocumentTransportTransition('http'); const work = vi.fn(async () => 1);
    for (const run of [() => withDocumentHttpAdmission(work), () => withDocumentWebSocketAdmission('handshake', work), () => withDocumentWebSocketAdmission('operation', work)]) {
      const error = await run().catch(cause => cause); expect(isDocumentTransportUnavailable(error)).toBe(true);
    }
    expect(work).not.toHaveBeenCalled(); close.resolve(); await handle.drained; finishDocumentTransportTransition(handle);
  });
  it('keeps a held real execution root until original work settles', async () => {
    vi.useFakeTimers(); const held = deferred<void>();
    const running = withDocumentHttpAdmission(() => runDocumentExecution({}, async () => { await held.promise; return 1; })); await tick();
    expect(getDocumentExecutionStats().activeScopes).toBe(1); setMode('http'); const handle = beginDocumentTransportTransition('http');
    let drained = false; void handle.drained.then(() => { drained = true; }); await tick(); expect(drained).toBe(false);
    expect(() => finishDocumentTransportTransition(handle)).toThrow(); held.resolve(); await running; await vi.advanceTimersByTimeAsync(20); await handle.drained;
    expect(getDocumentExecutionStats().activeScopes).toBe(0); finishDocumentTransportTransition(handle);
  });
  it('waits for an already-returned real scope until its original query and client end', async () => {
    vi.useFakeTimers(); const query = deferred<unknown>();
    class Client extends EventEmitter { _ending = false; _ended = false; _queryable = true; release(): void { this._ending = true; } query(_sql: string, cb: (error: Error | null, value?: unknown) => void): void { void query.promise.then(value => cb(null, value), cb); } }
    const client = new Client(); const pool = { _clients: [client], ending: false, connect(cb: (error: Error | null, value: Client) => void): void { cb(null, client); } } as unknown as Pool;
    const resolver = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('wujie.documentRequestPoolScope.v1')] as (value: Pool) => Pool;
    await withDocumentHttpAdmission(() => runDocumentExecution({}, async () => { const connected = await resolver(pool).connect(); void connected.query('SELECT 1').catch(() => undefined); }));
    expect(getDocumentExecutionStats().activeQueries).toBe(1); setMode('http'); const handle = beginDocumentTransportTransition('http');
    let drained = false; void handle.drained.then(() => { drained = true; }); await vi.advanceTimersByTimeAsync(20); expect(drained).toBe(false);
    query.resolve({ rows: [] }); await tick(); await vi.advanceTimersByTimeAsync(20); expect(drained).toBe(false);
    client._ended = true; client.emit('end'); await tick(); await vi.advanceTimersByTimeAsync(20); await handle.drained; finishDocumentTransportTransition(handle);
  });
  it('rejects forged handles and rechecks desired mode and actual zero at finish', async () => {
    setMode('http'); const handle = beginDocumentTransportTransition('http'); await handle.drained;
    expect(() => finishDocumentTransportTransition({ ...handle })).toThrow(); setMode('ws'); expect(() => finishDocumentTransportTransition(handle)).toThrow();
    setMode('http'); finishDocumentTransportTransition(handle); expect(documentTransportCanStart('http')).toBe(true);
  });
  it('refuses stale context work after the transition begins', async () => {
    const paused = deferred<void>(); const work = withDocumentHttpAdmission(() => runDocumentExecution({}, async () => { await paused.promise; assertDocumentTransportAdmission(); }));
    await tick(); setMode('http'); const handle = beginDocumentTransportTransition('http'); paused.resolve();
    const cause = await work.catch(error => error); expect(isDocumentTransportUnavailable(cause)).toBe(true); await handle.drained; finishDocumentTransportTransition(handle);
  });
  it('begins before desired changes but cannot finish until config agrees', async () => {
    const handle = beginDocumentTransportTransition('http'); await handle.drained;
    expect(documentTransportCanStart('ws')).toBe(false); expect(() => finishDocumentTransportTransition(handle)).toThrow();
    setMode('http'); finishDocumentTransportTransition(handle); expect(documentTransportCanStart('http')).toBe(true);
  });
  it('blocks work and SQL if drain begins after synchronous WS registration but before work runs', async () => {
    vi.useFakeTimers(); const query = vi.fn();
    class Client extends EventEmitter { _ending = false; _ended = false; _queryable = true; release(): void {} query = query; }
    const client = new Client(); const connect = vi.fn((callback: (error: Error | null, value: Client) => void) => callback(null, client));
    const pool = { _clients: [client], ending: false, connect } as unknown as Pool;
    const resolver = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('wujie.documentRequestPoolScope.v1')] as (value: Pool) => Pool;
    const work = vi.fn(async () => { const acquired = await resolver(pool).connect(); try { await acquired.query('SELECT 1'); } finally { acquired.release(); } });
    const running = withDocumentWebSocketAdmission('operation', work).catch(error => error);
    expect(getDocumentExecutionStats().activeScopes).toBe(1);
    const handle = beginDocumentTransportTransition('http');
    const result = await running; await vi.advanceTimersByTimeAsync(20); await handle.drained;
    setMode('http'); finishDocumentTransportTransition(handle);
    expect(isDocumentTransportUnavailable(result)).toBe(true); expect(work).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
  it('starts a child WS root independently and preserves its gate admission context', async () => {
    const result = await withDocumentWebSocketAdmission('handshake', async () => {
      assertDocumentTransportAdmission();
      const parent = getDocumentExecutionScope();
      const child = await withDocumentWebSocketAdmission('operation', async () => {
        assertDocumentTransportAdmission(); expect(getDocumentExecutionScope()).not.toBe(parent); expect(getDocumentExecutionStats().activeScopes).toBe(2); return 'child';
      });
      expect(getDocumentExecutionScope()).toBe(parent); return child;
    }).catch(error => error);
    expect(result).toBe('child'); expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('retains draining on participant failure', async () => {
    let closing: Promise<void> | undefined;
    const unregister = registerDocumentTransportGateway({ closeDocumentSockets: () => { closing = Promise.reject(Error('fixture')); return closing; } });
    try {
      setMode('http'); const handle = beginDocumentTransportTransition('http'); await expect(handle.drained).rejects.toBeDefined();
      expect(() => finishDocumentTransportTransition(handle)).toThrow(); expect(documentTransportCanStart('http')).toBe(false);
    } finally {
      unregister();
      expect(closing).toBeDefined(); await closing?.catch(() => undefined);
      const globals = globalThis as unknown as Record<symbol, unknown>;
      const state = globals[key] as { participants: Set<unknown>; transition?: { failed: boolean; timer?: unknown } };
      await vi.waitFor(() => {
        expect(getDocumentExecutionStats().activeScopes).toBe(0);
        expect(state.participants.size).toBe(0);
        expect(state.transition?.failed).toBe(true);
        expect(state.transition?.timer).toBeUndefined();
      });
      expect(globals[key]).toBe(state);
      // Terminal failed transition in this isolated test worker, never a production reset.
      delete globals[key];
    }
  });
});
