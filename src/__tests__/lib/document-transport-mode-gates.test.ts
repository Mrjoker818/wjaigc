import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const m = vi.hoisted(() => ({ auth: vi.fn(), issue: vi.fn(), consume: vi.fn(), readProject: vi.fn(),
  editorRead: vi.fn(), load: vi.fn(), updates: vi.fn(), commit: vi.fn(), pool: vi.fn(), socket: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: m.auth }));
vi.mock('@/lib/collaboration/document-tickets', () => ({ issueDocumentTicket: m.issue, consumeDocumentTicket: m.consume }));
vi.mock('@/lib/collaboration/document-project-bridge', () => ({ readCollaborativeProject: m.readProject }));
vi.mock('@/lib/db-client', () => ({ getPool: m.pool }));
vi.mock('@/lib/collaboration/document-access', () => ({ withDocumentEditorRead: m.editorRead, DocumentAccessError: class extends Error {} }));
vi.mock('@/lib/collaboration/document-assets', () => ({ DocumentAssetError: class extends Error {} }));
vi.mock('@/lib/collaboration/document-store', () => ({ loadDocumentInTransaction: m.load, readDocumentUpdatesAfterInTransaction: m.updates,
  commitDocumentUpdate: m.commit, DocumentUpdateRejectedError: class extends Error {} }));
vi.mock('ws', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Socket extends Emitter {
    static OPEN = 1;
    readyState = 1; bufferedAmount = 0; frames: Buffer[] = []; closed: Array<[number, string]> = [];
    send(frame: Buffer): void { this.frames.push(frame); }
    close(code: number, reason: string): void { this.closed.push([code, reason]); this.readyState = 3; this.emit('close'); }
    terminate(): void { this.readyState = 3; this.emit('close'); }
  }
  class Server {
    handleUpgrade(_request: unknown, _socket: unknown, _head: unknown, callback: (socket: Socket) => void): void {
      const socket = new Socket(); m.socket = socket; callback(socket);
    }
    close(callback: () => void): void { callback(); }
  }
  return { default: Socket, WebSocketServer: Server };
});
import { createDocumentGateway, type DocumentGateway } from '@/lib/collaboration/document-gateway';
import { POST } from '@/app/api/collaboration/document-ticket/route';
import { GET } from '@/app/api/collaboration/document-project/route';

interface FakeSocket extends EventEmitter { frames: Buffer[]; closed: Array<[number, string]> }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function ticketRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:5000/api/collaboration/document-ticket', { method: 'POST',
    headers: { Origin: 'http://localhost:5000', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ projectId: 'project-a' }) });
}
function upgrade(): { req: IncomingMessage; socket: Duplex; end: ReturnType<typeof vi.fn> } {
  const end = vi.fn();
  return { req: { url: '/api/collaboration/document', headers: { origin: 'http://localhost:5000', host: 'localhost:5000',
    'sec-websocket-protocol': `wujie-document-v1, wujie-document-ticket.${'a'.repeat(43)}` } } as unknown as IncomingMessage,
  socket: Object.assign(new EventEmitter(), { destroyed: false, readable: true, writable: true, end }) as unknown as Duplex, end };
}
const gateways: DocumentGateway[] = [];
let listener: EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('WUJIE_YJS_ENABLED', 'true'); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false');
  vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'http://localhost:5000'); m.socket = null;
  listener = Object.assign(new EventEmitter(), { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() });
  m.pool.mockReturnValue({ connect: async () => listener }); m.auth.mockResolvedValue({ id: 'editor-a' });
  m.issue.mockResolvedValue('a'.repeat(43)); m.consume.mockResolvedValue({ userId: 'editor-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '7' });
  m.readProject.mockResolvedValue({ projectId: 'project-a', ownerId: 'owner-a', sequence: 1, projection: { placements: {} }, readOnly: false });
  m.editorRead.mockImplementation(async (_actor, _project, _grant, callback: (client: unknown) => Promise<void>) => callback({}));
  m.load.mockImplementation(async () => ({ doc: new Y.Doc(), sequence: 1 })); m.updates.mockResolvedValue([]);
  m.commit.mockResolvedValue({ sequence: 2, update: new Uint8Array([0, 0]) });
});
afterEach(async () => { while (gateways.length) await gateways.pop()?.close(); vi.unstubAllEnvs(); });
async function open(): Promise<{ gateway: DocumentGateway; socket: FakeSocket; input: ReturnType<typeof upgrade> }> {
  const gateway = createDocumentGateway({ reconcileIntervalMs: 60_000 }); gateways.push(gateway); await gateway.ready;
  const input = upgrade(); await gateway.handleDocumentUpgrade(input.req, input.socket, Buffer.alloc(0));
  return { gateway, socket: m.socket as FakeSocket, input };
}

describe('document transport mode gates, controlled sockets and auth/storage', () => {
  it('reports HTTP only in an authorized successful directory and preserves readonly', async () => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true');
    m.readProject.mockResolvedValueOnce({ projectId: 'project-a', ownerId: 'owner-a', sequence: 1, projection: { placements: {} }, readOnly: true });
    const res = await GET(new NextRequest('http://localhost/api/collaboration/document-project?projectId=project-a'));
    expect(await res.json()).toMatchObject({ success: true, documentTransport: 'http', readOnly: true });
    expect(m.readProject).toHaveBeenCalledWith('editor-a', 'project-a');
  });
  it.each([['false', 'true'], ['true', 'false'], ['true', '']])('reports ws with YJS=%s HTTP=%s', async (enabled, http) => {
    vi.stubEnv('WUJIE_YJS_ENABLED', enabled); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', http);
    const res = await GET(new NextRequest('http://localhost/api/collaboration/document-project?projectId=project-a'));
    expect((await res.json()).documentTransport).toBe('ws');
  });
  it('does not reveal transport, project or identity in errors', async () => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); m.readProject.mockRejectedValue(Object.assign(new Error('private project owner'), { code: 'DOCUMENT_FORBIDDEN' }));
    const res = await GET(new NextRequest('http://localhost/api/collaboration/document-project?projectId=project-a'));
    expect(res.status).toBe(403); expect(await res.json()).toEqual({ success: false, code: 'DOCUMENT_FORBIDDEN' });
  });
  it('does not expose private auth exceptions in either route', async () => {
    m.auth.mockRejectedValue(new Error('private-actor-and-database'));
    const project = await GET(new NextRequest('http://localhost/api/collaboration/document-project?projectId=project-a'));
    const ticket = await POST(ticketRequest());
    expect(project.status).toBe(500); expect(ticket.status).toBe(500);
    expect(await project.json()).toEqual({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' });
    expect(await ticket.json()).toEqual({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' });
    expect(m.readProject).not.toHaveBeenCalled(); expect(m.issue).not.toHaveBeenCalled();
  });
  it('rejects stale expected actor before issuing a ticket', async () => {
    const res = await POST(ticketRequest({ 'x-wujie-expected-actor-id': 'editor-b' }));
    expect(res.status).toBe(409); expect(m.issue).not.toHaveBeenCalled();
  });
  it.each([null, 'ws'])('HTTP reports a selected-mode mismatch before issuing %#', async value => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); const res = await POST(ticketRequest(value === null ? {} : { 'x-wujie-document-transport': value }));
    expect(res.status).toBe(409); expect(await res.json()).toEqual({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' }); expect(m.issue).not.toHaveBeenCalled();
  });
  it('keeps an invalid transport header classified as malformed', async () => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); const res = await POST(ticketRequest({ 'x-wujie-document-transport': 'other' }));
    expect(res.status).toBe(400); expect(await res.json()).toEqual({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }); expect(m.issue).not.toHaveBeenCalled();
  });
  it('keeps authentication and malformed input errors distinct from a mode mismatch', async () => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true');
    const actor = await POST(ticketRequest({ 'x-wujie-expected-actor-id': 'editor-b' }));
    expect(actor.status).toBe(409); expect(await actor.json()).toEqual({ success: false, code: 'ACTOR_SCOPE_CHANGED' });
    const malformed = new NextRequest('http://localhost:5000/api/collaboration/document-ticket', { method: 'POST',
      headers: { Origin: 'http://localhost:5000', 'Content-Type': 'application/json' }, body: '{"unknown":1}' });
    const res = await POST(malformed); expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, code: 'DOCUMENT_REQUEST_INVALID' }); expect(m.issue).not.toHaveBeenCalled();
  });
  it('HTTP issues only a session-authenticated actor ticket when the explicit header matches', async () => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true');
    const res = await POST(ticketRequest({ 'x-wujie-document-transport': 'http', 'x-wujie-expected-actor-id': 'editor-a' }));
    expect(res.status).toBe(200); expect(m.issue).toHaveBeenCalledExactlyOnceWith('editor-a', 'project-a');
  });
  it('WS preserves legacy no-header tickets and rejects explicit HTTP', async () => {
    expect((await POST(ticketRequest())).status).toBe(200);
    const res = await POST(ticketRequest({ 'x-wujie-document-transport': 'http' }));
    expect(res.status).toBe(409); expect(await res.json()).toEqual({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' });
    expect(m.issue).toHaveBeenCalledTimes(1);
  });
  it('does not issue if the document feature becomes disabled while reading a ticket body', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const init = { method: 'POST', headers: { Origin: 'http://localhost:5000', 'Content-Type': 'application/json' }, body, duplex: 'half' as const };
    const req = new NextRequest('http://localhost:5000/api/collaboration/document-ticket', init);
    const pending = POST(req); await vi.waitFor(() => expect(req.body?.locked).toBe(true));
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false'); controller.enqueue(new TextEncoder().encode('{"projectId":"project-a"}')); controller.close();
    expect((await pending).status).toBe(503); expect(m.issue).not.toHaveBeenCalled();
  });
  it('rechecks the transport header after a mode flip while reading the ticket body', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const init = { method: 'POST', headers: { Origin: 'http://localhost:5000', 'Content-Type': 'application/json' }, body, duplex: 'half' as const };
    const req = new NextRequest('http://localhost:5000/api/collaboration/document-ticket', init);
    const pending = POST(req); await vi.waitFor(() => expect(req.body?.locked).toBe(true));
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); controller.enqueue(new TextEncoder().encode('{"projectId":"project-a"}')); controller.close();
    const res = await pending; expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' }); expect(m.issue).not.toHaveBeenCalled();
  });
  it('does not return a just-issued legacy ticket if mode flips while issuance is in flight', async () => {
    const issued = deferred<string>(); m.issue.mockReturnValueOnce(issued.promise);
    const pending = POST(ticketRequest()); await vi.waitFor(() => expect(m.issue).toHaveBeenCalledTimes(1));
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); issued.resolve('a'.repeat(43));
    const response = await pending; expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' });
  });
  it('HTTP rejects upgrade before consuming a ticket', async () => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); const { input } = await open();
    expect(input.end).toHaveBeenCalled(); expect(m.consume).not.toHaveBeenCalled(); expect(m.socket).toBeNull();
  });
  it('rechecks mode after a ticket consume that was already in progress', async () => {
    const d = deferred<{ userId: string; projectId: string; ownerId: string; grantGeneration: string } | null>(); m.consume.mockReturnValue(d.promise);
    const gateway = createDocumentGateway({ reconcileIntervalMs: 60_000 }); gateways.push(gateway); await gateway.ready;
    const input = upgrade(), opening = gateway.handleDocumentUpgrade(input.req, input.socket, Buffer.alloc(0));
    await vi.waitFor(() => expect(m.consume).toHaveBeenCalledTimes(1)); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true');
    d.resolve({ userId: 'editor-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '7' }); await opening;
    expect(input.end).toHaveBeenCalled(); expect(m.socket).toBeNull();
  });
  it('WS mode opens and commits the original update/ACK path', async () => {
    const { socket } = await open(); await vi.waitFor(() => expect(socket.frames.length).toBe(1));
    socket.emit('message', Buffer.from([2, 0, 0]), true);
    await vi.waitFor(() => expect(m.commit).toHaveBeenCalledTimes(1)); await vi.waitFor(() => expect(socket.frames.some(frame => frame[0] === 0x12)).toBe(true));
  });
  it('drops previously queued and newly received writes on a mode flip without commit or ACK', async () => {
    const initial = deferred<{ doc: Y.Doc; sequence: number }>(); m.load.mockReturnValueOnce(initial.promise);
    const { socket } = await open(); await vi.waitFor(() => expect(m.load).toHaveBeenCalledTimes(1));
    socket.emit('message', Buffer.from([2, 0, 0]), true); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true');
    socket.emit('message', Buffer.from([2, 0, 0]), true); initial.resolve({ doc: new Y.Doc(), sequence: 1 });
    await vi.waitFor(() => expect(socket.closed).toContainEqual([1012, 'document transport changed']));
    await Promise.resolve(); expect(m.commit).not.toHaveBeenCalled(); expect(socket.frames.some(frame => frame[0] === 0x12)).toBe(false);
  });
  it('does not ACK an already-started commit after switching modes and does not claim it was cancelled', async () => {
    const commit = deferred<{ sequence: number; update: Uint8Array }>(); m.commit.mockReturnValueOnce(commit.promise);
    const { socket } = await open(); await vi.waitFor(() => expect(socket.frames.length).toBe(1));
    socket.emit('message', Buffer.from([2, 0, 0]), true); await vi.waitFor(() => expect(m.commit).toHaveBeenCalledTimes(1));
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); commit.resolve({ sequence: 2, update: new Uint8Array([0, 0]) });
    await vi.waitFor(() => expect(socket.closed).toContainEqual([1012, 'document transport changed']));
    expect(socket.frames.some(frame => frame[0] === 0x12)).toBe(false); expect(m.commit).toHaveBeenCalledTimes(1);
  });
  it('closes as transport change when an in-flight commit rejects after switching modes', async () => {
    const commit = deferred<{ sequence: number; update: Uint8Array }>(); m.commit.mockReturnValueOnce(commit.promise);
    const { socket } = await open(); await vi.waitFor(() => expect(socket.frames.length).toBe(1));
    socket.emit('message', Buffer.from([2, 0, 0]), true); await vi.waitFor(() => expect(m.commit).toHaveBeenCalledTimes(1));
    const { DocumentUpdateRejectedError } = await import('@/lib/collaboration/document-store');
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); commit.reject(new DocumentUpdateRejectedError(new Error('internal')));
    await vi.waitFor(() => expect(socket.closed).toContainEqual([1012, 'document transport changed']));
    expect(socket.frames.some(frame => frame[0] === 0x12)).toBe(false);
  });
  it('closes on reconcile after a mode flip without fetching updates', async () => {
    const { socket } = await open(); await vi.waitFor(() => expect(socket.frames.length).toBe(1));
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); listener.emit('notification', { channel: 'wujie_document_access_changed', payload: 'project-a' });
    await vi.waitFor(() => expect(socket.closed).toContainEqual([1012, 'document transport changed'])); expect(m.updates).not.toHaveBeenCalled();
  });
  it('checks the mode again when a queued write starts after a quiet in-flight reconcile', async () => {
    const updates = deferred<Array<{ sequence: number; update: Uint8Array }>>(); m.updates.mockReturnValueOnce(updates.promise);
    const { socket } = await open(); await vi.waitFor(() => expect(socket.frames.length).toBe(1));
    listener.emit('notification', { channel: 'wujie_document_access_changed', payload: 'project-a' });
    await vi.waitFor(() => expect(m.updates).toHaveBeenCalledTimes(1));
    socket.emit('message', Buffer.from([2, 0, 0]), true); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); updates.resolve([]);
    await vi.waitFor(() => expect(socket.closed).toContainEqual([1012, 'document transport changed']));
    expect(m.commit).not.toHaveBeenCalled(); expect(socket.frames.some(frame => frame[0] === 0x12)).toBe(false);
  });
});
