import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn() }));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));

import { GET } from '@/app/api/workflow/save/route';

describe('GET /api/workflow/save', () => {
  beforeEach(() => {
    mocks.getSessionUser.mockReset();
    vi.restoreAllMocks();
  });

  it('rejects unauthenticated workflow reads before accessing user data', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const response = await GET(new NextRequest('http://localhost/api/workflow/save'));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads workflows only for the authenticated user', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    const response = await GET(new NextRequest('http://localhost/api/workflow/save?userId=other-user'));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the authenticated user ID when loading their workflow list', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    const response = await GET(new NextRequest('http://localhost/api/workflow/save'));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('userId=owner-1'));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('prefix=workflow_'));
  });
});
