// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';

// Keep the parent, hit testing, menu items/actions, and positioning real.
// jsdom has no layout: only the browser measurement boundary is supplied.
let viewport = { width: 320, height: 812 };
let measuredMenu = { width: 200, height: 174 };
const image: CanvasImage = { id: 'menu-image', url: '/menu-fixture.png',
  x: 160, y: 580, width: 80, height: 80, rotation: 0, zIndex: 1, createdAt: 1 };

function canvas(images: CanvasImage[] = [], onSendToChat?: (image: CanvasImage) => void): React.JSX.Element {
  return <InfiniteCanvas images={images} onImagesChange={() => undefined}
    selectedImage={null} onSelectImage={() => undefined} onPreviewImage={() => undefined}
    onGenerateVariation={() => undefined} onExtractKeywords={() => undefined}
    onRequestTaskPoll={async (): Promise<Response> => new Response('{}')}
    onFusion={() => undefined} onAddImages={() => undefined} onSendToChat={onSendToChat}
    projectId="menu-project" initialViewState={{ offsetX: 0, offsetY: 0, zoom: 1 }} />;
}

function rectangle(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height,
    toJSON: () => ({ x, y, width, height }) };
}

async function settle(): Promise<void> {
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}

function resize(width: number, height: number): void {
  viewport = { width, height };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  fireEvent(window, new Event('resize'));
}

beforeEach(() => {
  viewport = { width: 320, height: 812 };
  measuredMenu = { width: 200, height: 174 };
  resize(320, 812);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear() });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal('fetch', async (): Promise<Response> => new Response('{}'));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
    const isMenu = Array.from(this.children).some(child => child.tagName === 'BUTTON'
      && /粘贴|发送到聊天修改/.test(child.textContent ?? ''));
    if (!isMenu) return rectangle(0, 0, viewport.width, viewport.height);
    return rectangle(Number.parseFloat(this.style.left) || 0, Number.parseFloat(this.style.top) || 0,
      Math.min(measuredMenu.width, Number.parseFloat(this.style.maxWidth) || Infinity),
      Math.min(measuredMenu.height, Number.parseFloat(this.style.maxHeight) || Infinity));
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('real canvas context menu viewport containment', () => {
  it.each([
    { kind: 'image', point: { x: 180, y: 600 }, label: '发送到聊天修改' },
    { kind: 'blank', point: { x: 20, y: 40 }, label: '粘贴 Ctrl+V' },
  ])('dismisses the focused $kind menu on Escape without clearing canvas state', async ({ point, label }) => {
    let escapedToParent = 0;
    const view = render(<div onKeyDown={event => {
      if (event.key === 'Escape') escapedToParent++;
    }}>{canvas([image])}</div>);
    await settle();
    const interaction = view.container.querySelector('[data-canvas-interaction-surface]')!;
    // Select the real image through the consumer, then keep another real overlay open.
    fireEvent.contextMenu(interaction, { clientX: 180, clientY: 600 });
    const selected = view.container.querySelector('[data-canvas-image-id="menu-image"]')!;
    expect(selected.getAttribute('data-canvas-selected')).toBe('true');
    const toolbar = view.container.querySelector<HTMLElement>('[data-mobile-canvas-toolbar]')!;
    const allTools = within(toolbar).getByRole('button', { name: '全部工具' });
    fireEvent.click(allTools);
    const drawer = view.getByRole('dialog', { name: '全部工具' });
    fireEvent.contextMenu(interaction, { clientX: point.x, clientY: point.y });
    const menu = document.querySelector<HTMLElement>('[data-popup="context-menu"]')!;
    const button = within(menu).getByRole('button', { name: label });
    button.focus();
    expect(document.activeElement).toBe(button);
    const surface = view.container.querySelector('[data-canvas-surface]')!;
    const viewportStyle = surface.getAttribute('style');
    expect(viewportStyle).not.toBeNull();
    // Other keys retain their default behavior and leave the menu open.
    expect(fireEvent.keyDown(button, { key: 'ArrowDown', code: 'ArrowDown' })).toBe(true);
    expect(document.body.contains(menu)).toBe(true);
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
    });
    fireEvent(button, escape);
    expect(document.querySelector('[data-popup="context-menu"]')).toBeNull();
    expect(escape.defaultPrevented).toBe(true);
    expect(escapedToParent).toBe(0);
    expect(surface.getAttribute('style')).toBe(viewportStyle);
    expect(selected.getAttribute('data-canvas-selected')).toBe('true');
    expect(view.getByRole('dialog', { name: '全部工具' })).toBe(drawer);
    expect(allTools.getAttribute('aria-expanded')).toBe('true');
  });

  it.each([{ x: 180, y: 600, left: 112, top: 600 },
    { x: 319, y: 811, left: 112, top: 630 }])(
    'keeps the blank menu inside a 320px viewport at $x,$y', async point => {
      const view = render(canvas()); await settle();
      fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!,
        { clientX: point.x, clientY: point.y });
      const menu = view.getByText('粘贴').closest('button')!.parentElement!;
      expect(menu.getBoundingClientRect()).toMatchObject({ left: point.left, top: point.top });
      expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(312);
      expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(804);
    },
  );

  it('keeps an in-bounds desktop anchor unchanged', async () => {
    resize(1280, 900);
    const view = render(canvas()); await settle();
    fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!,
      { clientX: 100, clientY: 120 });
    expect(view.getByText('粘贴').closest('button')!.parentElement!.getBoundingClientRect())
      .toMatchObject({ left: 100, top: 120 });
  });

  it('repositions an open menu after the viewport shrinks', async () => {
    resize(1280, 900);
    const view = render(canvas()); await settle();
    fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!,
      { clientX: 800, clientY: 700 });
    resize(320, 400);
    expect(view.getByText('粘贴').closest('button')!.parentElement!.getBoundingClientRect())
      .toMatchObject({ left: 112, top: 218, right: 312, bottom: 392 });
  });

  it('contains the image menu and preserves the original selected-image action', async () => {
    measuredMenu = { width: 240, height: 900 };
    const received: string[] = [];
    const view = render(canvas([image], selected => { received.push(selected.id); })); await settle();
    fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!,
      { clientX: 180, clientY: 600 });
    const button = view.getByText('发送到聊天修改').closest('button')!;
    const menu = button.parentElement!;
    expect(menu.getBoundingClientRect()).toMatchObject({ left: 72, top: 8, right: 312, bottom: 804 });
    expect(menu.style.overflowY).toBe('auto');
    fireEvent.click(button);
    expect(received).toEqual(['menu-image']);
    expect(view.queryByText('发送到聊天修改')).toBeNull();
  });

  it('tracks visual viewport size and offsets, and removes listeners when closed', async () => {
    const visible = Object.assign(new EventTarget(), { width: 320, height: 400, offsetLeft: 20, offsetTop: 50 });
    vi.stubGlobal('visualViewport', visible);
    const add = vi.spyOn(visible, 'addEventListener');
    const remove = vi.spyOn(visible, 'removeEventListener');
    const view = render(canvas()); await settle();
    fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!,
      { clientX: 319, clientY: 811 });
    const menu = view.getByText('粘贴').closest('button')!.parentElement!;
    expect(menu.getBoundingClientRect()).toMatchObject({ left: 132, top: 268, right: 332, bottom: 442 });
    visible.offsetLeft = 30; visible.offsetTop = 70;
    act(() => { visible.dispatchEvent(new Event('scroll')); });
    expect(menu.getBoundingClientRect()).toMatchObject({ left: 142, top: 288 });
    visible.width = 180; visible.height = 220;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    expect(menu.getBoundingClientRect()).toMatchObject({ left: 38, top: 108, right: 202, bottom: 282 });
    fireEvent.click(within(menu).getByText('放大').closest('button')!);
    for (const type of ['resize', 'scroll']) {
      const subscription = add.mock.calls.find(call => call[0] === type)!;
      expect(remove).toHaveBeenCalledWith(type, subscription[1]);
    }
  });

  it('remeasures changing menu content and disconnects only its own observer when closed', async () => {
    let remeasure: (() => void) | undefined;
    let disconnect: ReturnType<typeof vi.fn> | undefined;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { this.callback = callback; }
      private callback: () => void;
      observe(target: Element): void {
        if (target.getAttribute('data-popup') === 'context-menu') {
          remeasure = this.callback;
          disconnect = this.disconnect;
        }
      }
      disconnect = vi.fn();
    });
    const view = render(canvas()); await settle();
    fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!,
      { clientX: 319, clientY: 811 });
    const menu = view.getByText('粘贴').closest('button')!.parentElement!;
    measuredMenu = { width: 240, height: 300 };
    expect(remeasure).toBeTypeOf('function');
    act(() => { remeasure!(); });
    expect(menu.getBoundingClientRect()).toMatchObject({ left: 72, top: 504, right: 312, bottom: 804 });
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(menu).getByText('粘贴').closest('button')!);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the full gutter for fractional viewport and menu sizes', async () => {
    resize(320.6, 400.6);
    measuredMenu = { width: 200.05, height: 174.05 };
    const view = render(canvas()); await settle();
    fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!,
      { clientX: 319, clientY: 399 });
    const bounds = view.getByText('粘贴').closest('button')!.parentElement!.getBoundingClientRect();
    expect(viewport.width - bounds.right).toBeGreaterThanOrEqual(8);
    expect(viewport.height - bounds.bottom).toBeGreaterThanOrEqual(8);
  });

  it('does not reset the viewport or leak auxiliary clicks from the menu', async () => {
    const auxiliaryClick = vi.fn();
    const view = render(<div onAuxClick={auxiliaryClick}>{canvas()}</div>); await settle();
    fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!,
      { clientX: 180, clientY: 600 });
    const menu = view.getByText('粘贴').closest('button')!.parentElement!;
    const surface = view.container.querySelector('[data-canvas-surface]')!;
    const before = surface.getAttribute('style');
    fireEvent(menu, new MouseEvent('auxclick', { bubbles: true, button: 1, clientX: 200, clientY: 610 }));
    expect(auxiliaryClick).not.toHaveBeenCalled();
    expect(surface.getAttribute('style')).toBe(before);
  });

  it('stacks the menu above the real mobile toolbar and its open drawer', async () => {
    const view = render(canvas()); await settle();
    const toolbar = view.container.querySelector<HTMLElement>('[data-mobile-canvas-toolbar]')!;
    fireEvent.click(within(toolbar).getByRole('button', { name: '全部工具' }));
    const drawer = view.container.querySelector<HTMLElement>('[data-mobile-canvas-toolbar-drawer]')!;
    fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!,
      { clientX: 180, clientY: 600 });
    const menu = view.getByText('粘贴').closest('button')!.parentElement!;
    // jsdom doesn't load Tailwind. Read the actual rendered layer declarations;
    // real-browser elementFromPoint separately verifies that buttons win hit tests.
    const layer = (element: HTMLElement): number => Number.parseFloat(element.style.zIndex)
      || Number(element.className.match(/(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?:\s|$)/)?.slice(1).find(Boolean) ?? 0);
    expect(layer(toolbar)).toBe(75);
    expect(layer(drawer)).toBe(76);
    expect(layer(menu)).toBeGreaterThan(Math.max(layer(toolbar), layer(drawer)));
  });

  it('allows menu scrolling without leaking wheel or pointer-down events into the canvas', async () => {
    let parentPointerEvents = 0;
    let parentWheelEvents = 0;
    const view = render(<div onPointerDown={() => { parentPointerEvents++; }}
      onWheel={() => { parentWheelEvents++; }}>{canvas()}</div>); await settle();
    fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!,
      { clientX: 180, clientY: 600 });
    const menu = view.getByText('粘贴').closest('button')!.parentElement!;
    const before = view.container.querySelector('[data-canvas-surface]')!.getAttribute('style');
    // jsdom has no native pointer capture; keep this platform boundary test-only.
    const capture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => undefined });
    try { fireEvent.pointerDown(menu); }
    finally {
      if (capture) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', capture);
      else Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
    }
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 60 });
    fireEvent(menu, wheel);
    expect(parentPointerEvents).toBe(0);
    expect(parentWheelEvents).toBe(0);
    expect(wheel.defaultPrevented).toBe(false);
    expect(view.container.querySelector('[data-canvas-surface]')!.getAttribute('style')).toBe(before);
  });
});
