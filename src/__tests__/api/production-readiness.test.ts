import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getApiProviders: vi.fn(),
  ensureCloudTaskTables: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: mocks.getApiProviders }));
vi.mock('@/lib/cloud-task-storage', () => ({ ensureCloudTaskTables: mocks.ensureCloudTaskTables }));

import { GET } from '@/app/api/admin/production-readiness/route';

const request = () => new NextRequest('http://localhost/api/admin/production-readiness');

describe('GET /api/admin/production-readiness', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
  });

  it('rejects non-admin callers before reading cloud configuration', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.getApiProviders).not.toHaveBeenCalled();
    expect(mocks.ensureCloudTaskTables).not.toHaveBeenCalled();
  });

  it('reports database and enabled provider configuration without returning credentials', async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.ensureCloudTaskTables.mockResolvedValue(undefined);
    mocks.getApiProviders.mockResolvedValue([
      { id: 'image-ok', name: 'Image API', modelType: 'image', isEnabled: true, baseUrl: 'https://image.example/v1', apiKey: 'private-key', selectedModels: ['image-model'] },
      { id: 'video-no-model', name: 'Video API', modelType: 'video', isEnabled: true, baseUrl: 'https://video.example/v1', apiKey: 'private-key', selectedModels: [] },
      { id: 'disabled', name: 'Disabled API', modelType: 'chat', isEnabled: false, baseUrl: '', apiKey: '', selectedModels: [] },
    ]);

    const response = await GET(request());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.database.status).toBe('pass');
    expect(data.summary).toEqual({ total: 3, enabled: 2, ready: 1, warnings: 1, failures: 0 });
    expect(data.providers).toEqual([
      { id: 'image-ok', name: 'Image API', modelType: 'image', status: 'pass', issues: [] },
      { id: 'video-no-model', name: 'Video API', modelType: 'video', status: 'warn', issues: ['No selected model'] },
    ]);
    expect(JSON.stringify(data)).not.toContain('private-key');
  });
});
