import { createHmac } from 'node:crypto';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  root: 'C:/Users/Administrator/.codex/visualizations/2026/09/19/01a0b95f-913f-7473-97ed-1362f0253b04/stage7-resume-20261101/execution-auth-fixture',
  secret: 'synthetic-only-auth-session-secret-0123456789abcdef',
  stage: '' as '' | 'secret' | 'users',
  reads: { secret: 0, users: 0 },
  wait: Promise.resolve() as Promise<void>,
  business: vi.fn(),
  dbCalls: vi.fn(() => { throw new Error('SYNTHETIC_DATABASE_FORBIDDEN'); }),
}));

vi.mock('server-only', () => ({}));
// Only the two explicitly named synthetic auth-file boundaries exist here.
vi.mock('fs/promises', () => ({
  readFile: async (file: string): Promise<string> => {
    if (path.resolve(file) !== path.resolve(fixture.root, 'system', 'auth-secret')) throw new Error('UNEXPECTED_FILE');
    fixture.reads.secret++;
    if (fixture.stage === 'secret') await fixture.wait;
    return fixture.secret;
  },
  mkdir: fixture.dbCalls, rm: fixture.dbCalls,
}));
vi.mock('@/lib/server-data-root', () => ({
  getServerSystemDir: () => path.join(fixture.root, 'system'),
  getServerUsersDir: () => path.join(fixture.root, 'users'),
}));
vi.mock('@/lib/auth/auth-persistence', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/auth/auth-persistence')>();
  return { ...actual, readAuthJsonFile: async (file: string): Promise<unknown> => {
    if (path.resolve(file) !== path.resolve(fixture.root, 'system', 'users.json')) throw new Error('UNEXPECTED_FILE');
    fixture.reads.users++;
    if (fixture.stage === 'users') await fixture.wait;
    return { users: [{ id: 'fixture-actor', name: 'fixture-user', passwordHash: 'synthetic',
      role: 'user', status: 'active', createdAt: 1, updatedAt: 1 }], updatedAt: 1 };
  } };
});
vi.mock('@/lib/db-client', () => ({ isDatabaseConfigured: () => false }));
vi.mock('@/lib/db-storage', () => ({
  dbReadUsers: fixture.dbCalls, dbReadUsersWithClient: fixture.dbCalls, dbWriteUsers: fixture.dbCalls,
  dbDeleteUser: fixture.dbCalls, dbDeleteUserData: fixture.dbCalls, dbInitCredits: fixture.dbCalls,
}));
vi.mock('@/lib/auth/auth-repository', () => ({
  readDatabaseSecretRing: fixture.dbCalls, resolveDatabaseSecretRing: fixture.dbCalls,
  updateUserCredentials: fixture.dbCalls, updateUserCredentialSidecar: fixture.dbCalls,
  updateUserProfileFields: fixture.dbCalls, withDatabaseAuthReplicaLock: fixture.dbCalls,
}));
vi.mock('@/lib/server-user-storage', () => ({
  ensureUserDataDirs: fixture.dbCalls, getUserDataDir: fixture.dbCalls,
}));
vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: fixture.dbCalls }));
vi.mock('@/lib/collaboration/document-tickets', () => ({ issueDocumentTicket: fixture.business }));
vi.mock('@/lib/collaboration/document-exchange-access', () => ({
  DocumentExchangeError: class extends Error { constructor(readonly code: string) { super(code); } },
}));

import { getSessionUser } from '@/lib/server-auth';
import { getDocumentExecutionStats, runDocumentExecution } from '@/lib/collaboration/document-execution-scope';
import { POST as issueTicketRoute } from '@/app/api/collaboration/document-ticket/route';

function request(): NextRequest {
  const payload = Buffer.from(JSON.stringify({ sub: 'fixture-actor', role: 'user',
    name: 'fixture-user', exp: Date.now() + 60_000 })).toString('base64url');
  const signature = createHmac('sha256', fixture.secret).update(payload).digest('base64url');
  return new NextRequest('http://localhost/api/collaboration/document-exchange', {
    headers: { cookie: `wujie_session=${payload}.${signature}` },
  });
}
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubEnv('WUJIE_AUTH_PERSISTENCE_MODE', 'FILE_ONLY');
  vi.stubEnv('WUJIE_AUTH_SECRET', fixture.secret);
  vi.stubEnv('COZE_PROJECT_ENV', 'DEV');
  fixture.stage = ''; fixture.reads = { secret: 0, users: 0 };
  fixture.wait = Promise.resolve(); fixture.business.mockClear(); fixture.dbCalls.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('real FILE_ONLY session authentication under execution scope', () => {
  it('accepts a synthetic signed session through the real authentication function', async () => {
    const user = await getSessionUser(request());
    expect(user?.id).toBe('fixture-actor');
    expect(fixture.reads).toEqual({ secret: 1, users: 1 });
    expect(fixture.dbCalls).not.toHaveBeenCalled();
  });

  it.each(['secret', 'users'] as const)('retains all eight timed-out scope slots until hanging %s reads settle', async stage => {
    const gate = deferred(); fixture.stage = stage; fixture.wait = gate.promise;
    const tasks = Array.from({ length: 8 }, () => runDocumentExecution({ timeoutMs: 100 }, async scope => {
      const user = await getSessionUser(request());
      scope.assertActive();
      if (!user) throw new Error('FIXTURE_AUTH_FAILED');
      scope.admitActor(user.id);
      fixture.business();
    }));
    const outcomes = tasks.map(task => task.then(() => 'success', cause => cause.code as string));
    try {
      await vi.waitFor(() => expect(fixture.reads[stage]).toBe(8), { timeout: 2_000 });
      expect(await Promise.all(outcomes)).toEqual(Array(8).fill('TIMEOUT'));
      expect(getDocumentExecutionStats().activeScopes).toBe(8);
      expect(getDocumentExecutionStats().drainingScopes).toBe(8);
      await expect(runDocumentExecution({ timeoutMs: 100 }, async () => undefined)).rejects.toMatchObject({ code: 'BUSY' });
      expect(fixture.business).not.toHaveBeenCalled();
      expect(fixture.dbCalls).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
    }
    await vi.waitFor(() => expect(getDocumentExecutionStats().activeScopes).toBe(0), { timeout: 2_000 });
    expect(fixture.business).not.toHaveBeenCalled();
    expect(getDocumentExecutionStats().actorAdmissions).toBe(0);
    fixture.stage = '';
    await expect(runDocumentExecution({ timeoutMs: 500 }, async scope => {
      const user = await getSessionUser(request()); scope.assertActive();
      if (!user) throw new Error('FIXTURE_AUTH_FAILED');
      scope.admitActor(user.id); return user.id;
    })).resolves.toBe('fixture-actor');
  });

  it.each(['secret', 'users'] as const)('does not read a ticket body or issue a ticket after abort during %s read', async stage => {
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false');
    const gate = deferred(), controller = new AbortController(); fixture.stage = stage; fixture.wait = gate.promise;
    const routeRequest = new NextRequest('http://localhost:5000/api/collaboration/document-ticket', {
      method: 'POST', signal: controller.signal,
      headers: { cookie: request().headers.get('cookie')!, origin: 'http://localhost:5000', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'fixture-project' }),
    });
    const body = routeRequest.body;
    if (!body) throw new Error('FIXTURE_BODY_MISSING');
    const getReader = vi.spyOn(body, 'getReader');
    const cancel = vi.spyOn(body, 'cancel');
    const pending = issueTicketRoute(routeRequest);
    try {
      await vi.waitFor(() => expect(fixture.reads[stage]).toBe(1), { timeout: 2_000 });
      controller.abort();
      const response = await pending;
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_EXCHANGE_REQUEST_CANCELLED' });
      expect(getDocumentExecutionStats().activeScopes).toBe(1);
      expect(getReader).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(routeRequest.bodyUsed).toBe(true);
      expect(fixture.business).not.toHaveBeenCalled();
    } finally { gate.resolve(); }
    await vi.waitFor(() => expect(getDocumentExecutionStats().activeScopes).toBe(0), { timeout: 2_000 });
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(routeRequest.bodyUsed).toBe(true);
    expect(fixture.business).not.toHaveBeenCalled();
    expect(fixture.dbCalls).not.toHaveBeenCalled();
  });
});
