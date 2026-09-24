import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  grantPresenceMember: vi.fn(),
  revokePresenceMember: vi.fn(),
  listPresenceMembers: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/collaboration/presence-members', () => ({
  grantPresenceMember: mocks.grantPresenceMember,
  revokePresenceMember: mocks.revokePresenceMember,
  listPresenceMembers: mocks.listPresenceMembers,
}));

function memberRequest(method: 'GET' | 'POST' | 'DELETE', options: {
  origin?: string;
  body?: Record<string, unknown>;
  projectId?: string;
} = {}): NextRequest {
  const url = new URL('http://localhost:5000/api/collaboration/members');
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

describe('/api/collaboration/members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-a' });
    mocks.listPresenceMembers.mockResolvedValue([{ userId: 'member-a', name: 'Member A' }]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('keeps member management disabled by default', async () => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'false');
    const { POST } = await import('@/app/api/collaboration/members/route');
    const response = await POST(memberRequest('POST', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'member-a' },
    }));
    expect(response.status).toBe(503);
    expect(mocks.grantPresenceMember).not.toHaveBeenCalled();
  });

  it('requires a signed-in session before listing members', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/collaboration/members/route');
    const response = await GET(memberRequest('GET', { projectId: 'project-a' }));
    expect(response.status).toBe(401);
    expect(mocks.listPresenceMembers).not.toHaveBeenCalled();
  });

  it('lists only members returned for the session owner and requested project', async () => {
    const { GET } = await import('@/app/api/collaboration/members/route');
    const response = await GET(memberRequest('GET', { projectId: 'project-a' }));
    expect(response.status).toBe(200);
    expect(mocks.listPresenceMembers).toHaveBeenCalledWith('owner-a', 'project-a');
    expect(await response.json()).toEqual({
      success: true,
      members: [{ userId: 'member-a', name: 'Member A' }],
    });
  });

  it('rejects cross-origin invitation without changing membership', async () => {
    const { POST } = await import('@/app/api/collaboration/members/route');
    const response = await POST(memberRequest('POST', {
      origin: 'https://other.example',
      body: { projectId: 'project-a', memberUserId: 'member-a' },
    }));
    expect(response.status).toBe(403);
    expect(mocks.grantPresenceMember).not.toHaveBeenCalled();
  });

  it('uses the session owner identity for invitations and omits private data', async () => {
    const { POST } = await import('@/app/api/collaboration/members/route');
    const response = await POST(memberRequest('POST', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'member-a' },
    }));
    expect(response.status).toBe(200);
    expect(mocks.grantPresenceMember).toHaveBeenCalledWith('owner-a', 'project-a', 'member-a');
    expect(await response.json()).toEqual({ success: true });
  });

  it('does not accept a client-supplied owner identity', async () => {
    const { POST } = await import('@/app/api/collaboration/members/route');
    const response = await POST(memberRequest('POST', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'member-a', ownerId: 'owner-b' },
    }));
    expect(response.status).toBe(400);
    expect(mocks.grantPresenceMember).not.toHaveBeenCalled();
  });

  it('returns forbidden for a non-owner without disclosing project membership', async () => {
    mocks.grantPresenceMember.mockRejectedValue({ code: 'PRESENCE_FORBIDDEN' });
    const { POST } = await import('@/app/api/collaboration/members/route');
    const response = await POST(memberRequest('POST', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'member-a' },
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, code: 'PRESENCE_FORBIDDEN' });
  });

  it('revokes through the session owner identity', async () => {
    const { DELETE } = await import('@/app/api/collaboration/members/route');
    const response = await DELETE(memberRequest('DELETE', {
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a', memberUserId: 'member-a' },
    }));
    expect(response.status).toBe(200);
    expect(mocks.revokePresenceMember).toHaveBeenCalledWith('owner-a', 'project-a', 'member-a');
  });
});
