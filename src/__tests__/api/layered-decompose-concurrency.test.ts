import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  renewCloudTaskLease: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
  transitionCloudTaskToLocalFallbackAndRefund: vi.fn(),
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
  evaluateAndCorrectReconstruction: vi.fn(),
  runLocalLayerPipeline: vi.fn(),
  saveImageFile: vi.fn(),
  deleteImageFile: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({
  chargeCloudTaskCredits: mocks.chargeCloudTaskCredits,
  claimCloudTaskLease: mocks.claimCloudTaskLease,
  completeCloudTask: mocks.completeCloudTask,
  getCloudTaskForUser: mocks.getCloudTaskForUser,
  refundCloudTaskCredits: mocks.refundCloudTaskCredits,
  releaseCloudTaskLease: mocks.releaseCloudTaskLease,
  renewCloudTaskLease: mocks.renewCloudTaskLease,
  terminateCloudTaskAndRefund: mocks.terminateCloudTaskAndRefund,
  transitionCloudTaskToLocalFallbackAndRefund: mocks.transitionCloudTaskToLocalFallbackAndRefund,
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

vi.mock('@/lib/element-decomposition/reconstruction', () => ({
  evaluateAndCorrectReconstruction: mocks.evaluateAndCorrectReconstruction,
}));

vi.mock('@/lib/layer-decomposition/local-pipeline', () => ({
  runLocalLayerPipeline: mocks.runLocalLayerPipeline,
}));

vi.mock('@/lib/server-data-root', () => ({
  saveImageFile: mocks.saveImageFile,
  deleteImageFile: mocks.deleteImageFile,
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
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimCount = 0;
    mocks.task = createTask();
    mocks.claimLayerTask.mockImplementation(async (input: {
      initialLease?: { owner: string; expiresAt: number };
    }) => {
      const owner = mocks.claimCount++ === 0;
      if (owner && input.initialLease && mocks.task) {
        mocks.task = {
          ...mocks.task,
          leaseOwner: input.initialLease.owner,
          leaseExpiresAt: input.initialLease.expiresAt,
          attemptCount: 1,
        };
      }
      return { owner, taskId: 'layer-task-1' };
    });
    mocks.getCloudTaskForUser.mockImplementation(async () => mocks.task);
    mocks.updateCloudTask.mockImplementation(async (
      _taskId: string,
      patch: Partial<CloudTask> & {
        expectedStatuses?: string[];
        leaseOwner?: string;
      },
    ) => {
      if (!mocks.task) return;
      const {
        expectedStatuses,
        leaseOwner,
        ...changes
      } = patch;
      if (expectedStatuses && !expectedStatuses.includes(mocks.task.status)) return false;
      if (leaseOwner && mocks.task.leaseOwner !== leaseOwner) return false;
      mocks.task = { ...mocks.task, ...changes, updatedAt: Date.now() };
      return true;
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
      leaseOwner?: string,
    ) => {
      if (!mocks.task || !['pending', 'processing'].includes(mocks.task.status)) {
        return { transitioned: false, refunded: false, creditCost: 0 };
      }
      if (leaseOwner && mocks.task.leaseOwner !== leaseOwner) {
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
    mocks.refundCloudTaskCredits.mockImplementation(async (
      _taskId: string,
      _reason: string,
      options?: { leaseOwner?: string },
    ) => {
      if (!mocks.task || mocks.task.creditStatus !== 'pending') return { refunded: false, creditCost: 0 };
      if (options?.leaseOwner && mocks.task.leaseOwner !== options.leaseOwner) {
        return { refunded: false, creditCost: 0 };
      }
      mocks.task = { ...mocks.task, creditStatus: 'refunded' };
      return { refunded: true, creditCost: mocks.task.creditCost || 0 };
    });
    mocks.transitionCloudTaskToLocalFallbackAndRefund.mockImplementation(async (
      _taskId: string,
      result: Record<string, unknown>,
      _reason: string,
      leaseOwner: string,
    ) => {
      if (
        !mocks.task
        || mocks.task.status !== 'processing'
        || mocks.task.leaseOwner !== leaseOwner
      ) {
        return { transitioned: false, refunded: false, creditCost: 0 };
      }
      const refunded = mocks.task.creditStatus === 'pending';
      mocks.task = {
        ...mocks.task,
        progress: 65,
        result,
        creditStatus: refunded ? 'refunded' : mocks.task.creditStatus,
      };
      return {
        transitioned: true,
        refunded,
        creditCost: mocks.task.creditCost || 0,
      };
    });
    mocks.completeCloudTask.mockImplementation(async (
      _taskId: string,
      result: Record<string, unknown>,
      leaseOwner?: string,
    ) => {
      if (!mocks.task || mocks.task.status !== 'processing') return false;
      if (leaseOwner && mocks.task.leaseOwner !== leaseOwner) return false;
      mocks.task = { ...mocks.task, status: 'completed', progress: 100, result };
      return true;
    });
    mocks.claimCloudTaskLease.mockImplementation(async () => {
      if (mocks.task?.leaseOwner) return null;
      if (mocks.task) mocks.task = { ...mocks.task, leaseOwner: 'worker-1' };
      return {
        taskId: 'layer-task-1', owner: 'worker-1', expiresAt: 1000, attemptCount: 1,
      };
    });
    mocks.releaseCloudTaskLease.mockResolvedValue(true);
    mocks.renewCloudTaskLease.mockResolvedValue(true);
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

  it('persists the entry audit on the owned task without changing submission semantics', async () => {
    const taskEntryAudit = {
      entry: 'layer' as const,
      mode: 'shadow' as const,
      handlerVersion: 'task-core-v2-shadow' as const,
      requestId: 'req-layer-entry-1',
      requestedProviderId: 'pear-provider',
      requestedModelId: 'pear-layer-model',
      actualProviderId: 'pear-provider',
      actualModelId: 'pear-layer-model',
      startedAt: 1_000,
      updatedAt: 1_000,
      durationMs: 0,
      creditCost: 0,
      creditStatus: 'not-applicable' as const,
    };

    await submitLayerDecomposition({
      userId: 'user-1',
      userRole: 'user',
      idempotencyKey: 'layer-audit-1',
      request,
      taskEntryAudit,
    });

    expect(mocks.task?.result).toEqual(expect.objectContaining({ taskEntryAudit }));
    expect(mocks.chargeCloudTaskCredits).toHaveBeenCalledTimes(1);
    expect(mocks.submitPearLayerTask).toHaveBeenCalledTimes(1);
  });

  it('keeps the initial Pear submission leased while duplicate clients poll', async () => {
    let finishSubmission: ((value: {
      kind: 'async';
      remoteTaskId: string;
      endpoint: string;
    }) => void) | undefined;
    mocks.submitPearLayerTask.mockImplementation(() => new Promise((resolve) => {
      finishSubmission = resolve;
    }));

    const primary = submitLayerDecomposition({
      userId: 'user-1',
      userRole: 'user',
      idempotencyKey: 'layer-request-1',
      request,
    });
    const primaryOutcome = primary.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.waitFor(() => expect(mocks.submitPearLayerTask).toHaveBeenCalledTimes(1));

    const duplicate = await submitLayerDecomposition({
      userId: 'user-1',
      userRole: 'user',
      idempotencyKey: 'layer-request-1',
      request,
    });
    const status = await getLayerTaskStatus({
      taskId: duplicate.taskId,
      userId: 'user-1',
      userRole: 'user',
    });
    finishSubmission?.({
      kind: 'async',
      remoteTaskId: 'pear-task-1',
      endpoint: '/v1/images/edits',
    });
    const submitted = await primaryOutcome;

    expect(status.status).toBe('processing');
    expect(status.phase).toBe('submitting-pear');
    expect(mocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
    expect(submitted).toHaveProperty('value.status', 'processing');
  });

  it('reports a lost submission lease instead of insufficient credits for a zero-cost task', async () => {
    mocks.calculateConfiguredCreditCost.mockResolvedValue(0);
    mocks.chargeCloudTaskCredits.mockImplementationOnce(async () => {
      if (mocks.task) mocks.task = { ...mocks.task, leaseOwner: 'worker-2' };
      return { charged: false, creditCost: 0 };
    });

    const outcome = await submitLayerDecomposition({
      userId: 'user-1',
      userRole: 'user',
      idempotencyKey: 'layer-request-1',
      request,
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

    expect(outcome).toHaveProperty('error.code', 'LAYER_TASK_LEASE_LOST');
    expect(outcome).toHaveProperty('error.status', 409);
    expect(mocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
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

  it('does not refund or fail a live task after this worker loses its lease', async () => {
    vi.useFakeTimers();
    mocks.task = createTask({
      status: 'processing',
      creditStatus: 'pending',
      result: {
        requestHash: 'hash',
        request,
        phase: 'downloading-psd',
        remoteArtifactUrl: 'https://cdn.example/result.zip',
      },
    });
    mocks.renewCloudTaskLease.mockImplementation(async () => {
      if (mocks.task) mocks.task = { ...mocks.task, leaseOwner: 'worker-2' };
      return false;
    });
    mocks.downloadPearPsd.mockImplementation((
      _url: string,
      options: { signal?: AbortSignal },
    ) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
        once: true,
      });
    }));

    const statusPromise = getLayerTaskStatus({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });
    const observed = statusPromise.then(
      (status) => ({ status }),
      (error: unknown) => ({ error }),
    );
    await vi.waitFor(() => expect(mocks.downloadPearPsd).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(100_000);
    const outcome = await observed;

    expect(outcome).not.toHaveProperty('error');
    expect(outcome).toHaveProperty('status.status', 'processing');
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
    expect(mocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
    expect(mocks.runLocalLayerPipeline).not.toHaveBeenCalled();
  });

  it('removes local layer files when cancellation wins during persistence', async () => {
    mocks.task = createTask({
      status: 'processing',
      creditStatus: 'not-applicable',
      result: {
        requestHash: 'hash',
        request: { ...request, engine: 'local' },
        phase: 'running-local-fallback',
      },
    });
    mocks.runLocalLayerPipeline.mockImplementation(async (
      _buffer: Buffer,
      options: {
        taskId?: string;
        persistLayer?: (
          buffer: Buffer,
          filename: string,
          layerAsset: EditableLayerAsset,
        ) => Promise<string>;
      },
    ) => {
      await options.persistLayer?.(
        Buffer.from('layer'),
        `${options.taskId}_background.png`,
        layer,
      );
      return {
        width: 4,
        height: 4,
        layers: [layer],
        buffers: new Map([[layer.id, Buffer.from('layer')]]),
        quality: { status: 'pass', score: 100, warnings: [], metrics: {} },
      };
    });
    mocks.saveImageFile.mockImplementation(() => {
      mocks.task = {
        ...mocks.task!,
        status: 'cancelled',
        error: 'LAYER_TASK_CANCELLED: cancelled during local persistence',
      };
      return '/api/serve-upload/layer-decomposition/background.png';
    });

    const status = await getLayerTaskStatus({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });

    expect(status.status).toBe('cancelled');
    expect(mocks.saveImageFile).toHaveBeenCalledTimes(1);
    expect(mocks.deleteImageFile).toHaveBeenCalledWith(
      expect.stringMatching(/^layer-task-1_[A-Za-z0-9_-]+_background\.png$/),
      'layer-decomposition',
    );
    expect(mocks.completeCloudTask).not.toHaveBeenCalled();
  });

  it('does not persist a Pear PSD after cancellation wins during artifact download', async () => {
    mocks.task = createTask({
      status: 'processing',
      creditStatus: 'pending',
      result: {
        requestHash: 'hash',
        request,
        phase: 'downloading-psd',
        remoteArtifactUrl: 'https://cdn.example/result.zip',
      },
    });
    mocks.downloadPearPsd.mockImplementation((
      _url: string,
      options: { signal?: AbortSignal },
    ) => new Promise((resolve) => {
      options.signal?.addEventListener('abort', () => {
        resolve({ buffer: Buffer.from('8BPS-result'), mimeType: 'image/vnd.adobe.photoshop' });
      }, { once: true });
    }));

    const statusPromise = getLayerTaskStatus({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });
    await vi.waitFor(() => expect(mocks.downloadPearPsd).toHaveBeenCalled());
    const cancelled = await cancelLayerTask({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });
    const status = await statusPromise;

    expect(cancelled.status).toBe('cancelled');
    expect(status.status).toBe('cancelled');
    expect(mocks.saveImageFile).not.toHaveBeenCalled();
    expect(mocks.extractEditableLayersFromPsd).not.toHaveBeenCalled();
    expect(mocks.completeCloudTask).not.toHaveBeenCalled();
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledTimes(1);
  });

  it('does not persist artifacts when another instance cancels the task', async () => {
    mocks.task = createTask({
      status: 'processing',
      creditStatus: 'pending',
      result: {
        requestHash: 'hash',
        request,
        phase: 'downloading-psd',
        remoteArtifactUrl: 'https://cdn.example/result.zip',
      },
    });
    mocks.downloadPearPsd.mockImplementation(async () => {
      mocks.task = {
        ...mocks.task!,
        status: 'cancelled',
        creditStatus: 'refunded',
        error: 'LAYER_TASK_CANCELLED: cancelled by another instance',
      };
      return {
        buffer: Buffer.from('8BPS-result'),
        mimeType: 'image/vnd.adobe.photoshop',
      };
    });

    const status = await getLayerTaskStatus({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });

    expect(status.status).toBe('cancelled');
    expect(mocks.saveImageFile).not.toHaveBeenCalled();
    expect(mocks.extractEditableLayersFromPsd).not.toHaveBeenCalled();
    expect(mocks.completeCloudTask).not.toHaveBeenCalled();
  });

  it('removes a persisted PSD when another instance cancels during the write boundary', async () => {
    mocks.task = createTask({
      status: 'processing',
      creditStatus: 'pending',
      result: {
        requestHash: 'hash',
        request,
        phase: 'downloading-psd',
        remoteArtifactUrl: 'https://cdn.example/result.psd',
      },
    });
    mocks.downloadPearPsd.mockResolvedValue({
      buffer: Buffer.from('8BPS-result'),
      mimeType: 'image/vnd.adobe.photoshop',
    });
    mocks.saveImageFile.mockImplementation(() => {
      mocks.task = {
        ...mocks.task!,
        status: 'cancelled',
        creditStatus: 'refunded',
        error: 'LAYER_TASK_CANCELLED: cancelled during persistence',
      };
      return '/api/serve-upload/layer-decomposition/layer-task-1.psd';
    });

    const status = await getLayerTaskStatus({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });

    expect(status.status).toBe('cancelled');
    expect(mocks.saveImageFile).toHaveBeenCalledTimes(1);
    expect(mocks.deleteImageFile).toHaveBeenCalledWith(
      'layer-task-1_worker-1.psd',
      'layer-decomposition',
    );
    expect(mocks.extractEditableLayersFromPsd).not.toHaveBeenCalled();
    expect(mocks.completeCloudTask).not.toHaveBeenCalled();
  });

  it('refunds Pear cost once then completes with local output after smart quality failure', async () => {
    const localReconstruction = {
      native: {
        widthMatches: true, heightMatches: true, alphaMae: 0, rgbMae: 0.01,
        maxChannelError: 0.1, mismatchedPixelRatio: 0.05, ssim: 0.98,
      },
      corrected: {
        widthMatches: true, heightMatches: true, alphaMae: 0, rgbMae: 0,
        maxChannelError: 0, mismatchedPixelRatio: 0, ssim: 1,
      },
      correctionApplied: false,
    };
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
    mocks.evaluateAndCorrectReconstruction.mockResolvedValue(localReconstruction);

    const status = await getLayerTaskStatus({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });

    expect(status.status).toBe('completed');
    expect(status.result?.engine).toBe('local');
    expect(status.result?.reconstruction).toEqual(localReconstruction);
    expect(mocks.transitionCloudTaskToLocalFallbackAndRefund).toHaveBeenCalledTimes(1);
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
    expect(mocks.completeCloudTask).toHaveBeenCalledTimes(1);
    expect(mocks.updateCloudTask).toHaveBeenCalledWith('layer-task-1', expect.objectContaining({
      result: expect.objectContaining({ phase: 'extracting-psd' }),
    }));
    expect(mocks.updateCloudTask).toHaveBeenCalledWith('layer-task-1', expect.objectContaining({
      result: expect.objectContaining({ phase: 'checking-quality' }),
    }));
    expect(mocks.releaseCloudTaskLease).toHaveBeenCalledWith('layer-task-1', 'worker-1');
  });

  it('preserves Pear failure diagnostics after smart fallback completes', async () => {
    const providerError = {
      code: 'upstream_timeout',
      message: 'The layered image worker timed out',
      type: 'api_error',
      param: 'image',
    };
    mocks.task = createTask({
      status: 'processing',
      creditStatus: 'pending',
      creditCost: 5,
      remoteTaskId: 'pear-task-1',
      result: {
        requestHash: 'hash',
        request,
        phase: 'waiting-for-pear',
      },
    });
    mocks.pollPearLayerTask.mockResolvedValue({
      status: 'failed',
      progress: 73,
      error: providerError.message,
      providerError,
    });
    mocks.runLocalLayerPipeline.mockResolvedValue({
      width: 4,
      height: 4,
      layers: [{ ...layer, source: 'local-enhanced' }],
      buffers: new Map([[layer.id, Buffer.from('layer')]]),
      quality: { status: 'warning', score: 82, warnings: [], metrics: {} },
    });
    mocks.evaluateAndCorrectReconstruction.mockResolvedValue({
      native: {
        widthMatches: true, heightMatches: true, alphaMae: 0, rgbMae: 0,
        maxChannelError: 0, mismatchedPixelRatio: 0, ssim: 1,
      },
      corrected: {
        widthMatches: true, heightMatches: true, alphaMae: 0, rgbMae: 0,
        maxChannelError: 0, mismatchedPixelRatio: 0, ssim: 1,
      },
      correctionApplied: false,
    });

    const status = await getLayerTaskStatus({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });

    expect(status.status).toBe('completed');
    expect(status.providerError).toEqual(providerError);
    expect(status.fallbackReason).toBe(providerError.message);
    expect(mocks.transitionCloudTaskToLocalFallbackAndRefund).toHaveBeenCalledTimes(1);
    expect(mocks.completeCloudTask).toHaveBeenCalledWith(
      'layer-task-1',
      expect.objectContaining({
        providerError,
        fallbackReason: providerError.message,
      }),
      'worker-1',
    );
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
  });

  it('attaches reconstruction metrics and correction assets to a completed Pear result', async () => {
    const correctionLayer: EditableLayerAsset = {
      ...layer,
      id: 'reconstruction-correction',
      name: 'reconstruction/correction',
      role: 'reconstruction-correction',
      imageUrl: '/api/serve-upload/layer-decomposition/correction.png',
      source: 'local-enhanced',
    };
    const reconstruction = {
      native: {
        widthMatches: true,
        heightMatches: true,
        alphaMae: 0,
        rgbMae: 0.02,
        maxChannelError: 0.2,
        mismatchedPixelRatio: 0.1,
        ssim: 0.96,
      },
      corrected: {
        widthMatches: true,
        heightMatches: true,
        alphaMae: 0,
        rgbMae: 0,
        maxChannelError: 0,
        mismatchedPixelRatio: 0,
        ssim: 1,
      },
      correctionApplied: true,
      correctionLayer,
    };
    mocks.task = createTask({
      status: 'processing',
      creditStatus: 'pending',
      creditCost: 5,
      result: {
        requestHash: 'hash', request, phase: 'downloading-psd', remoteArtifactUrl: 'https://cdn.example/result.psd',
      },
    });
    mocks.downloadPearPsd.mockResolvedValue({ buffer: Buffer.from('psd'), mimeType: 'image/vnd.adobe.photoshop' });
    mocks.extractEditableLayersFromPsd.mockResolvedValue({ width: 4, height: 4, layers: [layer], warnings: [] });
    mocks.refineLayerAssets.mockResolvedValue({
      layers: [layer], buffers: new Map([[layer.id, Buffer.from('layer')]]),
      metrics: { edgeContamination: 0, alphaCoverage: { [layer.id]: 1 }, removedFragments: 0 },
    });
    mocks.evaluateLayerQuality.mockResolvedValue({
      status: 'pass', score: 96, warnings: [], metrics: {},
    });
    mocks.evaluateAndCorrectReconstruction.mockResolvedValue(reconstruction);

    const status = await getLayerTaskStatus({
      taskId: 'layer-task-1', userId: 'user-1', userRole: 'user',
    });

    expect(status.status).toBe('completed');
    expect(status.result?.reconstruction).toEqual(reconstruction);
    expect(status.result?.layers).toContainEqual(correctionLayer);
    expect(mocks.evaluateAndCorrectReconstruction).toHaveBeenCalledTimes(1);
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
    expect(mocks.transitionCloudTaskToLocalFallbackAndRefund).toHaveBeenCalledTimes(1);
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
  });
});
