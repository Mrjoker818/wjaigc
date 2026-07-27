import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isConnected: vi.fn(),
  onTaskEvent: vi.fn(),
}));

vi.mock('@/lib/task-events-client', () => ({
  taskEventsClient: {
    isConnected: mocks.isConnected,
    onTaskEvent: mocks.onTaskEvent,
  },
}));

import { waitForAnnotationTaskResult } from '@/features/annotations/annotation-task-client';

describe('annotation task client', () => {
  let taskHandler: ((event: unknown) => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    taskHandler = undefined;
    mocks.isConnected.mockReset();
    mocks.onTaskEvent.mockReset();
    mocks.onTaskEvent.mockImplementation((handler: (event: unknown) => void) => {
      taskHandler = handler;
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves immediately from the SSE task event', async () => {
    mocks.isConnected.mockReturnValue(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const pending = waitForAnnotationTaskResult('task-1');
    taskHandler?.({
      taskId: 'task-1',
      type: 'completed',
      task: {
        status: 'completed',
        result: { imageUrl: 'https://example.com/result.png' },
      },
    });

    await expect(pending).resolves.toMatchObject({
      taskId: 'task-1',
      imageUrl: 'https://example.com/result.png',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to polling explicit task state when SSE is disconnected', async () => {
    mocks.isConnected.mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      result: { imageUrl: 'https://example.com/polled.png' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const pending = waitForAnnotationTaskResult('task-2');
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).resolves.toMatchObject({
      taskId: 'task-2',
      imageUrl: 'https://example.com/polled.png',
    });
  });

  it('surfaces failed task events without waiting for the timeout', async () => {
    mocks.isConnected.mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn());

    const pending = waitForAnnotationTaskResult('task-3');
    taskHandler?.({
      taskId: 'task-3',
      type: 'failed',
      task: {
        status: 'failed',
        error: 'provider rejected request',
      },
    });

    await expect(pending).rejects.toMatchObject({
      code: 'ANNOTATION_TASK_FAILED',
      message: 'provider rejected request',
      retryable: true,
    });
  });

  it('reports bounded processing progress and only reaches 100 on completion', async () => {
    mocks.isConnected.mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn());
    const onProgress = vi.fn();

    const pending = waitForAnnotationTaskResult('task-4', { onProgress });
    taskHandler?.({
      taskId: 'task-4',
      type: 'progress',
      task: {
        status: 'processing',
        progress: 150,
        label: '模型正在处理',
      },
    });
    taskHandler?.({
      taskId: 'task-4',
      type: 'completed',
      task: {
        status: 'completed',
        progress: 90,
        label: '正在保存结果',
        result: { imageUrl: 'https://example.com/result.png' },
      },
    });

    await expect(pending).resolves.toMatchObject({
      imageUrl: 'https://example.com/result.png',
    });
    expect(onProgress.mock.calls).toEqual([
      [95, '模型正在处理'],
      [100, '修改完成'],
    ]);
  });
});
