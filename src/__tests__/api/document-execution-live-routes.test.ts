import { EventEmitter } from 'node:events';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type QueryResult = { rows: unknown[]; rowCount: number };
type SyntheticClient = EventEmitter & { calls: string[]; releases: boolean[] };
const fixture = vi.hoisted(() => ({
  clients: [] as SyntheticClient[], query: vi.fn<(sql: string) => Promise<QueryResult>>(),
  auth: vi.fn(), project: vi.fn(), owner: vi.fn(), ticket: vi.fn(), start: vi.fn(),
  renew: vi.fn(), snapshot: vi.fn(), write: vi.fn(), receipt: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('pg', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Client extends Emitter {
    calls: string[] = [];
    releases: boolean[] = [];
    _ending = false;
    _ended = false;
    _queryable = true;
    constructor(private readonly pool: Pool) {
      super();
      this.once('end', () => { this._ended = true; });
    }
    query(sql: string, ...args: unknown[]): Promise<QueryResult> | void {
      this.calls.push(sql);
      const result = Promise.resolve().then(() => fixture.query(sql));
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        void result.then(value => callback(null, value), error => callback(error));
        return;
      }
      return result;
    }
    release(discard = false): void {
      this.releases.push(discard);
      if (discard) {
        this._ending = true;
        const index = this.pool._clients.indexOf(this);
        if (index >= 0) this.pool._clients.splice(index, 1);
        // The test controls the later end event separately from release.
      }
    }
  }
  class Pool extends Emitter {
    _clients: Client[] = [];
    ending = false;
    connect(callback?: (error: Error | null, client: Client) => void): Promise<Client> | void {
      const client = new Client(this); this._clients.push(client); fixture.clients.push(client);
      if (callback) { queueMicrotask(() => callback(null, client)); return; }
      return Promise.resolve(client);
    }
    async end(): Promise<void> { /* synthetic pool only */ }
  }
  return { Pool };
});
vi.mock('@/lib/server-auth', () => ({ getSessionUser: fixture.auth, WUJIE_SESSION_COOKIE: 'wujie_session' }));
vi.mock('@/lib/collaboration/document-project-bridge', () => ({ readCollaborativeProject: fixture.project, enableCollaborativeProject: vi.fn() }));
vi.mock('@/lib/collaboration/document-owner-status', () => ({ readDocumentOwnerStatus: fixture.owner }));
vi.mock('@/lib/collaboration/document-tickets', () => ({ issueDocumentTicket: fixture.ticket }));
vi.mock('@/lib/collaboration/document-exchange-sessions', () => ({ startDocumentExchangeSession: fixture.start, renewDocumentExchangeSession: fixture.renew }));
vi.mock('@/lib/collaboration/document-exchange-snapshot', () => ({ readDocumentExchangeSnapshot: fixture.snapshot }));
vi.mock('@/lib/collaboration/document-exchange-receipts', () => ({ executeDocumentExchangeUpdate: fixture.write, readDocumentExchangeReceipt: fixture.receipt, readDocumentExchangeReceiptByDigest: fixture.receipt }));

import { getPool } from '@/lib/db-client';
import { getDocumentExecutionStats } from '@/lib/collaboration/document-execution-scope';
import { GET as project } from '@/app/api/collaboration/document-project/route';
import { GET as owner } from '@/app/api/collaboration/document-enable/route';
import { POST as ticket } from '@/app/api/collaboration/document-ticket/route';
import { POST as session } from '@/app/api/collaboration/document-exchange-session/route';
import { POST as exchange } from '@/app/api/collaboration/document-exchange/route';
import { POST as receipt } from '@/app/api/collaboration/document-exchange-receipt/route';

const token = 'a'.repeat(43);
const operation = '11111111-1111-4111-8111-111111111111';
const ok = { rows: [], rowCount: 0 };
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function flush(): Promise<void> { for (let i = 0; i < 80; i++) await Promise.resolve(); }
function request(kind: string, signal?: AbortSignal, bodyOverride?: ReadableStream<Uint8Array>): NextRequest {
  const path = kind === 'owner' ? 'document-enable' : kind === 'project' ? 'document-project' : kind === 'ticket' ? 'document-ticket' : kind === 'session' ? 'document-exchange-session' : kind === 'receipt' ? 'document-exchange-receipt' : 'document-exchange';
  const headers = new Headers({ origin: 'https://fixture.invalid', cookie: 'wujie_session=synthetic-cookie', 'x-wujie-expected-actor-id': 'actor-a' });
  const url = 'https://fixture.invalid/api/collaboration/' + path;
  if (kind === 'owner' || kind === 'project') return new NextRequest(url + '?projectId=project-a', { headers, signal });
  headers.set('content-type', kind === 'exchange' ? 'application/octet-stream' : 'application/json');
  headers.set('x-wujie-document-transport', 'http');
  if (kind === 'exchange') { headers.set('x-wujie-project-id', 'project-a'); headers.set('x-wujie-document-session', token); headers.set('x-wujie-document-operation-id', operation); }
  const body = bodyOverride ?? (kind === 'exchange' ? new Uint8Array([2, 0]) : JSON.stringify(kind === 'session' ? { action: 'start', projectId: 'project-a', ticket: token } : kind === 'receipt' ? { projectId: 'project-a', sessionToken: token, operationId: operation, updateDigest: 'b'.repeat(64) } : { projectId: 'project-a' }));
  return new NextRequest(url, { method: 'POST', headers, body, signal, ...(bodyOverride ? { duplex: 'half' } : {}) } as ConstructorParameters<typeof NextRequest>[1]);
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.clients.length = 0;
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture.invalid/synthetic'); vi.stubEnv('PGDATABASE_URL', '');
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true'); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'https://fixture.invalid');
  fixture.query.mockResolvedValue(ok);
  fixture.auth.mockImplementation(async () => { await getPool().query('AUTH'); return { id: 'actor-a' }; });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it('all six real routes keep cancelled auth owned until both query and client end settle', async () => {
  const foreign = await getPool().connect();
  const foreignRaw = fixture.clients[0];
  for (const [kind, handle] of [['project', project], ['owner', owner], ['ticket', ticket], ['session', session], ['exchange', exchange], ['receipt', receipt]] as const) {
    const gate = deferred<QueryResult>(); fixture.query.mockImplementation(() => gate.promise);
    const abort = new AbortController(); const response = handle(request(kind, abort.signal));
    await flush();
    const owned = fixture.clients.at(-1)!;
    expect(owned.calls, kind).toEqual(['AUTH']);
    expect(getDocumentExecutionStats().activeQueries, kind).toBe(1);
    abort.abort(); const result = await response;
    expect(result.status, kind).toBe(400);
    expect(await result.json(), kind).toEqual({ success: false, code: 'DOCUMENT_EXCHANGE_REQUEST_CANCELLED' });
    expect(owned.releases, kind).toEqual([true]); expect(foreignRaw.releases, kind).toEqual([]);
    expect(getDocumentExecutionStats().activeScopes, kind).toBe(1);
    expect(getDocumentExecutionStats().ownedClients, kind).toBe(1);
    gate.resolve(ok); await flush();
    expect(getDocumentExecutionStats().activeQueries, kind).toBe(0);
    expect(getDocumentExecutionStats().activeScopes, kind).toBe(1);
    owned.emit('end'); await flush();
    expect(getDocumentExecutionStats().activeScopes, kind).toBe(0);
  }
  expect(fixture.project).not.toHaveBeenCalled(); expect(fixture.owner).not.toHaveBeenCalled(); expect(fixture.ticket).not.toHaveBeenCalled();
  expect(fixture.start).not.toHaveBeenCalled(); expect(fixture.write).not.toHaveBeenCalled(); expect(fixture.receipt).not.toHaveBeenCalled(); expect(fixture.snapshot).not.toHaveBeenCalled();
  foreign.release();
});

it('ticket body deadline is 5s and never issues a ticket', async () => {
  vi.useFakeTimers();
  const body = new ReadableStream<Uint8Array>({});
  const pending = ticket(request('ticket', undefined, body)); await flush();
  await vi.advanceTimersByTimeAsync(4999); let settled = false; void pending.then(() => { settled = true; }); await flush(); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1); const result = await pending;
  expect(result.status).toBe(408); expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT' });
  expect(fixture.ticket).not.toHaveBeenCalled(); await flush(); expect(getDocumentExecutionStats().activeScopes).toBe(0);
});

it('the total 20s budget yields uncertain without ACK while COMMIT is still in flight', async () => {
  vi.useFakeTimers(); const commit = deferred<QueryResult>();
  fixture.query.mockImplementation(sql => sql === 'COMMIT' ? commit.promise : sql.startsWith('STEP') ? new Promise(resolve => setTimeout(() => resolve(ok), 4500)) : Promise.resolve(ok));
  fixture.write.mockImplementation(async () => {
    const client = await getPool().connect();
    try { await client.query('BEGIN'); await client.query('STEP1'); await client.query('STEP2'); await client.query('STEP3'); await client.query('COMMIT'); return { operationId: operation, sessionFingerprint: 'b'.repeat(64), updateDigest: 'c'.repeat(64), documentSequence: 1 }; }
    finally { client.release(); }
  });
  const pending = exchange(request('exchange')); await flush();
  await vi.advanceTimersByTimeAsync(13500); await flush();
  const owned = fixture.clients.at(-1)!; expect(owned.calls).toEqual(['BEGIN', 'STEP1', 'STEP2', 'STEP3', 'COMMIT']);
  await vi.advanceTimersByTimeAsync(6499); let settled = false; void pending.then(() => { settled = true; }); await flush(); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1); const result = await pending;
  expect(result.status).toBe(503); expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_EXCHANGE_UNCERTAIN' });
  expect(owned.releases).toEqual([true]); expect(getDocumentExecutionStats().activeScopes).toBe(1);
  expect(getDocumentExecutionStats().actorAdmissions).toBe(1);
  owned.emit('end'); await flush();
  expect(getDocumentExecutionStats().activeScopes).toBe(1); expect(getDocumentExecutionStats().activeQueries).toBe(1);
  expect(getDocumentExecutionStats().actorAdmissions).toBe(1);
  commit.resolve(ok); await flush(); expect(getDocumentExecutionStats().activeScopes).toBe(0);
  expect(getDocumentExecutionStats().actorAdmissions).toBe(0);
});
