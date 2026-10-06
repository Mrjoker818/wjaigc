import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), upload: vi.fn(), adopt: vi.fn(), version: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.session }));
vi.mock('@/lib/collaboration/document-media-import', () => ({ importDocumentUpload: mocks.upload, adoptDocumentTaskResult: mocks.adopt, importDocumentAssetVersion: mocks.version }));
import { POST as upload } from '@/app/api/collaboration/document-assets/upload/route';
import { POST as adopt } from '@/app/api/collaboration/document-assets/adopt/route';
import { POST as version } from '@/app/api/collaboration/document-assets/import-version/route';

const command = { action: 'attach', transform: { x: 0, y: 0, width: 2, height: 2, rotation: 0, zIndex: 0 } };
const input = { projectId: 'project', idempotencyKey: 'key', taskId: 'task', outputIndex: 0, command };
function request(mode: 'upload' | 'adopt' | 'import-version', body: string = JSON.stringify(input), headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/collaboration/document-assets/${mode}`, { method: 'POST', body,
    headers: { origin: 'http://localhost', 'content-type': mode !== 'upload' ? 'application/json' : 'image/png', ...headers } });
}
beforeEach(() => {
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true'); vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
  mocks.session.mockReset().mockResolvedValue({ id: 'session-actor' });
  for (const execute of [mocks.upload, mocks.adopt, mocks.version]) execute.mockReset().mockResolvedValue({ placementId: 'p', assetVersionId: 'v', documentSequence: 4 });
});
afterEach(() => vi.unstubAllEnvs());
describe('media import routes', () => {
  it('rejects a changed upload actor before reading bytes or importing, but never authorizes from the expected actor header', async () => {
    const changed = request('upload', 'private video', { 'x-wujie-expected-actor-id': 'previous-actor' });
    const response = await upload(changed);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'ACTOR_SCOPE_CHANGED' });
    expect(changed.bodyUsed).toBe(false); expect(mocks.upload).not.toHaveBeenCalled();
    const matched = request('upload', 'video', { 'x-wujie-expected-actor-id': 'session-actor' });
    expect((await upload(matched)).status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledWith('session-actor', matched);
  });
  const versionInput = { projectId: 'project', sourceVersionId: 'version', idempotencyKey: 'key', command };
  it('version route binds session actor and returns the committed command for refreshMedia', async (): Promise<void> => {
    const req = request('import-version', JSON.stringify(versionInput));
    const response = await version(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, placementId: 'p', assetVersionId: 'v', documentSequence: 4 });
    expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toBe('Cookie');
    expect(mocks.version).toHaveBeenCalledWith('session-actor', versionInput, req.signal);
    expect(mocks.adopt).not.toHaveBeenCalled();
  });
  it('version route rejects anonymous, foreign/missing Origin and duplicate query before consuming JSON', async (): Promise<void> => {
    const anon = request('import-version'); mocks.session.mockResolvedValue(null);
    expect((await version(anon)).status).toBe(401); expect(anon.bodyUsed).toBe(false);
    mocks.session.mockResolvedValue({ id: 'session-actor' });
    for (const origin of ['', 'https://foreign.example']) {
      const req = request('import-version', JSON.stringify(versionInput), { origin });
      expect((await version(req)).status).toBe(403); expect(req.bodyUsed).toBe(false);
    }
    for (const query of ['?projectId=p', '?projectId=p&projectId=p']) {
      const req = new NextRequest('http://localhost/api/collaboration/document-assets/import-version' + query,
        { method: 'POST', body: JSON.stringify(versionInput), headers: { origin: 'http://localhost', 'content-type': 'application/json' } });
      expect((await version(req)).status).toBe(400); expect(req.bodyUsed).toBe(false);
    }
    expect(mocks.version).not.toHaveBeenCalled();
  });
  it.each(['taskId', 'outputIndex', 'actorId', 'ownerId', 'url', 'storageKey', 'validated', 'trusted'])('version route rejects injected %s without media work', async (field): Promise<void> => {
    expect((await version(request('import-version', JSON.stringify({ ...versionInput, [field]: 'forged' })))).status).toBe(400);
    expect(mocks.version).not.toHaveBeenCalled();
  });
  it('version route enforces body budget, JSON MIME and sanitized failure contract', async (): Promise<void> => {
    expect((await version(request('import-version', ' '.repeat(8193)))).status).toBe(413);
    expect((await version(request('import-version', '{}', { 'content-type': 'image/png' }))).status).toBe(415);
    expect((await version(request('import-version', JSON.stringify(versionInput), { 'content-length': '1' }))).status).toBe(400);
    expect(mocks.version).not.toHaveBeenCalled();
    for (const [code, status] of [['DOCUMENT_MEDIA_SOURCE_FORBIDDEN', 403], ['DOCUMENT_MEDIA_CONFLICT', 409], ['DOCUMENT_MEDIA_BUSY', 503], ['DOCUMENT_MEDIA_CANCELLED', 400], ['UNKNOWN', 500]] as const) {
      mocks.version.mockRejectedValue(Object.assign(new Error('SQL secret /private/file https://private?token=secret'), { code }));
      const response = await version(request('import-version', JSON.stringify(versionInput)));
      expect(response.status).toBe(status); expect(await response.text()).not.toMatch(/secret|SQL|private\/file/u);
    }
  });
  it.each(['upload', 'adopt'] as const)('%s requires session/Origin and does not consume forbidden requests', async (mode): Promise<void> => {
    const post = mode === 'upload' ? upload : adopt;
    const anon = request(mode); mocks.session.mockResolvedValue(null);
    expect((await post(anon)).status).toBe(401); expect(anon.bodyUsed).toBe(false);
    mocks.session.mockResolvedValue({ id: 'session-actor' });
    const foreign = request(mode, 'private', { origin: 'https://foreign.example' });
    expect((await post(foreign)).status).toBe(403); expect(foreign.bodyUsed).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.adopt).not.toHaveBeenCalled();
  });
  it.each(['upload', 'adopt'] as const)('%s binds actor only from session and returns committed-shaped result with private cache headers', async (mode): Promise<void> => {
    const req = request(mode); const response = await (mode === 'upload' ? upload(req) : adopt(req));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, placementId: 'p', assetVersionId: 'v', documentSequence: 4 });
    expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toBe('Cookie');
    if (mode === 'upload') expect(mocks.upload).toHaveBeenCalledWith('session-actor', req);
    else expect(mocks.adopt).toHaveBeenCalledWith('session-actor', input, req.signal);
  });
  it.each(['actorId', 'ownerId', 'url', 'storageKey', 'assetVersionId', 'validated'])('adopt rejects forged %s', async (field): Promise<void> => {
    expect((await adopt(request('adopt', JSON.stringify({ ...input, [field]: 'forged' })))).status).toBe(400);
    expect(mocks.adopt).not.toHaveBeenCalled();
  });
  it('adopt bounds actual JSON and rejects non-JSON MIME without changing the old contract', async (): Promise<void> => {
    expect((await adopt(request('adopt', ' '.repeat(8193)))).status).toBe(413);
    expect((await adopt(request('adopt', '{}', { 'content-type': 'image/png' }))).status).toBe(415);
    expect((await adopt(request('adopt', JSON.stringify(input), { 'content-length': '1' }))).status).toBe(400);
    expect(mocks.adopt).not.toHaveBeenCalled();
  });
  it('reports native media admission busy as retryable rather than internal failure', async (): Promise<void> => {
    mocks.upload.mockRejectedValue(new Error('ASSET_MEDIA_BUSY'));
    expect((await upload(request('upload'))).status).toBe(503);
  });
  it.each([
    ['DOCUMENT_FORBIDDEN', 403], ['DOCUMENT_MEDIA_SOURCE_FORBIDDEN', 403], ['DOCUMENT_DISABLED', 503],
    ['DOCUMENT_PROJECT_NOT_ENABLED', 503], ['DOCUMENT_MEDIA_BUSY', 503], ['DOCUMENT_MEDIA_CONFLICT', 409],
    ['DOCUMENT_ASSET_COMMAND_CONFLICT', 409], ['DOCUMENT_MEDIA_INVALID', 400], ['DOCUMENT_MEDIA_TOO_LARGE', 413],
    ['DOCUMENT_MEDIA_CANCELLED', 400], ['UNKNOWN', 500],
  ] as const)('maps %s without leaking source or credentials', async (code, status): Promise<void> => {
    for (const execute of [mocks.upload, mocks.adopt]) execute.mockRejectedValue(Object.assign(new Error('https://source.example/private?token=secret'), { code }));
    for (const mode of ['upload', 'adopt'] as const) {
      const response = await (mode === 'upload' ? upload(request(mode)) : adopt(request(mode)));
      expect(response.status).toBe(status); expect(await response.text()).not.toContain('secret');
    }
  });
});
