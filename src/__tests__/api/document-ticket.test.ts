import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  issueDocumentTicket: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/collaboration/document-tickets', () => ({
  issueDocumentTicket: mocks.issueDocumentTicket,
}));

function request(options: { origin?: string; body?: unknown; query?: string } = {}): NextRequest {
  const url = new URL('http://localhost:5000/api/collaboration/document-ticket');
  if (options.query) url.search = options.query;
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      ...(options.origin ? { Origin: options.origin } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

describe('/api/collaboration/document-ticket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    mocks.getSessionUser.mockResolvedValue({ id: 'editor-a' });
    mocks.issueDocumentTicket.mockResolvedValue('a'.repeat(43));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not issue while the document feature is disabled or the user is anonymous', async () => {
    const { POST } = await import('@/app/api/collaboration/document-ticket/route');
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    expect((await POST(request({ origin: 'http://localhost:5000', body: { projectId: 'project-a' } }))).status)
      .toBe(503);
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await POST(request({ origin: 'http://localhost:5000', body: { projectId: 'project-a' } }))).status)
      .toBe(401);
    expect(mocks.issueDocumentTicket).not.toHaveBeenCalled();
  });

  it('rejects cross-origin, URL credentials and client-supplied identity', async () => {
    const { POST } = await import('@/app/api/collaboration/document-ticket/route');
    expect((await POST(request({ origin: 'https://other.example', body: { projectId: 'project-a' } }))).status)
      .toBe(403);
    expect((await POST(request({ origin: 'http://localhost:5000', body: { projectId: 'project-a' }, query: '?token=x' }))).status)
      .toBe(400);
    expect((await POST(request({ origin: 'http://localhost:5000', body: { projectId: 'project-a', userId: 'owner-a' } }))).status)
      .toBe(400);
    expect(mocks.issueDocumentTicket).not.toHaveBeenCalled();
  });

  it('issues only for the session identity and returns a private uncached ticket', async () => {
    const { POST } = await import('@/app/api/collaboration/document-ticket/route');
    const response = await POST(request({ origin: 'http://localhost:5000', body: { projectId: 'project-a' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ticket: 'a'.repeat(43) });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(JSON.stringify([...response.headers])).not.toContain('a'.repeat(43));
    expect(mocks.issueDocumentTicket).toHaveBeenCalledWith('editor-a', 'project-a');
  });

  it('hides permission and database details', async () => {
    const { POST } = await import('@/app/api/collaboration/document-ticket/route');
    mocks.issueDocumentTicket.mockRejectedValueOnce({ code: 'DOCUMENT_TICKET_LIMIT' });
    const limited = await POST(request({ origin: 'http://localhost:5000', body: { projectId: 'project-a' } }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ success: false, code: 'DOCUMENT_TICKET_LIMIT' });
    mocks.issueDocumentTicket.mockRejectedValueOnce({ code: 'DOCUMENT_FORBIDDEN' });
    const forbidden = await POST(request({ origin: 'http://localhost:5000', body: { projectId: 'project-a' } }));
    expect(forbidden.status).toBe(403);
    mocks.issueDocumentTicket.mockRejectedValueOnce(new Error('database secret'));
    const failed = await POST(request({ origin: 'http://localhost:5000', body: { projectId: 'project-a' } }));
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('database secret');
  });

  it('reports that an authorized project has not yet enabled document collaboration', async () => {
    const { POST } = await import('@/app/api/collaboration/document-ticket/route');
    mocks.issueDocumentTicket.mockRejectedValueOnce({ code: 'DOCUMENT_PROJECT_NOT_ENABLED' });
    const response = await POST(request({ origin: 'http://localhost:5000', body: { projectId: 'project-a' } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' });
  });
});
