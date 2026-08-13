import { describe, expect, it } from 'vitest';

import {
  getCanvasKernelReadStrategy,
  getCanvasKernelWriteStrategy,
  resolveCanvasKernelMode,
} from '@/lib/canvas-kernel/mode';

describe('canvas kernel mode contract', () => {
  it('defaults missing and unknown values to legacy', () => {
    expect(resolveCanvasKernelMode()).toBe('legacy');
    expect(resolveCanvasKernelMode('')).toBe('legacy');
    expect(resolveCanvasKernelMode('invalid')).toBe('legacy');
  });

  it('keeps all three supported modes distinct', () => {
    expect(resolveCanvasKernelMode('legacy')).toBe('legacy');
    expect(resolveCanvasKernelMode('shadow')).toBe('shadow');
    expect(resolveCanvasKernelMode('canvas-v2')).toBe('canvas-v2');
  });

  it('prevents shadow mode from becoming write-authoritative', () => {
    expect(getCanvasKernelReadStrategy('legacy')).toBe('legacy-authoritative');
    expect(getCanvasKernelReadStrategy('shadow')).toBe('shadow-compare');
    expect(getCanvasKernelReadStrategy('canvas-v2')).toBe('kernel-authoritative');
    expect(getCanvasKernelWriteStrategy('legacy')).toBe('legacy-authoritative');
    expect(getCanvasKernelWriteStrategy('shadow')).toBe('legacy-authoritative');
    expect(getCanvasKernelWriteStrategy('canvas-v2')).toBe('kernel-authoritative');
  });
});
