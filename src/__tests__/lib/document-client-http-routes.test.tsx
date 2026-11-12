// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The existing jsdom dependency has no installed declarations.
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';
import { applyCanvasImagePatch, assertCanvasDocumentTransition, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { createBrowserPendingUpdateStore, useCollaborativeCanvas } from '@/lib/collaboration/document-client';
import { jsdomCrypto } from '../helpers/jsdom-native-web-boundary';

const service = vi.hoisted(() => ({ auth: vi.fn(), project: vi.fn(), ticket: vi.fn(),
  start: vi.fn(), renew: vi.fn(), snapshot: vi.fn(), write: vi.fn(), readReceipt: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({ getPool: () => { throw new Error('unexpected database access'); } }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: service.auth, WUJIE_SESSION_COOKIE: 'wujie_session' }));
vi.mock('@/lib/collaboration/document-project-bridge', () => ({ readCollaborativeProject: service.project }));
vi.mock('@/lib/collaboration/document-tickets', () => ({ issueDocumentTicket: service.ticket }));
vi.mock('@/lib/collaboration/document-exchange-sessions', () => ({ startDocumentExchangeSession: service.start, renewDocumentExchangeSession: service.renew }));
vi.mock('@/lib/collaboration/document-exchange-snapshot', () => ({ readDocumentExchangeSnapshot: service.snapshot }));
vi.mock('@/lib/collaboration/document-exchange-receipts', () => ({ executeDocumentExchangeUpdate: service.write, readDocumentExchangeReceipt: service.readReceipt }));

import { GET as projectRoute } from '@/app/api/collaboration/document-project/route';
import { POST as ticketRoute } from '@/app/api/collaboration/document-ticket/route';
import { POST as sessionRoute } from '@/app/api/collaboration/document-exchange-session/route';
import { POST as exchangeRoute } from '@/app/api/collaboration/document-exchange/route';

const token = 'a'.repeat(43), ticket = 't'.repeat(43);
const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const fingerprint = hash(token);
interface Receipt { operationId: string; sessionFingerprint: string; updateDigest: string; documentSequence: number }
let canonical: Y.Doc, sequence: number, writes: number, loseResponse: boolean, currentActor: string;
let receipts: Map<string, Receipt>, held: Map<string, symbol>;
let requests: Array<{ path: string; actor: string | null; status: number; code?: string }>, operations: string[];
const cleanups: Array<() => void> = [];

function locks() {
  return { request: (name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>): Promise<void> => {
    if (held.has(name)) return Promise.resolve().then(() => callback(null));
    const identity = Symbol(name); held.set(name, identity);
    return Promise.resolve().then(() => callback({ name, mode: 'exclusive' } as Lock))
      .finally(() => { if (held.get(name) === identity) held.delete(name); });
  } };
}
const descriptor = () => ({ actorId: 'actor-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '7',
  sessionToken: token, sessionFingerprint: fingerprint, expiresAt: '2030-01-01T00:00:00.000Z',
  retainUntil: '2030-02-01T00:00:00.000Z' });

/** Native NextRequest bridge: simulated cookie and Origin, no real network or real authentication. */
async function bridge(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input), 'http://localhost:5000'), headers = new Headers(init.headers);
  headers.set('Origin', 'http://localhost:5000'); headers.set('Cookie', 'wujie_session=synthetic-cookie');
  let body: string | Uint8Array<ArrayBuffer> | undefined;
  if (typeof init.body === 'string') body = init.body;
  else if (init.body instanceof ArrayBuffer) body = new Uint8Array(Buffer.from(new Uint8Array(init.body)));
  else if (ArrayBuffer.isView(init.body)) body = new Uint8Array(Buffer.from(init.body.buffer, init.body.byteOffset, init.body.byteLength));
  // Construct a native signal in NextRequest's realm; hook cancellation is tested separately.
  const request = new NextRequest(url, { method: init.method ?? 'GET', headers, body, ...(body ? { duplex: 'half' as const } : {}) });
  const result = url.pathname === '/api/collaboration/document-project' ? await projectRoute(request)
    : url.pathname === '/api/collaboration/document-ticket' ? await ticketRoute(request)
      : url.pathname === '/api/collaboration/document-exchange-session' ? await sessionRoute(request)
        : url.pathname === '/api/collaboration/document-exchange' ? await exchangeRoute(request)
          : (() => { throw new Error('unexpected endpoint'); })();
  const rejected = result.status === 409 ? await result.clone().json() as { code?: string } : undefined;
  requests.push({ path: url.pathname, actor: headers.get('x-wujie-expected-actor-id'), status: result.status,
    ...(rejected?.code ? { code: rejected.code } : {}) });
  if (url.pathname === '/api/collaboration/document-exchange' && body instanceof Uint8Array && body[0] === 2 && loseResponse) {
    if (result.status !== 200) throw new Error('controlled loss requires successful route response');
    loseResponse = false; throw new Error('controlled response loss after actual route success');
  }
  return result;
}

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('WUJIE_YJS_ENABLED', 'true'); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true');
  vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'http://localhost:5000');
  const dom = new JSDOM('', { url: 'http://localhost:5000/' });
  vi.stubGlobal('localStorage', dom.window.localStorage); vi.stubGlobal('sessionStorage', dom.window.sessionStorage);
  vi.stubGlobal('crypto', jsdomCrypto); vi.stubGlobal('isSecureContext', true); held = new Map();
  vi.stubGlobal('navigator', { locks: locks() }); vi.stubGlobal('fetch', vi.fn(bridge));
  canonical = createCanvasDocument(); applyCanvasImagePatch(canonical, {
    placementId: 'p1', assetVersionId: 'version-p1', x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
  }, 'controlled seed');
  sequence = 1; writes = 0; loseResponse = false; currentActor = 'actor-a'; requests = []; operations = []; receipts = new Map();
  service.auth.mockImplementation(async () => ({ id: currentActor }));
  service.project.mockImplementation(async () => {
    const projection = readCanvasDocument(canonical), placement = projection.placements.p1;
    return { projectId: 'project-a', ownerId: 'owner-a', sequence, projection, readOnly: false,
      canvasImages: [{ ...placement, id: 'image-p1', placementId: 'p1', url: '/api/serve-upload/p1.png',
        originalWidth: 80, originalHeight: 60, createdAt: 1 }] };
  });
  service.ticket.mockResolvedValue(ticket);
  service.start.mockImplementation(async input => {
    if (input.actorId !== 'actor-a' || input.projectId !== 'project-a' || input.ticket !== ticket) throw Error('unexpected start scope');
    return descriptor();
  });
  service.renew.mockImplementation(async () => descriptor());
  service.snapshot.mockImplementation(async input => {
    if (input.actorId !== 'actor-a' || input.sessionToken !== token) throw Error('unexpected pull scope');
    return { sessionFingerprint: fingerprint, sequence, update: Y.encodeStateAsUpdate(canonical, input.stateVector) };
  });
  service.write.mockImplementation(async input => {
    if (input.actorId !== 'actor-a' || input.sessionToken !== token) throw Error('unexpected write scope');
    const updateDigest = createHash('sha256').update('wujie-document-update-v1\0').update(input.bytes).digest('hex');
    operations.push(input.operationId);
    const old = receipts.get(input.operationId);
    if (old) { if (old.updateDigest !== updateDigest) throw Error('operation digest changed'); return old; }
    const next = createCanvasDocument(); Y.applyUpdate(next, Y.encodeStateAsUpdate(canonical)); Y.applyUpdate(next, input.bytes);
    assertCanvasDocumentTransition(canonical, next); canonical.destroy(); canonical = next; sequence++; writes++;
    const value = { operationId: input.operationId, sessionFingerprint: fingerprint, updateDigest, documentSequence: sequence };
    receipts.set(input.operationId, value); return value;
  });
  service.readReceipt.mockResolvedValue(null);
});
afterEach(async () => {
  while (cleanups.length) cleanups.pop()?.();
  await Promise.resolve(); await Promise.resolve(); canonical.destroy();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
function mount() {
  const result = renderHook(() => useCollaborativeCanvas('project-a', 'actor-a', 'owner-a'));
  cleanups.push(result.unmount); return result;
}

describe('actual hook through actual document HTTP routes with controlled services', () => {
  it('initializes and clears durable pending only after the exact route receipt', async () => {
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(service.project).toHaveBeenCalledTimes(1); expect(service.ticket).toHaveBeenCalledTimes(1);
    expect(service.start).toHaveBeenCalledTimes(1); expect(service.snapshot).toHaveBeenCalled();
    act(() => f.result.current.applyLocalChange({ placementId: 'p1', x: 51 }));
    await act(async () => { await f.result.current.waitForPendingUpdates(); });
    expect(readCanvasDocument(canonical).placements.p1.x).toBe(51); expect(writes).toBe(1);
    expect(createBrowserPendingUpdateStore('project-a', 'actor-a').load()).toHaveLength(0);
    expect(operations).toHaveLength(1); expect(receipts.get(operations[0])?.documentSequence).toBe(2);
  });
  it('retries the same operation explicitly after the route succeeded but its response was lost', async () => {
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('saved'));
    loseResponse = true; act(() => f.result.current.applyLocalChange({ placementId: 'p1', x: 62 }));
    await waitFor(() => {
      expect(f.result.current.status).toBe('recovery');
      expect(f.result.current.recoveryRetryReady).toBe(true);
    }, { timeout: 3_500 });
    expect(writes).toBe(1); expect(operations).toHaveLength(1);
    expect(createBrowserPendingUpdateStore('project-a', 'actor-a').load()).toHaveLength(1);
    act(() => f.result.current.retryRecovered());
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(operations).toEqual([operations[0], operations[0]]); expect(writes).toBe(1);
    expect(createBrowserPendingUpdateStore('project-a', 'actor-a').load()).toHaveLength(0);
  });
  it('rejects the old hook actor at the actual project route after authentication changes', async () => {
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(service.ticket).toHaveBeenCalledTimes(1); expect(service.start).toHaveBeenCalledTimes(1);
    currentActor = 'actor-b'; act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(requests.some(item => item.code === 'ACTOR_SCOPE_CHANGED')).toBe(true));
    await waitFor(() => expect(f.result.current.status).toBe('unavailable'));
    expect(requests.filter(item => item.path.endsWith('document-project'))).toEqual([
      { path: '/api/collaboration/document-project', actor: 'actor-a', status: 200 },
      { path: '/api/collaboration/document-project', actor: 'actor-a', status: 409, code: 'ACTOR_SCOPE_CHANGED' },
    ]);
    expect(service.project).toHaveBeenCalledTimes(1); expect(service.ticket).toHaveBeenCalledTimes(1); expect(service.start).toHaveBeenCalledTimes(1);
    expect(f.result.current.isWritable()).toBe(false);
  });
});
