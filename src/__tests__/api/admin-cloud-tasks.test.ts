import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  listCloudTasks: vi.fn(),
  getCloudTaskProviderSummary: vi.fn(),
  getApiProviders: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/cloud-task-storage', () => ({
  listCloudTasks: mocks.listCloudTasks,
  getCloudTaskProviderSummary: mocks.getCloudTaskProviderSummary,
}));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: mocks.getApiProviders }));

import { GET } from '@/app/api/admin/cloud-tasks/route';

describe('admin cloud task monitor', () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.listCloudTasks.mockResolvedValue([{ id: 'task-1', providerId: 'provider-1', status: 'completed' }]);
    mocks.getApiProviders.mockResolvedValue([{ id: 'provider-1', name: 'internal-name', displayName: 'Production Images' }]);
  });

  it('returns the configured provider display name with each task', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/cloud-tasks?limit=1'));
    const payload = await response.json();

    expect(payload.tasks[0]).toMatchObject({ providerId: 'provider-1', providerName: 'Production Images' });
  });
});
