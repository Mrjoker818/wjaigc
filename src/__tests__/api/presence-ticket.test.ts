import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  issuePresenceTicket: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/collaboration/presence-tickets', () => ({
  issuePresenceTicket: mocks.issuePresenceTicket,
}));

function ticketRequest(options: {
  origin?: string;
  body?: unknown;
  contentType?: string;
  query?: string;
} = {}): NextRequest {
  const url = new URL('http://localhost:5000/api/collaboration/presence-ticket');
  if (options.query) url.search = options.query;
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      ...(options.origin ? { Origin: options.origin } : {}),
      ...(options.body !== undefined
        ? { 'Content-Type': options.contentType ?? 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

describe('/api/collaboration/presence-ticket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    mocks.getSessionUser.mockResolvedValue({ id: 'member-a' });
    mocks.issuePresenceTicket.mockResolvedValue('a'.repeat(43));
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(['true', 'false', undefined])('reports authenticated availability without issuing a ticket: %s', async flag => {
    if (flag === undefined) delete process.env.WUJIE_PRESENCE_ENABLED;
    else vi.stubEnv('WUJIE_PRESENCE_ENABLED', flag);
    const { GET } = await import('@/app/api/collaboration/presence-ticket/route');
    const result = await GET(new NextRequest('http://localhost:5000/api/collaboration/presence-ticket'));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ success: true, enabled: flag === 'true' });
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Vary')).toBe('Cookie');
    expect(mocks.issuePresenceTicket).not.toHaveBeenCalled();
  });

  it('does not expose availability to a signed-out caller', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/collaboration/presence-ticket/route');
    const result = await GET(new NextRequest('http://localhost:5000/api/collaboration/presence-ticket'));
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ success: false, code: 'AUTHENTICATION_REQUIRED' });
    expect(mocks.issuePresenceTicket).not.toHaveBeenCalled();
  });

  it('rejects all query data on availability reads', async () => {
    const { GET } = await import('@/app/api/collaboration/presence-ticket/route');
    const result = await GET(new NextRequest('http://localhost:5000/api/collaboration/presence-ticket?ticket=forbidden'));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ success: false, code: 'PRESENCE_REQUEST_INVALID' });
    expect(mocks.issuePresenceTicket).not.toHaveBeenCalled();
  });

  it('keeps issuance disabled unless the presence flag is true', async () => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'false');
    const { POST } = await import('@/app/api/collaboration/presence-ticket/route');
    const response = await POST(ticketRequest({
      origin: 'http://localhost:5000', body: { projectId: 'project-a' },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, code: 'PRESENCE_DISABLED' });
    expect(mocks.issuePresenceTicket).not.toHaveBeenCalled();
  });

  it('requires a signed-in member', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/collaboration/presence-ticket/route');
    const response = await POST(ticketRequest({
      origin: 'http://localhost:5000', body: { projectId: 'project-a' },
    }));
    expect(response.status).toBe(401);
    expect(mocks.issuePresenceTicket).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin request before issuing a ticket', async () => {
    const { POST } = await import('@/app/api/collaboration/presence-ticket/route');
    const response = await POST(ticketRequest({
      origin: 'https://other.example', body: { projectId: 'project-a' },
    }));
    expect(response.status).toBe(403);
    expect(mocks.issuePresenceTicket).not.toHaveBeenCalled();
  });

  it('requires an Origin and JSON content type', async () => {
    const { POST } = await import('@/app/api/collaboration/presence-ticket/route');
    const missingOrigin = await POST(ticketRequest({ body: { projectId: 'project-a' } }));
    expect(missingOrigin.status).toBe(403);
    const wrongType = await POST(ticketRequest({
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a' },
      contentType: 'text/plain',
    }));
    expect(wrongType.status).toBe(415);
    expect(mocks.issuePresenceTicket).not.toHaveBeenCalled();
  });

  it('rejects a ticket or other data in the URL rather than accepting query credentials', async () => {
    const { POST } = await import('@/app/api/collaboration/presence-ticket/route');
    const response = await POST(ticketRequest({
      origin: 'http://localhost:5000',
      body: { projectId: 'project-a' },
      query: '?ticket=not-for-urls',
    }));
    expect(response.status).toBe(400);
    expect(mocks.issuePresenceTicket).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON and client-supplied identity', async () => {
    const { POST } = await import('@/app/api/collaboration/presence-ticket/route');
    for (const body of [
      { projectId: '' },
      { projectId: 'project-a', userId: 'owner-b' },
      { projectId: 'project-a', ownerId: 'owner-b' },
    ]) {
      const response = await POST(ticketRequest({ origin: 'http://localhost:5000', body }));
      expect(response.status).toBe(400);
    }
    const malformed = new NextRequest('http://localhost:5000/api/collaboration/presence-ticket', {
      method: 'POST',
      headers: { Origin: 'http://localhost:5000', 'Content-Type': 'application/json' },
      body: '{"projectId":',
    });
    expect((await POST(malformed)).status).toBe(400);
    expect(mocks.issuePresenceTicket).not.toHaveBeenCalled();
  });

  it('returns only a no-store body ticket bound to the session and project', async () => {
    const { POST } = await import('@/app/api/collaboration/presence-ticket/route');
    const response = await POST(ticketRequest({
      origin: 'http://localhost:5000', body: { projectId: 'project-a' },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ticket: 'a'.repeat(43) });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(JSON.stringify([...response.headers])).not.toContain('a'.repeat(43));
    expect(mocks.issuePresenceTicket).toHaveBeenCalledWith('member-a', 'project-a');
  });

  it('hides membership denial and unexpected errors without leaking a ticket', async () => {
    const { POST } = await import('@/app/api/collaboration/presence-ticket/route');
    mocks.issuePresenceTicket.mockRejectedValueOnce({ code: 'PRESENCE_FORBIDDEN' });
    const forbidden = await POST(ticketRequest({
      origin: 'http://localhost:5000', body: { projectId: 'project-a' },
    }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ success: false, code: 'PRESENCE_FORBIDDEN' });

    mocks.issuePresenceTicket.mockRejectedValueOnce(new Error('secret database detail'));
    const failed = await POST(ticketRequest({
      origin: 'http://localhost:5000', body: { projectId: 'project-a' },
    }));
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('secret database detail');
  });
});
