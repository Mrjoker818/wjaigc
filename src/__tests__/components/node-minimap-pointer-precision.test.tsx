// @vitest-environment jsdom
// Real NodeEditor: replay captured fractional pointer / integer click inputs.
// Geometry is a fixed SVG/browser-API double, not a replacement UI or handler.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow, createWorkflowNode, type Workflow } from '@/lib/workflow-engine';
const originalScreenCtm = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'getScreenCTM');
interface RequestRecord { url: string; method: string; allowed: boolean }
let requests: RequestRecord[] = [];

class FixturePointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 7;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
  }
}
class FixturePoint {
  constructor(readonly x: number, readonly y: number) {}
  matrixTransform(m: { a: number; b: number; c: number; d: number; e: number; f: number }): FixturePoint {
    return new FixturePoint(m.a * this.x + m.c * this.y + m.e, m.b * this.x + m.d * this.y + m.f);
  }
}
class FixtureResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
class FixtureChannel {
  close(): void {}
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}
function storage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, key: i => [...values.keys()][i] ?? null,
    removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } };
}
function pointer(target: Element, type: string, init: PointerEventInit = {}): void {
  fireEvent(target, new FixturePointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, detail: type === 'click' ? 1 : 0,
    clientX: type === 'click' ? 284 : 284.66668701171875,
    clientY: type === 'click' ? 683 : 683.4500122070312, ...init,
  }));
}
function release(nav: Element, init: PointerEventInit = {}): void {
  pointer(nav, 'pointerdown', init);
  pointer(nav, 'pointerup', init);
}
function pan(): { x: number; y: number } {
  const layer = document.querySelector<HTMLElement>('[data-workflow-legacy-node-layer]');
  const match = layer?.style.transform.match(/^translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(0\.8\)$/);
  if (!match) throw Error('NQ_REAL_VIEWPORT_TRANSFORM_REQUIRED');
  return { x: Number(match[1]), y: Number(match[2]) };
}
function expectPan(x: number, y: number): void {
  expect(pan().x).toBeCloseTo(x, 3);
  expect(pan().y).toBeCloseTo(y, 3);
}
async function mount(): Promise<SVGSVGElement> {
  const workflow = createEmptyWorkflow('NQ captured pointer replay');
  workflow.id = 'nq-workflow';
  workflow.nodes = [
    { ...createWorkflowNode('input-text', 20, 10, 'result'), id: 'nq-result', width: 260, height: 293.5 },
    { ...createWorkflowNode('input-text', -500, -500, 'source'), id: 'nq-source', width: 260, height: 293.5 },
  ];
  const before = JSON.stringify(workflow);
  render(<NodeEditor workflow={workflow} userId="nq-actor" projectId="nq-project" rendererMode="legacy"
    canvasImages={[]} onWorkflowChange={(next: Workflow | null): void => { expect(JSON.stringify(next)).toBe(before); }} />);
  await waitFor(() => expect(document.querySelector('[data-workflow-legacy-node-layer]')).not.toBeNull());
  const toggle = screen.getByRole('button', { name: '切换小地图' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: '小地图导航' })).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  return screen.getByRole('button', { name: '小地图导航' }) as unknown as SVGSVGElement;
}

describe('NQ real minimap pointer precision', () => {
  beforeEach(() => {
    requests = [];
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('ResizeObserver', FixtureResizeObserver);
    vi.stubGlobal('BroadcastChannel', FixtureChannel);
    vi.stubGlobal('PointerEvent', FixturePointerEvent);
    vi.stubGlobal('DOMPoint', FixturePoint);
    vi.stubGlobal('DOMMatrixReadOnly', class { readonly m22 = 1; });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input), method = init?.method ?? 'GET';
      const allowed = url === '/api/skills?surface=workflow' && method === 'GET'
        && init?.body == null && init?.headers === undefined;
      requests.push({ url, method, allowed });
      if (!allowed) throw Error('NQ_UNEXPECTED_REQUEST');
      return new Response(JSON.stringify({ skills: [] }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({ matches: false, media: query, onchange: null,
      addEventListener: (): void => {}, removeEventListener: (): void => {}, addListener: (): void => {},
      removeListener: (): void => {}, dispatchEvent: (): boolean => true }));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
      return this.classList.contains('canvas-bg') ? new DOMRect(0, 49, 390, 697) : new DOMRect(0, 0, 260, 293.5);
    });
    // Captured NP screen CTM: a=d=1/15,e=274+2/3,f=673.
    Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', { configurable: true,
      value: (): object => ({ inverse: (): object => ({ a: 15, b: 0, c: 0, d: 15, e: -4120, f: -10095 }) }) });
  });
  afterEach(() => {
    const failures: unknown[] = [];
    try { cleanup(); } catch (error) { failures.push(error); }
    // Independent of the test body: a caught request rejection cannot disappear.
    try { expect(requests).toEqual([{ url: '/api/skills?surface=workflow', method: 'GET', allowed: true }]); }
    catch (error) { failures.push(error); }
    try {
      vi.unstubAllGlobals(); vi.restoreAllMocks();
      if (originalScreenCtm) Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', originalScreenCtm);
      else Reflect.deleteProperty(SVGSVGElement.prototype, 'getScreenCTM');
    } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'NQ_CLEANUP_FAILURES');
  });

  it.each(['mouse', 'touch', 'pen'])('%s keeps captured subpixel precision through click', async pointerType => {
    const nav = await mount(); release(nav, { pointerType }); pointer(nav, 'click', { pointerType });
    // Independent NP model center (150,156.75), canvas390x697,zoom0.8.
    expectPan(74.999755859375, 223.099853515625);
  });
  it('blank map keeps the clicked world point rather than snapping to a node', async () => {
    const nav = await mount(); release(nav, { clientX: 300.5, clientY: 680.5 });
    pointer(nav, 'click', { clientX: 300, clientY: 680 });
    expectPan(-115, 258.5);
  });
  it.each(['pointercancel', 'lostpointercapture'])('%s before release discards the interrupted sample', async type => {
    const nav = await mount(); pointer(nav, 'pointerdown'); pointer(nav, type); pointer(nav, 'pointerup'); pointer(nav, 'click');
    expectPan(83, 228.5);
  });
  it('normal implicit capture loss after touch release preserves the completed sample', async () => {
    const nav = await mount(); release(nav, { pointerType: 'touch' });
    pointer(nav, 'lostpointercapture', { pointerType: 'touch' }); pointer(nav, 'click', { pointerType: 'touch' });
    expectPan(74.999755859375, 223.099853515625);
  });
  it('wrong released pointer cannot reuse an armed sample', async () => {
    const nav = await mount(); pointer(nav, 'pointerdown'); pointer(nav, 'pointerup', { pointerId: 8 }); pointer(nav, 'click');
    expectPan(83, 228.5);
  });
  it('wrong clicked pointer discards the completed sample', async () => {
    const nav = await mount(); release(nav); pointer(nav, 'click', { pointerId: 8 }); expectPan(83, 228.5); pointer(nav, 'click');
    expectPan(83, 228.5);
  });
  it('a new nonprimary pointer interrupts the old sample', async () => {
    const nav = await mount(); pointer(nav, 'pointerdown'); pointer(nav, 'pointerdown', { pointerId: 8, isPrimary: false });
    pointer(nav, 'pointerup'); pointer(nav, 'click'); expectPan(83, 228.5);
  });
  it('window blur discards the completed sample', async () => {
    const nav = await mount(); release(nav); fireEvent.blur(window); pointer(nav, 'click'); expectPan(83, 228.5);
  });
  it('an outside pointerdown discards the completed sample', async () => {
    const nav = await mount(); release(nav); pointer(document.body, 'pointerdown'); pointer(nav, 'click'); expectPan(83, 228.5);
  });
  it('a completed sample is consumed only once', async () => {
    const nav = await mount(); release(nav); pointer(nav, 'click'); pointer(nav, 'click'); expectPan(83, 228.5);
  });
  it('closing and reopening cannot reuse the former SVG owner', async () => {
    const nav = await mount(); release(nav); fireEvent.click(screen.getByRole('button', { name: '关闭小地图' }));
    fireEvent.click(screen.getByRole('button', { name: '切换小地图' }));
    pointer(screen.getByRole('button', { name: '小地图导航' }), 'click'); expectPan(83, 228.5);
  });
  it('legacy clicks without a pointer id still use their own coordinates', async () => {
    const nav = await mount(); release(nav); fireEvent.click(nav, { clientX: 284, clientY: 683, detail: 1 }); expectPan(83, 228.5);
  });
  it('keyboard pan is unchanged and does not leave a completed pointer sample', async () => {
    const nav = await mount(); release(nav); fireEvent.keyDown(nav, { key: 'ArrowRight' }); expectPan(-40, 0);
    pointer(nav, 'click'); expectPan(83, 228.5);
  });
});
