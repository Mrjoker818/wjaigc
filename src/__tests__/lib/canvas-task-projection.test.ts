import { describe, expect, it } from 'vitest';

import {
  createCanvasDocumentSnapshot,
  executeCanvasCommand,
  type CanvasDocumentSnapshot,
} from '@/lib/canvas-kernel/commands';
import {
  projectCanvasTaskEvent,
  type CanvasTaskEvent,
} from '@/lib/canvas-kernel/task-projection';

function placeholder(
  taskId: string,
  slotIndex: number,
  status = 'processing',
) {
  return {
    id: `frame-${slotIndex}`,
    x: slotIndex * 120,
    y: 0,
    width: 100,
    height: 100,
    url: '',
    model: 'gpt-image-2',
    apiProviderId: 'pear-image',
    isProcessingPlaceholder: true,
    processing: {
      taskId,
      batchId: 'batch-a',
      slotId: `batch-a:${slotIndex}`,
      slotIndex,
      outputIndex: 0,
      status,
      progress: status === 'processing' ? 30 : 0,
      label: '生成中',
      revision: 2,
    },
  };
}

function event(
  taskId: string,
  slotIndex: number,
  overrides: Partial<CanvasTaskEvent> = {},
): CanvasTaskEvent {
  return {
    taskId,
    batchId: 'batch-a',
    slotId: `batch-a:${slotIndex}`,
    slotIndex,
    outputIndex: 0,
    status: 'completed',
    progress: 100,
    revision: 3,
    providerId: 'pear-image',
    modelId: 'gpt-image-2',
    result: { url: `https://cdn.example.com/${slotIndex}.png` },
    ...overrides,
  };
}

function apply(snapshot: CanvasDocumentSnapshot, taskEvent: CanvasTaskEvent): CanvasDocumentSnapshot {
  return projectCanvasTaskEvent(snapshot, taskEvent).reduce(
    (current, command) => executeCanvasCommand(current, command).next,
    snapshot,
  );
}

describe('projectCanvasTaskEvent', () => {
  it.each([1, 2, 3, 4])('projects each of %i generation slots independently', (count) => {
    let snapshot = createCanvasDocumentSnapshot(
      Array.from({ length: count }, (_, index) => placeholder(`task-${index}`, index)),
    );

    for (let index = count - 1; index >= 0; index -= 1) {
      const commands = projectCanvasTaskEvent(snapshot, event(`task-${index}`, index));
      expect(commands).toEqual([
        expect.objectContaining({
          type: 'task-result',
          id: `frame-${index}`,
          taskId: `task-${index}`,
          outputIndex: 0,
          terminal: true,
        }),
      ]);
      snapshot = executeCanvasCommand(snapshot, commands[0]).next;
      expect(snapshot.byId[`frame-${index}`]).toMatchObject({
        url: `https://cdn.example.com/${index}.png`,
        isProcessingPlaceholder: false,
        generationTaskId: `task-${index}`,
      });
      expect(snapshot.byId[`frame-${index}`].processing).toBeUndefined();
    }
  });

  it('keeps terminal failures and rejects a late completed result', () => {
    const initial = createCanvasDocumentSnapshot([placeholder('task-a', 0)]);
    const failed = apply(initial, event('task-a', 0, {
      status: 'failed',
      progress: 70,
      error: {
        code: 'PROVIDER_REJECTED',
        message: '供应商拒绝了本次生成',
        source: 'provider',
        retryable: false,
        requestId: 'req_failure',
      },
      result: undefined,
    }));

    expect(failed.byId['frame-0'].processing).toMatchObject({
      status: 'failed',
      error: '供应商拒绝了本次生成',
      errorCode: 'PROVIDER_REJECTED',
      retryable: false,
    });
    expect(projectCanvasTaskEvent(failed, event('task-a', 0, { revision: 4 }))).toEqual([]);
  });

  it.each(['cancelled', 'timeout'] as const)('does not regress a %s slot', (status) => {
    const initial = createCanvasDocumentSnapshot([placeholder('task-a', 0, status)]);
    expect(projectCanvasTaskEvent(initial, event('task-a', 0))).toEqual([]);
  });

  it('deduplicates completed delivery from SSE, polling and refresh recovery', () => {
    const initial = createCanvasDocumentSnapshot([placeholder('task-a', 0)]);
    const completed = apply(initial, event('task-a', 0, {
      result: {
        url: 'https://cdn.example.com/final.png',
        assetVersionId: 'version-a',
        placementId: 'placement-a',
      },
    }));

    expect(projectCanvasTaskEvent(completed, event('task-a', 0, {
      revision: 3,
      result: {
        url: 'https://cdn.example.com/final.png',
        assetVersionId: 'version-a',
        placementId: 'placement-a',
      },
    }))).toEqual([]);
  });

  it('allows a later completed event to enrich missing durable asset identity', () => {
    const initial = createCanvasDocumentSnapshot([placeholder('task-a', 0)]);
    const sseCompleted = apply(initial, event('task-a', 0, {
      source: 'sse',
      result: { url: 'https://cdn.example.com/final.png' },
    }));
    const commands = projectCanvasTaskEvent(sseCompleted, event('task-a', 0, {
      source: 'poll',
      revision: 4,
      result: {
        url: 'https://cdn.example.com/final.png',
        assetVersionId: 'version-a',
        placementId: 'placement-a',
      },
    }));

    expect(commands).toHaveLength(1);
    expect(executeCanvasCommand(sseCompleted, commands[0]).next.byId['frame-0']).toMatchObject({
      assetVersionId: 'version-a',
      placementId: 'placement-a',
    });
  });

  it('rejects duplicate and out-of-order non-terminal events', () => {
    const initial = createCanvasDocumentSnapshot([placeholder('task-a', 0)]);
    const progressed = apply(initial, event('task-a', 0, {
      status: 'uploading',
      progress: 80,
      revision: 5,
      result: undefined,
    }));

    expect(projectCanvasTaskEvent(progressed, event('task-a', 0, {
      status: 'processing',
      progress: 60,
      revision: 4,
      result: undefined,
    }))).toEqual([]);
    expect(projectCanvasTaskEvent(progressed, event('task-a', 0, {
      status: 'uploading',
      progress: 80,
      revision: 5,
      result: undefined,
    }))).toEqual([]);
  });

  it('resumes a persisted placeholder and preserves provider/model identity', () => {
    const base = placeholder('task-a', 0);
    const resumed = {
      ...base,
      mediaAvailability: 'missing',
      mediaErrorCode: 'MEDIA_UNAVAILABLE',
      processing: { ...base.processing, isResumed: true },
    };
    const snapshot = createCanvasDocumentSnapshot([resumed]);
    const command = projectCanvasTaskEvent(snapshot, event('task-a', 0, {
      providerId: undefined,
      modelId: undefined,
      result: { url: 'https://cdn.example.com/recovered.png' },
    }))[0];

    expect(command).toMatchObject({
      type: 'task-result',
      patch: {
        apiProviderId: 'pear-image',
        model: 'gpt-image-2',
        mediaAvailability: 'ready',
        mediaErrorCode: undefined,
      },
    });
  });

  it('completes a resumed slot whose latest poll projection has no revision', () => {
    const base = placeholder('task-b', 1);
    const snapshot = createCanvasDocumentSnapshot([{
      ...base,
      mediaAvailability: 'missing',
      processing: {
        ...base.processing,
        revision: undefined,
        isResumed: true,
      },
      taskProjection: {
        taskId: 'task-b',
        outputIndex: 0,
        status: 'processing',
        progress: 35,
        source: 'poll',
      },
    }]);

    const completed = apply(snapshot, event('task-b', 1, {
      revision: undefined,
      source: 'recovery',
      providerId: undefined,
      modelId: undefined,
      result: { url: '/api/serve-upload/e2e-progressive-slot-2.png' },
    }));

    expect(completed.byId['frame-1']).toMatchObject({
      url: '/api/serve-upload/e2e-progressive-slot-2.png',
      isProcessingPlaceholder: false,
      generationTaskId: 'task-b',
      mediaAvailability: 'ready',
      taskProjection: {
        taskId: 'task-b',
        status: 'completed',
        source: 'recovery',
      },
    });
  });

  it('updates only the failed slot in a partially successful batch', () => {
    let snapshot = createCanvasDocumentSnapshot([
      placeholder('task-a', 0),
      placeholder('task-b', 1),
    ]);
    snapshot = apply(snapshot, event('task-a', 0));
    snapshot = apply(snapshot, event('task-b', 1, {
      status: 'failed',
      result: undefined,
      error: {
        code: 'MODEL_TIMEOUT',
        message: '模型响应超时',
        source: 'provider',
        retryable: true,
        requestId: 'req_timeout',
      },
    }));

    expect(snapshot.byId['frame-0'].url).toContain('/0.png');
    expect(snapshot.byId['frame-1'].processing).toMatchObject({
      status: 'failed',
      errorCode: 'MODEL_TIMEOUT',
    });
  });
});
