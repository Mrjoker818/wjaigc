import { describe, expect, it } from 'vitest';

import {
  consumeCanvasHydrationGuard,
  createCanvasHydrationGuard,
  shouldConsumeCanvasHydrationGuard,
} from '@/lib/canvas-autosave-guard';

const image = (overrides: Record<string, unknown> = {}) => ({
  id: 'image-1',
  url: '/api/serve-upload/uploads/image-1.png',
  x: 120,
  y: 80,
  width: 256,
  height: 256,
  rotation: 0,
  zIndex: 1,
  ...overrides,
});

describe('canvas autosave hydration guard', () => {
  it('consumes exactly the unchanged project hydration snapshot', () => {
    const guard = createCanvasHydrationGuard('project-1', [image()]);

    expect(shouldConsumeCanvasHydrationGuard(guard, 'project-1', [image()])).toBe(true);
    expect(shouldConsumeCanvasHydrationGuard(guard, 'project-2', [image()])).toBe(false);
  });

  it('does not suppress a user mutation made during project hydration', () => {
    const guard = createCanvasHydrationGuard('project-1', [image()]);

    expect(shouldConsumeCanvasHydrationGuard(guard, 'project-1', [image({ x: 180 })])).toBe(false);
    expect(shouldConsumeCanvasHydrationGuard(guard, 'project-1', [image(), image({ id: 'image-2' })])).toBe(false);
  });

  it('suppresses an immediate-save snapshot once and then releases the guard', () => {
    const guard = createCanvasHydrationGuard('project-1', [image()]);
    const first = consumeCanvasHydrationGuard(guard, 'project-1', [image()]);
    const second = consumeCanvasHydrationGuard(first.nextGuard, 'project-1', [image()]);

    expect(first).toEqual({ suppress: true, nextGuard: null });
    expect(second).toEqual({ suppress: false, nextGuard: null });
  });

  it('releases a stale same-project guard without suppressing the mutation', () => {
    const guard = createCanvasHydrationGuard('project-1', [image()]);

    expect(consumeCanvasHydrationGuard(guard, 'project-1', [image({ x: 180 })]))
      .toEqual({ suppress: false, nextGuard: null });
  });
});
