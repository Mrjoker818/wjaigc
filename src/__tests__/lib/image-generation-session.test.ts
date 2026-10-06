import { describe, expect, it, vi } from 'vitest';

import {
  createImageGenerationSession,
  type ImageGenerationSessionDependencies,
  type ImageGenerationTaskUpdate,
} from '@/lib/image-generation-session';
import { extractTaskAssetReferences } from '@/lib/asset-core/workspace-transfer';

function managedResult(versionId: string, placementId: string, url = `/media/${versionId}.png`) {
  return {
    assetProjection: {
      references: [{
        assetId: `asset-${versionId}`,
        assetVersionId: versionId,
        placementId,
        url,
      }],
    },
  };
}

function harness() {
  let listener: ((update: ImageGenerationTaskUpdate) => void) | null = null;
  const submit = vi.fn(async (request: { outputCount: number }) => ({
    batchId: 'batch-1',
    slots: Array.from({ length: request.outputCount }, (_, slotIndex) => ({
      taskId: `task-${slotIndex + 1}`,
      slotId: `server-slot-${slotIndex + 1}`,
      slotIndex,
      status: 'processing',
    })),
  }));
  const dependencies: ImageGenerationSessionDependencies = {
    submit,
    subscribeTaskEvents: callback => { listener = callback; return () => { listener = null; }; },
    isTaskEventsConnected: () => true,
    cancelTask: vi.fn(async () => ({ success: true })),
    restoreTasks: vi.fn(async () => []),
    extractAssetReferences: extractTaskAssetReferences,
    schedulePoll: () => 0,
    clearScheduledPoll: vi.fn(),
  };
  return {
    dependencies,
    emit: (update: ImageGenerationTaskUpdate) => listener?.(update),
  };
}

describe('ordinary output groups', () => {
  const request = { projectId: 'p1', outputCount: 2, prompt: 'cup', providerId: 'provider', model: 'gpt-image-1' };
  const marker = { version: 1, kind: 'ordinary-generation', taskId: 'ordinary-root', requestedCount: 2 };
  function groupHarness() {
    const fake = harness();
    fake.dependencies.submit = async () => ({ taskId: 'ordinary-root', taskIds: ['ordinary-root'], outputGroup: marker, status: 'processing', result: { outputGroup: marker } });
    return fake;
  }
  function results(count: number) {
    return { outputGroup: marker, imageUrls: Array.from({ length: count }, (_, index) => `/media/v${index}.png`),
      assetProjection: { references: Array.from({ length: count }, (_, index) => managedResult(`v${index}`, `pl${index}`).assetProjection.references[0]) } };
  }
  it('maps all and extra canonical outputs to stable indices, then ignores duplicate completion', async () => {
    const fake = groupHarness(); const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.submit(request);
      fake.emit({ taskId: 'ordinary-root', status: 'completed', result: results(3) });
      const first = session.snapshot();
      expect(first.map(slot => [slot.outputIndex, slot.assetVersionId, slot.placementId, slot.status])).toEqual([
        [0, 'v0', 'pl0', 'completed'], [1, 'v1', 'pl1', 'completed'], [2, 'v2', 'pl2', 'completed'],
      ]);
      fake.emit({ taskId: 'ordinary-root', status: 'completed', result: results(3) });
      expect(session.snapshot()).toEqual(first);
    } finally { session.dispose(); }
  });
  it('keeps missing canonical projections pending and never offers regeneration', async () => {
    const fake = groupHarness(); const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.submit(request);
      fake.emit({ taskId: 'ordinary-root', status: 'completed', result: { imageUrls: ['/one', '/two'], assetProjection: { status: 'projection_pending' } } });
      expect(session.snapshot().map(slot => slot.status)).toEqual(['processing', 'processing']);
      expect(await session.retry(session.snapshot()[0].id)).toBeNull();
      fake.emit({ taskId: 'ordinary-root', status: 'completed', result: results(2) });
      expect(session.snapshot().map(slot => slot.status)).toEqual(['completed', 'completed']);
    } finally { session.dispose(); }
  });
  it('marks unproduced slots nonretryable without discarding successful results', async () => {
    const fake = groupHarness(); const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.submit(request);
      fake.emit({ taskId: 'ordinary-root', status: 'completed', result: results(1) });
      expect(session.snapshot()[0].status).toBe('completed');
      expect(session.snapshot()[1]).toMatchObject({ status: 'failed', error: { code: 'ORDINARY_OUTPUT_NOT_PRODUCED', retryable: false } });
      expect(await session.retry(session.snapshot()[1].id)).toBeNull();
    } finally { session.dispose(); }
  });
  it('cancels the whole root once and rejects late completion or another project', async () => {
    const fake = groupHarness(); const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.submit(request);
      fake.emit({ taskId: 'ordinary-root', projectId: 'p2', status: 'completed', result: results(3) });
      expect(session.snapshot().map(slot => slot.status)).toEqual(['processing', 'processing']);
      expect(await session.cancel(session.snapshot()[1].id)).toBe(true);
      expect(await session.cancel(session.snapshot()[0].id)).toBe(false);
      fake.emit({ taskId: 'ordinary-root', status: 'completed', result: results(3) });
      expect(session.snapshot().map(slot => slot.status)).toEqual(['cancelled', 'cancelled']);
      expect(fake.dependencies.cancelTask).toHaveBeenCalledTimes(1);
    } finally { session.dispose(); }
  });
  it.each([{ ...marker, requestedCount: '2' }, { ...marker, taskId: 'other' }, { ...marker, extra: true }])('does not bind malformed group %#', async outputGroup => {
    const fake = groupHarness(); fake.dependencies.submit = async () => ({ taskId: 'ordinary-root', taskIds: ['ordinary-root'], outputGroup });
    const session = createImageGenerationSession(fake.dependencies);
    try { await session.submit(request); expect(session.snapshot().every(slot => !slot.outputGroup)).toBe(true); }
    finally { session.dispose(); }
  });
  it('does not accept multiple task IDs as a group', async () => {
    const fake = groupHarness(); fake.dependencies.submit = async () => ({ taskId: 'ordinary-root', taskIds: ['ordinary-root', 'other'], outputGroup: marker });
    const session = createImageGenerationSession(fake.dependencies);
    try { await session.submit(request); expect(session.snapshot().every(slot => !slot.outputGroup)).toBe(true); }
    finally { session.dispose(); }
  });
  it('ignores an in-flight old group poll after restore into a different project', async () => {
    const fake = groupHarness();
    let finish: ((update: ImageGenerationTaskUpdate) => void) | undefined;
    let tick: (() => void | Promise<void>) | undefined;
    fake.dependencies.pollTask = () => new Promise(resolve => { finish = resolve; });
    fake.dependencies.schedulePoll = callback => { tick = callback; return 1; };
    const session = createImageGenerationSession(fake.dependencies);
    try {
      await session.submit(request); const running = tick!();
      await session.restore('p2');
      finish!({ taskId: 'ordinary-root', status: 'completed', result: results(3) }); await running;
      expect(session.snapshot()).toEqual([]);
    } finally { session.dispose(); }
  });
});

describe('image generation session', () => {
  it('binds independent slots and projects each completed image immediately', async () => {
    const fake = harness();
    const session = createImageGenerationSession(fake.dependencies);

    await session.submit({
      projectId: 'p1', outputCount: 2, prompt: '海报', providerId: 'pear', model: 'gpt-image-2',
    });
    expect(session.snapshot().map(slot => slot.status)).toEqual(['processing', 'processing']);

    fake.emit({ taskId: 'task-2', status: 'completed', progress: 100, result: managedResult('v2', 'pl2') });

    expect(session.snapshot()[1]).toMatchObject({
      status: 'completed', assetVersionId: 'v2', placementId: 'pl2', url: '/media/v2.png',
    });
    expect(session.snapshot()[0].status).toBe('processing');
  });

  it('applies the same terminal event once', async () => {
    const fake = harness();
    const session = createImageGenerationSession(fake.dependencies);
    const listener = vi.fn();
    session.subscribe(listener);
    await session.submit({ projectId: 'p1', outputCount: 1, prompt: '海报', providerId: 'pear', model: 'm' });
    const before = listener.mock.calls.length;
    const event = { taskId: 'task-1', status: 'completed' as const, progress: 100, result: managedResult('v1', 'pl1') };

    fake.emit(event);
    fake.emit(event);

    expect(listener.mock.calls.length - before).toBe(1);
  });

  it('rejects a late completion after cancellation', async () => {
    const fake = harness();
    const session = createImageGenerationSession(fake.dependencies);
    await session.submit({ projectId: 'p1', outputCount: 1, prompt: '海报', providerId: 'pear', model: 'm' });
    const slotId = session.snapshot()[0].id;

    await session.cancel(slotId);
    fake.emit({ taskId: 'task-1', status: 'completed', progress: 100, result: managedResult('late', 'late-placement') });

    expect(session.snapshot()[0]).toMatchObject({ status: 'cancelled', taskId: 'task-1' });
    expect(session.snapshot()[0].assetVersionId).toBeUndefined();
    expect(fake.dependencies.cancelTask).toHaveBeenCalledWith('task-1');
  });

  it('preserves task identity and retry metadata on failure', async () => {
    const fake = harness();
    const session = createImageGenerationSession(fake.dependencies);
    await session.submit({ projectId: 'p1', outputCount: 1, prompt: '海报', providerId: 'pear', model: 'm' });

    fake.emit({
      taskId: 'task-1', status: 'failed', progress: 37,
      error: { code: 'PROVIDER_TIMEOUT', message: '上游超时', retryable: true },
    });

    expect(session.snapshot()[0]).toMatchObject({
      taskId: 'task-1', status: 'failed', progress: 37,
      error: { code: 'PROVIDER_TIMEOUT', message: '上游超时', retryable: true },
    });
  });

  it('restores only authoritative tasks for the requested project', async () => {
    const fake = harness();
    vi.mocked(fake.dependencies.restoreTasks).mockResolvedValue([
      { id: 'restore-1', projectId: 'p1', taskId: 'task-a', status: 'processing', progress: 30 },
      { id: 'restore-2', projectId: 'p2', taskId: 'task-b', status: 'completed', progress: 100, result: managedResult('v-other', 'pl-other') },
    ]);
    const session = createImageGenerationSession(fake.dependencies);

    await session.restore('p1');

    expect(session.snapshot()).toHaveLength(1);
    expect(session.snapshot()[0]).toMatchObject({ projectId: 'p1', taskId: 'task-a', status: 'processing' });
  });

  it('does not restore a completed task without a managed asset projection as successful', async () => {
    const fake = harness();
    vi.mocked(fake.dependencies.restoreTasks).mockResolvedValue([{
      id: 'restore-empty',
      projectId: 'p1',
      taskId: 'task-empty',
      status: 'completed',
      progress: 100,
      result: { imageUrl: '/unmanaged/result.png' },
    }]);
    const session = createImageGenerationSession(fake.dependencies);

    await session.restore('p1');

    expect(session.snapshot()[0]).toMatchObject({
      status: 'failed',
      taskId: 'task-empty',
      error: { code: 'MISSING_ASSET_PROJECTION', retryable: false },
    });
  });

  it('retries a failed slot in place with a fresh task identity', async () => {
    const fake = harness();
    const session = createImageGenerationSession(fake.dependencies);
    await session.submit({ projectId: 'p1', outputCount: 2, prompt: '海报', providerId: 'pear', model: 'm' });
    const slotId = session.snapshot()[1].id;
    fake.emit({
      taskId: 'task-2', status: 'failed',
      error: { code: 'UPSTREAM', message: '上游失败', retryable: true },
    });
    vi.mocked(fake.dependencies.submit).mockResolvedValueOnce({
      batchId: 'retry-batch',
      slots: [{ taskId: 'retry-task', slotIndex: 0, status: 'processing' }],
    });

    await session.retry(slotId);

    expect(session.snapshot()).toHaveLength(2);
    expect(session.snapshot()[1]).toMatchObject({ id: slotId, taskId: 'retry-task', status: 'processing' });
    expect(fake.dependencies.submit).toHaveBeenLastCalledWith(expect.objectContaining({ outputCount: 1, submitOnly: true }));
  });

  it('polls active tasks when the event stream is disconnected', async () => {
    const fake = harness();
    const scheduled: Array<() => void> = [];
    fake.dependencies.isTaskEventsConnected = () => false;
    fake.dependencies.pollTask = vi.fn(async taskId => ({
      taskId,
      status: 'completed',
      progress: 100,
      result: managedResult('polled-version', 'polled-placement'),
    }));
    fake.dependencies.schedulePoll = callback => {
      scheduled.push(callback);
      return scheduled.length;
    };
    fake.dependencies.clearScheduledPoll = vi.fn();
    const session = createImageGenerationSession(fake.dependencies);

    await session.submit({ projectId: 'p1', outputCount: 1, prompt: '海报', providerId: 'pear', model: 'm' });
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();

    expect(session.snapshot()[0]).toMatchObject({
      status: 'completed',
      assetVersionId: 'polled-version',
      placementId: 'polled-placement',
    });
  });

  it('waits for a managed projection when SSE reports completion before projection', async () => {
    const fake = harness();
    const scheduled: Array<() => void | Promise<void>> = [];
    fake.dependencies.pollTask = vi.fn(async taskId => ({
      taskId,
      status: 'completed',
      progress: 100,
      result: managedResult('late-version', 'late-placement'),
    }));
    fake.dependencies.schedulePoll = callback => {
      scheduled.push(callback);
      return scheduled.length;
    };
    const session = createImageGenerationSession(fake.dependencies);

    await session.submit({ projectId: 'p1', outputCount: 1, prompt: '海报', providerId: 'pear', model: 'm' });
    fake.emit({ taskId: 'task-1', status: 'completed', progress: 100, result: { imageUrl: '/unmanaged.png' } });

    expect(session.snapshot()[0]).toMatchObject({ taskId: 'task-1', status: 'processing' });
    expect(session.snapshot()[0].error).toBeUndefined();
    await scheduled[0]();

    expect(fake.dependencies.pollTask).toHaveBeenCalledWith('task-1');
    expect(session.snapshot()[0]).toMatchObject({
      status: 'completed',
      assetVersionId: 'late-version',
      placementId: 'late-placement',
      url: '/media/late-version.png',
    });
  });

  it('fails an unbound slot instead of leaving it submitting forever', async () => {
    const fake = harness();
    vi.mocked(fake.dependencies.submit).mockResolvedValueOnce({
      batchId: 'short-batch',
      slots: [{ taskId: 'only-task', slotIndex: 0, status: 'processing' }],
    });
    const session = createImageGenerationSession(fake.dependencies);

    await session.submit({ projectId: 'p1', outputCount: 2, prompt: '海报', providerId: 'pear', model: 'm' });

    expect(session.snapshot()[1]).toMatchObject({
      status: 'failed',
      error: { code: 'MISSING_GENERATION_TASK', retryable: true },
    });
  });

  it('starts fallback polling when SSE disconnects after submission', async () => {
    const fake = harness();
    let connected = true;
    const scheduled: Array<() => void | Promise<void>> = [];
    fake.dependencies.isTaskEventsConnected = () => connected;
    fake.dependencies.pollTask = vi.fn(async taskId => ({
      taskId,
      status: 'completed',
      result: managedResult('late-poll', 'late-placement'),
    }));
    fake.dependencies.schedulePoll = callback => {
      scheduled.push(callback);
      return scheduled.length;
    };
    const session = createImageGenerationSession(fake.dependencies);
    await session.submit({ projectId: 'p1', outputCount: 1, prompt: '海报', providerId: 'pear', model: 'm' });

    expect(scheduled).toHaveLength(1);
    connected = false;
    await scheduled[0]();

    expect(fake.dependencies.pollTask).toHaveBeenCalledWith('task-1');
    expect(session.snapshot()[0].status).toBe('completed');
  });
});
