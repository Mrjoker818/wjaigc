import { describe, expect, it } from 'vitest';
import { shouldSuspendCanvasVirtualization } from '@/lib/canvas-pan-virtualization';

describe('canvas pan virtualization', () => {
  it('keeps the rendered image set stable while a pan transform is in flight', () => {
    expect(shouldSuspendCanvasVirtualization(true, false)).toBe(true);
    expect(shouldSuspendCanvasVirtualization(false, true)).toBe(true);
  });

  it('restores viewport culling when no pan is active', () => {
    expect(shouldSuspendCanvasVirtualization(false, false)).toBe(false);
  });
});
