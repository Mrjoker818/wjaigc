// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';

const source: CanvasImage = {
  id: 'source', url: '/api/serve-upload/source.png', prompt: 'source',
  x: 100, y: 100, width: 200, height: 200, rotation: 0, zIndex: 1, createdAt: 1,
};

function Canvas({ onChange }: {
  onChange: (annotations: CanvasAnnotationV2[]) => boolean;
}): React.JSX.Element {
  const [selected, setSelected] = useState<CanvasImage | null>(source);
  return <InfiniteCanvas images={[source]} onImagesChange={() => undefined}
    selectedImage={selected} onSelectImage={setSelected} onPreviewImage={() => undefined}
    onGenerateVariation={() => undefined} onExtractKeywords={() => undefined}
    onFusion={() => undefined}
    onAddImages={() => undefined} projectId="pointer-project"
    initialViewState={{ offsetX: 0, offsetY: 0, zoom: 1 }}
    onAnnotationsChange={onChange} onRequestTaskPoll={async () => new Response('{}')} />;
}

async function settle(): Promise<void> {
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => { values.set(key, value); },
    removeItem: (key: string): void => { values.delete(key); } });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.stubGlobal('fetch', async (): Promise<Response> => new Response('{}'));
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  });
  const captured = new WeakMap<HTMLElement, Set<number>>();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600,
    toJSON: (): object => ({}),
  }));
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value(this: HTMLElement, id: number): void {
      const ids = captured.get(this) ?? new Set<number>(); ids.add(id); captured.set(this, ids);
    } },
    hasPointerCapture: { configurable: true, value(this: HTMLElement, id: number): boolean {
      return captured.get(this)?.has(id) ?? false;
    } },
    releasePointerCapture: { configurable: true, value(this: HTMLElement, id: number): void {
      captured.get(this)?.delete(id);
    } },
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const key of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) {
    Reflect.deleteProperty(HTMLElement.prototype, key);
  }
});

describe('real canvas annotation pointer boundary', () => {
  it.each([
    ['箭头标记', 'arrow', false], ['箭头标记', 'arrow', true],
    ['框选区域', 'region', false], ['框选区域', 'region', true],
    ['画笔圈画', 'brush', false], ['画笔圈画', 'brush', true],
  ] as const)('commits %s when events are batched=%s/%s', async (tool, kind, batched) => {
    let submitted: CanvasAnnotationV2[] = [];
    const view = render(<Canvas onChange={annotations => { submitted = annotations; return true; }} />);
    await settle();
    fireEvent.keyDown(window, { key: 'c', code: 'KeyC' }); await settle();
    fireEvent.click(view.getByRole('button', { name: tool })); await settle();
    const surface = view.container.querySelector<HTMLElement>('[data-canvas-interaction-surface]')!;
    const events = [
      (): void => { fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, button: 0, clientX: 120, clientY: 140 }); },
      (): void => { fireEvent.pointerMove(surface, { pointerId: 1, clientX: 240, clientY: 260 }); },
      (): void => { fireEvent.pointerUp(surface, { pointerId: 1, clientX: 240, clientY: 260 }); },
    ];
    if (batched) act(() => { events.forEach(event => event()); });
    else for (const event of events) { event(); await settle(); }
    await settle();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ projectId: 'pointer-project', sourceImageId: 'source', type: kind });
    if (kind === 'arrow') expect(submitted[0].geometry).toEqual({ kind: 'arrow',
      start: { x: 0.1, y: 0.2 }, end: { x: 0.7, y: 0.8 } });
    if (kind === 'region') expect(submitted[0].geometry).toEqual({ kind: 'region',
      region: { x: 0.1, y: 0.2, w: 0.6, h: 0.6 } });
    if (kind === 'brush') {
      const geometry = submitted[0].geometry;
      expect(geometry.kind).toBe('brush');
      if (geometry.kind === 'brush') {
        expect(geometry.points[0]).toEqual({ x: 0.1, y: 0.2 });
        expect(geometry.points.at(-1)).toEqual({ x: 0.7, y: 0.8 });
        expect(geometry.points.length).toBeGreaterThan(2);
      }
    }
    expect(view.container.querySelector(`[data-annotation-kind="${kind}"]`)).not.toBeNull();
    expect(view.container.querySelector(`[data-annotation-kind="draft-${kind}"]`)).toBeNull();
    expect(surface.hasPointerCapture(1)).toBe(false);
  });

  it('cancels a same-batch draft and releases its pointer without committing', async () => {
    let submitted: CanvasAnnotationV2[] = [];
    const view = render(<Canvas onChange={annotations => { submitted = annotations; return true; }} />);
    await settle(); fireEvent.keyDown(window, { key: 'c', code: 'KeyC' }); await settle();
    fireEvent.click(view.getByRole('button', { name: '箭头标记' })); await settle();
    const surface = view.container.querySelector<HTMLElement>('[data-canvas-interaction-surface]')!;
    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 120, clientY: 140 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 240, clientY: 260 });
      fireEvent.pointerCancel(surface, { pointerId: 1 });
    });
    await settle();
    expect(submitted).toEqual([]);
    expect(view.container.querySelector('[data-annotation-kind="draft-arrow"]')).toBeNull();
    expect(surface.hasPointerCapture(1)).toBe(false);
  });

  it('ignores another pointer and commits only the captured pointer', async () => {
    let submitted: CanvasAnnotationV2[] = [];
    const view = render(<Canvas onChange={annotations => { submitted = annotations; return true; }} />);
    await settle(); fireEvent.keyDown(window, { key: 'c', code: 'KeyC' }); await settle();
    fireEvent.click(view.getByRole('button', { name: '箭头标记' })); await settle();
    const surface = view.container.querySelector<HTMLElement>('[data-canvas-interaction-surface]')!;
    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 120, clientY: 140 }); await settle();
    act(() => {
      fireEvent.pointerMove(surface, { pointerId: 2, clientX: 280, clientY: 280 });
      fireEvent.pointerUp(surface, { pointerId: 2, clientX: 280, clientY: 280 });
      fireEvent.pointerCancel(surface, { pointerId: 2 });
    });
    await settle(); expect(submitted).toEqual([]); expect(surface.hasPointerCapture(1)).toBe(true);
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 240, clientY: 260 }); await settle();
    expect(submitted).toHaveLength(1);
    expect(submitted[0].geometry).toEqual({ kind: 'arrow', start: { x: 0.1, y: 0.2 }, end: { x: 0.7, y: 0.8 } });
    expect(surface.hasPointerCapture(1)).toBe(false);
  });

  it('a tool change cancels the draft before the original pointer is released', async () => {
    let submitted: CanvasAnnotationV2[] = [];
    const view = render(<Canvas onChange={annotations => { submitted = annotations; return true; }} />);
    await settle(); fireEvent.keyDown(window, { key: 'c', code: 'KeyC' }); await settle();
    fireEvent.click(view.getByRole('button', { name: '箭头标记' })); await settle();
    const surface = view.container.querySelector<HTMLElement>('[data-canvas-interaction-surface]')!;
    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 120, clientY: 140 }); await settle();
    act(() => {
      fireEvent.click(view.getByRole('button', { name: '框选区域' }));
      fireEvent.pointerUp(surface, { pointerId: 1, clientX: 240, clientY: 260 });
    });
    await settle();
    expect(submitted).toEqual([]);
    expect(view.container.querySelector('[data-annotation-kind="draft-arrow"]')).toBeNull();
    expect(surface.hasPointerCapture(1)).toBe(false);
  });

  it('does not display a locally committed annotation when the write boundary rejects it', async () => {
    const view = render(<Canvas onChange={() => false} />);
    await settle(); fireEvent.keyDown(window, { key: 'c', code: 'KeyC' }); await settle();
    fireEvent.click(view.getByRole('button', { name: '箭头标记' })); await settle();
    const surface = view.container.querySelector<HTMLElement>('[data-canvas-interaction-surface]')!;
    act(() => {
      fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 120, clientY: 140 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 240, clientY: 260 });
      fireEvent.pointerUp(surface, { pointerId: 1, clientX: 240, clientY: 260 });
    });
    await settle();
    expect(view.container.querySelector('[data-annotation-kind="arrow"]')).toBeNull();
    expect(view.container.querySelector('[data-annotation-kind="draft-arrow"]')).toBeNull();
    expect(surface.hasPointerCapture(1)).toBe(false);
  });
});
