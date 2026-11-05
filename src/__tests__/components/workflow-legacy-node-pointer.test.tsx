// @vitest-environment jsdom
// Hermetic component logic checks; real browser touch remains a separate gate.
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow, createWorkflowNode, type Workflow } from '@/lib/workflow-engine';

class ComponentPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'touch';
    this.isPrimary = init.isPrimary ?? true;
  }
}

let rafId = 0;
const frames = new Map<number, FrameRequestCallback>();
const captures = new WeakMap<Element, number>();
const captureDescriptors = new Map(['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']
  .map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]));
const point = (pointerId = 1, pointerType = 'touch', clientX = 100, clientY = 120): PointerEventInit => (
  { pointerId, pointerType, clientX, clientY, isPrimary: true, button: 0, bubbles: true }
);
function fixture(id = 'ut-workflow'): Workflow {
  const node = createWorkflowNode('input-text', 40, 80);
  node.id = 'ut-node'; node.label = '可拖动输入'; node.config.text = '保留原输入';
  return { ...createEmptyWorkflow('UT input regression'), id, nodes: [node], connections: [] };
}
function editor(workflow = fixture()): React.JSX.Element {
  return <NodeEditor workflow={workflow} rendererMode="legacy" userId="ut-actor" projectId="ut-project"
    taskModelCatalog={[]} canvasImages={[]} />;
}
function card(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[data-node-id="ut-node"]')!;
}
function header(container: HTMLElement): HTMLElement { return card(container).querySelector<HTMLElement>('.node-header')!; }
function position(container: HTMLElement): string[] { return [card(container).style.left, card(container).style.top]; }
function flush(): void {
  act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(1)); });
}
function mount(): ReturnType<typeof render> { const result = render(editor()); flush(); return result; }
function move(container: HTMLElement, init = point(1, 'touch', 180, 160)): void {
  fireEvent.pointerMove(card(container), init); flush();
}
function undo(container: HTMLElement): HTMLButtonElement { return container.querySelector<HTMLButtonElement>('[aria-label="撤销"]')!; }

beforeEach(() => {
  localStorage.clear(); frames.clear(); rafId = 0;
  vi.stubGlobal('PointerEvent', ComponentPointerEvent);
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => { frames.set(++rafId, callback); return rafId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      if (target.classList.contains('canvas-bg')) {
        this.callback([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
    }
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method && init.method !== 'GET') throw new Error('UT rejects submission or external side effects');
    return Response.json({ models: [], workflows: [], skills: [], presets: [] });
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation((): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700, toJSON: () => ({}),
  }));
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value(this: Element, id: number): void { captures.set(this, id); } },
    hasPointerCapture: { configurable: true, value(this: Element, id: number): boolean { return captures.get(this) === id; } },
    releasePointerCapture: { configurable: true, value(this: Element, id: number): void { if (captures.get(this) === id) captures.delete(this); } },
  });
});
afterEach(() => {
  cleanup(); frames.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [name, descriptor] of captureDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

describe('legacy node pointer drag uses the real editor state and history', () => {
  it.each(['touch', 'pen', 'mouse'])('moves with %s and one undo restores the exact original node', async pointerType => {
    const { container } = mount();
    await waitFor(() => expect(card(container)).not.toBeNull());
    fireEvent.pointerDown(header(container), point(1, pointerType));
    move(container, point(1, pointerType, 180, 160));
    expect(position(container)).toEqual(['140px', '130px']);
    fireEvent.pointerUp(card(container), point(1, pointerType, 180, 160));
    fireEvent.pointerUp(card(container), point(1, pointerType, 180, 160));
    expect(undo(container).disabled).toBe(false);
    fireEvent.click(undo(container));
    expect(position(container)).toEqual(['40px', '80px']);
    expect(undo(container).disabled).toBe(true);
  });

  it.each(['pointerCancel', 'lostPointerCapture'])('%s rolls back a shown preview without a history entry', eventName => {
    const { container } = mount();
    fireEvent.pointerDown(header(container), point()); move(container);
    expect(position(container)).toEqual(['140px', '130px']);
    fireEvent[eventName as 'pointerCancel' | 'lostPointerCapture'](card(container), point());
    expect(position(container)).toEqual(['40px', '80px']);
    expect(undo(container).disabled).toBe(true);
    fireEvent.pointerMove(card(container), point(1, 'touch', 400, 400)); flush();
    expect(position(container)).toEqual(['40px', '80px']);
  });

  it('rejects a second contact and wrong pointer up while keeping the first drag live', () => {
    const { container } = mount();
    fireEvent.pointerDown(header(container), point());
    fireEvent.pointerDown(header(container), { ...point(2), isPrimary: false });
    move(container, point(2, 'touch', 500, 500));
    expect(position(container)).toEqual(['40px', '80px']);
    fireEvent.pointerUp(card(container), point(2));
    move(container); expect(position(container)).toEqual(['140px', '130px']);
    fireEvent.pointerUp(card(container), point(1, 'touch', 180, 160));
    fireEvent.click(undo(container)); expect(position(container)).toEqual(['40px', '80px']);
  });

  it('accepts a fresh pointer after cancellation and ignores old pointer coordinates', () => {
    const { container } = mount();
    fireEvent.pointerDown(header(container), point()); move(container);
    expect(position(container)).toEqual(['140px', '130px']);
    fireEvent.pointerCancel(card(container), point());
    fireEvent.pointerDown(header(container), point(3));
    move(container, point(1, 'touch', 500, 500));
    expect(position(container)).toEqual(['40px', '80px']);
    move(container, point(3, 'touch', 140, 200));
    fireEvent.pointerUp(card(container), point(3, 'touch', 140, 200));
    expect(position(container)).toEqual(['90px', '180px']);
  });

  it('ignores compatibility mouse events during an owned pointer drag', () => {
    const { container } = mount();
    fireEvent.pointerDown(header(container), point(1, 'mouse'));
    fireEvent.mouseDown(header(container), { button: 0, clientX: 100, clientY: 120 });
    fireEvent.mouseLeave(container.querySelector('.canvas-bg')!);
    move(container, point(1, 'mouse', 180, 160));
    expect(position(container)).toEqual(['140px', '130px']);
    fireEvent.pointerUp(card(container), point(1, 'mouse', 180, 160));
    fireEvent.mouseUp(card(container));
    fireEvent.click(undo(container)); expect(position(container)).toEqual(['40px', '80px']);
    expect(undo(container).disabled).toBe(true);
  });

  it('keeps text input editing out of pointer drag and retains the mouse-only fallback', () => {
    const { container } = mount();
    const input = card(container).querySelector<HTMLTextAreaElement>('textarea')!;
    fireEvent.pointerDown(input, point()); move(container);
    fireEvent.change(input, { target: { value: '用户更新' } });
    fireEvent.pointerUp(input, point(1, 'touch', 180, 160));
    expect(position(container)).toEqual(['40px', '80px']); expect(input.value).toBe('用户更新');
    fireEvent.mouseDown(header(container), { button: 0, clientX: 100, clientY: 120 });
    fireEvent.mouseMove(container.querySelector('.canvas-bg')!, { clientX: 180, clientY: 160 }); flush();
    fireEvent.mouseUp(container.querySelector('.canvas-bg')!);
    expect(position(container)).toEqual(['140px', '130px']);
  });

  it('cancels an unfinished pointer on window blur', () => {
    const { container } = mount();
    fireEvent.pointerDown(header(container), point()); move(container);
    expect(position(container)).toEqual(['140px', '130px']);
    fireEvent.blur(window); expect(position(container)).toEqual(['40px', '80px']);
    expect(undo(container).disabled).toBe(true);
  });

  it('does not write old gesture positions into a newly selected workflow scope', async () => {
    const { container, rerender } = mount();
    fireEvent.pointerDown(header(container), point()); move(container);
    expect(position(container)).toEqual(['140px', '130px']);
    const next = fixture('ut-next-workflow'); next.nodes[0].x = 900; next.nodes[0].y = 700;
    rerender(editor(next));
    fireEvent.pointerUp(card(container), point(1, 'touch', 500, 500)); flush();
    await waitFor(() => expect(position(container)).toEqual(['900px', '700px']));
    expect(undo(container).disabled).toBe(true);
  });

  it('uses the release coordinates even when the browser coalesces away the last move', () => {
    const { container } = mount();
    fireEvent.pointerDown(header(container), point());
    fireEvent.pointerUp(card(container), point(1, 'touch', 180, 160));
    expect(position(container)).toEqual(['140px', '130px']);
    fireEvent.click(undo(container)); expect(position(container)).toEqual(['40px', '80px']);
  });

  it('does not restart a completed touch drag from its later compatibility mousedown', () => {
    const { container } = mount();
    fireEvent.pointerDown(header(container), point()); move(container);
    fireEvent.pointerUp(card(container), point(1, 'touch', 180, 160));
    fireEvent.mouseDown(header(container), { button: 0, clientX: 180, clientY: 160 });
    fireEvent.mouseMove(container.querySelector('.canvas-bg')!, { clientX: 500, clientY: 500 }); flush();
    fireEvent.mouseUp(card(container));
    expect(position(container)).toEqual(['140px', '130px']);
    fireEvent.click(undo(container)); expect(position(container)).toEqual(['40px', '80px']);
    expect(undo(container).disabled).toBe(true);
  });

  it('does not begin a drag when capture fails', () => {
    const { container } = mount();
    vi.spyOn(card(container), 'setPointerCapture').mockImplementation(() => { throw new Error('capture refused'); });
    fireEvent.pointerDown(header(container), point()); move(container);
    fireEvent.pointerUp(card(container), point(1, 'touch', 180, 160));
    expect(position(container)).toEqual(['40px', '80px']);
    expect(undo(container).disabled).toBe(true);
  });

  it('keeps the mobile inspector closed for a drag and opens it for the next tap', () => {
    const { container } = mount();
    const inspector = container.querySelector<HTMLElement>('aside[data-workflow-ui-occlusion]')!;
    fireEvent.pointerDown(header(container), point());
    expect(inspector.classList.contains('hidden')).toBe(true);
    move(container); fireEvent.pointerUp(card(container), point(1, 'touch', 180, 160));
    expect(position(container)).toEqual(['140px', '130px']);
    expect(inspector.classList.contains('hidden')).toBe(true);
    fireEvent.pointerDown(header(container), point(3));
    fireEvent.pointerUp(card(container), point(3));
    expect(inspector.classList.contains('hidden')).toBe(false);
    expect(position(container)).toEqual(['140px', '130px']);
  });

  it('does not capture input ports or consume the collapse button', () => {
    const { container } = mount();
    const port = card(container).querySelector<HTMLElement>('.port-dot')!;
    fireEvent.pointerDown(port, point()); move(container);
    fireEvent.pointerUp(port, point(1, 'touch', 180, 160));
    expect(position(container)).toEqual(['40px', '80px']);
    const collapse = card(container).querySelector<HTMLButtonElement>('[aria-label="折叠节点"]')!;
    fireEvent.pointerDown(collapse, point()); move(container);
    fireEvent.pointerUp(collapse, point()); fireEvent.click(collapse);
    expect(card(container).classList.contains('collapsed')).toBe(true);
    expect(position(container)).toEqual(['40px', '80px']);
  });

  it('releases an unfinished drag on unmount without leaving a queued preview', () => {
    const { container, unmount } = mount();
    fireEvent.pointerDown(header(container), point());
    fireEvent.pointerMove(card(container), point(1, 'touch', 180, 160));
    expect(frames.size).toBeGreaterThan(0);
    unmount();
    expect(frames.size).toBe(0);
  });

  it.each(['pointerMove', 'pointerUp', 'pointerCancel', 'lostPointerCapture'] as const)(
    'ignores non-owner %s with the same pointer identity', eventName => {
      const { container } = mount();
      fireEvent.pointerDown(header(container), point()); move(container);
      expect(position(container)).toEqual(['140px', '130px']);
      fireEvent[eventName](header(container), point(1, 'touch', 500, 500)); flush();
      expect(position(container)).toEqual(['140px', '130px']);
      move(container, point(1, 'touch', 220, 200));
      fireEvent.pointerUp(card(container), point(1, 'touch', 220, 200));
      expect(position(container)).toEqual(['190px', '180px']);
      fireEvent.click(undo(container)); expect(position(container)).toEqual(['40px', '80px']);
    },
  );
});
