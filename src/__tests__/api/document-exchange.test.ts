import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { applyCanvasImagePatch, assertCanvasDocumentTransition, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';

const boundary = vi.hoisted(() => ({ getPool: vi.fn(), getSessionUser: vi.fn(), assertDocumentEditor: vi.fn(),
  assertDocumentProjectEnabled: vi.fn(), loadDocumentInTransaction: vi.fn(), commitDocumentUpdateInTransaction: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({ getPool: boundary.getPool }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: boundary.getSessionUser, WUJIE_SESSION_COOKIE: 'wujie_session' }));
vi.mock('@/lib/collaboration/document-access', () => ({ assertDocumentEditor: boundary.assertDocumentEditor,
  assertDocumentProjectEnabled: boundary.assertDocumentProjectEnabled, withDocumentEditorRead: vi.fn() }));
vi.mock('@/lib/collaboration/document-store', () => ({ loadDocumentInTransaction: boundary.loadDocumentInTransaction,
  commitDocumentUpdateInTransaction: boundary.commitDocumentUpdateInTransaction, commitDocumentUpdate: vi.fn(),
  DocumentUpdateRejectedError: class DocumentUpdateRejectedError extends Error {} }));
vi.mock('@/lib/collaboration/document-assets', () => ({ DocumentAssetError: class DocumentAssetError extends Error {} }));
vi.mock('@/lib/collaboration/document-tickets', () => ({ consumeDocumentTicket: vi.fn() }));
import { POST } from '@/app/api/collaboration/document-exchange/route';
import { POST as lookupReceipt } from '@/app/api/collaboration/document-exchange-receipt/route';
import { getDocumentExecutionStats } from '@/lib/collaboration/document-execution-scope';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const digest = (bytes: Uint8Array): string => createHash('sha256').update('wujie-document-update-v1\0').update(bytes).digest('hex');
const tokenA = 'a'.repeat(43), tokenB = 'b'.repeat(43), cookieA = 'synthetic-cookie-a', cookieB = 'synthetic-cookie-b';
const baseTime = Date.now();
function descriptor(actorId: 'actor-a' | 'actor-b') {
  const token = actorId === 'actor-a' ? tokenA : tokenB;
  return { sessionToken: token, sessionFingerprint: hash(token), actorId, projectId: 'project-a', ownerId: 'owner-a',
    grantGeneration: '7', expiresAt: new Date(baseTime + 600_000).toISOString(), retainUntil: new Date(baseTime + 604_800_000).toISOString() };
}
function clone(doc: Y.Doc): Y.Doc { const next = createCanvasDocument(); Y.applyUpdate(next, Y.encodeStateAsUpdate(doc)); return next; }
function framed(type: number, bytes: Uint8Array): Uint8Array { const out = new Uint8Array(bytes.length + 1); out[0] = type; out.set(bytes, 1); return out; }
function pullFrame(): Uint8Array { const doc = new Y.Doc(); try { return framed(1, Y.encodeStateVector(doc)); } finally { doc.destroy(); } }

interface ReceiptRow { update_digest: string; document_sequence: string }
interface SessionRow { session_hash: string; actor_id: string; auth_session_hash: string; project_id: string;
  owner_id: string; grant_generation: string; shortActive: boolean; retained: boolean; revoked: boolean }
interface Client {
  query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; pendingDoc?: Y.Doc; pendingSequence?: number;
  receipt?: [string, ReceiptRow]; hasProjectLock: boolean; stagedWrites: number;
}
interface Fixture {
  doc: Y.Doc; sequence: number; writes: number; loads: number; grants: Map<string, string>;
  sessions: Map<string, SessionRow>; receipts: Map<string, ReceiptRow>; clients: Client[];
  commitResponseLost: boolean; projectHolder?: Client; waiters: Array<() => void>;
}
function fixture(): Fixture {
  const doc = createCanvasDocument();
  for (const placementId of ['p-one', 'p-two']) applyCanvasImagePatch(doc, {
    placementId, assetVersionId: `${placementId}-v1`, x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
  }, 'authoritative-fixture');
  const result: Fixture = { doc, sequence: 1, writes: 0, loads: 0, grants: new Map([['actor-a', '7'], ['actor-b', '7']]),
    sessions: new Map(), receipts: new Map(), clients: [], waiters: [], commitResponseLost: false };
  for (const actor of ['actor-a', 'actor-b'] as const) {
    const value = descriptor(actor); result.sessions.set(value.sessionFingerprint, { session_hash: value.sessionFingerprint,
      actor_id: actor, auth_session_hash: hash(actor === 'actor-a' ? cookieA : cookieB), project_id: 'project-a',
      owner_id: 'owner-a', grant_generation: '7', shortActive: true, retained: true, revoked: false });
  }
  return result;
}
function bind(state: Fixture): void {
  boundary.getSessionUser.mockImplementation(async (request: NextRequest) => {
    const cookie = request.cookies.get('wujie_session')?.value;
    return cookie === cookieA || cookie === `${cookieA}-new` ? { id: 'actor-a' } : cookie === cookieB ? { id: 'actor-b' } : null;
  });
  boundary.assertDocumentEditor.mockImplementation(async (actor: string, project: string, _client: Client, generation: string) => {
    if (project !== 'project-a' || state.grants.get(actor) !== generation) throw { code: 'DOCUMENT_FORBIDDEN' };
    return { ownerId: 'owner-a' };
  });
  boundary.assertDocumentProjectEnabled.mockResolvedValue(undefined);
  boundary.loadDocumentInTransaction.mockImplementation(async () => { state.loads++; return { doc: clone(state.doc), sequence: state.sequence }; });
  // Controlled persistence boundary. Real Yjs/transition validation, NOT the actual PG asset checks or COMMIT engine.
  boundary.commitDocumentUpdateInTransaction.mockImplementation(async (client: Client, input: { bytes: Uint8Array }) => {
    const candidate = clone(state.doc); Y.applyUpdate(candidate, input.bytes); assertCanvasDocumentTransition(state.doc, candidate);
    client.pendingDoc = candidate; client.pendingSequence = state.sequence + 1; client.stagedWrites = 1;
    return { sequence: client.pendingSequence, update: input.bytes };
  });
  boundary.getPool.mockReturnValue({ connect: async () => {
    const client: Client = { query: vi.fn(), release: vi.fn(), hasProjectLock: false, stagedWrites: 0 };
    const unlock = (): void => { if (state.projectHolder === client) { state.projectHolder = undefined; client.hasProjectLock = false; state.waiters.shift()?.(); } };
    client.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
      if (sql.includes('FROM wujie_projects') && /FOR (?:UPDATE|SHARE)/u.test(sql) && !client.hasProjectLock) {
        if (state.projectHolder && state.projectHolder !== client) {
          if (sql.includes('NOWAIT')) throw { code: '55P03' };
          await new Promise<void>(resolve => state.waiters.push(resolve));
        }
        state.projectHolder = client; client.hasProjectLock = true;
      }
      if (sql === 'COMMIT') {
        if (client.pendingDoc) { state.doc.destroy(); state.doc = client.pendingDoc; client.pendingDoc = undefined; state.sequence = client.pendingSequence!; state.writes += client.stagedWrites; }
        if (client.receipt) state.receipts.set(...client.receipt);
        unlock();
        if (state.commitResponseLost) { state.commitResponseLost = false; throw new Error('synthetic lost COMMIT response'); }
      }
      if (sql === 'ROLLBACK') { client.pendingDoc?.destroy(); client.pendingDoc = undefined; client.receipt = undefined; unlock(); }
      if (sql.includes('FROM wujie_document_exchange_sessions')) {
        const row = state.sessions.get(String(args[0]));
        return { rows: row ? [{ ...row, active: !row.revoked && (sql.includes('retain_until > clock_timestamp()') ? row.retained : row.shortActive) }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('FROM wujie_project_canvas_documents')) return { rows: [{ owner_id: 'owner-a', sequence: String(state.sequence) }], rowCount: 1 };
      if (sql.includes('FROM wujie_document_update_receipts')) {
        const row = state.receipts.get(`${args[0]}:${args[1]}`); return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO wujie_document_update_receipts')) client.receipt = [`${args[0]}:${args[1]}`, { update_digest: String(args[6]), document_sequence: String(args[7]) }];
      return { rows: [{}], rowCount: 1 };
    });
    client.release.mockImplementation(() => { unlock(); }); state.clients.push(client); return client;
  } });
}
function request(body = pullFrame(), options: { actor?: 'actor-a' | 'actor-b'; operationId?: string; mode?: string; after?: string;
  project?: string; cookie?: string; origin?: string; query?: string; token?: string } = {}): NextRequest {
  const actor = options.actor ?? 'actor-a', session = descriptor(actor);
  const headers = new Headers({ Origin: options.origin ?? 'http://localhost:5000', 'Content-Type': 'application/octet-stream',
    Cookie: `wujie_session=${options.cookie ?? (actor === 'actor-a' ? cookieA : cookieB)}`, 'x-wujie-expected-actor-id': actor,
    'x-wujie-project-id': options.project ?? 'project-a', 'x-wujie-document-session': options.token ?? session.sessionToken });
  if (options.operationId) headers.set('x-wujie-document-operation-id', options.operationId);
  if (options.mode) headers.set('x-wujie-document-operation', options.mode);
  if (options.after) headers.set('x-wujie-document-after-sequence', options.after);
  return new NextRequest(`http://localhost:5000/api/collaboration/document-exchange${options.query ?? ''}`, { method: 'POST', headers, body: body.slice().buffer });
}
function localDelta(state: Fixture, placementId: string, x: number): Uint8Array {
  const edit = clone(state.doc); const vector = Y.encodeStateVector(edit);
  try { applyCanvasImagePatch(edit, { placementId, x }, 'edit'); return Y.encodeStateAsUpdate(edit, vector); }
  finally { edit.destroy(); }
}
let state: Fixture;
const cleanup: Array<() => void> = [];
/** Same controlled SQL fixture, now checked out through the production scope resolver. */
function connectFixtureThroughExecutionScope(revokeAfterLostCommit = false): void {
  const original = boundary.getPool() as { connect(): Promise<Client> };
  const retained: PoolClient[] = [];
  const commit = boundary.commitDocumentUpdateInTransaction.getMockImplementation()!;
  boundary.commitDocumentUpdateInTransaction.mockImplementation(async (_view: PoolClient, input: { bytes: Uint8Array }) => {
    if (!state.projectHolder) throw new Error('controlled transaction owner missing');
    return commit(state.projectHolder, input);
  });
  const pool = { ending: false, _clients: retained, connect: async (): Promise<PoolClient> => {
    const client = await original.connect(), events = new EventEmitter();
    const driver = client as Client & { _ending: boolean; _ended: boolean; _queryable: boolean };
    driver._ending = false; driver._ended = false; driver._queryable = true;
    Object.assign(client, { on: events.on.bind(events), once: events.once.bind(events), removeListener: events.removeListener.bind(events) });
    const releasing = client.release.getMockImplementation()!;
    client.release.mockImplementation((discard?: boolean) => {
      releasing(discard);
      if (discard) {
        driver._ending = true; const index = retained.indexOf(client as unknown as PoolClient); if (index >= 0) retained.splice(index, 1);
        queueMicrotask(() => { driver._ended = true; events.emit('end'); });
      }
    });
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (...args: unknown[]) => {
      try { return await query(...args); }
      catch (error) { if (args[0] === 'COMMIT' && revokeAfterLostCommit) state.grants.set('actor-a', '8'); throw error; }
    });
    retained.push(client as unknown as PoolClient);
    cleanup.push(() => { driver._ended = true; events.emit('end'); });
    return client as unknown as PoolClient;
  } } as unknown as Pool;
  const key = Symbol.for('wujie.documentRequestPoolScope.v1');
  const resolve = (globalThis as typeof globalThis & { [key]?: (pool: Pool) => Pool })[key];
  expect(resolve).toBeTypeOf('function'); boundary.getPool.mockImplementation(() => resolve!(pool));
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('WUJIE_YJS_ENABLED', 'true'); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true');
  vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'http://localhost:5000'); state = fixture(); bind(state);
});
afterEach(() => { while (cleanup.length) cleanup.pop()?.(); state.clients.forEach(client => client.pendingDoc?.destroy()); state.doc.destroy(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('actual receipt service under an owned execution scope', () => {
  it('confirms only the original authorized receipt after an owned COMMIT reply is lost', async () => {
    connectFixtureThroughExecutionScope(); state.commitResponseLost = true;
    const bytes = localDelta(state, 'p-one', 71), operationId = 'operation_owned_recovery_1';
    const response = await POST(request(framed(2, bytes), { operationId }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, receipt: {
      operationId, sessionFingerprint: hash(tokenA), updateDigest: digest(bytes), documentSequence: 2,
    } });
    expect(state.writes).toBe(1); expect(state.clients).toHaveLength(2);
    expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('preserves uncertain-forbidden after the original grant changes before receipt recovery', async () => {
    connectFixtureThroughExecutionScope(true); state.commitResponseLost = true;
    const response = await POST(request(framed(2, localDelta(state, 'p-one', 72)), { operationId: 'operation_owned_recovery_2' }));
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN' });
    expect(state.writes).toBe(1); expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
});

describe('fixed session HTTP exchange through real route/services and controlled SQL', () => {
  it('pulls a real binary snapshot with the authenticated session fingerprint and private headers', async () => {
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(response.headers.get('x-wujie-document-session-fingerprint')).toBe(hash(tokenA));
    expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toBe('Cookie');
    const bytes = new Uint8Array(await response.arrayBuffer()); expect(bytes[0]).toBe(0x11);
    expect(Number(new DataView(bytes.buffer).getBigUint64(1))).toBe(1);
    const copy = createCanvasDocument();
    try { Y.applyUpdate(copy, bytes.subarray(9)); expect(readCanvasDocument(copy).placements['p-one'].x).toBe(10); }
    finally { copy.destroy(); }
  });
  it('returns a state-vector diff even at the current sequence and rejects an ahead cursor', async () => {
    const unchanged = await POST(request(framed(1, Y.encodeStateVector(state.doc)), { after: '1' }));
    expect(unchanged.status).toBe(200); expect(unchanged.headers.get('x-wujie-document-session-fingerprint')).toBe(hash(tokenA)); expect(state.loads).toBe(1);
    expect((await POST(request(pullFrame(), { after: '2' }))).status).toBe(409);
  });
  it('does not accept a sequence cursor as proof that an empty Yjs state has received the document', async () => {
    const response = await POST(request(pullFrame(), { after: '1' }));
    expect(response.status).toBe(200);
    const copy = createCanvasDocument();
    try {
      Y.applyUpdate(copy, new Uint8Array(await response.arrayBuffer()).subarray(9));
      expect(readCanvasDocument(copy).placements['p-one'].x).toBe(10);
    } finally { copy.destroy(); }
  });
  it('returns deletion information even if a stale client supplies the current sequence cursor', async () => {
    const copy = clone(state.doc), vector = Y.encodeStateVector(copy);
    try {
      applyCanvasImagePatch(state.doc, { placementId: 'p-one', deleted: true }, 'typed-media-fixture');
      state.sequence++;
      const response = await POST(request(framed(1, vector), { after: String(state.sequence) }));
      expect(response.status).toBe(200);
      Y.applyUpdate(copy, new Uint8Array(await response.arrayBuffer()).subarray(9));
      expect(readCanvasDocument(copy).placements['p-one'].deleted).toBe(true);
    } finally { copy.destroy(); }
  });
  it('returns the Yjs deletion set when state vectors are identical but an annotation deletion is missing', async () => {
    applyCanvasImagePatch(state.doc, { placementId: 'p-one', annotation: 'remove this note' }, 'annotation-fixture');
    const copy = clone(state.doc), vector = Y.encodeStateVector(copy);
    try {
      state.doc.getMap('annotations').delete('p-one'); state.sequence++;
      expect([...Y.encodeStateVector(state.doc)]).toEqual([...vector]);
      const response = await POST(request(framed(1, vector), { after: String(state.sequence) }));
      expect(response.status).toBe(200);
      Y.applyUpdate(copy, new Uint8Array(await response.arrayBuffer()).subarray(9));
      expect(readCanvasDocument(copy).placements['p-one'].annotation).toBeUndefined();
    } finally { copy.destroy(); }
  });
  it('returns an exact persisted operation receipt, not an uncorrelated nine-byte ACK', async () => {
    const update = localDelta(state, 'p-one', 50), operationId = 'operation_00000001';
    const response = await POST(request(framed(2, update), { operationId })); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, receipt: { operationId, sessionFingerprint: hash(tokenA), updateDigest: digest(update), documentSequence: 2 } });
    expect(state.writes).toBe(1); expect(readCanvasDocument(state.doc).placements['p-one'].x).toBe(50);
  });
  it('replays only the same operation/digest without another write and refuses ID reuse with different bytes', async () => {
    const update = localDelta(state, 'p-one', 50), options = { operationId: 'operation_00000001' };
    const first = await POST(request(framed(2, update), options)); expect(first.status).toBe(200);
    const replay = await POST(request(framed(2, update), options)); expect(await replay.json()).toEqual(await first.json()); expect(state.writes).toBe(1);
    const changed = localDelta(state, 'p-one', 80);
    expect((await POST(request(framed(2, changed), options))).status).toBe(409); expect(state.writes).toBe(1);
  });
  it('queries an original result within retention without reactivating an expired writer', async () => {
    const update = localDelta(state, 'p-one', 50), operationId = 'operation_00000001';
    expect((await POST(request(framed(2, update), { operationId }))).status).toBe(200);
    state.sessions.get(hash(tokenA))!.shortActive = false;
    expect((await POST(request(framed(2, update), { operationId }))).status).toBe(403);
    const recovered = await POST(request(framed(2, update), { operationId, mode: 'receipt' })); expect(recovered.status).toBe(200);
    expect((await recovered.json()).receipt.documentSequence).toBe(2); expect(state.writes).toBe(1);
    const missing = await POST(request(framed(2, update), { operationId: 'operation_missing_1', mode: 'receipt' }));
    expect(await missing.json()).toEqual({ success: true, receipt: null }); expect(state.writes).toBe(1);
  });
  it.each([{ token: tokenB }, { project: 'project-b' }, { cookie: `${cookieA}-new` }])('refuses cross-session/project/cookie %j', async options => {
    expect((await POST(request(pullFrame(), options))).status).toBe(403); expect(state.loads).toBe(0); expect(state.writes).toBe(0);
  });
  it('refuses revoked and regranted old sessions, including receipt lookup', async () => {
    const update = localDelta(state, 'p-one', 50); state.grants.set('actor-a', '8');
    const req = request(framed(2, update), { operationId: 'operation_00000001', mode: 'receipt' });
    req.headers.set('x-wujie-document-grant-generation', '8');
    expect([400, 403]).toContain((await POST(req)).status); expect(state.writes).toBe(0);
  });
  it('resolves a lost COMMIT reply only from the authorized persistent receipt', async () => {
    state.commitResponseLost = true; const update = localDelta(state, 'p-one', 50);
    const response = await POST(request(framed(2, update), { operationId: 'operation_00000001' }));
    expect(response.status).toBe(200); expect((await response.json()).receipt.documentSequence).toBe(2); expect(state.writes).toBe(1);
  });
  it('refuses unsafe Origin, query tokens, missing operation IDs, malformed and oversize frames before writes', async () => {
    expect((await POST(request(pullFrame(), { origin: 'https://attacker.example' }))).status).toBe(403);
    expect((await POST(request(pullFrame(), { query: '?ticket=secret' }))).status).toBe(400);
    expect((await POST(request(framed(2, localDelta(state, 'p-one', 50))))).status).toBe(400);
    expect((await POST(request(new Uint8Array([2, 255]), { operationId: 'operation_00000001' }))).status).toBe(400);
    expect((await POST(request(new Uint8Array(1_048_578)))).status).toBe(413); expect(state.writes).toBe(0);
  });
  it('keeps metadata updates from masquerading as a media delete command', async () => {
    const edit = clone(state.doc), vector = Y.encodeStateVector(edit);
    try {
      edit.getMap('tombstones').set('p-one', true);
      const response = await POST(request(framed(2, Y.encodeStateAsUpdate(edit, vector)), { operationId: 'operation_00000001' }));
      expect(response.status).toBe(422); expect(state.writes).toBe(0);
    } finally { edit.destroy(); }
  });
  it('stays disabled without authentication or explicit transport enablement', async () => {
    expect((await POST(request(pullFrame(), { cookie: 'unknown' }))).status).toBe(401);
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false'); expect((await POST(request())).status).toBe(503);
  });
  it('allows two bounded concurrent edits without treating normal project contention as a disconnection', async () => {
    const updateA = localDelta(state, 'p-one', 50), updateB = localDelta(state, 'p-two', 80);
    const results = await Promise.all([
      POST(request(framed(2, updateA), { operationId: 'operation_00000001' })),
      POST(request(framed(2, updateB), { actor: 'actor-b', operationId: 'operation_00000002' })),
    ]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(state.writes).toBe(2);
    expect(readCanvasDocument(state.doc).placements['p-one'].x).toBe(50);
    expect(readCanvasDocument(state.doc).placements['p-two'].x).toBe(80);
  });
  it('uses a shared project lock for canonical reads while retaining fixed session authorization', async () => {
    expect((await POST(request())).status).toBe(200);
    const projectQuery = state.clients[0].query.mock.calls.find((args: unknown[]): boolean =>
      typeof args[0] === 'string' && args[0].includes('FROM wujie_projects'));
    expect(projectQuery?.[0]).toMatch(/FOR SHARE/u);
    expect(boundary.assertDocumentEditor).toHaveBeenCalledWith('actor-a', 'project-a', expect.anything(), '7');
  });
  it('bounds same-actor body readers and returns every admission on a failed body', async () => {
    const held: Array<{ request: NextRequest; controller: ReadableStreamDefaultController<Uint8Array> }> = [];
    const pending: Array<Promise<Response>> = [];
    try {
      for (let i = 0; i < 2; i++) {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
        const original = request();
        const options = { method: 'POST', headers: original.headers, body, duplex: 'half' as const };
        const req = new NextRequest(original.url, options);
        held.push({ request: req, controller }); pending.push(POST(req));
      }
      await vi.waitFor(() => expect(held.every(item => item.request.body?.locked)).toBe(true));
      const extra = await POST(request()); expect(extra.status).toBe(429); expect(state.loads).toBe(0);
    } finally {
      held.forEach(item => item.controller.error(new Error('synthetic body failure'))); await Promise.all(pending);
    }
    expect((await POST(request())).status).toBe(200);
  });
  it('bounds all authenticated body readers across actors within this process', async () => {
    boundary.getSessionUser.mockImplementation(async (req: NextRequest) => ({ id: req.headers.get('x-wujie-expected-actor-id') }));
    const held: Array<{ request: NextRequest; controller: ReadableStreamDefaultController<Uint8Array> }> = [];
    const pending: Array<Promise<Response>> = [];
    try {
      for (let i = 0; i < 8; i++) {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
        const original = request(); original.headers.set('x-wujie-expected-actor-id', `actor-${i}`);
        const options = { method: 'POST', headers: original.headers, body, duplex: 'half' as const };
        const req = new NextRequest(original.url, options);
        held.push({ request: req, controller }); pending.push(POST(req));
      }
      await vi.waitFor(() => expect(held.every(item => item.request.body?.locked)).toBe(true));
      const extra = request(); extra.headers.set('x-wujie-expected-actor-id', 'ninth-actor');
      expect((await POST(extra)).status).toBe(429); expect(state.loads).toBe(0);
    } finally {
      held.forEach(item => item.controller.error(new Error('synthetic body failure'))); await Promise.all(pending);
    }
    bind(state); expect((await POST(request())).status).toBe(200);
  });
});

async function browser(actor: 'actor-a' | 'actor-b', durable?: { pending: string; journal: string }) {
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const { createCanvasDocumentSession } = await import('@/lib/collaboration/document-client');
  const { createDocumentHttpTransport } = await import('@/lib/collaboration/document-http-transport');
  let frames: Array<{ id: string; frame: number[]; intent?: Record<string, unknown> }> = durable ? JSON.parse(durable.pending) : [];
  const journal: Record<string, import('@/lib/collaboration/document-http-transport').DocumentHttpOperationRecord> = durable ? JSON.parse(durable.journal) : {};
  const store = { load: () => frames.map(item => ({ id: item.id, frame: new Uint8Array(item.frame), intent: item.intent })),
    append: (frame: Uint8Array, intent?: Record<string, unknown>) => { const id = crypto.randomUUID(); frames.push({ id, frame: [...frame], intent }); return id; },
    remove: (id: string) => { frames = frames.filter(item => item.id !== id); } };
  const operationJournal = { get: (id: string) => journal[id], put: (id: string, value: typeof journal[string]) => { journal[id] = { ...value }; }, remove: (id: string) => { delete journal[id]; } };
  const operations: string[] = []; let loseResponse = false;
  const fetcher = async (_url: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers); headers.set('Cookie', `wujie_session=${actor === 'actor-a' ? cookieA : cookieB}`); headers.set('Origin', 'http://localhost:5000');
    const body = new Uint8Array(init.body as ArrayBuffer);
    const actual = new NextRequest('http://localhost:5000/api/collaboration/document-exchange', {
      ...init, signal: init.signal ?? undefined, method: 'POST', headers, body: body.slice().buffer,
    });
    const result = await POST(actual);
    if (body[0] === 2) { operations.push(headers.get('x-wujie-document-operation-id')!); if (loseResponse) { loseResponse = false; throw new Error('synthetic response lost after commit'); } }
    return result;
  };
  const transport = createDocumentHttpTransport({ sessionDescriptor: descriptor(actor), pendingStore: store, operationJournal, fetch: fetcher, pollIntervalMs: 60_000 });
  const session = createCanvasDocumentSession(transport.socket, undefined, store); cleanup.push(() => { session.disconnect(); transport.close(); });
  await transport.start();
  return { session, transport, store, operations, loseNextResponse: () => { loseResponse = true; },
    saved: () => ({ pending: JSON.stringify(frames), journal: JSON.stringify(journal) }) };
}
function receiptRequest(updateDigest: string, options: Parameters<typeof request>[1] = {}, extra: Record<string, unknown> = {}): NextRequest {
  const original = request(undefined, options); original.headers.set('Content-Type', 'application/json');
  return new NextRequest('http://localhost:5000/api/collaboration/document-exchange-receipt' + (options.query ?? ''), {
    method: 'POST', headers: original.headers, body: JSON.stringify({
      projectId: options.project ?? 'project-a', sessionToken: options.token ?? descriptor(options.actor ?? 'actor-a').sessionToken,
      operationId: options.operationId ?? 'operation_00000001', updateDigest, ...extra,
    }),
  });
}
describe('retained exact receipt recovery without original bytes', () => {
  it.each(['timeout', 'abort'] as const)('cleans a stalled receipt body and returns admission after %s', async mode => {
    vi.useFakeTimers(); const owner = new AbortController(), cancel = vi.fn();
    const base = receiptRequest('d'.repeat(64));
    const body = new ReadableStream<Uint8Array>({ start(controller): void { controller.enqueue(new TextEncoder().encode('{')); }, cancel });
    const options = { method: 'POST', headers: base.headers, body, duplex: 'half' as const, signal: owner.signal };
    const pending = lookupReceipt(new NextRequest(base.url, options));
    await vi.advanceTimersByTimeAsync(0);
    if (mode === 'abort') owner.abort(); else await vi.advanceTimersByTimeAsync(5_001);
    expect((await pending).status).toBe(mode === 'abort' ? 400 : 408);
    expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); expect(state.clients).toHaveLength(0);
    expect((await lookupReceipt(receiptRequest('d'.repeat(64)))).status).toBe(200);
  });
  it('preserves the smaller receipt JSON ceiling before any database lookup', async () => {
    const response = await lookupReceipt(receiptRequest('d'.repeat(64), {}, { excess: 'x'.repeat(65_537) }));
    expect(response.status).toBe(413); expect(state.clients).toHaveLength(0);
    expect((await lookupReceipt(receiptRequest('d'.repeat(64)))).status).toBe(200);
  });
  it('finds the original committed receipt after local frame cleanup without another document write', async () => {
    const bytes = localDelta(state, 'p-one', 56), updateDigest = digest(bytes);
    const write = await POST(request(framed(2, bytes), { operationId: 'operation_00000001' }));
    expect(write.status).toBe(200); const expected = await write.json(), loads = state.loads, clients = state.clients.length;
    const response = await lookupReceipt(receiptRequest(updateDigest));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(expected);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(state.writes).toBe(1); expect(state.loads).toBe(loads);
    const sql = state.clients.slice(clients).flatMap(client => client.query.mock.calls.map(args => String(args[0])));
    expect(sql.some(command => /^(?:INSERT|UPDATE|DELETE)/u.test(command))).toBe(false);
    expect(sql.some(command => command.includes('retain_until > clock_timestamp()'))).toBe(true);
  });
  it('returns null for an unknown operation rather than inferring success from the current document tip', async () => {
    const response = await lookupReceipt(receiptRequest('d'.repeat(64)));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, receipt: null });
    expect(state.writes).toBe(0); expect(state.loads).toBe(0); expect(state.sequence).toBe(1);
  });
  it('reads the exact old result within retention after the short writer session expires', async () => {
    const bytes = localDelta(state, 'p-one', 56);
    expect((await POST(request(framed(2, bytes), { operationId: 'operation_00000001' }))).status).toBe(200);
    state.sessions.get(hash(tokenA))!.shortActive = false;
    const response = await lookupReceipt(receiptRequest(digest(bytes)));
    expect(response.status).toBe(200); expect((await response.json()).receipt.documentSequence).toBe(2);
    expect(state.writes).toBe(1);
    state.sessions.get(hash(tokenA))!.retained = false;
    expect((await lookupReceipt(receiptRequest(digest(bytes)))).status).toBe(403);
  });
  it.each([{ token: tokenB }, { cookie: cookieB }, { cookie: `${cookieA}-new` }, { project: 'project-b' }])(
    'does not expose an original receipt under a foreign session/cookie/project %j', async options => {
      const bytes = localDelta(state, 'p-one', 56);
      await POST(request(framed(2, bytes), { operationId: 'operation_00000001' }));
      const response = await lookupReceipt(receiptRequest(digest(bytes), options));
      expect([403, 409]).toContain(response.status);
      expect((await response.json()).receipt).toBeUndefined(); expect(state.writes).toBe(1);
    });
  it('refuses a regranted old session and a receipt digest mismatch', async () => {
    const bytes = localDelta(state, 'p-one', 56);
    await POST(request(framed(2, bytes), { operationId: 'operation_00000001' }));
    expect((await lookupReceipt(receiptRequest('d'.repeat(64)))).status).toBe(409);
    state.grants.set('actor-a', '8');
    const response = await lookupReceipt(receiptRequest(digest(bytes)));
    expect(response.status).toBe(403); expect((await response.json()).receipt).toBeUndefined();
    expect(state.writes).toBe(1);
  });
  it('rejects unsafe Origin, query credentials, forged body identity and missing proof fields', async () => {
    expect((await lookupReceipt(receiptRequest('d'.repeat(64), { origin: 'https://attacker.example' }))).status).toBe(403);
    expect((await lookupReceipt(receiptRequest('d'.repeat(64), { query: '?sessionToken=secret' }))).status).toBe(400);
    expect((await lookupReceipt(receiptRequest('d'.repeat(64), {}, { actorId: 'actor-a', grantGeneration: '8' }))).status).toBe(400);
    expect((await lookupReceipt(receiptRequest('', {}, { bytes: [1, 2] }))).status).toBe(400);
    expect(state.clients).toHaveLength(0);
  });
  it('stays behind feature and actual authentication gates', async () => {
    expect((await lookupReceipt(receiptRequest('d'.repeat(64), { cookie: 'unknown' }))).status).toBe(401);
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false');
    expect((await lookupReceipt(receiptRequest('d'.repeat(64)))).status).toBe(503);
    expect(state.clients).toHaveLength(0);
  });
});

describe('real document-client through actual HTTP route with controlled auth/storage', () => {
  it('preserves the original rejected quarantine for a definite canonical update refusal', async () => {
    const a = await browser('actor-a');
    const { DocumentUpdateRejectedError } = await import('@/lib/collaboration/document-store');
    boundary.commitDocumentUpdateInTransaction.mockRejectedValueOnce(new DocumentUpdateRejectedError('controlled canonical refusal'));
    a.session.applyLocalChange({ placementId: 'p-one', x: 50 });
    await vi.waitFor(() => expect(a.session.status).toBe('rejected'));
    expect(a.store.load()).toHaveLength(1);
    expect(a.session.exportRecoveryCopy().pendingFrames[0].rejected).toBe(true);
    expect(JSON.parse(a.saved().journal)).not.toEqual({}); expect(state.writes).toBe(0);
  });
  it('confirms an actual local edit only after the exact backend operation receipt', async () => {
    const a = await browser('actor-a'); expect(a.session.images['p-one'].x).toBe(10);
    a.session.applyLocalChange({ placementId: 'p-one', x: 50 });
    await vi.waitFor(() => expect(a.session.status).toBe('saved'));
    expect(state.writes).toBe(1); expect(a.store.load()).toHaveLength(0); expect(readCanvasDocument(state.doc).placements['p-one'].x).toBe(50);
  });
  it('converges two users changing different placements concurrently without disconnecting', async () => {
    const a = await browser('actor-a'), b = await browser('actor-b');
    a.session.applyLocalChange({ placementId: 'p-one', x: 50 }); b.session.applyLocalChange({ placementId: 'p-two', x: 80 });
    await vi.waitFor(() => { expect(a.session.status).toBe('saved'); expect(b.session.status).toBe('saved'); });
    await Promise.all([a.transport.pull(), b.transport.pull()]);
    expect(a.session.images['p-one'].x).toBe(50); expect(a.session.images['p-two'].x).toBe(80);
    expect(b.session.images['p-one'].x).toBe(50); expect(b.session.images['p-two'].x).toBe(80); expect(state.writes).toBe(2);
  });
  it('retains a lost-response operation across a recreated page and explicitly retries the same identity without another write', async () => {
    const a = await browser('actor-a'); a.loseNextResponse(); a.session.applyLocalChange({ placementId: 'p-one', x: 55 });
    await vi.waitFor(() => expect(a.session.status).toBe('unavailable'));
    const saved = a.saved(); expect(a.store.load()).toHaveLength(1); expect(state.writes).toBe(1); const original = a.operations[0];
    a.session.disconnect(); a.transport.close();
    const reopened = await browser('actor-a', saved); expect(reopened.session.status).toBe('recovery');
    reopened.session.retryRecovered(); await vi.waitFor(() => expect(reopened.session.status).toBe('saved'));
    expect(reopened.operations).toEqual([original]); expect(reopened.store.load()).toHaveLength(0); expect(state.writes).toBe(1);
  });
});

function controlledStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length(): number { return values.size; },
    key: (index: number): string | null => [...values.keys()][index] ?? null,
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => { values.set(String(key), String(value)); },
    removeItem: (key: string): void => { values.delete(key); },
    clear: (): void => { values.clear(); },
  };
}

describe('original pending store and browser journal through actual retained receipt route', () => {
  async function recoveryFixture(commit: boolean) {
    const backing = controlledStorage();
    vi.stubGlobal('window', { localStorage: backing }); vi.stubGlobal('localStorage', backing);
    vi.stubGlobal('sessionStorage', controlledStorage());
    const { createBrowserPendingUpdateStore } = await import('@/lib/collaboration/document-client');
    const { createDocumentHttpBrowserStorage } = await import('@/lib/collaboration/document-http-browser-storage');
    const { reconcileDocumentHttpOrphan } = await import('@/lib/collaboration/document-http-receipt-recovery');
    let owned = true;
    const assertLease = (): void => { if (!owned) throw Error('controlled owner lost'); };
    const makeStore = () => createDocumentHttpBrowserStorage({
      actorId: 'actor-a', projectId: 'project-a', pendingStore: createBrowserPendingUpdateStore('project-a', 'actor-a'), assertLease, storage: backing,
    });
    const current = makeStore(), bound = descriptor('actor-a');
    await current.saveDescriptor(bound);
    const update = localDelta(state, 'p-one', 56), operationId = crypto.randomUUID();
    const pendingId = current.guardedPendingStore.append(framed(2, update));
    const expectedRecord = { operationId, sessionFingerprint: bound.sessionFingerprint, updateDigest: digest(update),
      actorId: bound.actorId, projectId: bound.projectId, ownerId: bound.ownerId, grantGeneration: bound.grantGeneration };
    current.journalFor(bound).put(pendingId, expectedRecord);
    if (commit) expect((await POST(request(framed(2, update), { operationId }))).status).toBe(200);
    // Models only this exact cleanup/crash point. Server acceptance is established above when commit=true.
    current.guardedPendingStore.remove(pendingId);
    const restarted = makeStore(), restored = await restarted.readDescriptor();
    expect(restored).toEqual(bound); const journal = restarted.journalFor(restored!);
    expect((await restarted.inspect()).reasons).toContain('orphan-journal');
    const controller = new AbortController(); let calls = 0; let afterResponse: (() => void) | undefined;
    const fetcher = async (_url: string, init: RequestInit): Promise<Response> => {
      calls++; const headers = new Headers(init.headers);
      headers.set('Origin', 'http://localhost:5000'); headers.set('Cookie', `wujie_session=${cookieA}`);
      const result = await lookupReceipt(new NextRequest('http://localhost:5000/api/collaboration/document-exchange-receipt', {
        ...init, signal: init.signal ?? undefined, headers,
      }));
      afterResponse?.(); return result;
    };
    return { backing, restarted, journal, expectedRecord, pendingId, calls: () => calls,
      setAfterResponse: (callback: () => void): void => { afterResponse = callback; },
      lose: (): void => { owned = false; controller.abort(); }, regain: (): void => { owned = true; },
      reconcile: () => reconcileDocumentHttpOrphan({ sessionDescriptor: bound, pendingId, expectedRecord,
        journal, assertLease, signal: controller.signal, fetch: fetcher }) };
  }
  it('clears only an exact server-confirmed orphan without recreating or replaying a document update', async () => {
    const f = await recoveryFixture(true);
    expect(await f.reconcile()).toEqual({ state: 'confirmed', documentSequence: 2 });
    expect(f.journal.get(f.pendingId)).toBeUndefined(); expect(f.calls()).toBe(1);
    expect((await f.restarted.inspect()).state).toBe('ready'); expect(state.writes).toBe(1);
  });
  it('keeps an unknown orphan when no exact server receipt is found', async () => {
    const f = await recoveryFixture(false);
    expect(await f.reconcile()).toEqual({ state: 'unresolved' });
    expect(f.journal.get(f.pendingId)).toEqual(f.expectedRecord); expect(state.writes).toBe(0);
    expect((await f.restarted.inspect()).reasons).toContain('orphan-journal');
  });
  it('does not clear or upgrade an old journal after real route authorization rejects a regranted session', async () => {
    const f = await recoveryFixture(true); state.grants.set('actor-a', '8');
    await expect(f.reconcile()).rejects.toThrow(); expect(f.journal.get(f.pendingId)).toEqual(f.expectedRecord);
    expect((await f.restarted.readDescriptor())?.grantGeneration).toBe('7'); expect(state.writes).toBe(1);
  });
  it('does not delete a journal replaced while its read-only response is in flight', async () => {
    const f = await recoveryFixture(true), replacement = { ...f.expectedRecord, operationId: crypto.randomUUID() };
    f.setAfterResponse(() => {
      const key = Array.from({ length: f.backing.length }, (_unused, index) => f.backing.key(index))
        .find(value => value?.startsWith('wujie-canvas-document-http-journal-v1:'));
      expect(key).toBeTruthy(); f.backing.setItem(key!, JSON.stringify(replacement));
    });
    await expect(f.reconcile()).rejects.toThrow(); expect(f.journal.get(f.pendingId)).toEqual(replacement);
    expect(state.writes).toBe(1);
  });
  it('preserves records when the owning browser lease is lost during the actual receipt query', async () => {
    const f = await recoveryFixture(true); f.setAfterResponse(f.lose);
    await expect(f.reconcile()).rejects.toThrow(); f.regain();
    expect(f.journal.get(f.pendingId)).toEqual(f.expectedRecord); expect(state.writes).toBe(1);
  });
});
