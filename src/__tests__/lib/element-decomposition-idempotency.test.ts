import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CloudTask,
  CreateCloudTaskInput,
  UpdateCloudTaskInput,
} from '@/lib/cloud-task-storage';
import type { ElementBranchState } from '@/lib/element-decomposition/service';

type TestBranch = 'board' | 'layers';

interface TestParentResult extends Record<string, unknown> {
  branches: Partial<Record<TestBranch, ElementBranchState>>;
  overallStatus?: string;
}

type TestParentTask = Omit<CloudTask, 'result'> & { result: TestParentResult };

const storage = vi.hoisted(() => ({
  tasks: new Map<string, CloudTask>(),
  createCloudTask: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  getCloudTaskForUserByIdempotencyKey: vi.fn(),
  getLatestElementDecomposeParentForProject: vi.fn(),
  listCloudTasks: vi.fn(),
  updateCloudTask: vi.fn(),
}));

const sourceMocks = vi.hoisted(() => ({
  freezeElementSource: vi.fn(),
  persistFrozenElementSource: vi.fn(),
}));

const board = vi.hoisted(() => ({
  submit: vi.fn(),
  poll: vi.fn(),
  cancel: vi.fn(),
}));

const layers = vi.hoisted(() => ({
  submit: vi.fn(),
  get: vi.fn(),
  snapshot: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => storage);
vi.mock('@/lib/element-decomposition/source-snapshot', () => ({
  freezeElementSource: sourceMocks.freezeElementSource,
  persistFrozenElementSource: sourceMocks.persistFrozenElementSource,
}));
vi.mock('@/lib/layer-decomposition/service', () => ({
  submitLayerDecomposition: layers.submit,
  getLayerTaskStatus: layers.get,
  getLayerTaskSnapshot: layers.snapshot,
  cancelLayerTask: layers.cancel,
}));
vi.mock('@/lib/element-decomposition/board-executor', () => ({
  submitElementBoard: board.submit,
  pollElementBoard: board.poll,
  cancelElementBoard: board.cancel,
}));

function request() {
  return {
    projectId: 'project-1',
    sourceImageId: 'image-1',
    imageUrl: '/api/serve-upload/source.png',
    outputMode: 'both' as const,
    board: {
      aspectRatio: '16:9',
      background: 'transparent' as const,
      providerId: 'image-provider',
      modelId: 'gpt-image-1',
    },
    layers: { engine: 'cloud' as const, providerId: 'pear', modelId: 'Image-Layered' },
  };
}

function parentTask(taskId: string): TestParentTask {
  const task = storage.tasks.get(taskId);
  if (!task?.result || !task.result.branches || typeof task.result.branches !== 'object') {
    throw new Error(`Expected parent task ${taskId}`);
  }
  return task as TestParentTask;
}

function parentBranch(task: TestParentTask, branch: TestBranch): ElementBranchState {
  const state = task.result.branches[branch];
  if (!state) throw new Error(`Expected ${branch} branch on ${task.id}`);
  return state;
}

describe('element decomposition parent idempotency', () => {
  beforeEach(() => {
    storage.tasks.clear();
    vi.clearAllMocks();
    sourceMocks.freezeElementSource.mockResolvedValue({
      sourceImageId: 'image-1',
      canonicalUrl: '/api/serve-upload/source.png',
      sha256: 'a'.repeat(64),
      width: 800,
      height: 600,
      mimeType: 'image/png',
      buffer: Buffer.from('source'),
    });
    sourceMocks.persistFrozenElementSource.mockResolvedValue({
      managedUrl: `/api/serve-upload/element-sources/${'a'.repeat(64)}.png`,
      sha256: 'a'.repeat(64),
    });
    board.submit.mockImplementation(async ({ idempotencyKey }: { idempotencyKey: string }) => ({
      taskId: `board:${idempotencyKey}`,
      status: 'processing',
      progress: 10,
    }));
    board.poll.mockResolvedValue({ taskId: 'board-task', status: 'completed', progress: 100, result: { imageUrl: '/board.png' } });
    board.cancel.mockResolvedValue({ taskId: 'board-task', status: 'cancelled', progress: 10 });
    layers.submit.mockImplementation(async ({ idempotencyKey }: { idempotencyKey: string }) => ({
      success: true,
      taskId: `layer:${idempotencyKey}`,
      status: 'processing',
      progress: 10,
    }));
    layers.get.mockResolvedValue({ taskId: 'layer-task', status: 'completed', progress: 100, result: { layers: [] } });
    layers.snapshot.mockResolvedValue({ taskId: 'layer-task', status: 'completed', progress: 100, result: { layers: [] } });
    layers.cancel.mockResolvedValue({ taskId: 'layer-task', status: 'cancelled', progress: 10 });
    storage.createCloudTask.mockImplementation(async (task: CreateCloudTaskInput) => {
      const existing = [...storage.tasks.values()].find(
        candidate => candidate.userId === task.userId && candidate.idempotencyKey === task.idempotencyKey,
      );
      if (existing) return false;
      storage.tasks.set(task.id, {
        ...task,
        result: task.result || {},
        creditStatus: task.creditStatus || 'pending',
        revision: 0,
      });
      return true;
    });
    storage.getCloudTaskForUserByIdempotencyKey.mockImplementation(async (userId: string, key: string) => (
      structuredClone(
        [...storage.tasks.values()].find(task => task.userId === userId && task.idempotencyKey === key) || null,
      )
    ));
    storage.getCloudTaskForUser.mockImplementation(async (taskId: string, userId: string) => {
      const task = storage.tasks.get(taskId);
      return task?.userId === userId ? structuredClone(task) : null;
    });
    storage.listCloudTasks.mockImplementation(async ({ userId, limit = 100 }: { userId?: string; limit?: number }) => (
      [...storage.tasks.values()]
        .filter(task => !userId || task.userId === userId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .map(task => structuredClone(task))
    ));
    storage.getLatestElementDecomposeParentForProject.mockImplementation(async (userId: string, projectId: string) => (
      [...storage.tasks.values()]
        .filter(task => task.userId === userId && task.type === 'element-decompose-parent')
        .filter(task => task.projectId === projectId || (!task.projectId
          && (task.result?.request as Record<string, unknown> | undefined)?.projectId === projectId))
        .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0]
        || null
    ));
    storage.updateCloudTask.mockImplementation(async (taskId: string, patch: UpdateCloudTaskInput) => {
      const task = storage.tasks.get(taskId);
      if (!task) return false;
      if (patch.expectedStatuses?.length && !patch.expectedStatuses.includes(task.status)) return false;
      if (patch.expectedRevision !== undefined && patch.expectedRevision !== (task.revision || 0)) return false;
      storage.tasks.set(taskId, { ...task, ...patch, revision: (task.revision || 0) + 1 });
      return true;
    });
  });

  it('returns one persistent parent for concurrent same-user submissions', async () => {
    const { submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const responses = await Promise.all(Array.from({ length: 8 }, () => submitElementDecomposition({
      userId: 'user-1',
      userRole: 'user',
      idempotencyKey: 'element-request-001',
      request: request(),
    })));

    expect(new Set(responses.map(response => response.taskId)).size).toBe(1);
    expect([...storage.tasks.values()].filter(task => task.type === 'element-decompose-parent')).toHaveLength(1);
  });

  it('persists source-bound branch idempotency keys', async () => {
    const { submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const response = await submitElementDecomposition({
      userId: 'user-1',
      userRole: 'user',
      idempotencyKey: 'element-request-002',
      request: request(),
    });

    expect(response.source.sha256).toBe('a'.repeat(64));
    expect(response.branches.board?.idempotencyKey).toMatch(
      /^element-request-002:board:a{64}:[a-f0-9]{64}$/,
    );
    expect(response.branches.layers?.idempotencyKey).toMatch(
      /^element-request-002:layers:a{64}:[a-f0-9]{64}$/,
    );
    const managedUrl = `/api/serve-upload/element-sources/${'a'.repeat(64)}.png`;
    expect(sourceMocks.persistFrozenElementSource).toHaveBeenCalledTimes(1);
    expect(board.submit).toHaveBeenCalledWith(expect.objectContaining({
      sourceUrl: managedUrl,
      sourceHash: 'a'.repeat(64),
    }));
    expect(layers.submit).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        imageUrl: managedUrl,
        requireTransparentSubject: true,
      }),
    }));
  });

  it('persists the project binding on a new parent task', async () => {
    const { submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-project-binding', request: request(),
    });

    expect(storage.createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      type: 'element-decompose-parent',
    }));
  });

  it('recovers only the latest owned parent for the requested project', async () => {
    const now = Date.now();
    const makeTask = (overrides: Partial<CloudTask>): CloudTask => ({
      id: 'task', userId: 'user-1', projectId: 'project-1', type: 'element-decompose-parent',
      status: 'completed', progress: 100, creditStatus: 'not-applicable', createdAt: now, updatedAt: now,
      revision: 0, result: { source: {}, branches: {} }, ...overrides,
    });
    storage.tasks.set('older-owned', makeTask({ id: 'older-owned', updatedAt: now - 10 }));
    storage.tasks.set('newer-owned', makeTask({ id: 'newer-owned', updatedAt: now - 5 }));
    storage.tasks.set('other-user', makeTask({ id: 'other-user', userId: 'user-2', updatedAt: now }));
    storage.tasks.set('other-project', makeTask({ id: 'other-project', projectId: 'project-2', updatedAt: now + 1 }));
    storage.tasks.set('other-type', makeTask({ id: 'other-type', type: 'image-generation', updatedAt: now + 2 }));

    const { findLatestElementDecompositionForProject } = await import('@/lib/element-decomposition/service');
    const recovered = await findLatestElementDecompositionForProject({ userId: 'user-1', projectId: 'project-1' });

    expect(recovered.taskId).toBe('newer-owned');
    expect(storage.getLatestElementDecomposeParentForProject).toHaveBeenCalledWith('user-1', 'project-1');
    expect(storage.listCloudTasks).not.toHaveBeenCalled();
    expect(layers.get).not.toHaveBeenCalled();
    expect(board.poll).not.toHaveBeenCalled();
    expect(storage.updateCloudTask).not.toHaveBeenCalled();
  });

  it('recovers a legacy parent whose persisted request contains the project binding', async () => {
    const now = Date.now();
    storage.tasks.set('legacy-parent', {
      id: 'legacy-parent', userId: 'user-1', type: 'element-decompose-parent', status: 'completed',
      progress: 100, creditStatus: 'not-applicable', createdAt: now, updatedAt: now, revision: 0,
      result: { request: { projectId: 'project-1' }, source: {}, branches: {} },
    });

    const { findLatestElementDecompositionForProject } = await import('@/lib/element-decomposition/service');
    await expect(findLatestElementDecompositionForProject({
      userId: 'user-1', projectId: 'project-1',
    })).resolves.toMatchObject({ taskId: 'legacy-parent', overallStatus: 'processing' });
  });

  it('rejects one key reused for a different normalized request', async () => {
    const { submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-request-003', request: request(),
    });

    await expect(submitElementDecomposition({
      userId: 'user-1',
      userRole: 'user',
      idempotencyKey: 'element-request-003',
      request: { ...request(), board: { aspectRatio: '1:1', background: 'transparent' } },
    })).rejects.toMatchObject({ code: 'ELEMENT_IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it('rejects one key reused when the owned URL resolves to different frozen bytes', async () => {
    const { submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-source-conflict', request: request(),
    });
    sourceMocks.freezeElementSource.mockResolvedValueOnce({
      sourceImageId: 'image-1',
      canonicalUrl: '/api/serve-upload/source.png',
      sha256: 'b'.repeat(64),
      width: 800,
      height: 600,
      mimeType: 'image/png',
      buffer: Buffer.from('changed-source'),
    });

    await expect(submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-source-conflict', request: request(),
    })).rejects.toMatchObject({ code: 'ELEMENT_IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it('submits each child once for concurrent duplicate parent requests', async () => {
    const { submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    await Promise.all(Array.from({ length: 12 }, () => submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-request-004', request: request(),
    })));

    expect(board.submit).toHaveBeenCalledTimes(1);
    expect(layers.submit).toHaveBeenCalledTimes(1);
  });

  it('keeps a duplicate parent processing while its child submissions are pending', async () => {
    const { submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    let releaseBoard: (() => void) | undefined;
    const boardStarted = new Promise<void>((resolveStarted) => {
      board.submit.mockImplementationOnce(async ({ idempotencyKey }: { idempotencyKey: string }) => {
        resolveStarted();
        await new Promise<void>((resolve) => { releaseBoard = resolve; });
        return { taskId: `board:${idempotencyKey}`, status: 'processing', progress: 10 };
      });
    });

    const owner = submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-parent-pending', request: request(),
    });
    await boardStarted;

    const duplicate = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-parent-pending', request: request(),
    });

    expect(duplicate.status).toBe('processing');
    expect(duplicate.overallStatus).toBe('processing');
    expect(board.submit).toHaveBeenCalledTimes(1);
    expect(layers.submit).not.toHaveBeenCalled();

    releaseBoard?.();
    await owner;
  });

  it('polls board work and stores the completed board result', async () => {
    const { getElementDecomposition, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-request-005', request: request(),
    });
    const response = await getElementDecomposition({ taskId: submitted.taskId, userId: 'user-1', userRole: 'user' });

    expect(board.poll).toHaveBeenCalledWith(expect.objectContaining({ taskId: submitted.branches.board?.taskId }));
    expect(response.branches.board).toMatchObject({ status: 'completed', result: { imageUrl: '/board.png' } });
  });

  it('preserves refunded Pear fallback evidence on the completed layers branch', async () => {
    const providerError = {
      code: 'LAYER_QUALITY_GATE_FAILED',
      message: 'Pear PSD did not pass the reconstruction quality gate',
      type: 'quality_error',
    };
    layers.get.mockResolvedValueOnce({
      taskId: 'layer-task',
      status: 'completed',
      progress: 100,
      creditStatus: 'refunded',
      fallbackReason: providerError.message,
      providerError,
      result: { engine: 'local', layers: [{ id: 'local-layer' }] },
    });

    const { getElementDecomposition, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-refunded-fallback', request: request(),
    });
    const response = await getElementDecomposition({
      taskId: submitted.taskId, userId: 'user-1', userRole: 'user',
    });

    expect(response.branches.layers).toMatchObject({
      status: 'completed',
      creditStatus: 'refunded',
      fallbackReason: providerError.message,
      providerError,
      result: { engine: 'local', layers: [{ id: 'local-layer' }] },
    });
  });

  it('hydrates fallback evidence for a legacy completed parent without resubmitting', async () => {
    const { getElementDecomposition, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-legacy-fallback', request: request(),
    });
    const stored = parentTask(submitted.taskId);
    stored.status = 'completed';
    stored.result.branches = {
      board: { ...parentBranch(stored, 'board'), status: 'completed', progress: 100 },
      layers: {
        ...parentBranch(stored, 'layers'),
        status: 'completed',
        progress: 100,
        result: { engine: 'local', layers: [{ id: 'legacy-local-layer' }] },
      },
    };
    layers.snapshot.mockResolvedValueOnce({
      taskId: submitted.branches.layers?.taskId,
      status: 'completed',
      progress: 100,
      creditStatus: 'refunded',
      fallbackReason: 'Pear reconstruction failed',
      providerError: { code: 'LAYER_QUALITY_FAILED', message: 'Pear reconstruction failed' },
      result: { engine: 'local', layers: [{ id: 'legacy-local-layer' }] },
    });
    storage.updateCloudTask.mockClear();

    const response = await getElementDecomposition({
      taskId: submitted.taskId, userId: 'user-1', userRole: 'user',
    });

    expect(layers.submit).toHaveBeenCalledTimes(1);
    expect(layers.snapshot).toHaveBeenCalledTimes(1);
    expect(layers.get).not.toHaveBeenCalled();
    expect(storage.updateCloudTask).not.toHaveBeenCalled();
    expect(response.branches.layers).toMatchObject({
      status: 'completed',
      creditStatus: 'refunded',
      fallbackReason: 'Pear reconstruction failed',
      result: { engine: 'local' },
    });
  });

  it('keeps a legacy completed parent readable when its child evidence is no longer available', async () => {
    const { getElementDecomposition, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-legacy-missing-child', request: request(),
    });
    const stored = parentTask(submitted.taskId);
    stored.status = 'completed';
    stored.result.branches = {
      board: { ...parentBranch(stored, 'board'), status: 'completed', progress: 100 },
      layers: {
        ...parentBranch(stored, 'layers'),
        status: 'completed',
        progress: 100,
        result: { engine: 'local', layers: [{ id: 'legacy-local-layer' }] },
      },
    };
    layers.snapshot.mockRejectedValueOnce(new Error('legacy child task expired'));

    const response = await getElementDecomposition({
      taskId: submitted.taskId, userId: 'user-1', userRole: 'user',
    });

    expect(layers.submit).toHaveBeenCalledTimes(1);
    expect(layers.snapshot).toHaveBeenCalledTimes(1);
    expect(layers.get).not.toHaveBeenCalled();
    expect(response.status).toBe('completed');
    expect(response.branches.layers).toMatchObject({
      status: 'completed',
      result: { engine: 'local' },
    });
  });

  it('does not advance a nonterminal child while reading a legacy completed parent', async () => {
    const { getElementDecomposition, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-legacy-live-child', request: request(),
    });
    const stored = parentTask(submitted.taskId);
    stored.status = 'completed';
    stored.result.branches = {
      board: { ...parentBranch(stored, 'board'), status: 'completed', progress: 100 },
      layers: {
        ...parentBranch(stored, 'layers'),
        status: 'completed',
        progress: 100,
        result: { engine: 'local', layers: [{ id: 'legacy-local-layer' }] },
      },
    };
    layers.snapshot.mockResolvedValueOnce({
      taskId: submitted.branches.layers?.taskId,
      status: 'processing',
      progress: 65,
    });
    storage.updateCloudTask.mockClear();

    const response = await getElementDecomposition({
      taskId: submitted.taskId, userId: 'user-1', userRole: 'user',
    });

    expect(layers.snapshot).toHaveBeenCalledTimes(1);
    expect(layers.get).not.toHaveBeenCalled();
    expect(storage.updateCloudTask).not.toHaveBeenCalled();
    expect(response.status).toBe('completed');
    expect(response.branches.layers).toMatchObject({
      status: 'completed',
      progress: 100,
      result: { engine: 'local' },
    });
  });

  it('does not overwrite a newer retry branch with a stale polling result', async () => {
    const { getElementDecomposition, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-poll-race', request: request(),
    });
    const originalBoardId = submitted.branches.board!.taskId;
    let releasePoll: (() => void) | undefined;
    board.poll.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releasePoll = resolve; });
      return { taskId: originalBoardId, status: 'completed', progress: 100, result: { imageUrl: '/stale.png' } };
    });

    const polling = getElementDecomposition({ taskId: submitted.taskId, userId: 'user-1', userRole: 'user' });
    await vi.waitFor(() => expect(board.poll).toHaveBeenCalled());
    const current = parentTask(submitted.taskId);
    const newerBoard = {
      ...parentBranch(current, 'board'),
      taskId: 'board-new-attempt',
      idempotencyKey: 'new-attempt-key',
      status: 'processing' as const,
      attempt: 2,
    };
    current.result.branches = { ...current.result.branches, board: newerBoard };
    current.revision = (current.revision || 0) + 1;
    releasePoll?.();
    await polling;

    expect(parentBranch(parentTask(submitted.taskId), 'board')).toMatchObject({
      taskId: 'board-new-attempt',
      attempt: 2,
      status: 'processing',
    });
  });

  it('surfaces a state conflict when a polled snapshot cannot be committed', async () => {
    const { getElementDecomposition, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-poll-conflict', request: request(),
    });
    storage.updateCloudTask.mockResolvedValueOnce(false);

    await expect(getElementDecomposition({
      taskId: submitted.taskId, userId: 'user-1', userRole: 'user',
    })).rejects.toMatchObject({ code: 'ELEMENT_TASK_STATE_CONFLICT', status: 409 });
  });

  it.each(['board', 'layers'] as const)('retries failed %s branch with an attempt-specific key', async (branchName) => {
    const { retryElementBranch, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: `element-retry-${branchName}`, request: request(),
    });
    const parent = parentTask(submitted.taskId);
    const siblingName = branchName === 'board' ? 'layers' : 'board';
    const branch = parentBranch(parent, branchName);
    const sibling = parentBranch(parent, siblingName);
    const siblingId = sibling.taskId;
    parent.status = 'completed';
    branch.status = 'failed';
    sibling.status = 'completed';

    const response = await retryElementBranch({ taskId: submitted.taskId, branch: branchName, userId: 'user-1', userRole: 'user' });

    expect(response.branches[branchName]?.idempotencyKey).toMatch(/:attempt:2$/);
    expect(response.branches[branchName]?.taskId).not.toBe(submitted.branches[branchName]?.taskId);
    expect(response.branches[siblingName]?.taskId).toBe(siblingId);
    if (branchName === 'board') {
      expect(board.submit).toHaveBeenLastCalledWith(expect.objectContaining({
        providerId: 'image-provider',
        modelId: 'gpt-image-1',
      }));
    }
  });

  it('passes the exact board provider and model during initial submission', async () => {
    const { submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-board-model-contract', request: request(),
    });

    expect(board.submit).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'image-provider',
      modelId: 'gpt-image-1',
    }));
  });

  it.each(['board', 'layers'] as const)('submits only one chargeable %s child across 20 concurrent retries', async (branchName) => {
    const { retryElementBranch, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: `element-retry-race-${branchName}`, request: request(),
    });
    const parent = parentTask(submitted.taskId);
    const siblingName = branchName === 'board' ? 'layers' : 'board';
    const branch = parentBranch(parent, branchName);
    const sibling = parentBranch(parent, siblingName);
    parent.status = 'completed';
    branch.status = 'failed';
    sibling.status = 'completed';
    const submit = branchName === 'board' ? board.submit : layers.submit;
    const callsBeforeRetry = submit.mock.calls.length;
    submit.mockImplementationOnce(async ({ idempotencyKey }: { idempotencyKey: string }) => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return branchName === 'board'
        ? { taskId: `board:${idempotencyKey}`, status: 'processing', progress: 10 }
        : { success: true, taskId: `layer:${idempotencyKey}`, status: 'processing', progress: 10 };
    });

    const retries = await Promise.allSettled(Array.from({ length: 20 }, () => retryElementBranch({
      taskId: submitted.taskId,
      branch: branchName,
      userId: 'user-1',
      userRole: 'user',
    })));

    expect(submit.mock.calls.length - callsBeforeRetry).toBe(1);
    expect(retries.some(result => result.status === 'fulfilled')).toBe(true);
    const current = parentTask(submitted.taskId);
    expect(parentBranch(current, branchName)).toMatchObject({
      attempt: 2,
      status: 'completed',
      submissionPending: false,
    });
    expect(parentBranch(current, siblingName).taskId).toBe(sibling.taskId);
  });

  it('persists a retry submission failure as retryable instead of leaving the branch reserved', async () => {
    const { retryElementBranch, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-retry-submit-failure', request: request(),
    });
    const parent = parentTask(submitted.taskId);
    parent.status = 'completed';
    parentBranch(parent, 'board').status = 'failed';
    parentBranch(parent, 'layers').status = 'completed';
    board.submit.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(retryElementBranch({
      taskId: submitted.taskId,
      branch: 'board',
      userId: 'user-1',
      userRole: 'user',
    })).rejects.toThrow('provider unavailable');

    const current = parentTask(submitted.taskId);
    expect(current.status).toBe('completed');
    expect(parentBranch(current, 'board')).toMatchObject({
      attempt: 2,
      status: 'failed',
      submissionPending: false,
      error: 'provider unavailable',
    });
    expect(current.result.overallStatus).toBe('partial');
  });

  it('cancels both live child executors', async () => {
    const { cancelElementDecomposition, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-request-006', request: request(),
    });
    await cancelElementDecomposition({ taskId: submitted.taskId, userId: 'user-1', userRole: 'user' });

    expect(board.cancel).toHaveBeenCalledWith(expect.objectContaining({ taskId: submitted.branches.board?.taskId }));
    expect(layers.cancel).toHaveBeenCalledWith(expect.objectContaining({ taskId: submitted.branches.layers?.taskId }));
  });

  it('does not report a board branch cancelled when downstream cancellation fails', async () => {
    const { cancelElementDecomposition, submitElementDecomposition } = await import('@/lib/element-decomposition/service');
    const submitted = await submitElementDecomposition({
      userId: 'user-1', userRole: 'user', idempotencyKey: 'element-cancel-failure', request: request(),
    });
    board.cancel.mockRejectedValueOnce(new Error('cancel endpoint unavailable'));

    await expect(cancelElementDecomposition({
      taskId: submitted.taskId, userId: 'user-1', userRole: 'user',
    })).rejects.toThrow('cancel endpoint unavailable');
    expect(parentBranch(parentTask(submitted.taskId), 'board').status).not.toBe('cancelled');
  });
});
