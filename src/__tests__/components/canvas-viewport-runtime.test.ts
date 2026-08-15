import { beforeEach, describe, expect, it, vi } from 'vitest';

const reactMocks = vi.hoisted(() => ({
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  transitions: [] as Array<() => void>,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    startTransition: (callback: () => void) => {
      reactMocks.transitions.push(callback);
    },
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
    useEffect: vi.fn(),
    useRef: <T>(value: T) => ({ current: value }),
    useState: <T>(initializer: T | (() => T)) => {
      const value = typeof initializer === 'function'
        ? (initializer as () => T)()
        : initializer;
      const setter = vi.fn();
      reactMocks.setters.push(setter);
      return [value, setter] as const;
    },
  };
});

import { useCanvasViewport } from '@/components/canvas/use-canvas-viewport';

describe('canvas viewport runtime behavior', () => {
  let animationFrame: FrameRequestCallback | null;

  beforeEach(() => {
    reactMocks.setters.length = 0;
    reactMocks.transitions.length = 0;
    animationFrame = null;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrame = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  function useViewportHarness(onPanViewportSync = vi.fn()) {
    const transform = {
      dataset: {} as Record<string, string>,
      style: { transform: '', pointerEvents: '' },
    };
    const viewport = useCanvasViewport({
      mode: 'legacy',
      transformRef: { current: transform } as unknown as React.RefObject<HTMLDivElement>,
      onPanViewportSync,
    });
    return { onPanViewportSync, transform, viewport };
  }

  function flushAnimationFrame(now: number): void {
    const callback = animationFrame;
    animationFrame = null;
    expect(callback).not.toBeNull();
    callback?.(now);
  }

  it('starts a pan in refs without publishing React state', () => {
    const { transform, viewport } = useViewportHarness();

    expect(viewport.beginPan({ pointerId: 7, clientX: 10, clientY: 20 })).toBe(true);
    expect(reactMocks.setters.every((setter) => setter.mock.calls.length === 0)).toBe(true);

    viewport.previewPan({ pointerId: 7, clientX: 30, clientY: 45 });
    flushAnimationFrame(10);
    expect(transform.style.transform).toBe('translate(20px, 25px) scale(1)');
  });

  it('marks the pan lifetime without disabling media hit testing', () => {
    const { transform, viewport } = useViewportHarness();

    expect(viewport.beginPan({ pointerId: 7, clientX: 10, clientY: 20 })).toBe(true);
    expect(transform.dataset.canvasPanActive).toBe('true');
    expect(transform.style.pointerEvents).toBe('');

    viewport.commitPan({ pointerId: 7 });
    expect(transform.dataset.canvasPanActive).toBeUndefined();
    expect(transform.style.pointerEvents).toBe('');

    expect(viewport.beginPan({ pointerId: 8, clientX: 30, clientY: 40 })).toBe(true);
    expect(transform.style.pointerEvents).toBe('');
    viewport.cancelPan({ pointerId: 8 });
    expect(transform.dataset.canvasPanActive).toBeUndefined();
    expect(transform.style.pointerEvents).toBe('');
  });

  it('keeps the first pointer as owner when a second pointer tries to begin', () => {
    const { transform, viewport } = useViewportHarness();

    expect(viewport.beginPan({ pointerId: 1, clientX: 0, clientY: 0 })).toBe(true);
    expect(viewport.beginPan({ pointerId: 2, clientX: 100, clientY: 100 })).toBe(false);

    viewport.previewPan({ pointerId: 2, clientX: 200, clientY: 200 });
    flushAnimationFrame(10);
    expect(transform.style.transform).toBe('translate(0px, 0px) scale(1)');

    viewport.previewPan({ pointerId: 1, clientX: 20, clientY: 30 });
    flushAnimationFrame(20);
    expect(transform.style.transform).toBe('translate(20px, 30px) scale(1)');
  });

  it('publishes React state only after crossing the culling synchronization threshold', () => {
    const { onPanViewportSync, viewport } = useViewportHarness();
    expect(viewport.beginPan({ pointerId: 3, clientX: 0, clientY: 0 })).toBe(true);

    viewport.previewPan({ pointerId: 3, clientX: 20, clientY: 10 });
    flushAnimationFrame(10);
    expect(onPanViewportSync).not.toHaveBeenCalled();
    expect(reactMocks.setters.every((setter) => setter.mock.calls.length === 0)).toBe(true);

    viewport.previewPan({ pointerId: 3, clientX: 300, clientY: 10 });
    flushAnimationFrame(100);
    expect(onPanViewportSync).toHaveBeenCalledTimes(1);
    expect(onPanViewportSync).toHaveBeenCalledWith({ x: 300, y: 10 });
    expect(reactMocks.setters.some((setter) => setter.mock.calls.length > 0)).toBe(true);
  });

  it('commits the compositor transform before deferring React viewport publication', () => {
    const { transform, viewport } = useViewportHarness();
    expect(viewport.beginPan({ pointerId: 9, clientX: 0, clientY: 0 })).toBe(true);
    viewport.previewPan({ pointerId: 9, clientX: 120, clientY: 72 });
    flushAnimationFrame(10);
    expect(transform.style.transform).toBe('translate(120px, 72px) scale(1)');

    viewport.commitPan({ pointerId: 9 });

    expect(transform.style.transform).toBe('translate(120px, 72px) scale(1)');
    expect(reactMocks.transitions).toHaveLength(1);
    expect(reactMocks.setters.every((setter) => setter.mock.calls.length === 0)).toBe(true);

    reactMocks.transitions[0]();
    expect(reactMocks.setters.some((setter) => setter.mock.calls.length > 0)).toBe(true);
  });
});
