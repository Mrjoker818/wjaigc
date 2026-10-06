import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), execute: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.session }));
vi.mock('@/lib/collaboration/document-asset-commands', () => ({ executeDocumentAssetCommand: mocks.execute }));
import { POST } from '@/app/api/collaboration/document-assets/route';

const body = { projectId: 'project-a', idempotencyKey: 'key', command: {
  action: 'attach', assetVersionId: 'v1', transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1 },
} };
function request(value: unknown = body, headers: Record<string, string> = {}, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/collaboration/document-assets${query}`, {
    method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', ...headers },
    body: typeof value === 'string' ? value : JSON.stringify(value),
  });
}
describe('document asset command HTTP boundary', () => {
  beforeEach(() => {
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
    mocks.session.mockReset().mockResolvedValue({ id: 'editor-a' });
    mocks.execute.mockReset().mockResolvedValue({ placementId: 'p1', assetVersionId: 'v1', documentSequence: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('binds only the session actor and responds with stable result and private cache headers', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, placementId: 'p1', assetVersionId: 'v1', documentSequence: 1 });
    expect(mocks.execute).toHaveBeenCalledWith({ ...body, actorId: 'editor-a' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
  });
  it('rejects frozen work from a previous actor before executing under the new session', async () => {
    mocks.session.mockResolvedValue({ id: 'editor-b' });
    const response = await POST(request(body, { 'x-wujie-expected-actor-id': 'editor-a' }));
    expect({ status: response.status, body: await response.json(), executions: mocks.execute.mock.calls })
      .toEqual({ status: 409, body: { success: false, code: 'ACTOR_SCOPE_CHANGED' }, executions: [] });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
  });
  it('keeps the session authoritative when the expected actor matches', async () => {
    const response = await POST(request(body, { 'x-wujie-expected-actor-id': 'editor-a' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, placementId: 'p1', assetVersionId: 'v1', documentSequence: 1 });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({ ...body, actorId: 'editor-a' });
  });
  it('rejects an explicitly empty expected actor rather than treating it as a legacy caller', async () => {
    const response = await POST(request(body, { 'x-wujie-expected-actor-id': '' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'ACTOR_SCOPE_CHANGED' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('does not let an expected actor replace the session', async () => {
    mocks.session.mockResolvedValue(null);
    const response = await POST(request(body, { 'x-wujie-expected-actor-id': 'editor-a' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, code: 'AUTHENTICATION_REQUIRED' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('preserves the origin check when a matching expected actor is supplied', async () => {
    const response = await POST(request(body, {
      'x-wujie-expected-actor-id': 'editor-a', origin: 'https://evil.example',
    }));
    expect(response.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(['ownerId', 'actorId', 'bytes', 'url', 'prepared', 'extra'])('rejects forged %s without calling the command', async field => {
    const response = await POST(request({ ...body, [field]: 'forged' }));
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([
    [{ ...body, projectId: 'p\n' }, {}, '', 400],
    [{ ...body, idempotencyKey: 'x'.repeat(257) }, {}, '', 400],
    [{ ...body, command: { ...body.command, assetVersionId: 'a'.repeat(161) } }, {}, '', 400],
    [{ ...body, command: { ...body.command, transform: { ...body.command.transform, owner: 'forged' } } }, {}, '', 400],
    ['{bad', {}, '', 400], [' '.repeat(65_537), {}, '', 400],
    [body, { origin: 'https://evil.example' }, '', 403],
    [body, { 'content-type': 'text/plain' }, '', 415],
    [body, {}, '?owner=other', 400],
    [body, { 'content-length': '999999' }, '', 400],
  ] as const)('rejects malformed transport or payload %#', async (value, headers, query, status) => {
    const response = await POST(request(value, headers, query));
    expect(response.status).toBe(status);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
  });
  it('requires a session and defaults the feature to disabled', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    mocks.session.mockResolvedValue({ id: 'editor-a' });
    vi.stubEnv('WUJIE_YJS_ENABLED', undefined);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([
    ['DOCUMENT_FORBIDDEN', 403], ['DOCUMENT_ASSET_FORBIDDEN', 403],
    ['DOCUMENT_DISABLED', 503], ['DOCUMENT_PROJECT_NOT_ENABLED', 503],
    ['DOCUMENT_ASSET_COMMAND_INVALID', 400], ['DOCUMENT_ASSET_COMMAND_CONFLICT', 409], ['unexpected', 500],
  ])('maps %s without leaking details', async (code, status) => {
    mocks.execute.mockRejectedValue(Object.assign(new Error('secret database detail'), { code }));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('secret');
  });
});
