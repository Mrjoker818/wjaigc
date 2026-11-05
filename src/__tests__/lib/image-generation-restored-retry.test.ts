import { describe, expect, it, vi } from 'vitest';

import { extractTaskAssetReferences } from '@/lib/asset-core/workspace-transfer';
import {
  createImageGenerationSession,
  type ImageGenerationRequest,
  type ImageGenerationSessionDependencies,
  type ImageGenerationTaskUpdate,
  type RestoredImageGenerationTask,
} from '@/lib/image-generation-session';

type SubmitResponse = Awaited<ReturnType<ImageGenerationSessionDependencies['submit']>>;
type RetryResponse = SubmitResponse & {
  success?: boolean;
  error?: ImageGenerationTaskUpdate['error'];
};

// Keep the proposed optional boundary in the test until controller-qualified RED.
interface RestoredRetryDependencies extends ImageGenerationSessionDependencies {
  retryRestoredTask?(taskId: string, projectId: string): Promise<RetryResponse>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, deny) => { resolve = accept; reject = deny; });
  return { promise, resolve, reject };
}

function managedResult(versionId: string): Record<string, unknown> {
  return {
    assetProjection: {
      references: [{
        assetId: `asset-${versionId}`,
        assetVersionId: versionId,
        placementId: `placement-${versionId}`,
        url: `/media/${versionId}.png`,
      }],
    },
  };
}

function failedTask(overrides: Partial<RestoredImageGenerationTask> = {}): RestoredImageGenerationTask {
  return {
    id: 'restored-slot',
    taskId: 'ancestor-task',
    projectId: 'original-project',
    status: 'failed',
    progress: 37,
    error: { code: 'UPSTREAM_TIMEOUT', message: '原任务上游超时', retryable: true },
    ...overrides,
  };
}

function harness() {
  let listener: ((update: ImageGenerationTaskUpdate) => void) | undefined;
  let nextHandle = 0;
  let nextSlotId = 0;
  const scheduled = new Map<number, () => void | Promise<void>>();
  const submit = vi.fn(async (request: ImageGenerationRequest & { submitOnly: true }): Promise<SubmitResponse> => ({
    slots: Array.from({ length: request.outputCount }, (_, slotIndex) => ({
      taskId: `memory-task-${slotIndex}`,
      slotIndex,
      status: 'processing',
    })),
  }));
  const retryRestoredTask = vi.fn<(taskId: string, projectId: string) => Promise<RetryResponse>>(async (): Promise<RetryResponse> => ({
    success: true,
    taskId: 'child-task',
    taskIds: ['child-task'],
    status: 'processing',
  }));
  const restoreTasks = vi.fn<ImageGenerationSessionDependencies['restoreTasks']>(async (): Promise<RestoredImageGenerationTask[]> => [failedTask()]);
  const pollTask = vi.fn(async (taskId: string): Promise<ImageGenerationTaskUpdate> => ({ taskId, status: 'processing', progress: 42 }));
  const unsubscribe = vi.fn((): void => { listener = undefined; });
  const cancelTask = vi.fn<ImageGenerationSessionDependencies['cancelTask']>(async (): Promise<{ success: boolean }> => ({ success: true }));
  const dependencies: RestoredRetryDependencies = {
    submit,
    retryRestoredTask,
    restoreTasks,
    pollTask,
    cancelTask,
    extractAssetReferences: extractTaskAssetReferences,
    subscribeTaskEvents: callback => { listener = callback; return unsubscribe; },
    isTaskEventsConnected: () => false,
    schedulePoll: callback => {
      const handle = ++nextHandle;
      scheduled.set(handle, callback);
      return handle;
    },
    clearScheduledPoll: handle => { scheduled.delete(Number(handle)); },
    createSlotId: () => `memory-slot-${++nextSlotId}`,
  };
  const runNextPoll = async (): Promise<void> => {
    const pending = scheduled.entries().next().value;
    if (!pending) throw new Error('Expected an explicitly scheduled task poll');
    const [handle, callback] = pending;
    scheduled.delete(handle);
    await callback();
  };
  return {
    dependencies, submit, retryRestoredTask, restoreTasks, pollTask, cancelTask,
    unsubscribe, scheduled, runNextPoll,
    emit: (update: ImageGenerationTaskUpdate): void => { listener?.(update); },
  };
}

describe('standalone retry z client restored image generation retry', () => {
  it.each(['failed', 'timeout'] as const)('retries a restored %s task through its opaque identity in the same slot', async status => {
    const fake = harness();
    fake.restoreTasks.mockResolvedValue([failedTask({ status })]);
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.restore('original-project');
      const retried = await session.retry('restored-slot');

      expect(fake.retryRestoredTask).toHaveBeenCalledExactlyOnceWith('ancestor-task', 'original-project');
      expect(fake.submit).not.toHaveBeenCalled();
      expect(retried).toMatchObject({ id: 'restored-slot', taskId: 'child-task', projectId: 'original-project', status: 'processing', progress: 0 });
      expect(session.snapshot()).toHaveLength(1);
      expect(session.snapshot()[0].error).toBeUndefined();
      expect(fake.scheduled.size).toBe(1);
      await fake.runNextPoll();
      expect(fake.pollTask).toHaveBeenCalledExactlyOnceWith('child-task');
      expect(session.snapshot()[0].progress).toBe(42);
    } finally { session.dispose(); }
    expect(fake.scheduled.size).toBe(0);
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
  });

  it('cannot borrow a current form request or the safe projection of the restored task', async () => {
    const fake = harness();
    const currentForm: ImageGenerationRequest = {
      projectId: 'original-project', outputCount: 4, providerId: 'current-provider',
      model: 'current-model', prompt: '当前表单的红杯子', referenceImages: ['/media/current.png'],
    };
    const safeProjection = {
      ...failedTask(), prompt: '历史蓝杯子', providerId: 'original-provider', model: 'original-model',
    };
    fake.restoreTasks.mockResolvedValue([safeProjection]);
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.submit(currentForm);
      currentForm.prompt = '刷新后的表单';
      await session.restore('original-project');
      await session.retry('restored-slot');

      expect(fake.retryRestoredTask).toHaveBeenCalledExactlyOnceWith('ancestor-task', 'original-project');
      expect(fake.submit).toHaveBeenCalledTimes(1);
      expect(session.snapshot()).toHaveLength(1);
      expect(session.snapshot()[0]).toMatchObject({ id: 'restored-slot', taskId: 'child-task', status: 'processing' });
    } finally { session.dispose(); }
  });

  it.each([
    { name: 'permission denial', message: '403：原模型授权已撤销' },
    { name: 'unsafe replay denial', message: '409：原请求信息不完整，无法安全重试' },
  ])('preserves the original error and retry identity with visible feedback after $name', async ({ message }) => {
    const fake = harness();
    fake.retryRestoredTask.mockRejectedValueOnce(new Error(message));
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.restore('original-project');
      await session.retry('restored-slot');

      expect(session.snapshot()[0]).toMatchObject({
        id: 'restored-slot', taskId: 'ancestor-task', status: 'failed', progress: 37,
        error: { code: 'UPSTREAM_TIMEOUT', retryable: true },
      });
      expect(session.snapshot()[0].error?.message).toContain('原任务上游超时');
      expect(session.snapshot()[0].error?.message).toContain(message);
      expect(fake.scheduled.size).toBe(0);
      expect(fake.submit).not.toHaveBeenCalled();

      await session.retry('restored-slot');
      expect(fake.retryRestoredTask.mock.calls).toEqual([
        ['ancestor-task', 'original-project'], ['ancestor-task', 'original-project'],
      ]);
      expect(session.snapshot()[0]).toMatchObject({ taskId: 'child-task', status: 'processing' });
    } finally { session.dispose(); }
  });

  it.each(['polling', 'slots', 'outputGroup'] as const)('binds a reused failed child from a %s reply and next retries that child', async shape => {
    const fake = harness();
    const error = { code: 'CHILD_PROVIDER_FAILED', message: '复用子任务的服务端失败', retryable: true };
    const outputGroup = { version: 1, kind: 'ordinary-generation', taskId: 'failed-child', requestedCount: 1 };
    fake.retryRestoredTask.mockResolvedValueOnce({
      success: false, taskId: 'failed-child', taskIds: ['failed-child'], status: 'failed',
      error: shape === 'slots' ? error : error.message,
      ...(shape === 'slots' ? { slots: [{ taskId: 'failed-child', slotIndex: 0, status: 'failed', error }] } : {}),
      ...(shape === 'outputGroup' ? { outputGroup, result: { outputGroup } } : {}),
    }).mockResolvedValueOnce({ success: true, taskId: 'grandchild', taskIds: ['grandchild'], status: 'processing' });
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.restore('original-project');
      await session.retry('restored-slot');

      expect(session.snapshot()[0]).toMatchObject({
        id: 'restored-slot', taskId: 'failed-child', status: 'failed',
        error: { message: '复用子任务的服务端失败' },
      });
      expect(session.snapshot()[0].error?.retryable).not.toBe(false);
      expect(fake.scheduled.size).toBe(0);
      await session.retry('restored-slot');
      expect(fake.retryRestoredTask.mock.calls).toEqual([
        ['ancestor-task', 'original-project'], ['failed-child', 'original-project'],
      ]);
      expect(session.snapshot()).toHaveLength(1);
      expect(session.snapshot()[0]).toMatchObject({ id: 'restored-slot', taskId: 'grandchild', status: 'processing' });
      expect(fake.submit).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });

  it('ignores ancestor events after binding a child and accepts the child managed result', async () => {
    const fake = harness();
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.restore('original-project');
      await session.retry('restored-slot');
      expect(session.snapshot()[0].taskId).toBe('child-task');
      const child = session.snapshot();
      fake.emit({ taskId: 'ancestor-task', status: 'completed', result: managedResult('stale') });
      fake.emit({ taskId: 'ancestor-task', status: 'failed', error: '迟到的祖先失败' });
      expect(session.snapshot()).toEqual(child);

      fake.emit({ taskId: 'child-task', status: 'completed', result: managedResult('child-version') });
      expect(session.snapshot()[0]).toMatchObject({
        id: 'restored-slot', taskId: 'child-task', status: 'completed', progress: 100,
        assetVersionId: 'child-version', placementId: 'placement-child-version', url: '/media/child-version.png',
      });
      expect(fake.scheduled.size).toBe(0);
    } finally { session.dispose(); }
  });

  it('ignores an already running ancestor poll and continues polling only the child', async () => {
    const fake = harness();
    const ancestorPoll = deferred<ImageGenerationTaskUpdate>();
    fake.restoreTasks.mockResolvedValue([failedTask({ status: 'processing', error: undefined })]);
    fake.pollTask.mockReturnValueOnce(ancestorPoll.promise);
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.restore('original-project');
      const running = fake.runNextPoll();
      expect(fake.pollTask).toHaveBeenCalledExactlyOnceWith('ancestor-task');
      fake.emit({ taskId: 'ancestor-task', status: 'failed', error: '轮询期间失败' });
      await session.retry('restored-slot');
      expect(session.snapshot()[0].taskId).toBe('child-task');
      const child = session.snapshot();
      ancestorPoll.resolve({ taskId: 'ancestor-task', status: 'completed', result: managedResult('stale-poll') });
      await running;
      expect(session.snapshot()).toEqual(child);
      expect(fake.scheduled.size).toBe(1);
      await fake.runNextPoll();
      expect(fake.pollTask.mock.calls).toEqual([['ancestor-task'], ['child-task']]);
      expect(session.snapshot()[0]).toMatchObject({ taskId: 'child-task', progress: 42 });
    } finally { session.dispose(); }
  });

  it.each([
    { boundary: 'restore', outcome: 'admitted' },
    { boundary: 'restore', outcome: 'denied' },
    { boundary: 'dispose', outcome: 'admitted' },
    { boundary: 'dispose', outcome: 'denied' },
  ] as const)('ignores a late $outcome retry response after $boundary, even when a restored slot ID is reused', async ({ boundary, outcome }) => {
    const fake = harness();
    const admission = deferred<RetryResponse>();
    fake.retryRestoredTask.mockReturnValueOnce(admission.promise);
    const session = createImageGenerationSession(fake.dependencies);
    const published = vi.fn();
    session.subscribe(published);
    try {
      await session.restore('original-project');
      const pending = session.retry('restored-slot');
      expect(fake.retryRestoredTask).toHaveBeenCalledExactlyOnceWith('ancestor-task', 'original-project');

      if (boundary === 'restore') {
        fake.restoreTasks.mockResolvedValueOnce([failedTask({ projectId: 'new-project', taskId: 'new-project-task', error: '新项目原错误' })]);
        await session.restore('new-project');
      } else session.dispose();
      const expected = session.snapshot();
      const publishCount = published.mock.calls.length;

      if (outcome === 'admitted') admission.resolve({ success: true, taskId: 'late-child', taskIds: ['late-child'], status: 'processing' });
      else admission.reject(new Error('迟到的拒绝说明'));
      await pending;

      expect(session.snapshot()).toEqual(expected);
      expect(published).toHaveBeenCalledTimes(publishCount);
      expect(fake.scheduled.size).toBe(0);
      expect(fake.submit).not.toHaveBeenCalled();
      if (boundary === 'dispose') expect(fake.unsubscribe).toHaveBeenCalledOnce();
    } finally { session.dispose(); }
  });

  it('admits only once for repeated clicks while the restored retry is pending', async () => {
    const fake = harness();
    const admission = deferred<RetryResponse>();
    fake.retryRestoredTask.mockReturnValueOnce(admission.promise);
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.restore('original-project');
      const first = session.retry('restored-slot');
      const second = session.retry('restored-slot');
      expect(fake.retryRestoredTask).toHaveBeenCalledExactlyOnceWith('ancestor-task', 'original-project');
      expect(fake.submit).not.toHaveBeenCalled();
      admission.resolve({ success: true, taskId: 'one-child', taskIds: ['one-child'], status: 'processing' });
      await Promise.all([first, second]);
      expect(session.snapshot()).toHaveLength(1);
      expect(session.snapshot()[0]).toMatchObject({ id: 'restored-slot', taskId: 'one-child', status: 'processing' });
      expect(fake.scheduled.size).toBe(1);
    } finally { session.dispose(); }
  });

  it('cancels the admitted child and cleans its poll without accepting a late completion', async () => {
    const fake = harness();
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.restore('original-project');
      await session.retry('restored-slot');
      expect(await session.cancel('restored-slot')).toBe(true);
      expect(fake.cancelTask).toHaveBeenCalledExactlyOnceWith('child-task');
      expect(fake.scheduled.size).toBe(0);
      fake.emit({ taskId: 'child-task', status: 'completed', result: managedResult('cancelled-late') });
      expect(session.snapshot()[0]).toMatchObject({ id: 'restored-slot', taskId: 'child-task', status: 'cancelled' });
      expect(session.snapshot()[0].assetVersionId).toBeUndefined();
    } finally { session.dispose(); }
  });

  it('keeps in-memory retries on the original full request and preserves the sibling slot', async () => {
    const fake = harness();
    const request: ImageGenerationRequest = {
      projectId: 'memory-project', outputCount: 2, prompt: '原内存请求', providerId: 'frozen-provider',
      model: 'frozen-model', aspectRatio: '4:3', size: '1024x768', quality: 'high', referenceImages: ['/media/frozen.png'],
    };
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.submit(request);
      fake.emit({ taskId: 'memory-task-1', status: 'failed', error: '内存任务失败' });
      const sibling = session.snapshot()[0];
      fake.submit.mockResolvedValueOnce({ slots: [{ taskId: 'memory-child', slotIndex: 0, status: 'processing' }] });
      await session.retry('memory-slot-2');

      expect(fake.submit).toHaveBeenLastCalledWith({ ...request, outputCount: 1, submitOnly: true });
      expect(fake.submit).toHaveBeenCalledTimes(2);
      expect(fake.retryRestoredTask).not.toHaveBeenCalled();
      expect(session.snapshot()).toHaveLength(2);
      expect(session.snapshot()[0]).toEqual(sibling);
      expect(session.snapshot()[1]).toMatchObject({ id: 'memory-slot-2', taskId: 'memory-child', status: 'processing' });
    } finally { session.dispose(); }
  });

  it('preserves the legacy no-request result when the optional restored retry dependency is absent', async () => {
    const fake = harness();
    delete fake.dependencies.retryRestoredTask;
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.restore('original-project');
      const original = session.snapshot();
      expect(await session.retry('restored-slot')).toBeNull();
      expect(session.snapshot()).toEqual(original);
      expect(fake.submit).not.toHaveBeenCalled();
      expect(fake.scheduled.size).toBe(0);
    } finally { session.dispose(); }
  });
});


describe('standalone retry z client review regressions', () => {
  function siblingHarness() {
    const fake = harness();
    const ancestorGroup = { version: 1, kind: 'ordinary-generation', taskId: 'ancestor-task', requestedCount: 2 };
    const childGroup = { version: 1, kind: 'ordinary-generation', taskId: 'shared-child', requestedCount: 1 };
    fake.restoreTasks.mockResolvedValue([failedTask({ result: { outputGroup: ancestorGroup } })]);
    const reply: RetryResponse = {
      success: true, taskId: 'shared-child', taskIds: ['shared-child'], status: 'processing',
      outputGroup: childGroup, result: { outputGroup: childGroup },
    };
    fake.retryRestoredTask.mockResolvedValue(reply);
    return { ...fake, reply, childGroup };
  }

  it('preserves the first child owner after concurrent sibling retry replies and completes it through events', async () => {
    const fake = siblingHarness();
    const firstReply = deferred<RetryResponse>();
    const secondReply = deferred<RetryResponse>();
    fake.retryRestoredTask.mockReturnValueOnce(firstReply.promise).mockReturnValueOnce(secondReply.promise);
    const session = createImageGenerationSession(fake.dependencies);
    const ownerId = 'ancestor-task:output:0';
    const siblingId = 'ancestor-task:output:1';
    try {
      await session.restore('original-project');
      const first = session.retry(ownerId);
      const second = session.retry(siblingId);
      expect(fake.retryRestoredTask.mock.calls).toEqual([
        ['ancestor-task', 'original-project'], ['ancestor-task', 'original-project'],
      ]);
      firstReply.resolve(fake.reply);
      await first;
      const ownerPollHandles = [...fake.scheduled.keys()];
      secondReply.resolve(fake.reply);
      await second;
      const remainingPollHandles = [...fake.scheduled.keys()];
      fake.emit({
        taskId: 'shared-child', status: 'completed', progress: 100,
        result: { ...managedResult('event-owner'), outputGroup: fake.childGroup },
      });

      expect(session.snapshot().find(slot => slot.id === ownerId)).toMatchObject({
        taskId: 'shared-child', status: 'completed', assetVersionId: 'event-owner',
        placementId: 'placement-event-owner', url: '/media/event-owner.png',
      });
      const sibling = session.snapshot().find(slot => slot.id === siblingId);
      expect(sibling).toMatchObject({
        taskId: 'ancestor-task', status: 'failed', progress: 37,
        error: { code: 'UPSTREAM_TIMEOUT', retryable: true },
      });
      expect(sibling?.error?.message).toContain('原任务上游超时');
      expect(sibling?.error?.message).toContain(ownerId);
      expect(session.snapshot().filter(slot => slot.taskId === 'shared-child')).toHaveLength(1);
      expect(remainingPollHandles).toEqual(ownerPollHandles);
      expect(fake.scheduled.size).toBe(0);
      expect(fake.submit).not.toHaveBeenCalled();
    } finally {
      firstReply.resolve(fake.reply);
      secondReply.resolve(fake.reply);
      session.dispose();
    }
  });

  it('preserves the first child owner after sequential sibling retries and completes it through its original poll', async () => {
    const fake = siblingHarness();
    const session = createImageGenerationSession(fake.dependencies);
    const ownerId = 'ancestor-task:output:0';
    const siblingId = 'ancestor-task:output:1';
    try {
      await session.restore('original-project');
      await session.retry(ownerId);
      const ownerPollHandles = [...fake.scheduled.keys()];
      await session.retry(siblingId);
      const remainingPollHandles = [...fake.scheduled.keys()];
      fake.pollTask.mockResolvedValueOnce({
        taskId: 'shared-child', status: 'completed', progress: 100,
        result: { ...managedResult('polled-owner'), outputGroup: fake.childGroup },
      });
      await fake.runNextPoll();

      expect(session.snapshot().find(slot => slot.id === ownerId)).toMatchObject({
        taskId: 'shared-child', status: 'completed', assetVersionId: 'polled-owner',
        placementId: 'placement-polled-owner', url: '/media/polled-owner.png',
      });
      const sibling = session.snapshot().find(slot => slot.id === siblingId);
      expect(sibling).toMatchObject({
        taskId: 'ancestor-task', status: 'failed', progress: 37,
        error: { code: 'UPSTREAM_TIMEOUT', retryable: true },
      });
      expect(sibling?.error?.message).toContain('原任务上游超时');
      expect(sibling?.error?.message).toContain(ownerId);
      expect(remainingPollHandles).toEqual(ownerPollHandles);
      expect(fake.pollTask).toHaveBeenCalledExactlyOnceWith('shared-child');
      expect(fake.retryRestoredTask.mock.calls).toEqual([
        ['ancestor-task', 'original-project'], ['ancestor-task', 'original-project'],
      ]);
      expect(fake.scheduled.size).toBe(0);
      expect(fake.submit).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });

  it('cancels only the existing child owner after a sibling receives the same child reply', async () => {
    const fake = siblingHarness();
    const session = createImageGenerationSession(fake.dependencies);
    const ownerId = 'ancestor-task:output:0';
    const siblingId = 'ancestor-task:output:1';
    try {
      await session.restore('original-project');
      await session.retry(ownerId);
      await session.retry(siblingId);
      expect(await session.cancel(ownerId)).toBe(true);
      fake.emit({
        taskId: 'shared-child', status: 'completed', progress: 100,
        result: { ...managedResult('cancelled-owner'), outputGroup: fake.childGroup },
      });

      expect(session.snapshot().find(slot => slot.id === ownerId)).toMatchObject({
        taskId: 'shared-child', status: 'cancelled',
      });
      expect(session.snapshot().find(slot => slot.id === ownerId)?.assetVersionId).toBeUndefined();
      expect(session.snapshot().find(slot => slot.id === siblingId)).toMatchObject({
        taskId: 'ancestor-task', status: 'failed',
      });
      expect(await session.cancel(siblingId)).toBe(false);
      expect(fake.cancelTask).toHaveBeenCalledExactlyOnceWith('shared-child');
      expect(fake.scheduled.size).toBe(0);
      expect(fake.submit).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });

  it('does not mutate the disposed snapshot when an already running single-task poll completes', async () => {
    const fake = harness();
    const pollReply = deferred<ImageGenerationTaskUpdate>();
    fake.restoreTasks.mockResolvedValue([failedTask({
      taskId: 'active-before-dispose', status: 'processing', error: undefined,
    })]);
    fake.pollTask.mockReturnValueOnce(pollReply.promise);
    const session = createImageGenerationSession(fake.dependencies);
    const published = vi.fn();
    session.subscribe(published);
    try {
      await session.restore('original-project');
      const running = fake.runNextPoll();
      expect(fake.pollTask).toHaveBeenCalledExactlyOnceWith('active-before-dispose');
      session.dispose();
      const disposedSnapshot = session.snapshot();
      const publishCount = published.mock.calls.length;
      pollReply.resolve({
        taskId: 'active-before-dispose', status: 'completed', progress: 100,
        result: managedResult('disposed-late'),
      });
      await running;

      expect(session.snapshot()).toEqual(disposedSnapshot);
      expect(published).toHaveBeenCalledTimes(publishCount);
      expect(fake.scheduled.size).toBe(0);
      expect(fake.unsubscribe).toHaveBeenCalledOnce();
    } finally {
      pollReply.resolve({ taskId: 'active-before-dispose', status: 'processing' });
      session.dispose();
    }
  });
});

