import { describe, expect, it } from 'vitest';
import { shouldPersistProcessingPlaceholder } from '@/lib/canvas-task-placeholders';

describe('canvas-task-placeholders', () => {
  it('keeps only active processing placeholders during project sync', () => {
    expect(shouldPersistProcessingPlaceholder({ isProcessingPlaceholder: true, processing: { status: 'processing' } })).toBe(true);
    expect(shouldPersistProcessingPlaceholder({ isProcessingPlaceholder: true, processing: { status: 'submitting' } })).toBe(true);
  });

  it('drops failed and cancelled placeholders so completed results do not overlap them', () => {
    expect(shouldPersistProcessingPlaceholder({ isProcessingPlaceholder: true, processing: { status: 'failed' } })).toBe(false);
    expect(shouldPersistProcessingPlaceholder({ isProcessingPlaceholder: true, processing: { status: 'cancelled' } })).toBe(false);
  });
});
