import { NextRequest } from 'next/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const boundary = vi.hoisted(() => ({ session: vi.fn(), batch: vi.fn() }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: boundary.session }));
vi.mock('@/lib/collaboration/document-media-batch', () => ({ importDocumentMediaBatch: boundary.batch }));
import { POST } from '@/app/api/collaboration/document-assets/import-batch/route';
const input = { projectId: 'target', idempotencyKey: 'intent', items: [{ sourceVersionId: 'source',
  command: { action: 'attach', transform: { x: 0, y: 0, width: 2, height: 2, rotation: 0, zIndex: 1 } } }] };
function request(body = JSON.stringify(input), headers: Record<string, string> = {}, query = ''): NextRequest {
  return new NextRequest('http://localhost/api/collaboration/document-assets/import-batch' + query, {
    method: 'POST', body, headers: { origin: 'http://localhost', 'content-type': 'application/json', ...headers } });
}
beforeEach(() => { vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', ''); boundary.session.mockReset().mockResolvedValue({ id: 'actor' });
  boundary.batch.mockReset().mockResolvedValue({ projectId: 'target', documentSequence: 3, items: [] }); });
afterEach(() => vi.unstubAllEnvs());
describe('1394 actual route transport admission', () => {
  it('binds the real session actor and private response headers', async () => {
    const req = request(); const response = await POST(req);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie'); expect(boundary.batch).toHaveBeenCalledWith('actor', input, req.signal);
  });
  it('rejects actor drift before consuming JSON and does not grant authority via matched header', async () => {
    const req = request('invalid', { 'x-wujie-expected-actor-id': 'previous' });
    expect((await POST(req)).status).toBe(409); expect(req.bodyUsed).toBe(false); expect(boundary.batch).not.toHaveBeenCalled();
    expect((await POST(request(JSON.stringify(input), { 'x-wujie-expected-actor-id': 'actor' }))).status).toBe(200);
  });
  it('rejects anonymous, foreign/missing Origin, MIME and query before body work', async () => {
    boundary.session.mockResolvedValue(null); const anon = request(); expect((await POST(anon)).status).toBe(401); expect(anon.bodyUsed).toBe(false);
    boundary.session.mockResolvedValue({ id: 'actor' });
    for (const [headers, query, status] of [[{ origin: '' }, '', 403], [{ origin: 'https://foreign.example' }, '', 403],
      [{ 'content-type': 'image/png' }, '', 415], [{}, '?projectId=p&projectId=p', 400]] as const) {
      const req = request('invalid', headers, query); expect((await POST(req)).status).toBe(status); expect(req.bodyUsed).toBe(false);
    }
    expect(boundary.batch).not.toHaveBeenCalled();
  });
  it('bounds actual streamed UTF8 bytes at 64KiB, not the old 8KiB, and rejects invalid length', async () => {
    const padded = JSON.stringify(input) + ' '.repeat(9000);
    expect((await POST(request(padded))).status).toBe(200);
    expect((await POST(request(' '.repeat(65537)))).status).toBe(413);
    expect((await POST(request(JSON.stringify(input), { 'content-length': '1' }))).status).toBe(400);
    expect((await POST(request('[]'))).status).toBe(400);
  });
  it.each(['actor','owner','taskId','outputIndex','url','validated','trusted'])('rejects untrusted item %s', async field => {
    const body = { ...input, items: [{ ...input.items[0], [field]: 'forged' }] };
    expect((await POST(request(JSON.stringify(body)))).status).toBe(400); expect(boundary.batch).not.toHaveBeenCalled();
  });
  it('bounds member count and duplicate versions without source work', async () => {
    for (const items of [[], Array.from({ length: 101 }, (_, i) => ({ ...input.items[0], sourceVersionId: 'v' + i })),
      [input.items[0], input.items[0]]]) expect((await POST(request(JSON.stringify({ ...input, items })))).status).toBe(400);
    expect(boundary.batch).not.toHaveBeenCalled();
  });
  it.each([['DOCUMENT_FORBIDDEN',403],['DOCUMENT_MEDIA_CONFLICT',409],['DOCUMENT_MEDIA_BUSY',503],['UNKNOWN',500]] as const)('sanitizes %s', async (code, status) => {
    boundary.batch.mockRejectedValue(Object.assign(new Error('SQL /private secret token=key'), { code }));
    const response = await POST(request()); expect(response.status).toBe(status); expect(await response.text()).not.toMatch(/secret|SQL|token=/);
  });
  it('aborted request cannot reach batch service', async () => {
    const controller = new AbortController(); controller.abort();
    const req = new NextRequest('http://localhost/api/collaboration/document-assets/import-batch', {
      method: 'POST', body: JSON.stringify(input), signal: controller.signal,
      headers: { origin: 'http://localhost', 'content-type': 'application/json' } });
    expect((await POST(req)).status).toBe(400); expect(boundary.batch).not.toHaveBeenCalled();
  });
});
