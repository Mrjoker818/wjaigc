import { describe, expect, it } from 'vitest';
import {
  applyGenerationSlotsToProcessingPlaceholders,
  applyTaskIdsToProcessingPlaceholders,
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
});
