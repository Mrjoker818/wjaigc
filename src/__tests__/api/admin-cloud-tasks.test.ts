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
    mocks.listCloudTasks.mockResolvedValue([{
      id: 'task-1',
      userId: 'user-1',
      type: 'video',
      providerId: 'provider-1',
      model: 'video-actual',
      status: 'completed',
      progress: 100,
      creditStatus: 'charged',
      creditCost: 8,
      chargedTransactionId: 'charge-1',
      refundedTransactionId: '',
      createdAt: 1_000,
      updatedAt: 1_625,
      result: {
        taskError: {
          code: 'PROVIDER_REJECTED',
          message: 'Provider rejected the request',
          source: 'provider',
          retryable: false,
          requestId: 'req-task-1',
        },
        taskEntryAudit: {
          handlerVersion: 'task-core-v2-shadow',
          requestId: 'req-task-1',
          requestedProviderId: 'provider-requested',
          requestedModelId: 'video-requested',
          actualProviderId: 'provider-1',
          actualModelId: 'video-actual',
        },
      },
    }]);
    mocks.getApiProviders.mockResolvedValue([{ id: 'provider-1', name: 'internal-name', displayName: 'Production Images' }]);
  });

  it('returns the configured provider display name with each task', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/cloud-tasks?limit=1'));
    const payload = await response.json();

    expect(payload.tasks[0]).toMatchObject({ providerId: 'provider-1', providerName: 'Production Images' });
  });

  it('projects authoritative route, duration, billing, and request facts', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/cloud-tasks?limit=1'));
    const payload = await response.json();

    expect(payload.tasks[0]).toMatchObject({
      requestId: 'req-task-1',
      handlerVersion: 'task-core-v2-shadow',
      requestedProviderId: 'provider-requested',
      requestedModelId: 'video-requested',
      actualProviderId: 'provider-1',
      actualModelId: 'video-actual',
      durationMs: 625,
      billing: {
        status: 'charged',
        cost: 8,
        chargedTransactionId: 'charge-1',
        refundedTransactionId: null,
      },
      errorSource: 'provider',
    });
  });
});
