import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getProductionAuthConfigurationIssues: vi.fn(),
  getProductionPaymentConfigurationIssues: vi.fn(),
  getTaskEventTransportReadinessIssue: vi.fn(),
  getApiProviders: vi.fn(),
  ensureCloudTaskTables: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: mocks.requireAdminUser,
  getProductionAuthConfigurationIssues: mocks.getProductionAuthConfigurationIssues,
}));
vi.mock('@/lib/payment-config', () => ({
  getProductionPaymentConfigurationIssues: mocks.getProductionPaymentConfigurationIssues,
}));
vi.mock('@/lib/task-event-transport', () => ({
  getTaskEventTransportReadinessIssue: mocks.getTaskEventTransportReadinessIssue,
}));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: mocks.getApiProviders }));
vi.mock('@/lib/cloud-task-storage', () => ({ ensureCloudTaskTables: mocks.ensureCloudTaskTables }));

import { GET } from '@/app/api/admin/production-readiness/route';

const request = () => new NextRequest('http://localhost/api/admin/production-readiness');

describe('GET /api/admin/production-readiness', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getProductionAuthConfigurationIssues.mockReturnValue([]);
    mocks.getProductionPaymentConfigurationIssues.mockReturnValue([]);
    mocks.getTaskEventTransportReadinessIssue.mockReturnValue(null);
    delete process.env.COZE_PROJECT_ENV;
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.WUJIE_ADMIN_PASSWORD;
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

  it('fails production readiness when authentication secrets are missing', async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.ensureCloudTaskTables.mockResolvedValue(undefined);
    mocks.getApiProviders.mockResolvedValue([]);
    mocks.getProductionAuthConfigurationIssues.mockReturnValue([
      'Missing WUJIE_AUTH_SECRET or NEXTAUTH_SECRET',
      'Missing WUJIE_ADMIN_PASSWORD',
    ]);

    const response = await GET(request());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.security).toEqual({
      status: 'fail',
      issues: expect.arrayContaining([
        'Missing WUJIE_AUTH_SECRET or NEXTAUTH_SECRET',
        'Missing WUJIE_ADMIN_PASSWORD',
      ]),
    });
  });

  it('reports a missing payment token secret as a production security failure', async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.ensureCloudTaskTables.mockResolvedValue(undefined);
    mocks.getApiProviders.mockResolvedValue([]);
    mocks.getProductionPaymentConfigurationIssues.mockReturnValue([
      'Missing PAYMENT_TOKEN_SECRET',
    ]);

    const response = await GET(request());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.security).toEqual({
      status: 'fail',
      issues: ['Missing PAYMENT_TOKEN_SECRET'],
    });
  });

  it('reports persistent-polling task event transport as a non-blocking warning', async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.ensureCloudTaskTables.mockResolvedValue(undefined);
    mocks.getApiProviders.mockResolvedValue([]);
    mocks.getTaskEventTransportReadinessIssue.mockReturnValue('Shared task event backend is not configured; clients use durable task polling across instances.');

    const data = await (await GET(request())).json();

    expect(data.success).toBe(true);
    expect(data.taskEvents).toEqual({ status: 'warn', issue: expect.stringContaining('durable task polling') });
  });
});
