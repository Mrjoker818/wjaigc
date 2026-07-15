import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  subscribeToTaskEvents: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/task-registry', () => ({ subscribeToTaskEvents: mocks.subscribeToTaskEvents }));

import { GET } from '@/app/api/task-events/route';

describe('GET /api/task-events', () => {
  it('rejects an unauthenticated caller even when it supplies another user ID in the URL', async () => {
    const rejected = new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 });
    mocks.requireApiAuthOrReject.mockResolvedValue(rejected);

    const response = await GET(new NextRequest('http://localhost/api/task-events?userId=admin_mr_joker'));

    expect(response.status).toBe(401);
    expect(mocks.subscribeToTaskEvents).not.toHaveBeenCalled();
  });
});
