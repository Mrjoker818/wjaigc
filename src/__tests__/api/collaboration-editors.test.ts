import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  grantDocumentEditor: vi.fn(),
  grantDocumentEditorByName: vi.fn(),
  revokeDocumentEditor: vi.fn(),
  listDocumentEditors: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/collaboration/document-access', () => ({
  grantDocumentEditor: mocks.grantDocumentEditor,
  grantDocumentEditorByName: mocks.grantDocumentEditorByName,
  revokeDocumentEditor: mocks.revokeDocumentEditor,
  listDocumentEditors: mocks.listDocumentEditors,
}));

function editorRequest(method: 'GET' | 'POST' | 'DELETE', options: {
  origin?: string;
  body?: Record<string, unknown>;
  projectId?: string;
} = {}): NextRequest {
  const url = new URL('http://localhost:5000/api/collaboration/editors');
  if (options.projectId) url.searchParams.set('projectId', options.projectId);
  return new NextRequest(url, {
    method,
    headers: {
      ...(options.origin ? { Origin: options.origin } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

describe('/api/collaboration/editors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-a' });
    mocks.listDocumentEditors.mockResolvedValue([{ userId: 'editor-a', name: 'Editor A' }]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('invites by exact account name without using the legacy ID grant', async () => {
    const { POST } = await import('@/app/api/collaboration/editors/route');
    const result = await POST(editorRequest('POST', { origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberName: 'Editor A' } }));
    expect(result.status).toBe(200);
    expect(mocks.grantDocumentEditorByName).toHaveBeenCalledWith('owner-a', 'project-a', 'Editor A');
    expect(mocks.grantDocumentEditor).not.toHaveBeenCalled();
  });

  it.each([
    { memberName: 'Editor A', memberUserId: 'editor-a' },
    { memberName: '' }, { memberName: 'Editor A', ownerId: 'other' },
  ])('rejects invalid name invitation %j', async fields => {
    const { POST } = await import('@/app/api/collaboration/editors/route');
    const result = await POST(editorRequest('POST', { origin: 'http://localhost:5000',
      body: { projectId: 'project-a', ...fields } }));
    expect(result.status).toBe(400);
    expect(mocks.grantDocumentEditorByName).not.toHaveBeenCalled();
    expect(mocks.grantDocumentEditor).not.toHaveBeenCalled();
  });

  it('keeps document editor management disabled by default', async () => {
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    const { POST } = await import('@/app/api/collaboration/editors/route');
    const result = await POST(editorRequest('POST', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'editor-a' },
    }));
    expect(result.status).toBe(503);
    expect(mocks.grantDocumentEditor).not.toHaveBeenCalled();
  });

  it('rejects anonymous reads and writes', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const { GET, POST } = await import('@/app/api/collaboration/editors/route');
    const read = await GET(editorRequest('GET', { projectId: 'project-a' }));
    const write = await POST(editorRequest('POST', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'editor-a' },
    }));
    expect(read.status).toBe(401);
    expect(write.status).toBe(401);
    expect(mocks.listDocumentEditors).not.toHaveBeenCalled();
    expect(mocks.grantDocumentEditor).not.toHaveBeenCalled();
  });

  it('lists only the authorized project editors with private uncached response', async () => {
    const { GET } = await import('@/app/api/collaboration/editors/route');
    const result = await GET(editorRequest('GET', { projectId: 'project-a' }));
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Vary')).toBe('Cookie');
    expect(mocks.listDocumentEditors).toHaveBeenCalledWith('owner-a', 'project-a');
    expect(await result.json()).toEqual({
      success: true,
      editors: [{ userId: 'editor-a', name: 'Editor A' }],
    });
  });

  it('rejects cross-origin grants before changing the editor list', async () => {
    const { POST } = await import('@/app/api/collaboration/editors/route');
    const result = await POST(editorRequest('POST', {
      origin: 'https://other.example',
      body: { projectId: 'project-a', memberUserId: 'editor-a' },
    }));
    expect(result.status).toBe(403);
    expect(mocks.grantDocumentEditor).not.toHaveBeenCalled();
  });

  it('uses the session identity and refuses a client-supplied owner', async () => {
    const { POST } = await import('@/app/api/collaboration/editors/route');
    const invalid = await POST(editorRequest('POST', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'editor-a', ownerId: 'owner-b' },
    }));
    expect(invalid.status).toBe(400);
    expect(mocks.grantDocumentEditor).not.toHaveBeenCalled();
    const valid = await POST(editorRequest('POST', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'editor-a' },
    }));
    expect(valid.status).toBe(200);
    expect(mocks.grantDocumentEditor).toHaveBeenCalledWith('owner-a', 'project-a', 'editor-a');
    expect(await valid.json()).toEqual({ success: true });
  });

  it('returns a nondisclosing forbidden response for non-owner access', async () => {
    mocks.grantDocumentEditor.mockRejectedValue({ code: 'DOCUMENT_FORBIDDEN' });
    const { POST } = await import('@/app/api/collaboration/editors/route');
    const result = await POST(editorRequest('POST', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'editor-a' },
    }));
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ success: false, code: 'DOCUMENT_FORBIDDEN' });
  });

  it('revokes only the requested editor under the signed-in owner', async () => {
    const { DELETE } = await import('@/app/api/collaboration/editors/route');
    const result = await DELETE(editorRequest('DELETE', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'editor-a' },
    }));
    expect(result.status).toBe(200);
    expect(mocks.revokeDocumentEditor).toHaveBeenCalledWith('owner-a', 'project-a', 'editor-a');
  });
});
