import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ auth: vi.fn(), issue: vi.fn(), ownerStatus: vi.fn(), enable: vi.fn(),
  snapshot: vi.fn(), write: vi.fn(), readBytes: vi.fn(), start: vi.fn(), renew: vi.fn(), readDigest: vi.fn(),
  ExchangeError: class extends Error { constructor(readonly code: string) { super(code); } },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: m.auth, WUJIE_SESSION_COOKIE: 'wujie_session' }));
vi.mock('@/lib/collaboration/document-tickets', () => ({ issueDocumentTicket: m.issue }));
vi.mock('@/lib/collaboration/document-owner-status', () => ({ readDocumentOwnerStatus: m.ownerStatus }));
vi.mock('@/lib/collaboration/document-project-bridge', () => ({ enableCollaborativeProject: m.enable }));
vi.mock('@/lib/collaboration/document-exchange-access', () => ({ DocumentExchangeError: m.ExchangeError }));
vi.mock('@/lib/collaboration/document-exchange-snapshot', () => ({ readDocumentExchangeSnapshot: m.snapshot }));
vi.mock('@/lib/collaboration/document-exchange-sessions', () => ({ startDocumentExchangeSession: m.start, renewDocumentExchangeSession: m.renew }));
vi.mock('@/lib/collaboration/document-exchange-receipts', () => ({ executeDocumentExchangeUpdate: m.write,
  readDocumentExchangeReceipt: m.readBytes, readDocumentExchangeReceiptByDigest: m.readDigest }));
import { POST as exchange } from '@/app/api/collaboration/document-exchange/route';
import { POST as session } from '@/app/api/collaboration/document-exchange-session/route';
import { POST as receipt } from '@/app/api/collaboration/document-exchange-receipt/route';
import { POST as ticket } from '@/app/api/collaboration/document-ticket/route';
import { GET as ownerStatus } from '@/app/api/collaboration/document-enable/route';

const token = 's'.repeat(43), operationId = 'operation_00000001', digest = 'd'.repeat(64);
const serviceNames = ['snapshot', 'write', 'readBytes', 'start', 'renew', 'readDigest'] as const;
type ServiceName = typeof serviceNames[number];
interface Scenario { name: string; path: string; bytes: Uint8Array; service: ServiceName; headers?: Record<string, string> }
const json = (body: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(body));
const scenarios: Scenario[] = [
  { name: 'snapshot', path: 'document-exchange', bytes: new Uint8Array([1, 0]), service: 'snapshot' },
  { name: 'write', path: 'document-exchange', bytes: new Uint8Array([2, 0, 0]), service: 'write', headers: { 'x-wujie-document-operation-id': operationId } },
  { name: 'bytes receipt', path: 'document-exchange', bytes: new Uint8Array([2, 0, 0]), service: 'readBytes', headers: { 'x-wujie-document-operation-id': operationId, 'x-wujie-document-operation': 'receipt' } },
  { name: 'start', path: 'document-exchange-session', bytes: json({ action: 'start', projectId: 'project-a', ticket: token }), service: 'start' },
  { name: 'renew', path: 'document-exchange-session', bytes: json({ action: 'renew', projectId: 'project-a', sessionToken: token }), service: 'renew' },
  { name: 'digest receipt', path: 'document-exchange-receipt', bytes: json({ projectId: 'project-a', sessionToken: token, operationId, updateDigest: digest }), service: 'readDigest' },
];
function bodyRequest(scenario: Scenario) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const isBinary = scenario.path === 'document-exchange';
  const headers = { Origin: 'http://localhost:5000', 'Content-Type': isBinary ? 'application/octet-stream' : 'application/json',
    Cookie: 'wujie_session=synthetic-cookie', 'x-wujie-expected-actor-id': 'actor-a',
    ...(isBinary ? { 'x-wujie-project-id': 'project-a', 'x-wujie-document-session': token } : {}), ...scenario.headers };
  const init = { method: 'POST', headers, body, duplex: 'half' as const };
  const request = new NextRequest(`http://localhost:5000/api/collaboration/${scenario.path}`, init);
  const handler = isBinary ? exchange : scenario.path === 'document-exchange-session' ? session : receipt;
  return { request, handler, finish: () => { controller.enqueue(scenario.bytes); controller.close(); } };
}
function ticketRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:5000/api/collaboration/document-ticket', { method: 'POST',
    headers: { Origin: 'http://localhost:5000', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ projectId: 'project-a' }) });
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('WUJIE_YJS_ENABLED', 'true'); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true');
  vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'http://localhost:5000'); m.auth.mockResolvedValue({ id: 'actor-a' });
  m.issue.mockResolvedValue(token); m.snapshot.mockResolvedValue({ sessionFingerprint: digest, sequence: 1, update: new Uint8Array([0, 0]) });
  m.write.mockResolvedValue({ operationId, sessionFingerprint: digest, updateDigest: digest, documentSequence: 1 });
  m.readBytes.mockResolvedValue(null); m.readDigest.mockResolvedValue(null);
  m.start.mockResolvedValue({ sessionToken: token }); m.renew.mockResolvedValue({ sessionToken: token });
  m.ownerStatus.mockResolvedValue({ projectId: 'project-a', featureEnabled: true, enabled: false, currentRevision: 1 });
  m.enable.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('HTTP mode rechecked after body, with controlled service calls', () => {
  it.each(scenarios.flatMap(scenario => ['WUJIE_YJS_HTTP_ENABLED', 'WUJIE_YJS_ENABLED'].map(flag => ({ scenario, flag }))))
    ('refuses $scenario.name after $flag is switched off before body completes', async ({ scenario, flag }) => {
      const f = bodyRequest(scenario), pending = f.handler(f.request);
      await vi.waitFor(() => expect(f.request.body?.locked).toBe(true));
      vi.stubEnv(flag, 'false'); f.finish(); const result = await pending;
      expect(result.status).toBe(503); expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_EXCHANGE_DISABLED' });
      for (const name of serviceNames) expect(m[name]).not.toHaveBeenCalled();
    });
  it.each(scenarios)('still calls the authorized selected service for $name when flags stay on', async scenario => {
    const f = bodyRequest(scenario), pending = f.handler(f.request);
    await vi.waitFor(() => expect(f.request.body?.locked).toBe(true)); f.finish();
    expect((await pending).status).toBe(200); expect(m[scenario.service]).toHaveBeenCalledTimes(1);
  });
  it('does not claim that a write already handed to the service was cancelled', async () => {
    const work = deferred<unknown>(); m.write.mockReturnValueOnce(work.promise);
    const f = bodyRequest(scenarios[1]), pending = f.handler(f.request);
    await vi.waitFor(() => expect(f.request.body?.locked).toBe(true)); f.finish();
    await vi.waitFor(() => expect(m.write).toHaveBeenCalledTimes(1)); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false');
    work.resolve({ operationId, sessionFingerprint: digest, updateDigest: digest, documentSequence: 1 });
    expect((await pending).status).toBe(200); expect(m.write).toHaveBeenCalledTimes(1);
  });
  it('does not discard an exact receipt read already handed to the service', async () => {
    const work = deferred<unknown>(); m.readDigest.mockReturnValueOnce(work.promise);
    const f = bodyRequest(scenarios[5]), pending = f.handler(f.request);
    await vi.waitFor(() => expect(f.request.body?.locked).toBe(true)); f.finish();
    await vi.waitFor(() => expect(m.readDigest).toHaveBeenCalledTimes(1)); vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false');
    work.resolve(null); const response = await pending;
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, receipt: null });
  });
  it.each([scenarios[1], scenarios[3], scenarios[5]])('returns actor slots after rejecting two switched $name bodies', async scenario => {
    const first = bodyRequest(scenario), second = bodyRequest(scenario);
    const a = first.handler(first.request), b = second.handler(second.request);
    await vi.waitFor(() => { expect(first.request.body?.locked).toBe(true); expect(second.request.body?.locked).toBe(true); });
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false'); first.finish(); second.finish();
    expect((await a).status).toBe(503); expect((await b).status).toBe(503);
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); const third = bodyRequest(scenario), fourth = bodyRequest(scenario);
    const c = third.handler(third.request), d = fourth.handler(fourth.request);
    await vi.waitFor(() => { expect(third.request.body?.locked).toBe(true); expect(fourth.request.body?.locked).toBe(true); });
    third.finish(); fourth.finish(); expect((await c).status).toBe(200); expect((await d).status).toBe(200);
    expect(m[scenario.service]).toHaveBeenCalledTimes(2);
  });
});

describe('ticket failure after a mode change', () => {
  it.each([{ code: 'DOCUMENT_TICKET_LIMIT' }, new Error('private synthetic failure')])
    ('reports a changed transport instead of a stale issue failure %#', async error => {
      vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false'); const issued = deferred<string>(); m.issue.mockReturnValueOnce(issued.promise);
      const pending = ticket(ticketRequest()); await vi.waitFor(() => expect(m.issue).toHaveBeenCalledTimes(1));
      vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); issued.reject(error); const result = await pending;
      expect(result.status).toBe(409); expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' });
    });
  it('preserves actual authorization denial when mode also changes', async () => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false'); const issued = deferred<string>(); m.issue.mockReturnValueOnce(issued.promise);
    const pending = ticket(ticketRequest()); await vi.waitFor(() => expect(m.issue).toHaveBeenCalledTimes(1));
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); issued.reject({ code: 'DOCUMENT_FORBIDDEN' }); const result = await pending;
    expect(result.status).toBe(403); expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_FORBIDDEN' });
  });
  it('returns the original project-not-enabled denial when mode also changes', async () => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false'); const issued = deferred<string>(); m.issue.mockReturnValueOnce(issued.promise);
    const pending = ticket(ticketRequest()); await vi.waitFor(() => expect(m.issue).toHaveBeenCalledTimes(1));
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'true'); issued.reject({ code: 'DOCUMENT_PROJECT_NOT_ENABLED' });
    const result = await pending; expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' });
  });
  it('reports a mode change when HTTP issuance fails after switching to WS', async () => {
    const issued = deferred<string>(); m.issue.mockReturnValueOnce(issued.promise);
    const pending = ticket(ticketRequest({ 'x-wujie-document-transport': 'http' }));
    await vi.waitFor(() => expect(m.issue).toHaveBeenCalledTimes(1));
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false'); issued.reject({ code: 'DOCUMENT_TICKET_LIMIT' });
    const result = await pending; expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' });
  });
  it('reports disabled if the document feature is switched off while issuance fails', async () => {
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false'); const issued = deferred<string>(); m.issue.mockReturnValueOnce(issued.promise);
    const pending = ticket(ticketRequest()); await vi.waitFor(() => expect(m.issue).toHaveBeenCalledTimes(1));
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false'); issued.reject(new Error('private'));
    const result = await pending; expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_DISABLED' });
  });
  it.each([[{ code: 'DOCUMENT_TICKET_LIMIT' }, 429, 'DOCUMENT_TICKET_LIMIT'],
    [{ code: 'DOCUMENT_FORBIDDEN' }, 403, 'DOCUMENT_FORBIDDEN'], [new Error('private'), 500, 'DOCUMENT_INTERNAL_ERROR']] as const)
    ('preserves same-mode failure %#', async (error, status, code) => {
      vi.stubEnv('WUJIE_YJS_HTTP_ENABLED', 'false'); m.issue.mockRejectedValueOnce(error); const result = await ticket(ticketRequest());
      expect(result.status).toBe(status); expect(await result.json()).toEqual({ success: false, code });
    });
});

describe('owner status expected actor gate', () => {
  it.each(['actor-b', ''])('rejects mismatched expected actor %j before owner lookup', async actor => {
    const request = new NextRequest('http://localhost:5000/api/collaboration/document-enable?projectId=project-a',
      { headers: { 'x-wujie-expected-actor-id': actor } });
    const result = await ownerStatus(request);
    expect(result.status).toBe(409); expect(await result.json()).toEqual({ success: false, code: 'ACTOR_SCOPE_CHANGED' });
    expect(m.ownerStatus).not.toHaveBeenCalled();
  });
  it.each([undefined, 'actor-a'])('keeps legacy or matching actor owner reads %#', async actor => {
    const request = new NextRequest('http://localhost:5000/api/collaboration/document-enable?projectId=project-a',
      actor === undefined ? {} : { headers: { 'x-wujie-expected-actor-id': actor } });
    expect((await ownerStatus(request)).status).toBe(200); expect(m.ownerStatus).toHaveBeenCalledExactlyOnceWith('actor-a', 'project-a');
  });
});
