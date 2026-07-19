import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: mocks.requireAdminUser,
}));

import { GET, POST } from '@/app/api/export-project/route';

describe('project source export administrator boundary', () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockReset();
    mocks.requireAdminUser.mockResolvedValue(null);
  });

  it('rejects anonymous archive downloads before creating a full project export', async () => {
    const response = await GET(new NextRequest('http://localhost/api/export-project?scope=full'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'Admin access required' });
    expect(mocks.requireAdminUser).toHaveBeenCalledTimes(1);
  });

  it('rejects anonymous POST export requests before reading scope', async () => {
    const response = await POST(new NextRequest('http://localhost/api/export-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'full' }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'Admin access required' });
    expect(mocks.requireAdminUser).toHaveBeenCalledTimes(1);
  });
});
