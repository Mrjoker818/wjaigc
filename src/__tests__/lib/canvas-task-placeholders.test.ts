import { describe, expect, it } from 'vitest';
import {
  applyGenerationSlotsToProcessingPlaceholders,
  applyTaskIdsToProcessingPlaceholders,
  mergeLocalCompletedTaskProjection,
  preserveLocalCanvasTaskSlotOrder,
  shouldPreserveProjectedCanvasCompletion,
  shouldPersistProcessingPlaceholder,
} from '@/lib/canvas-task-placeholders';

describe('canvas-task-placeholders', () => {
  it('keeps only active processing placeholders during project sync', () => {
    expect(shouldPersistProcessingPlaceholder({ isProcessingPlaceholder: true, processing: { status: 'processing' } })).toBe(true);
    expect(shouldPersistProcessingPlaceholder({ isProcessingPlaceholder: true, processing: { status: 'submitting' } })).toBe(true);
  });

  it('drops failed and cancelled placeholders so completed results do not overlap them', () => {
    expect(shouldPersistProcessingPlaceholder({ isProcessingPlaceholder: true, processing: { status: 'failed' } })).toBe(false);
    expect(shouldPersistProcessingPlaceholder({ isProcessingPlaceholder: true, processing: { status: 'cancelled' } })).toBe(false);
    expect(shouldPersistProcessingPlaceholder({ isProcessingPlaceholder: true, processing: { status: 'timeout' } })).toBe(false);
  });

  it('persists each asynchronous task ID onto its matching canvas placeholder', () => {
    expect(applyTaskIdsToProcessingPlaceholders([
      { id: 'frame-a', isProcessingPlaceholder: true, processing: { status: 'submitting', progress: 5 } },
      { id: 'frame-b', isProcessingPlaceholder: true, processing: { status: 'submitting', progress: 5 } },
      { id: 'already-an-image', isProcessingPlaceholder: false, processing: { status: 'submitting', progress: 5 } },
    ], ['frame-a', 'frame-b'], ['task-a', 'task-b'])).toEqual([
      { id: 'frame-a', isProcessingPlaceholder: true, processing: { status: 'processing', progress: 10, taskId: 'task-a', label: '已提交，等待生成' } },
      { id: 'frame-b', isProcessingPlaceholder: true, processing: { status: 'processing', progress: 10, taskId: 'task-b', label: '已提交，等待生成' } },
      { id: 'already-an-image', isProcessingPlaceholder: false, processing: { status: 'submitting', progress: 5 } },
    ]);
  });

  it('does not overwrite a terminal placeholder during a later project sync', () => {
    const images = [
      { id: 'frame-a', isProcessingPlaceholder: true, processing: { status: 'failed', taskId: 'task-a', progress: 0 } },
    ];

    expect(applyTaskIdsToProcessingPlaceholders(
      images,
      ['frame-a'],
      ['task-a'],
    )).toEqual(images);
  });

  it('binds submitted tasks to placeholders by durable slot identity instead of response order', () => {
    const images = [
      {
        id: 'frame-slot-0',
        isProcessingPlaceholder: true,
        processing: {
          status: 'submitting',
          progress: 5,
          batchId: 'batch-a',
          slotId: 'batch-a:0',
          slotIndex: 0,
        },
      },
      {
        id: 'frame-slot-1',
        isProcessingPlaceholder: true,
        processing: {
          status: 'submitting',
          progress: 5,
          batchId: 'batch-a',
          slotId: 'batch-a:1',
          slotIndex: 1,
        },
      },
    ];

    const result = applyGenerationSlotsToProcessingPlaceholders(images, [
      { batchId: 'batch-a', slotId: 'batch-a:1', slotIndex: 1, taskId: 'task-b', status: 'submitting' },
      { batchId: 'batch-a', slotId: 'batch-a:0', slotIndex: 0, taskId: 'task-a', status: 'submitting' },
    ]);

    expect(result[0].processing).toMatchObject({
      batchId: 'batch-a',
      slotId: 'batch-a:0',
      slotIndex: 0,
      taskId: 'task-a',
    });
    expect(result[1].processing).toMatchObject({
      batchId: 'batch-a',
      slotId: 'batch-a:1',
      slotIndex: 1,
      taskId: 'task-b',
    });
  });

  it('keeps legacy taskIds array compatibility for placeholders without slot metadata', () => {
    const images: Array<{
      id: string;
      isProcessingPlaceholder: boolean;
      processing: {
        status: string;
        progress: number;
        taskId?: string;
      };
    }> = [
      { id: 'legacy-a', isProcessingPlaceholder: true, processing: { status: 'submitting', progress: 5 } },
      { id: 'legacy-b', isProcessingPlaceholder: true, processing: { status: 'submitting', progress: 5 } },
    ];

    expect(applyTaskIdsToProcessingPlaceholders(
      images,
      ['legacy-a', 'legacy-b'],
      ['task-a', 'task-b'],
    ).map((image) => image.processing?.taskId))
      .toEqual(['task-a', 'task-b']);
  });

  it('persists a reused terminal slot task id so reload can fetch its durable result', () => {
    const images = [{
      id: 'frame-slot-0',
      isProcessingPlaceholder: true,
      processing: {
        status: 'submitting',
        progress: 5,
        batchId: 'batch-a',
        slotId: 'batch-a:0',
        slotIndex: 0,
      },
    }];

    const result = applyGenerationSlotsToProcessingPlaceholders(images, [{
      batchId: 'batch-a',
      slotId: 'batch-a:0',
      slotIndex: 0,
      taskId: 'completed-task',
      status: 'completed',
      result: { imageUrl: 'https://cdn.example.com/completed.png' },
    }]);

    expect(result[0].processing).toMatchObject({
      batchId: 'batch-a',
      slotId: 'batch-a:0',
      slotIndex: 0,
      taskId: 'completed-task',
      status: 'completed',
      progress: 100,
    });
  });

  it('binds failed submit metadata without discarding the later unified error projection', () => {
    const result = applyGenerationSlotsToProcessingPlaceholders([{
      id: 'frame-slot-0',
      isProcessingPlaceholder: true,
      processing: { status: 'submitting', progress: 5, slotIndex: 0 },
    }], [{
      batchId: 'batch-a',
      slotId: 'batch-a:0',
      slotIndex: 0,
      taskId: 'failed-task',
      status: 'failed',
    }]);

    expect(result[0].processing).toMatchObject({
      taskId: 'failed-task',
      status: 'submitting',
    });
  });
  it('binds a normalized fallback slot sequence without duplicate-index overwrite', () => {
    const images = [
      { id: 'frame-a', isProcessingPlaceholder: true, processing: { status: 'submitting', progress: 5 } },
      { id: 'frame-b', isProcessingPlaceholder: true, processing: { status: 'submitting', progress: 5 } },
    ];
    const normalized = [
      { taskId: 'task-a', batchId: 'batch-a', slotId: 'batch-a:0', slotIndex: 0, status: 'submitting' as const },
      { taskId: 'task-b', batchId: 'batch-a', slotId: 'batch-a:1', slotIndex: 1, status: 'submitting' as const },
    ];

    const result = applyGenerationSlotsToProcessingPlaceholders(
      images,
      normalized,
      ['frame-a', 'frame-b'],
    );

    expect(result.map(image => (
      image.processing as { taskId?: string } | undefined
    )?.taskId)).toEqual(['task-a', 'task-b']);
  });

  it('keeps the local completed terminal projection over a stale server placeholder', () => {
    const server = {
      id: 'frame-slot-1',
      url: '',
      isProcessingPlaceholder: true,
      processing: { taskId: 'task-b', status: 'processing', progress: 35 },
      taskProjection: { taskId: 'task-b', outputIndex: 0, status: 'processing', progress: 35 },
      mediaAvailability: 'missing',
      mediaErrorCode: 'MEDIA_UNAVAILABLE',
      model: 'stale-model',
      apiProviderId: 'stale-provider',
    };
    const local = {
      id: 'frame-slot-1',
      url: '/api/serve-upload/completed.png',
      sourceUrl: '/api/serve-upload/completed.png',
      isProcessingPlaceholder: false,
      processing: undefined,
      generationTaskId: 'task-b',
      taskProjection: { taskId: 'task-b', outputIndex: 0, status: 'completed', progress: 100 },
      mediaAvailability: 'ready',
      mediaErrorCode: undefined,
      model: 'gpt-image-2',
      modelName: 'GPT Image 2',
      apiProviderId: 'pear-image',
      apiProvider: 'PearAPI',
    };

    expect(mergeLocalCompletedTaskProjection(server, local)).toMatchObject({
      url: '/api/serve-upload/completed.png',
      sourceUrl: '/api/serve-upload/completed.png',
      isProcessingPlaceholder: false,
      generationTaskId: 'task-b',
      taskProjection: { status: 'completed', progress: 100 },
      mediaAvailability: 'ready',
      model: 'gpt-image-2',
      modelName: 'GPT Image 2',
      apiProviderId: 'pear-image',
      apiProvider: 'PearAPI',
    });
    expect(mergeLocalCompletedTaskProjection(server, local).processing).toBeUndefined();
    expect(mergeLocalCompletedTaskProjection(server, local).mediaErrorCode).toBeUndefined();
  });

  it('does not treat an ordinary non-task image as an authoritative task completion', () => {
    const server = {
      id: 'ordinary-image',
      url: '/api/serve-upload/server.png',
      mediaAvailability: 'ready',
      model: 'server-model',
    };
    const local = {
      id: 'ordinary-image',
      url: '/api/serve-upload/local.png',
      isProcessingPlaceholder: false,
      processing: undefined,
      model: 'local-model',
    };

    expect(mergeLocalCompletedTaskProjection(server, local)).toBe(server);
  });

  it('prevents a legacy frame completion from rewriting an already projected result', () => {
    expect(shouldPreserveProjectedCanvasCompletion({
      url: '/api/serve-upload/completed.png',
      taskProjection: {
        taskId: 'task-b',
        outputIndex: 0,
        status: 'completed',
        progress: 100,
      },
    }, '/api/serve-upload/completed.png')).toBe(true);
    expect(shouldPreserveProjectedCanvasCompletion({
      url: '',
      taskProjection: {
        taskId: 'task-b',
        outputIndex: 0,
        status: 'processing',
        progress: 35,
      },
    }, '/api/serve-upload/completed.png')).toBe(false);
  });

  it('keeps task slots in their local creation order after server reconciliation', () => {
    const local = [1, 2, 3, 4].map((slot) => ({
      id: `slot-${slot}`,
      taskProjection: {
        taskId: `task-${slot}`,
        outputIndex: 0,
        status: slot === 4 ? 'processing' : 'completed',
        progress: slot === 4 ? 35 : 100,
      },
    }));
    const merged = [local[2], local[0], local[1], local[3]];

    expect(preserveLocalCanvasTaskSlotOrder(merged, local).map(node => node.id))
      .toEqual(['slot-1', 'slot-2', 'slot-3', 'slot-4']);
  });
});
