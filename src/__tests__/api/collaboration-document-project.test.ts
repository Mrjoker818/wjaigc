import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  readCollaborativeProject: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/collaboration/document-project-bridge', () => ({
  readCollaborativeProject: mocks.readCollaborativeProject,
}));

import { GET } from '@/app/api/collaboration/document-project/route';

describe('collaborative project read route', () => {
  beforeEach(() => {
    mocks.getSessionUser.mockReset().mockResolvedValue({ id: 'editor-a' });
    mocks.readCollaborativeProject.mockReset().mockResolvedValue({
      projectId: 'project-a', ownerId: 'owner-a', sequence: 3,
      projection: { placements: {} }, readOnly: false,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns the scoped document to the authenticated editor', async () => {
    const response = await GET(new NextRequest(
      'http://localhost/api/collaboration/document-project?projectId=project-a'
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true, projectId: 'project-a', ownerId: 'owner-a',
      sequence: 3, projection: { placements: {} }, readOnly: false,
    });
    expect(mocks.readCollaborativeProject).toHaveBeenCalledWith('editor-a', 'project-a');
  });

  it('permits a read-only response when live collaboration is disabled', async () => {
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    mocks.readCollaborativeProject.mockResolvedValue({
      projectId: 'project-a', ownerId: 'owner-a', sequence: 3,
      projection: { placements: {} }, readOnly: true,
    });
    const response = await GET(new NextRequest(
      'http://localhost/api/collaboration/document-project?projectId=project-a'
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, readOnly: true });
  });

  it('does not read a document without an authenticated account', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await GET(new NextRequest(
      'http://localhost/api/collaboration/document-project?projectId=project-a'
    ));
    expect(response.status).toBe(401);
    expect(mocks.readCollaborativeProject).not.toHaveBeenCalled();
  });

  it('does not expose a document when the project editor check fails', async () => {
    mocks.readCollaborativeProject.mockRejectedValue(Object.assign(
      new Error('forbidden'), { code: 'DOCUMENT_FORBIDDEN' },
    ));
    const response = await GET(new NextRequest(
      'http://localhost/api/collaboration/document-project?projectId=project-a'
    ));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_FORBIDDEN' });
  });

  it('distinguishes a legacy project from a broken enabled document', async () => {
    mocks.readCollaborativeProject.mockRejectedValueOnce(Object.assign(
      new Error('not enabled'), { code: 'DOCUMENT_PROJECT_NOT_ENABLED' },
    ));
    const legacy = await GET(new NextRequest(
      'http://localhost/api/collaboration/document-project?projectId=project-a'
    ));
    expect(legacy.status).toBe(409);
    expect(await legacy.json()).toEqual({ success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' });

    mocks.readCollaborativeProject.mockRejectedValueOnce(Object.assign(
      new Error('missing document'), { code: 'DOCUMENT_AUTHORITY_CONFLICT' },
    ));
    const broken = await GET(new NextRequest(
      'http://localhost/api/collaboration/document-project?projectId=project-a'
    ));
    expect(broken.status).toBe(409);
    expect(await broken.json()).toEqual({ success: false, code: 'DOCUMENT_AUTHORITY_CONFLICT' });
  });
});
