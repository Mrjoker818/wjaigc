import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbGetUserData: vi.fn(),
  dbListUserData: vi.fn(),
  dbSetUserData: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/db-storage', () => ({
  dbGetUserData: mocks.dbGetUserData,
  dbListUserData: mocks.dbListUserData,
  dbSetUserData: mocks.dbSetUserData,
}));

import { GET, POST } from '@/app/api/workflow/save/route';

describe('GET /api/workflow/save', () => {
  beforeEach(() => {
    mocks.getSessionUser.mockReset();
    mocks.dbGetUserData.mockReset();
    mocks.dbListUserData.mockReset();
    mocks.dbSetUserData.mockReset();
  });

  it('rejects unauthenticated workflow reads before accessing user data', async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new NextRequest('http://localhost/api/workflow/save'));

    expect(response.status).toBe(401);
    expect(mocks.dbListUserData).not.toHaveBeenCalled();
  });

  it('loads workflows only for the authenticated user', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });

    const response = await GET(new NextRequest('http://localhost/api/workflow/save?userId=other-user'));

    expect(response.status).toBe(403);
    expect(mocks.dbListUserData).not.toHaveBeenCalled();
  });

  it('loads only workflow records for the authenticated user from direct storage', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });
    mocks.dbListUserData.mockResolvedValue([{ dataKey: 'workflow_a', updatedAt: 1 }, { dataKey: 'projects', updatedAt: 2 }]);
    mocks.dbGetUserData.mockResolvedValue({ id: 'a', name: 'Saved workflow' });

    const response = await GET(new NextRequest('http://localhost/api/workflow/save'));

    expect(response.status).toBe(200);
    expect(mocks.dbListUserData).toHaveBeenCalledWith('owner-1');
    expect(mocks.dbGetUserData).toHaveBeenCalledWith('owner-1', 'workflow_a');
    await expect(response.json()).resolves.toEqual({ workflows: [{ id: 'a', name: 'Saved workflow' }] });
  });

  it('saves a workflow through direct storage instead of a fixed localhost port', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });
    mocks.dbSetUserData.mockResolvedValue(true);

    const response = await POST(new NextRequest('http://localhost/api/workflow/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'owner-1', workflow: { id: 'workflow-a', name: 'Draft' } }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.dbSetUserData).toHaveBeenCalledWith('owner-1', 'workflow_workflow-a', expect.objectContaining({ id: 'workflow-a' }));
  });
});
