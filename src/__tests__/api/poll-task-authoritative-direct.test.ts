import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getTaskInfo: vi.fn(),
  isTaskCancelled: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  claimCloudTaskLease: vi.fn(),
  registerTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  findProviderForModel: vi.fn(),
  findProviderById: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock('@/lib/task-registry', () => ({
  getTaskInfo: mocks.getTaskInfo,
  isTaskCancelled: mocks.isTaskCancelled,
  registerTask: mocks.registerTask,
  registerTaskAbortController: vi.fn(),
  releaseQueueSlot: vi.fn(),
  unregisterTaskAbortController: vi.fn(),
  updateTaskProgress: mocks.updateTaskProgress,
}));

vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: mocks.getCloudTaskForUser,
  claimCloudTaskLease: mocks.claimCloudTaskLease,
  completeCloudTask: vi.fn(),
  refundCloudTaskCredits: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
  updateCloudTask: vi.fn(),
}));

vi.mock('@/lib/cloud-task-persistence', () => ({
  buildRecoveredTaskContext: vi.fn(),
  recordImageTaskTerminal: vi.fn(),
  recordVideoTaskTerminal: vi.fn(),
}));

vi.mock('@/lib/server-api-config', () => ({
  findProviderForModel: mocks.findProviderForModel,
  findProviderById: mocks.findProviderById,
  normalizeApiBaseUrl: (value: string) => value,
}));

vi.mock('@/lib/model-capabilities', () => ({
  normalizeModelForApi: (model: string) => ({
    apiModelName: model,
    wasNormalized: false,
  }),
}));

vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ getInternalRequestHeaders: vi.fn() }));
vi.mock('@/lib/remove-bg-postprocess', () => ({ postProcessAIRemoveBG: vi.fn() }));
vi.mock('@/lib/fetch-image-buffer', () => ({ fetchImageBuffer: vi.fn() }));
vi.mock('@/lib/image-tools/masked-edit-composite', () => ({ compositeMaskedEdit: vi.fn() }));
vi.mock('@/lib/edit-task-store', () => ({
  getEditTask: vi.fn(),
  deleteEditTask: vi.fn(),
  setEditTask: vi.fn(),
  failEditTask: vi.fn(),
}));
vi.mock('@/app/api/refine-engine/route', () => ({ getRefineResult: vi.fn() }));
vi.mock('@/app/api/brand-ecommerce/route', () => ({ getBrandResult: vi.fn() }));
vi.mock('@/app/api/font-design/generate-image/route', () => ({ getFontDesignResult: vi.fn() }));
vi.mock('@/lib/quality-enhance', () => ({ enhanceViaAI: vi.fn() }));
vi.mock('@/lib/layer-decomposition/service', () => ({ getLayerTaskStatus: vi.fn() }));

import { POST } from '@/app/api/poll-task/route';

describe('poll-task authoritative direct recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue(undefined);
    mocks.isTaskCancelled.mockReturnValue(false);
  });

  it('returns a completed durable direct snapshot without rebuilding or remotely polling it', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'direct-task',
      userId: 'user-a',
      type: 'generate',
      status: 'completed',
      progress: 100,
      result: {
        imageUrl: '/authoritative.png',
        imageUrls: ['/authoritative.png'],
      },
      createdAt: 1,
      updatedAt: 2,
      revision: 2,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const request = new Request('http://localhost/api/poll-task', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId: 'direct-task',
        model: 'image-model',
      }),
    });

    const response = await POST(request as NextRequest);
    const payload = await response.json();

    expect(payload).toMatchObject({
      success: true,
      status: 'completed',
      progress: 100,
      imageUrl: '/authoritative.png',
      imageUrls: ['/authoritative.png'],
    });
    expect(mocks.getTaskInfo).toHaveBeenCalledWith('direct-task');
    expect(mocks.registerTask).not.toHaveBeenCalled();
    expect(mocks.updateTaskProgress).not.toHaveBeenCalled();
    expect(mocks.claimCloudTaskLease).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
