import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  query: vi.fn(),
  getPool: vi.fn(),
}));

mocks.getPool.mockReturnValue({ query: mocks.query });

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/db-client', () => ({ getPool: mocks.getPool }));

import { DELETE, GET } from '@/app/api/artifacts/route';

describe('artifact ownership', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getPool.mockReturnValue({ query: mocks.query });
  });

  it('rejects unauthenticated artifact reads before opening the database', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));

    const response = await GET(new NextRequest('http://localhost/api/artifacts?projectId=project-1'));

    expect(response.status).toBe(401);
    expect(mocks.getPool).not.toHaveBeenCalled();
  });

  it('filters artifact lists by the authenticated user ID', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue({ authenticated: true, userId: 'owner-1', userRole: 'user' });
    mocks.query.mockResolvedValue({ rows: [] });

    const response = await GET(new NextRequest('http://localhost/api/artifacts?projectId=project-1'));

    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.stringContaining('project_id = $1 AND user_id = $2'),
      ['project-1', 'owner-1'],
    );
  });

  it('does not delete an artifact that is not owned by the authenticated user', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue({ authenticated: true, userId: 'owner-1', userRole: 'user' });
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const response = await DELETE(new NextRequest('http://localhost/api/artifacts?id=foreign-artifact', { method: 'DELETE' }));

    expect(response.status).toBe(404);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND user_id = $2'),
      ['foreign-artifact', 'owner-1'],
    );
  });
});
