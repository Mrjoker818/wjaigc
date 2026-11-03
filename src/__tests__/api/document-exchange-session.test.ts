import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPool: vi.fn(), consumeDocumentTicket: vi.fn(), assertDocumentEditor: vi.fn(),
  assertDocumentProjectEnabled: vi.fn(), getSessionUser: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({ getPool: mocks.getPool }));
vi.mock('@/lib/collaboration/document-tickets', () => ({ consumeDocumentTicket: mocks.consumeDocumentTicket }));
vi.mock('@/lib/collaboration/document-access', () => ({ assertDocumentEditor: mocks.assertDocumentEditor,
  assertDocumentProjectEnabled: mocks.assertDocumentProjectEnabled }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser, WUJIE_SESSION_COOKIE: 'wujie_session' }));
import { startDocumentExchangeSession, renewDocumentExchangeSession } from '@/lib/collaboration/document-exchange-sessions';
import { POST } from '@/app/api/collaboration/document-exchange-session/route';

const rawCookie = 'verified-local-synthetic-cookie';
const authHash = createHash('sha256').update(rawCookie).digest('hex');
const token = 's'.repeat(43), ticket = 't'.repeat(43);
const tokenHash = createHash('sha256').update(token).digest('hex');
const now = Date.parse('2026-11-01T07:00:00.000Z');
interface Row {
  session_hash: string; actor_id: string; auth_session_hash: string; project_id: string;
  owner_id: string; grant_generation: string; expires_at: string; retain_until: string; revoked_at: string | null;
}
function row(changes: Partial<Row> = {}): Row {
  return { session_hash: tokenHash, actor_id: 'editor-a', auth_session_hash: authHash, project_id: 'project-a',
    owner_id: 'owner-a', grant_generation: '7', expires_at: new Date(now + 600_000).toISOString(),
    retain_until: new Date(now + 604_800_000).toISOString(), revoked_at: null, ...changes };
}
function startInput() { return { actorId: 'editor-a', authSessionHash: authHash, projectId: 'project-a', ticket }; }
function renewInput() { return { actorId: 'editor-a', authSessionHash: authHash, projectId: 'project-a', sessionToken: token }; }
interface State { sessions: Map<string, Row> }
interface Options {
  commitFailure?: 'before' | 'after'; commitGate?: Promise<void>; actorCount?: number; projectCount?: number;
  expiredAtAdmission?: boolean; receiptCount?: number;
  expiryBeforeRenewal?: boolean;
  projectContention?: boolean;
}
/** A controlled query/commit double: never evidence of real PostgreSQL semantics. */
function client(state: State, options: Options = {}) {
  const commands: string[] = [], pending = new Map<string, Row>();
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    commands.push(sql);
    if (options.projectContention && sql.includes('FROM wujie_projects') && sql.includes('NOWAIT')) throw { code: '55P03' };
    if (sql === 'COMMIT') {
      if (options.commitGate) await options.commitGate;
      if (options.commitFailure === 'before') throw new Error('commit response missing before storage');
      for (const [key, value] of pending) state.sessions.set(key, value);
      if (options.commitFailure === 'after') throw new Error('commit response missing after storage');
    }
    if (sql === 'ROLLBACK') pending.clear();
    if (sql.includes('COUNT(*)') && sql.includes('wujie_document_exchange_sessions')) {
      return { rows: [{ actor_count: options.actorCount ?? 0, project_count: options.projectCount ?? 0 }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO wujie_document_exchange_sessions')) {
      const value = row({ session_hash: String(args[0]), actor_id: String(args[1]), auth_session_hash: String(args[2]),
        project_id: String(args[3]), owner_id: String(args[4]), grant_generation: String(args[5]) });
      pending.set(value.session_hash, value);
      return { rows: [value], rowCount: 1 };
    }
    if (sql.includes('UPDATE wujie_document_exchange_sessions')) {
      if (options.expiryBeforeRenewal) return { rows: [], rowCount: 0 };
      const original = state.sessions.get(String(args[0]));
      if (!original) return { rows: [], rowCount: 0 };
      const value = { ...original, expires_at: new Date(Math.min(now + 600_000, Date.parse(original.retain_until))).toISOString() };
      pending.set(value.session_hash, value); return { rows: [value], rowCount: 1 };
    }
    if (sql.includes('FROM wujie_document_exchange_sessions')) {
      const value = state.sessions.get(String(args[0]));
      if (!value) return { rows: [], rowCount: 0 };
      const retained = sql.includes('retain_until > clock_timestamp()');
      const active = value.revoked_at === null && Date.parse(retained ? value.retain_until : value.expires_at) > now && !options.expiredAtAdmission;
      return { rows: [{ ...value, active }], rowCount: 1 };
    }
    if (sql.includes('FROM wujie_project_canvas_documents')) return { rows: [{ owner_id: 'owner-a' }], rowCount: 1 };
    return { rows: [{}], rowCount: 1 };
  });
  return { query, commands, release: vi.fn() };
}
function connect(...clients: ReturnType<typeof client>[]) {
  const acquire = vi.fn(); clients.forEach(value => acquire.mockResolvedValueOnce(value));
  mocks.getPool.mockReturnValue({ connect: acquire }); return acquire;
}
function request(body: unknown, options: { actor?: string; origin?: string; cookie?: string; query?: string } = {}): NextRequest {
  return new NextRequest(`http://localhost:5000/api/collaboration/document-exchange-session${options.query ?? ''}`, {
    method: 'POST', headers: { Origin: options.origin ?? 'http://localhost:5000', 'Content-Type': 'application/json',
      Cookie: `wujie_session=${options.cookie ?? rawCookie}`, 'x-wujie-expected-actor-id': options.actor ?? 'editor-a',
      'x-wujie-auth-session-hash': 'forged-client-value' }, body: JSON.stringify(body),
  });
}

describe('trusted exchange session: real service and NextRequest, controlled authentication/SQL', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true'); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true');
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'http://localhost:5000');
    mocks.getSessionUser.mockResolvedValue({ id: 'editor-a' });
    mocks.consumeDocumentTicket.mockResolvedValue({ userId: 'editor-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '7' });
    mocks.assertDocumentEditor.mockResolvedValue({ ownerId: 'owner-a' }); mocks.assertDocumentProjectEnabled.mockResolvedValue(undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  it('creates a random token, stores only its hash, freezes the consumed grant, and waits for COMMIT', async () => {
    const state: State = { sessions: new Map() }, db = client(state); connect(db);
    const result = await startDocumentExchangeSession(startInput());
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(result.sessionFingerprint).toBe(createHash('sha256').update(result.sessionToken).digest('hex'));
    expect(result).toMatchObject({ actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a', grantGeneration: '7' });
    expect(state.sessions.get(result.sessionFingerprint)).toMatchObject({ auth_session_hash: authHash, grant_generation: '7' });
    expect(JSON.stringify([...state.sessions.values()])).not.toContain(result.sessionToken);
    expect(db.commands.indexOf('COMMIT')).toBeGreaterThan(db.commands.findIndex(sql => sql.includes('INSERT INTO')));
    expect(mocks.consumeDocumentTicket).toHaveBeenCalledExactlyOnceWith(ticket);
    expect(mocks.assertDocumentEditor).toHaveBeenCalledWith('editor-a', 'project-a', db, '7');
  });
  it.each([null, { userId: 'editor-b', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '7' },
    { userId: 'editor-a', projectId: 'project-b', ownerId: 'owner-a', grantGeneration: '7' }])
    ('never starts from an invalid or foreign ticket %j', async identity => {
      mocks.consumeDocumentTicket.mockResolvedValue(identity);
      await expect(startDocumentExchangeSession(startInput())).rejects.toHaveProperty('code');
      expect(mocks.getPool).not.toHaveBeenCalled();
    });
  it('rechecks the original ticket generation before creating a transport session', async () => {
    const state: State = { sessions: new Map() }, db = client(state); connect(db);
    mocks.assertDocumentEditor.mockRejectedValueOnce({ code: 'DOCUMENT_FORBIDDEN' });
    await expect(startDocumentExchangeSession(startInput())).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_FORBIDDEN' });
    expect(state.sessions.size).toBe(0); expect(db.commands).not.toContain('COMMIT');
  });
  it('uses the existing bounded lock wait after consuming a ticket instead of failing every ordinary contention', async () => {
    const state: State = { sessions: new Map() }, db = client(state, { projectContention: true }); connect(db);
    const session = await startDocumentExchangeSession(startInput());
    expect(state.sessions.has(session.sessionFingerprint)).toBe(true);
    expect(db.commands).toContain("SET LOCAL lock_timeout = '1000ms'");
    expect(db.commands.find(sql => sql.includes('FROM wujie_projects'))).not.toContain('NOWAIT');
    expect(mocks.consumeDocumentTicket).toHaveBeenCalledExactlyOnceWith(ticket);
  });
  it.each([{ actorCount: 4 }, { projectCount: 20 }])('enforces the project-serialized active session cap %j', async options => {
    const state: State = { sessions: new Map() }, db = client(state, options); connect(db);
    await expect(startDocumentExchangeSession(startInput())).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_SESSION_LIMIT' });
    expect(state.sessions.size).toBe(0);
  });
  it('does not publish a token while its COMMIT is still pending', async () => {
    const state: State = { sessions: new Map() };
    let finish: () => void = () => {}; const commitGate = new Promise<void>(resolve => { finish = resolve; });
    const db = client(state, { commitGate }); connect(db);
    let done = false; const pending = startDocumentExchangeSession(startInput()).then(result => { done = true; return result; });
    try {
      await vi.waitFor(() => expect(db.commands).toContain('COMMIT')); expect(done).toBe(false);
      finish(); expect((await pending).sessionToken).toHaveLength(43);
    } finally { finish(); await pending.catch(() => undefined); }
  });
  it('recovers the same token after a confirmed persistent session whose COMMIT response was lost', async () => {
    const state: State = { sessions: new Map() }, first = client(state, { commitFailure: 'after' }), recovery = client(state); connect(first, recovery);
    const result = await startDocumentExchangeSession(startInput());
    expect(state.sessions.has(result.sessionFingerprint)).toBe(true);
    expect(first.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.consumeDocumentTicket).toHaveBeenCalledTimes(1); expect(state.sessions.size).toBe(1);
    expect(recovery.commands.some(sql => sql.includes('INSERT INTO'))).toBe(false);
  });
  it('does not create another session or return an invented token after an unresolved COMMIT', async () => {
    const state: State = { sessions: new Map() }; connect(client(state, { commitFailure: 'before' }), client(state));
    await expect(startDocumentExchangeSession(startInput())).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_UNCERTAIN' });
    expect(state.sessions.size).toBe(0); expect(mocks.consumeDocumentTicket).toHaveBeenCalledTimes(1);
  });
  it('renews an expired short session within retention using the original token and grant, without consuming a new ticket', async () => {
    const stored = row({ expires_at: new Date(now - 1_000).toISOString() });
    const state: State = { sessions: new Map([[tokenHash, stored]]) }, db = client(state); connect(db);
    const result = await renewDocumentExchangeSession(renewInput());
    expect(result.sessionToken).toBe(token); expect(result.grantGeneration).toBe('7');
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(now);
    expect(mocks.consumeDocumentTicket).not.toHaveBeenCalled();
    expect(state.sessions.get(tokenHash)?.grant_generation).toBe('7');
    expect(mocks.assertDocumentEditor).toHaveBeenCalledWith('editor-a', 'project-a', db, '7');
  });
  it.each([{ auth_session_hash: 'd'.repeat(64) }, { actor_id: 'editor-b' }, { project_id: 'project-b' },
    { revoked_at: '2026-11-01T06:59:00Z' }, { retain_until: new Date(now - 1).toISOString() }])
    ('never renews outside the fixed session/cookie/retention binding %j', async changes => {
      const state: State = { sessions: new Map([[tokenHash, row(changes)]]) }, db = client(state); connect(db);
      await expect(renewDocumentExchangeSession(renewInput())).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_FORBIDDEN' });
      expect(db.commands.some(sql => sql.includes('UPDATE wujie_document_exchange_sessions'))).toBe(false);
    });
  it('cannot wash an old transport grant through a new authorization or a new ticket', async () => {
    const state: State = { sessions: new Map([[tokenHash, row()]]) }, db = client(state); connect(db);
    mocks.assertDocumentEditor.mockImplementation(async (_actor, _project, _client, generation) => {
      if (generation !== '8') throw { code: 'DOCUMENT_FORBIDDEN' }; return { ownerId: 'owner-a' };
    });
    await expect(renewDocumentExchangeSession(renewInput())).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_FORBIDDEN' });
    expect(state.sessions.get(tokenHash)?.grant_generation).toBe('7'); expect(mocks.consumeDocumentTicket).not.toHaveBeenCalled();
  });
  it.each([{ actorCount: 4 }, { projectCount: 20 }])('does not resurrect an expired session past the active cap %j', async options => {
    const state: State = { sessions: new Map([[tokenHash, row({ expires_at: new Date(now - 1).toISOString() })]]) };
    const db = client(state, options); connect(db);
    await expect(renewDocumentExchangeSession(renewInput())).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_SESSION_LIMIT' });
    expect(db.commands.some(sql => sql.includes('UPDATE wujie_document_exchange_sessions'))).toBe(false);
  });
  it('does not mistake an old still-valid row for a successful renewal whose COMMIT outcome is unknown', async () => {
    const oldExpiry = new Date(now + 100_000).toISOString();
    const state: State = { sessions: new Map([[tokenHash, row({ expires_at: oldExpiry })]]) };
    connect(client(state, { commitFailure: 'before' }), client(state));
    await expect(renewDocumentExchangeSession(renewInput())).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_UNCERTAIN' });
    expect(state.sessions.get(tokenHash)?.expires_at).toBe(oldExpiry);
  });
  it('caps a renewal at the original retention boundary and preserves every identity field', async () => {
    const stored = row({ expires_at: new Date(now - 1).toISOString(), retain_until: new Date(now + 1_000).toISOString() });
    const state: State = { sessions: new Map([[tokenHash, stored]]) }; connect(client(state));
    const result = await renewDocumentExchangeSession(renewInput());
    expect(result.expiresAt).toBe(stored.retain_until); expect(result.retainUntil).toBe(stored.retain_until);
    expect(state.sessions.get(tokenHash)).toEqual({ ...stored, expires_at: stored.retain_until });
  });
  it('renews its existing active slot without allocating an extra identity at the limit', async () => {
    const state: State = { sessions: new Map([[tokenHash, row()]]) }, db = client(state, { actorCount: 3, projectCount: 19 }); connect(db);
    const result = await renewDocumentExchangeSession(renewInput());
    expect(result.sessionToken).toBe(token); expect(state.sessions.size).toBe(1);
    const count = db.query.mock.calls.find(([sql]) => sql.includes('COUNT(*)'));
    expect(count?.[1]).toEqual(['project-a', 'editor-a', tokenHash]);
  });
  it('reports a retention deadline crossed after admission as expired rather than a temporary storage failure', async () => {
    const original = row(); const state: State = { sessions: new Map([[tokenHash, original]]) };
    const db = client(state, { expiryBeforeRenewal: true }); connect(db);
    await expect(renewDocumentExchangeSession(renewInput())).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_EXPIRED' });
    expect(state.sessions.get(tokenHash)).toEqual(original); expect(db.commands).not.toContain('COMMIT');
  });
  it('injects the verified cookie hash and actor through the actual HTTP route, ignoring a forged header', async () => {
    const state: State = { sessions: new Map() }; connect(client(state));
    const response = await POST(request({ action: 'start', projectId: 'project-a', ticket }));
    expect(response.status).toBe(200);
    const value = await response.json(); expect(value.success).toBe(true);
    expect(state.sessions.get(value.session.sessionFingerprint)?.auth_session_hash).toBe(authHash);
    expect(value.session.actorId).toBe('editor-a'); expect(JSON.stringify(value)).not.toContain(authHash);
    expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toBe('Cookie');
  });
  it('rejects cross-origin, actor switches, query secrets and body identity forgery before consuming a ticket', async () => {
    const body = { action: 'start', projectId: 'project-a', ticket };
    expect((await POST(request(body, { origin: 'https://attacker.example' }))).status).toBe(403);
    expect((await POST(request(body, { actor: 'editor-b' }))).status).toBe(409);
    expect((await POST(request(body, { query: '?token=secret' }))).status).toBe(400);
    expect((await POST(request({ ...body, grantGeneration: '8', actorId: 'editor-a' }))).status).toBe(400);
    expect(mocks.consumeDocumentTicket).not.toHaveBeenCalled();
  });
  it('stays disabled by default without consuming a ticket', async () => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false');
    expect((await POST(request({ action: 'start', projectId: 'project-a', ticket }))).status).toBe(503);
    expect(mocks.consumeDocumentTicket).not.toHaveBeenCalled();
  });
  it('denies anonymous requests in a fresh HTTP fixture without consuming a ticket', async () => {
    // Enabling HTTP in an already-started WS fixture is a draining transition.
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await POST(request({ action: 'start', projectId: 'project-a', ticket }))).status).toBe(401);
    expect(mocks.consumeDocumentTicket).not.toHaveBeenCalled();
  });
  it('hides ticket/database errors and fails closed before publishing any session', async () => {
    mocks.consumeDocumentTicket.mockRejectedValue(new Error('postgres://secret@private-host'));
    const response = await POST(request({ action: 'start', projectId: 'project-a', ticket }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-host');
  });
  it.each([false, true])('bounds a stalled JSON body, including a complete prefix: %s', async withPrefix => {
    vi.useFakeTimers();
    const base = request({ action: 'start', projectId: 'project-a', ticket }); const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller): void { if (withPrefix) controller.enqueue(new TextEncoder().encode(JSON.stringify({ action: 'start', projectId: 'project-a', ticket }))); }, cancel,
    });
    const options = { method: 'POST', headers: base.headers, body, duplex: 'half' as const };
    const pending = POST(new NextRequest(base.url, options));
    await vi.advanceTimersByTimeAsync(5_001);
    const response = await pending;
    expect(response.status).toBe(408); expect(cancel).toHaveBeenCalledTimes(1);
    expect(mocks.consumeDocumentTicket).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('stops body reading on caller abort without consuming a ticket or leaving a deadline timer', async () => {
    vi.useFakeTimers(); const abort = new AbortController(), base = request({ action: 'start', projectId: 'project-a', ticket });
    const body = new ReadableStream<Uint8Array>();
    const options = { method: 'POST', headers: base.headers, body, duplex: 'half' as const, signal: abort.signal };
    const pending = POST(new NextRequest(base.url, options)); abort.abort();
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.status).toBe(400); expect(mocks.consumeDocumentTicket).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels an already active stalled body reader and clears its owned timer', async () => {
    vi.useFakeTimers(); const abort = new AbortController(), cancel = vi.fn(), base = request({ action: 'start', projectId: 'project-a', ticket });
    const body = new ReadableStream<Uint8Array>({ start(controller): void { controller.enqueue(new TextEncoder().encode('{')); }, cancel });
    const options = { method: 'POST', headers: base.headers, body, duplex: 'half' as const, signal: abort.signal };
    const pending = POST(new NextRequest(base.url, options));
    // The route now owns its total execution deadline as well as the original body deadline.
    await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(2);
    abort.abort(); const response = await pending;
    expect(response.status).toBe(400); expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    expect(mocks.consumeDocumentTicket).not.toHaveBeenCalled();
  });
});
