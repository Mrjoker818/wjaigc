import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  enableCollaborativeProject: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/collaboration/document-project-bridge', () => ({
  enableCollaborativeProject: mocks.enableCollaborativeProject,
}));

import { POST } from '@/app/api/collaboration/document-enable/route';

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

  it('rejects invalid requests before entering the enable transaction', async () => {
    const response = await POST(request({ projectId: 'project-a', expectedRevision: -1 }));
    expect(response.status).toBe(400);
    expect(mocks.enableCollaborativeProject).not.toHaveBeenCalled();
  });
});
