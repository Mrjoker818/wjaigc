import { describe, expect, it } from 'vitest';
import {
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
});
