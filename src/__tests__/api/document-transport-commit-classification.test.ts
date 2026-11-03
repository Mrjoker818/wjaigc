import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Result = { rows: Array<Record<string, unknown>>; rowCount: number };
const fixture = vi.hoisted(() => ({ query: vi.fn<(sql: string) => Promise<Result>>(), auth: vi.fn(), release: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('pg', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Client extends Emitter {
    _ending = false; _ended = false; _queryable = true;
    constructor(private readonly pool: Pool) { super(); }
    query(sql: string, ...args: unknown[]): Promise<Result> | void {
      const result = Promise.resolve().then(() => fixture.query(sql)); const callback = args.at(-1);
      if (typeof callback === 'function') { void result.then(value => callback(null, value), error => callback(error)); return; }
      return result;
    }
    release(discard = false): void {
      fixture.release(discard);
      if (!discard) return;
      this._ending = true; this.pool._clients = this.pool._clients.filter(client => client !== this);
      queueMicrotask(() => { this._ended = true; this.emit('end'); });
    }
  }
  class Pool extends Emitter {
    _clients: Client[] = []; ending = false;
    connect(callback?: (error: Error | null, client: Client) => void): Promise<Client> | void {
      const client = new Client(this); this._clients.push(client);
      if (callback) { queueMicrotask(() => callback(null, client)); return; }
      return Promise.resolve(client);
    }
    async end(): Promise<void> {}
  }
  return { Pool };
});
vi.mock('@/lib/server-auth', () => ({ getSessionUser: fixture.auth, WUJIE_SESSION_COOKIE: 'wujie_session' }));
vi.mock('@/lib/collaboration/document-access', () => ({
  assertDocumentEditor: async () => ({ ownerId: 'actor-a' }),
  assertDocumentProjectEnabled: async () => {},
  DocumentAccessError: class extends Error {},
  DocumentFeatureDisabledError: class extends Error {},
  DocumentProjectNotEnabledError: class extends Error {},
}));

import { getPool } from '@/lib/db-client';
import { getDocumentExecutionStats } from '@/lib/collaboration/document-execution-scope';
import { executeDocumentRoute } from '@/lib/collaboration/document-execution-route';
import { beginDocumentTransportTransition, documentTransportCanStart, finishDocumentTransportTransition, type DocumentTransportTransition } from '@/lib/collaboration/document-transport-gate';
import { POST as issueTicket } from '@/app/api/collaboration/document-ticket/route';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void } {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
const ok: Result = { rows: [], rowCount: 0 };
let transition: DocumentTransportTransition | undefined;
function request(): NextRequest {
  return new NextRequest('https://fixture.invalid/api/collaboration/document-ticket', {
    method: 'POST', headers: { origin: 'https://fixture.invalid', cookie: 'wujie_session=synthetic', 'content-type': 'application/json', 'x-wujie-expected-actor-id': 'actor-a', 'x-wujie-document-transport': 'ws' },
    body: JSON.stringify({ projectId: 'project-a' }),
  });
}
function response(code: string, status: number): NextResponse { return NextResponse.json({ success: false, code }, { status }); }
async function waitForCommit(): Promise<void> {
  await vi.waitFor(() => expect(fixture.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1));
}
beforeEach(() => {
  expect(getDocumentExecutionStats().activeScopes).toBe(0); vi.clearAllMocks(); transition = undefined;
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true'); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false');
  vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'https://fixture.invalid'); vi.stubEnv('DATABASE_URL', 'postgresql://fixture.invalid/commit-classification'); vi.stubEnv('PGDATABASE_URL', '');
  fixture.auth.mockResolvedValue({ id: 'actor-a' }); fixture.query.mockResolvedValue(ok);
  expect(documentTransportCanStart('ws')).toBe(true);
});
afterEach(async () => {
  await vi.waitFor(() => expect(getDocumentExecutionStats().activeScopes).toBe(0));
  if (transition) { await transition.drained; vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); finishDocumentTransportTransition(transition); }
  const globals = globalThis as unknown as Record<symbol, unknown>, key = Symbol.for('wujie.documentTransportGate.v1');
  const state = globals[key] as { phase: string; participants: Set<unknown> };
  expect(state.phase).toBe('open'); expect(state.participants.size).toBe(0); delete globals[key];
  vi.unstubAllEnvs();
});

it('real ticket service COMMIT succeeding after drain starts returns DRAINING', async () => {
  const commit = deferred<Result>(); fixture.query.mockImplementation(sql => sql === 'COMMIT' ? commit.promise : Promise.resolve(ok));
  const running = issueTicket(request()); await waitForCommit();
  transition = beginDocumentTransportTransition('http'); commit.resolve(ok);
  const result = await running; const payload: unknown = await result.json();
  expect(result.status).toBe(503); expect(payload).toEqual({ success: false, code: 'DOCUMENT_TRANSPORT_DRAINING' });
  expect(fixture.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
});

it('real ticket service confirmed COMMIT followed by drain returns DRAINING', async () => {
  fixture.release.mockImplementationOnce(() => { transition = beginDocumentTransportTransition('http'); });
  const result = await issueTicket(request());
  expect(transition).toBeDefined(); expect(fixture.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
  expect(result.status).toBe(503); expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_TRANSPORT_DRAINING' });
});

it('real ticket service uncertain COMMIT remains UNCERTAIN during drain', async () => {
  const commit = deferred<Result>(); fixture.query.mockImplementation(sql => sql === 'COMMIT' ? commit.promise : Promise.resolve(ok));
  const running = issueTicket(request()); await waitForCommit();
  transition = beginDocumentTransportTransition('http'); commit.reject(Error('synthetic private driver failure'));
  const result = await running; expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_EXCHANGE_UNCERTAIN' });
  expect(fixture.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
});

it('actual wrapper preserves exact UNCERTAIN_FORBIDDEN after an uncertain COMMIT', async () => {
  const commit = deferred<Result>(); fixture.query.mockImplementation(sql => sql === 'COMMIT' ? commit.promise : Promise.resolve(ok));
  const running = executeDocumentRoute(request(), async () => {
    const client = await getPool().connect();
    try { await client.query('COMMIT'); throw Error('synthetic commit unexpectedly succeeded'); }
    catch { return response('DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN', 403); }
    finally { client.release(); }
  }, response);
  await waitForCommit(); transition = beginDocumentTransportTransition('http'); commit.reject(Error('synthetic private driver failure'));
  const result = await running; expect(result.status).toBe(403);
  expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN' });
  expect(fixture.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
});
