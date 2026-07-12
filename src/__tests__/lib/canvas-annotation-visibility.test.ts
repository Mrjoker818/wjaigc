import { describe, expect, it } from 'vitest';
import { shouldShowAnnotationBubble } from '@/lib/canvas-annotation-visibility';

describe('shouldShowAnnotationBubble', () => {
  it('keeps a failed annotation visible so its API error can be read and retried', () => {
    expect(shouldShowAnnotationBubble({ status: 'failed', chatExpanded: false })).toBe(true);
  });
});
