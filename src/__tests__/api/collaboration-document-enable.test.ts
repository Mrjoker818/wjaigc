import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  enableCollaborativeProject: vi.fn(),
  readDocumentOwnerStatus: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/collaboration/document-project-bridge', () => ({
  enableCollaborativeProject: mocks.enableCollaborativeProject,
}));
vi.mock('@/lib/collaboration/document-owner-status', () => ({ readDocumentOwnerStatus: mocks.readDocumentOwnerStatus }));

import { POST } from '@/app/api/collaboration/document-enable/route';
import * as enableRoute from '@/app/api/collaboration/document-enable/route';

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/collaboration/document-enable', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

describe('collaborative document enable route', () => {
  beforeEach(() => {
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    mocks.getSessionUser.mockReset().mockResolvedValue({ id: 'owner-a' });
    mocks.enableCollaborativeProject.mockReset().mockResolvedValue(undefined);
    mocks.readDocumentOwnerStatus.mockReset().mockResolvedValue({
      projectId: 'project-a', featureEnabled: true, enabled: false, currentRevision: 7,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('enables only the authenticated owner project at the supplied revision', async () => {
    const response = await POST(request({ projectId: 'project-a', expectedRevision: 7 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, projectId: 'project-a' });
    expect(mocks.enableCollaborativeProject).toHaveBeenCalledWith('owner-a', 'project-a', 7);
  });

  it('does not enable projects when the feature flag is off', async () => {
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    const response = await POST(request({ projectId: 'project-a', expectedRevision: 7 }));
    expect(response.status).toBe(503);
    expect(mocks.enableCollaborativeProject).not.toHaveBeenCalled();
  });

  it('offers a read-only owner status endpoint independently of the enable mutation', async () => {
    const route = enableRoute as typeof enableRoute & {
      GET?: (request: NextRequest) => Promise<Response>;
    };
    expect(route.GET, 'owner status must be readable without submitting an enable mutation')
      .toBeTypeOf('function');
    if (!route.GET) return;
    const response = await route.GET(new NextRequest(
      'http://localhost/api/collaboration/document-enable?projectId=project-a',
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(mocks.enableCollaborativeProject).not.toHaveBeenCalled();
  });

  it('returns a revision conflict without enabling at a guessed revision', async () => {
    mocks.enableCollaborativeProject.mockRejectedValue(Object.assign(
      new Error('Canvas project snapshot is stale'),
      { code: 'DOCUMENT_PROJECT_REVISION_CONFLICT', currentRevision: 8 },
    ));
    const response = await POST(request({ projectId: 'project-a', expectedRevision: 7 }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false, code: 'DOCUMENT_PROJECT_REVISION_CONFLICT', currentRevision: 8,
    });
  });

  it.each(['', '?projectId=', '?projectId=project-a&projectId=project-b',
    '?projectId=project-a&ownerId=other', '?other=project-a'])
    ('rejects malformed status query %s before reading a project', async query => {
      const response = await enableRoute.GET(new NextRequest(`http://localhost/api/collaboration/document-enable${query}`));
      expect(response.status).toBe(400);
      expect(mocks.readDocumentOwnerStatus).not.toHaveBeenCalled();
    });

  it('requires authentication even when status is read-only', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await enableRoute.GET(new NextRequest('http://localhost/api/collaboration/document-enable?projectId=project-a'));
    expect(response.status).toBe(401);
    expect(mocks.readDocumentOwnerStatus).not.toHaveBeenCalled();
  });

  it.each([['DOCUMENT_FORBIDDEN', 403], ['DOCUMENT_AUTHORITY_CONFLICT', 409], ['unexpected', 500]] as const)
    ('preserves status failure %s rather than reporting disabled', async (code, status) => {
      mocks.readDocumentOwnerStatus.mockRejectedValue(Object.assign(new Error('private detail'), { code }));
      const response = await enableRoute.GET(new NextRequest('http://localhost/api/collaboration/document-enable?projectId=project-a'));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ success: false, code: status === 500 ? 'DOCUMENT_INTERNAL_ERROR' : code });
    });

  it('rejects invalid requests before entering the enable transaction', async () => {
    const response = await POST(request({ projectId: 'project-a', expectedRevision: -1 }));
    expect(response.status).toBe(400);
    expect(mocks.enableCollaborativeProject).not.toHaveBeenCalled();
  });
});
