import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudTask } from '@/lib/cloud-task-storage';
import type { EditableLayerAsset, LayerDecompositionRequest } from '@/lib/layer-decomposition/types';

const mocks = vi.hoisted(() => ({
  task: null as CloudTask | null,
  claimCount: 0,
  claimLayerTask: vi.fn(),
  chargeCloudTaskCredits: vi.fn(),
  claimCloudTaskLease: vi.fn(),
  completeCloudTask: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  refundCloudTaskCredits: vi.fn(),
  releaseCloudTaskLease: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
  updateCloudTask: vi.fn(),
  calculateConfiguredCreditCost: vi.fn(),
  resolveLayerProvider: vi.fn(),
  resolveLayerSourceImage: vi.fn(),
  submitPearLayerTask: vi.fn(),
  pollPearLayerTask: vi.fn(),
  downloadPearPsd: vi.fn(),
  extractEditableLayersFromPsd: vi.fn(),
  refineLayerAssets: vi.fn(),
  evaluateLayerQuality: vi.fn(),
  runLocalLayerPipeline: vi.fn(),
  saveImageFile: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({
  chargeCloudTaskCredits: mocks.chargeCloudTaskCredits,
  claimCloudTaskLease: mocks.claimCloudTaskLease,
  completeCloudTask: mocks.completeCloudTask,
  getCloudTaskForUser: mocks.getCloudTaskForUser,
  refundCloudTaskCredits: mocks.refundCloudTaskCredits,
  releaseCloudTaskLease: mocks.releaseCloudTaskLease,
  terminateCloudTaskAndRefund: mocks.terminateCloudTaskAndRefund,
  updateCloudTask: mocks.updateCloudTask,
}));

vi.mock('@/lib/credits', () => ({
  calculateConfiguredCreditCost: mocks.calculateConfiguredCreditCost,
}));

vi.mock('@/lib/layer-decomposition/idempotency', () => ({
  claimLayerTask: mocks.claimLayerTask,
  createLayerRequestHash: (value: unknown) => JSON.stringify(value),
  LayerIdempotencyConflictError: class LayerIdempotencyConflictError extends Error {
    code = 'LAYER_IDEMPOTENCY_CONFLICT';
  },
}));

vi.mock('@/lib/layer-decomposition/provider', () => ({
  resolveLayerProvider: mocks.resolveLayerProvider,
  LayerProviderError: class LayerProviderError extends Error {
    code = 'LAYER_PROVIDER_ERROR';
  },
}));

vi.mock('@/lib/layer-decomposition/pear-adapter', () => ({
  submitPearLayerTask: mocks.submitPearLayerTask,
  pollPearLayerTask: mocks.pollPearLayerTask,
  PearProtocolError: class PearProtocolError extends Error {
    code = 'PEAR_PROTOCOL_ERROR';
    retryable = false;
    status = 502;
  },
  PearSubmissionIndeterminateError: class PearSubmissionIndeterminateError extends Error {},
}));

vi.mock('@/lib/layer-decomposition/source-image', () => ({
  resolveLayerSourceImage: mocks.resolveLayerSourceImage,
  downloadPearPsd: mocks.downloadPearPsd,
}));

vi.mock('@/lib/layer-decomposition/psd-extractor', () => ({
  extractEditableLayersFromPsd: mocks.extractEditableLayersFromPsd,
}));

vi.mock('@/lib/layer-decomposition/post-process', () => ({
  refineLayerAssets: mocks.refineLayerAssets,
}));

vi.mock('@/lib/layer-decomposition/quality-gate', () => ({
  evaluateLayerQuality: mocks.evaluateLayerQuality,
}));

vi.mock('@/lib/layer-decomposition/local-pipeline', () => ({
  runLocalLayerPipeline: mocks.runLocalLayerPipeline,
}));

vi.mock('@/lib/server-data-root', () => ({
  saveImageFile: mocks.saveImageFile,
}));

import {
  cancelLayerTask,
  getLayerTaskStatus,
  submitLayerDecomposition,
} from '@/lib/layer-decomposition/service';

const request: LayerDecompositionRequest = {
  imageUrl: '/api/serve-upload/source.png',
  engine: 'smart',
  providerId: 'pear-provider',
  modelId: 'pear-layer-model',
};

const layer: EditableLayerAsset = {
  id: 'layer-1',
  name: '主体',
  role: 'subject',
  imageUrl: '/api/serve-upload/layer-1.png',
  width: 4,
  height: 4,
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
  blendMode: 'normal',
  visible: true,
  source: 'pear-psd',
};

function createTask(overrides: Partial<CloudTask> = {}): CloudTask {
  return {
    id: 'layer-task-1',
    userId: 'user-1',
    type: 'layer-decomposition',
    status: 'pending',
    providerId: request.providerId,
    model: request.modelId,
    progress: 0,
    result: { requestHash: 'hash', request },
    creditStatus: 'not-applicable',
    creditCost: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('layer decomposition service concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimCount = 0;
    mocks.task = createTask();
    mocks.claimLayerTask.mockImplementation(async () => ({
      owner: mocks.claimCount++ === 0,
      taskId: 'layer-task-1',
    }));
    mocks.getCloudTaskForUser.mockImplementation(async () => mocks.task);
    mocks.updateCloudTask.mockImplementation(async (_taskId: string, patch: Partial<CloudTask>) => {
      if (!mocks.task) return;
      mocks.task = { ...mocks.task, ...patch, updatedAt: Date.now() };
    });
    mocks.chargeCloudTaskCredits.mockImplementation(async () => {
      if (!mocks.task || mocks.task.status !== 'pending') return { charged: false, creditCost: 5 };
      mocks.task = { ...mocks.task, status: 'processing', creditStatus: 'pending', creditCost: 5 };
      return { charged: true, creditCost: 5, userId: 'user-1' };
    });
    mocks.terminateCloudTaskAndRefund.mockImplementation(async (
      _taskId: string,
      status: 'failed' | 'timeout' | 'cancelled',
      reason: string,
    ) => {
      if (!mocks.task || !['pending', 'processing'].includes(mocks.task.status)) {
        return { transitioned: false, refunded: false, creditCost: 0 };
      }
      const refunded = mocks.task.creditStatus === 'pending';
      mocks.task = {
        ...mocks.task,
        status,
        error: reason,
        creditStatus: refunded ? 'refunded' : mocks.task.creditStatus,
      };
      return { transitioned: true, refunded, creditCost: mocks.task.creditCost || 0 };
    });
    mocks.refundCloudTaskCredits.mockImplementation(async () => {
      if (!mocks.task || mocks.task.creditStatus !== 'pending') return { refunded: false, creditCost: 0 };
      mocks.task = { ...mocks.task, creditStatus: 'refunded' };
      return { refunded: true, creditCost: mocks.task.creditCost || 0 };
    });
    mocks.completeCloudTask.mockImplementation(async (_taskId: string, result: Record<string, unknown>) => {
      if (!mocks.task || mocks.task.status !== 'processing') return false;
      mocks.task = { ...mocks.task, status: 'completed', progress: 100, result };
      return true;
    });
    mocks.claimCloudTaskLease.mockResolvedValue({
      taskId: 'layer-task-1', owner: 'worker-1', expiresAt: 1000, attemptCount: 1,
    });
    mocks.releaseCloudTaskLease.mockResolvedValue(true);
    mocks.calculateConfiguredCreditCost.mockResolvedValue(5);
    mocks.resolveLayerProvider.mockResolvedValue({
      provider: { id: 'pear-provider', baseUrl: 'https://pear.example', apiKey: 'secret' },
      configuredModelId: 'pear-layer-model',
    });
    mocks.resolveLayerSourceImage.mockResolvedValue({
      buffer: Buffer.from('source'), mimeType: 'image/png', width: 4, height: 4,
    });
    mocks.submitPearLayerTask.mockResolvedValue({
      kind: 'async', remoteTaskId: 'pear-task-1', endpoint: '/v1/images/edits',
    });
    mocks.saveImageFile.mockReturnValue('/api/serve-upload/result.psd');
  });

  it('returns one task and charges and submits once for concurrent duplicate submissions', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => (
      submitLayerDecomposition({
        userId: 'user-1',
        userRole: 'user',
        idempotencyKey: 'layer-request-1',
        request,
      })
    )));

    expect(new Set(responses.map((response) => response.taskId))).toEqual(new Set(['layer-task-1']));
    expect(mocks.chargeCloudTaskCredits).toHaveBeenCalledTimes(1);
    expect(mocks.submitPearLayerTask).toHaveBeenCalledTimes(1);
  });

  it('cannot complete after cancellation wins', async () => {
    mocks.task = createTask({
      status: 'processing',
      creditStatus: 'pending',
      result: { requestHash: 'hash', request: { ...request, engine: 'local' }, phase: 'running-local-fallback' },
    });
    mocks.resolveLayerSourceImage.mockImplementation((_url: string, options: { signal?: AbortSignal }) => (
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
      })
    ));

    const statusPromise = getLayerTaskStatus({ taskId: 'layer-task-1', userId: 'user-1', userRole: 'user' });
    await vi.waitFor(() => expect(mocks.resolveLayerSourceImage).toHaveBeenCalled());
    const cancelled = await cancelLayerTask({ taskId: 'layer-task-1', userId: 'user-1', userRole: 'user' });
    const status = await statusPromise;

    expect(cancelled.status).toBe('cancelled');
    expect(status.status).toBe('cancelled');
    expect(mocks.completeCloudTask).not.toHaveBeenCalled();
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledTimes(1);
  });

  it('refunds Pear cost once then completes with local output after smart quality failure', async () => {
    mocks.task = createTask({
      status: 'processing',
      creditStatus: 'pending',
      creditCost: 5,
      result: {
        requestHash: 'hash', request, phase: 'downloading-psd', remotePsdUrl: 'https://cdn.example/result.psd',
      },
    });
    mocks.downloadPearPsd.mockResolvedValue({ buffer: Buffer.from('psd'), mimeType: 'application/octet-stream' });
    mocks.extractEditableLayersFromPsd.mockResolvedValue({ width: 4, height: 4, layers: [layer], warnings: [] });
    mocks.refineLayerAssets.mockResolvedValue({
      layers: [layer], buffers: new Map([[layer.id, Buffer.from('layer')]]),
      metrics: { edgeContamination: 0, alphaCoverage: { [layer.id]: 1 }, removedFragments: 0 },
    });
    mocks.evaluateLayerQuality.mockResolvedValue({
      status: 'fail', score: 12, warnings: ['RECONSTRUCTION_ERROR_HIGH'], metrics: {},
    });
    mocks.runLocalLayerPipeline.mockResolvedValue({
      width: 4,
      height: 4,
      layers: [{ ...layer, source: 'local-enhanced' }],
      buffers: new Map(),
      quality: { status: 'warning', score: 82, warnings: ['LOCAL_REVIEW_REQUIRED'], metrics: {} },
    });

    const status = await getLayerTaskStatus({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });

    expect(status.status).toBe('completed');
    expect(status.result?.engine).toBe('local');
    expect(mocks.refundCloudTaskCredits).toHaveBeenCalledTimes(1);
    expect(mocks.completeCloudTask).toHaveBeenCalledTimes(1);
    expect(mocks.updateCloudTask).toHaveBeenCalledWith('layer-task-1', expect.objectContaining({
      result: expect.objectContaining({ phase: 'extracting-psd' }),
    }));
    expect(mocks.updateCloudTask).toHaveBeenCalledWith('layer-task-1', expect.objectContaining({
      result: expect.objectContaining({ phase: 'checking-quality' }),
    }));
    expect(mocks.releaseCloudTaskLease).toHaveBeenCalledWith('layer-task-1', 'worker-1');
  });

  it('falls back locally after a smart-mode Pear PSD decode failure', async () => {
    mocks.task = createTask({
      status: 'processing',
      creditStatus: 'pending',
      creditCost: 5,
      result: {
        requestHash: 'hash', request, phase: 'downloading-psd', remotePsdUrl: 'https://cdn.example/broken.psd',
      },
    });
    mocks.downloadPearPsd.mockResolvedValue({ buffer: Buffer.from('broken'), mimeType: 'application/octet-stream' });
    mocks.extractEditableLayersFromPsd.mockRejectedValue(
      Object.assign(new Error('PSD could not be decoded safely'), { code: 'PSD_DECODE_FAILED' }),
    );
    mocks.runLocalLayerPipeline.mockResolvedValue({
      width: 4,
      height: 4,
      layers: [{ ...layer, source: 'local-enhanced' }],
      buffers: new Map(),
      quality: { status: 'warning', score: 80, warnings: ['LOCAL_REVIEW_REQUIRED'], metrics: {} },
    });

    const status = await getLayerTaskStatus({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });

    expect(status.status).toBe('completed');
    expect(status.result?.engine).toBe('local');
    expect(mocks.refundCloudTaskCredits).toHaveBeenCalledTimes(1);
  });
});
