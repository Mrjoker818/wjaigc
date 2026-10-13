// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NodeEditor from '@/components/node-editor';
import { WorkflowLegacySurface } from '@/components/workflow/WorkflowLegacySurface';
import { computePortPosition } from '@/lib/node-port-position';
import { getLegacyPortWorldPosition } from '@/lib/workflow-renderer/legacy-port-position';
import { createEmptyWorkflow, createWorkflowNode, type NodePort, type Workflow } from '@/lib/workflow-engine';
import { projectLegacyRenderModel, type WorkflowRenderViewport } from '@/lib/workflow-renderer/view-model';

interface Point { x: number; y: number }
const centers = new Map<string, Point>();
let viewport: WorkflowRenderViewport;
let layerWidth: number;
const resizeCallbacks = new Set<ResizeObserverCallback>();

class LayoutResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) { resizeCallbacks.add(callback); }
  observe(target: Element): void {
    if (target.classList.contains('canvas-bg')) {
      this.callback([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this);
    }
  }
  unobserve(): void {}
  disconnect(): void { resizeCallbacks.delete(this.callback); }
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) };
}

function layoutRect(element: HTMLElement): DOMRect {
  const card = element.closest<HTMLElement>('[data-node-id]');
  const portId = element.dataset.portId;
  if (card && portId && centers.has(portId)) {
    const center = centers.get(portId)!;
    const worldX = Number.parseFloat(card.style.left) + center.x;
    const worldY = Number.parseFloat(card.style.top) + center.y;
    return rect(80 + viewport.x + (worldX - 6) * viewport.zoom, 120 + viewport.y + (worldY - 6) * viewport.zoom, 12 * viewport.zoom, 12 * viewport.zoom);
  }
  if (element.hasAttribute('data-workflow-legacy-node-layer')) {
    return rect(80 + viewport.x, 120 + viewport.y, layerWidth * viewport.zoom, 700 * viewport.zoom);
  }
  if (element.hasAttribute('data-node-id')) {
    return rect(80 + viewport.x + Number.parseFloat(element.style.left) * viewport.zoom,
      120 + viewport.y + Number.parseFloat(element.style.top) * viewport.zoom,
      Number.parseFloat(element.style.width) * viewport.zoom, 400 * viewport.zoom);
  }
  return rect(80, 120, 1000, 700);
}

function fixture(): Workflow {
  const input = createWorkflowNode('input-image', -180, 90); input.id = 'image';
  input.config = { ...input.config, imageUrl: '/fixture.png', inputBinding: { assetVersionId: 'original-version' } };
  const sketch = createWorkflowNode('ai-sketch-to-code', 360, -140); sketch.id = 'sketch'; sketch.width = 340;
  const output = createWorkflowNode('output-export', 760, 260); output.id = 'export';
  centers.set('image-out-out-image', { x: 247, y: 254 });
  centers.set('sketch-in-in-image', { x: 313, y: 80 });
  centers.set('sketch-in-in-prompt', { x: 313, y: 130 });
  centers.set('sketch-out-out-image', { x: 339, y: 172 });
  centers.set('sketch-out-out-document', { x: 339, y: 198 });
  centers.set('export-in-in-image', { x: 1, y: 68 });
  centers.set('export-in-in-document', { x: 1, y: 102 });
  return {
    ...createEmptyWorkflow('legacy port geometry'), nodes: [input, sketch, output],
    connections: [
      { id: 'image-sketch', fromNodeId: 'image', fromPortId: 'out-image', toNodeId: 'sketch', toPortId: 'in-image', type: 'image' },
      { id: 'sketch-image', fromNodeId: 'sketch', fromPortId: 'out-image', toNodeId: 'export', toPortId: 'in-image', type: 'image' },
      { id: 'sketch-document', fromNodeId: 'sketch', fromPortId: 'out-document', toNodeId: 'export', toPortId: 'in-document', type: 'data' },
    ],
  };
}

function endpoints(container: HTMLElement, edgeId: string): number[] {
  const path = container.querySelector(`[data-edge-id="${edgeId}"] path`)?.getAttribute('d');
  expect(path, `missing edge ${edgeId}`).toBeTruthy();
  const values = path!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  return [values[0], values[1], values[6], values[7]];
}

function surface(workflow: Workflow): React.JSX.Element {
  return <WorkflowLegacySurface model={projectLegacyRenderModel(workflow, viewport)} onCommand={vi.fn()}
    getPortPosition={(node, port) => computePortPosition(node, port.id)} />;
}

beforeEach(() => {
  centers.clear(); viewport = { x: 0, y: 0, zoom: 1 }; resizeCallbacks.clear(); localStorage.clear();
  layerWidth = 1000;
  const browserComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudoElt?: string | null): CSSStyleDeclaration => {
    const style = browserComputedStyle(element, pseudoElt);
    if (element.hasAttribute('data-workflow-legacy-node-layer')) {
      Object.defineProperty(style, 'transform', { value: `matrix(${viewport.zoom}, 0, 0, ${viewport.zoom}, ${viewport.x}, ${viewport.y})`, configurable: true });
    }
    return style;
  });
  vi.stubGlobal('ResizeObserver', LayoutResizeObserver);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ models: [], workflows: [], skills: [] })));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect { return layoutRect(this); });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement): number {
    return this.hasAttribute('data-node-id') ? Number.parseFloat(this.style.width) : Math.round(layerWidth);
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('legacy edges use the rendered port centers in world coordinates', () => {
  it.each([
    { width: 1000.4, zoom: 0.5 }, { width: 1000.4, zoom: 1 }, { width: 1000.4, zoom: 2 },
    { width: 1000.6, zoom: 0.5 }, { width: 1000.6, zoom: 1 }, { width: 1000.6, zoom: 2 },
  ])('preserves fractional layer width $width with rounded offsetWidth at $zoom zoom', ({ width, zoom }) => {
    layerWidth = width; viewport = { x: -320, y: 210, zoom };
    const workflow = fixture(); const { container, rerender } = render(surface(workflow));
    const layer = container.querySelector<HTMLElement>('[data-workflow-legacy-node-layer]')!;
    expect(layer.offsetWidth).toBe(Math.round(width));
    expect(layer.getBoundingClientRect().width).toBe(width * zoom);
    expect(endpoints(container, 'image-sketch')).toEqual([67, 344, 673, -60]);
    expect(endpoints(container, 'sketch-image')).toEqual([699, 32, 761, 328]);
    expect(endpoints(container, 'sketch-document')).toEqual([699, 58, 761, 362]);
    const moved = { ...workflow, nodes: workflow.nodes.map(node => node.id === 'sketch' ? { ...node, x: -1200, y: -740 } : node) };
    rerender(surface(moved));
    expect(endpoints(container, 'image-sketch')).toEqual([67, 344, -887, -660]);
    expect(endpoints(container, 'sketch-document')).toEqual([-861, -542, 761, 362]);
    expect(getLegacyPortWorldPosition(container.querySelector<HTMLElement>('[data-port-id="sketch-out-out-document"]')!, layer)).toEqual({ x: -861, y: -542 });
    viewport = { x: 175, y: -90, zoom: zoom * 1.25 };
    layer.style.transform = `translate(175px, -90px) scale(${viewport.zoom})`;
    act(() => { fireEvent.load(container.querySelector('img')!); });
    expect(endpoints(container, 'sketch-document')).toEqual([-861, -542, 761, 362]);
  });

  it('keeps fractional-width native temporary and final endpoints exact during a live viewport preview', async () => {
    layerWidth = 1000.4; viewport = { x: 0, y: 0, zoom: 0.8 };
    const workflow = fixture(); workflow.connections = [];
    const { container } = render(<NodeEditor workflow={workflow} rendererMode="legacy" userId="port-user"
      projectId="port-project" taskModelCatalog={[]} canvasImages={[]} onWorkflowChange={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('[data-port-id="image-out-out-image"]')).not.toBeNull());
    viewport = { x: -200, y: 150, zoom: 2 };
    const layer = container.querySelector<HTMLElement>('[data-workflow-legacy-node-layer]')!;
    layer.style.transform = 'translate(-200px, 150px) scale(2)';
    fireEvent.mouseDown(container.querySelector('[data-port-id="image-out-out-image"]')!, { button: 0 });
    const temporary = container.querySelector('[data-workflow-legacy-edge-layer] path[stroke-dasharray="6 4"]')!;
    expect(temporary.getAttribute('d')).toMatch(/^M 67 344 C /);
    fireEvent.mouseUp(container.querySelector('[data-port-id="sketch-in-in-image"]')!, { button: 0 });
    await waitFor(() => expect(container.querySelector('[data-edge-id]')).not.toBeNull());
    const edgeId = container.querySelector('[data-edge-id]')!.getAttribute('data-edge-id')!;
    expect(endpoints(container, edgeId)).toEqual([67, 344, 673, -60]);
  });

  it.each([
    { x: 0, y: 0, zoom: 1 }, { x: 150, y: -80, zoom: 0.5 }, { x: -320, y: 210, zoom: 2 },
  ])('aligns image, sketch multi-type rows, and export inputs at $zoom zoom', view => {
    viewport = view;
    const workflow = fixture(); const before = JSON.stringify(workflow);
    const { container } = render(surface(workflow));
    expect(endpoints(container, 'image-sketch')).toEqual([67, 344, 673, -60]);
    expect(endpoints(container, 'sketch-image')).toEqual([699, 32, 761, 328]);
    expect(endpoints(container, 'sketch-document')).toEqual([699, 58, 761, 362]);
    expect(JSON.stringify(workflow)).toBe(before);
  });

  it('recomputes endpoints after a node drag, port insertion/removal, and card resize', () => {
    const workflow = fixture(); const { container, rerender } = render(surface(workflow));
    const moved = { ...workflow, nodes: workflow.nodes.map(node => node.id === 'sketch' ? { ...node, x: -420, y: 180, width: 420, height: 480 } : node) };
    centers.set('sketch-out-out-document', { x: 419, y: 218 });
    rerender(surface(moved));
    expect(endpoints(container, 'sketch-document')).toEqual([-1, 398, 761, 362]);
    const addedPort: NodePort = { id: 'in-extra', label: '额外输入', type: 'prompt', direction: 'in' };
    const expanded = { ...moved, nodes: moved.nodes.map(node => node.id === 'sketch' ? { ...node, ports: [addedPort, ...node.ports] } : node) };
    centers.set('sketch-in-in-extra', { x: 393, y: 80 });
    centers.set('sketch-in-in-image', { x: 393, y: 130 });
    centers.set('sketch-out-out-document', { x: 419, y: 268 });
    rerender(surface(expanded));
    expect(endpoints(container, 'image-sketch')).toEqual([67, 344, -27, 310]);
    expect(endpoints(container, 'sketch-document')).toEqual([-1, 448, 761, 362]);
    centers.set('sketch-in-in-image', { x: 313, y: 80 });
    centers.set('sketch-out-out-document', { x: 339, y: 198 });
    rerender(surface(workflow));
    expect(endpoints(container, 'sketch-document')).toEqual([699, 58, 761, 362]);
    expect(container.querySelector('[data-port-id="sketch-in-in-extra"]')).toBeNull();
  });

  it('refreshes centers when layout changes without a new workflow object', () => {
    const workflow = fixture(); const { container } = render(surface(workflow));
    centers.set('image-out-out-image', { x: 287, y: 304 });
    act(() => { for (const callback of [...resizeCallbacks]) callback([], {} as ResizeObserver); });
    expect(endpoints(container, 'image-sketch')).toEqual([107, 394, 673, -60]);
  });

  it('uses the current viewport transform once even during an imperative pan/zoom preview', () => {
    const workflow = fixture(); const { container } = render(surface(workflow));
    viewport = { x: -200, y: 150, zoom: 2 };
    const layer = container.querySelector<HTMLElement>('[data-workflow-legacy-node-layer]')!;
    layer.style.transform = 'translate(-200px, 150px) scale(2)';
    act(() => { fireEvent.load(container.querySelector('img')!); });
    expect(endpoints(container, 'image-sketch')).toEqual([67, 344, 673, -60]);
  });

  it('keeps the v2 local position contract independent of legacy node displacement', () => {
    const sketch = fixture().nodes[1];
    const displaced = { ...sketch, x: -999, y: 750 };
    expect(computePortPosition(displaced, 'in-image')).toEqual({ x: 0, y: 49 });
    expect(computePortPosition(displaced, 'out-document')).toEqual({ x: 340, y: 142 });
  });

  it('starts a native temporary line at the final line center and saves unchanged typed identities/bindings', async () => {
    viewport = { x: 0, y: 0, zoom: 0.8 };
    const workflow = fixture(); workflow.connections = [];
    const binding = JSON.stringify(workflow.nodes[0].config.inputBinding);
    const onWorkflowChange = vi.fn();
    const { container } = render(<NodeEditor workflow={workflow} rendererMode="legacy" userId="port-user"
      projectId="port-project" taskModelCatalog={[]} canvasImages={[]} onWorkflowChange={onWorkflowChange} />);
    await waitFor(() => expect(container.querySelector('[data-port-id="image-out-out-image"]')).not.toBeNull());
    const output = container.querySelector('[data-port-id="image-out-out-image"]')!;
    fireEvent.mouseDown(output, { button: 0 });
    const temporary = container.querySelector('[data-workflow-legacy-edge-layer] path[stroke-dasharray="6 4"]')!;
    expect(temporary.getAttribute('d')).toMatch(/^M 67 344 C /);
    fireEvent.mouseUp(container.querySelector('[data-port-id="sketch-in-in-image"]')!, { button: 0 });
    await waitFor(() => expect(container.querySelector('[data-edge-id]')).not.toBeNull());
    const edgeId = container.querySelector('[data-edge-id]')!.getAttribute('data-edge-id')!;
    expect(endpoints(container, edgeId)).toEqual([67, 344, 673, -60]);
    await waitFor(() => expect(onWorkflowChange).toHaveBeenCalled());
    const saved = onWorkflowChange.mock.calls.at(-1)![0] as Workflow;
    expect(saved.connections).toHaveLength(1);
    expect(saved.connections[0]).toMatchObject({ fromNodeId: 'image', fromPortId: 'out-image', toNodeId: 'sketch', toPortId: 'in-image', type: 'image' });
    expect(JSON.stringify(saved.nodes[0].config.inputBinding)).toBe(binding);
  });
});

describe('legacy zoom measurement uses the effective painted transform, not its inline target', () => {
  it.each([
    { painted: 0.8, target: 0.64 }, { painted: 0.64, target: 0.768 },
  ])('keeps cached world centers exact while CSS changes from $painted to $target', ({ painted, target }) => {
    layerWidth = 1000.4; viewport = { x: 50, y: 40, zoom: painted };
    const workflow = fixture(); const { container, rerender } = render(surface(workflow));
    rerender(<WorkflowLegacySurface model={projectLegacyRenderModel(workflow, { x: 50, y: 40, zoom: target })}
      onCommand={vi.fn()} getPortPosition={(node, port) => computePortPosition(node, port.id)} />);
    const layer = container.querySelector<HTMLElement>('[data-workflow-legacy-node-layer]')!;
    expect(layer.style.transform).toBe(`translate(50px, 40px) scale(${target})`);
    expect(endpoints(container, 'image-sketch')).toEqual([67, 344, 673, -60]);
    expect(endpoints(container, 'sketch-image')).toEqual([699, 32, 761, 328]);
    expect(endpoints(container, 'sketch-document')).toEqual([699, 58, 761, 362]);
    expect(getLegacyPortWorldPosition(container.querySelector<HTMLElement>('[data-port-id="sketch-in-in-image"]')!, layer)).toEqual({ x: 673, y: -60 });
    // CSS settles without another React state update or measurement event.
    viewport = { x: 50, y: 40, zoom: target };
    expect(endpoints(container, 'sketch-document')).toEqual([699, 58, 761, 362]);
    expect(getLegacyPortWorldPosition(container.querySelector<HTMLElement>('[data-port-id="sketch-in-in-image"]')!, layer)).toEqual({ x: 673, y: -60 });
  });

  it.each([
    { painted: 0.8, target: 0.64 }, { painted: 0.64, target: 0.768 },
  ])('keeps native temporary and final centers equal during $painted to $target CSS transition', async ({ painted, target }) => {
    layerWidth = 1000.6; viewport = { x: 50, y: 40, zoom: painted };
    const workflow = fixture(); workflow.connections = [];
    const { container } = render(<NodeEditor workflow={workflow} rendererMode="legacy" userId="port-user"
      projectId="port-project" taskModelCatalog={[]} canvasImages={[]} onWorkflowChange={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('[data-port-id="image-out-out-image"]')).not.toBeNull());
    const layer = container.querySelector<HTMLElement>('[data-workflow-legacy-node-layer]')!;
    layer.style.transform = `translate(50px, 40px) scale(${target})`;
    fireEvent.mouseDown(container.querySelector('[data-port-id="image-out-out-image"]')!, { button: 0 });
    expect(container.querySelector('[data-workflow-legacy-edge-layer] path[stroke-dasharray="6 4"]')!.getAttribute('d')).toMatch(/^M 67 344 C /);
    fireEvent.mouseUp(container.querySelector('[data-port-id="sketch-in-in-image"]')!, { button: 0 });
    await waitFor(() => expect(container.querySelector('[data-edge-id]')).not.toBeNull());
    const edgeId = container.querySelector('[data-edge-id]')!.getAttribute('data-edge-id')!;
    expect(endpoints(container, edgeId)).toEqual([67, 344, 673, -60]);
    viewport = { x: 50, y: 40, zoom: target };
    expect(endpoints(container, edgeId)).toEqual([67, 344, 673, -60]);
  });
});


describe('legacy measured-port cache follows the rendered visible membership', () => {
  it.each([
    { membership: 'replacement Set', retainSet: false },
    { membership: 'same Set with changed members', retainSet: true },
  ])('remeasures expansion, shrink and reentry with stable model/dependencies and $membership', ({ retainSet }) => {
    layerWidth = 737.4; viewport = { x: 50, y: 40, zoom: 0.8 };
    const workflow = fixture(); const before = JSON.stringify(workflow);
    const model = projectLegacyRenderModel(workflow, viewport);
    const execResults = {};
    const cardCallbacks = {
      onSelect: vi.fn(), onHover: vi.fn(), onDragStart: vi.fn(), onPortMouseDown: vi.fn(), onPortMouseUp: vi.fn(),
      onDelete: vi.fn(), onDeselect: vi.fn(), onPreviewImage: vi.fn(), collapsedNodes: new Set<string>(),
    };
    const onCommand = vi.fn();
    const fallback = vi.fn((node: Workflow['nodes'][number], port: NodePort): Point | null => computePortPosition(node, port.id));
    let visibleNodeIds = new Set(['image', 'sketch']);
    // Every render keeps the exact same model, viewport, execution and callback references.
    const view = (): React.JSX.Element => <WorkflowLegacySurface model={model} onCommand={onCommand}
      execResults={execResults} cardCallbacks={cardCallbacks} visibleNodeIds={visibleNodeIds} getPortPosition={fallback} />;
    const { container, rerender } = render(view());
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-edge-id]')).toHaveLength(1);
    expect(container.querySelector('[data-port-id="export-in-in-document"]')).toBeNull();
    expect(endpoints(container, 'image-sketch')).toEqual([67, 344, 673, -60]);

    // Side-panel expansion changes only DOM membership/available width, without zoom, pan or load/resize events.
    layerWidth = 993.4;
    if (retainSet) visibleNodeIds.add('export');
    else visibleNodeIds = new Set(['image', 'sketch', 'export']);
    rerender(view());
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-edge-id]')).toHaveLength(3);
    expect(container.querySelector('[data-port-id="export-in-in-image"]')).not.toBeNull();
    expect(container.querySelector('[data-port-id="export-in-in-document"]')).not.toBeNull();
    expect(endpoints(container, 'sketch-image')).toEqual([699, 32, 761, 328]);
    expect(endpoints(container, 'sketch-document')).toEqual([699, 58, 761, 362]);
    fallback.mockClear();
    rerender(view());
    expect(endpoints(container, 'sketch-image')).toEqual([699, 32, 761, 328]);
    expect(endpoints(container, 'sketch-document')).toEqual([699, 58, 761, 362]);
    expect(fallback).not.toHaveBeenCalled();

    layerWidth = 737.4;
    if (retainSet) visibleNodeIds.delete('export');
    else visibleNodeIds = new Set(['image', 'sketch']);
    rerender(view());
    expect(container.querySelector('[data-node-id="export"]')).toBeNull();
    expect(container.querySelectorAll('[data-edge-id]')).toHaveLength(1);
    expect(endpoints(container, 'image-sketch')).toEqual([67, 344, 673, -60]);

    // Remounted ports have new painted centers: an old all-visible cache must not survive culling.
    centers.set('export-in-in-image', { x: 1, y: 88 });
    centers.set('export-in-in-document', { x: 1, y: 142 });
    layerWidth = 993.4;
    if (retainSet) visibleNodeIds.add('export');
    else visibleNodeIds = new Set(['image', 'sketch', 'export']);
    rerender(view());
    expect(container.querySelector('[data-port-id="export-in-in-image"]')).not.toBeNull();
    expect(container.querySelector('[data-port-id="export-in-in-document"]')).not.toBeNull();
    expect(endpoints(container, 'sketch-image')).toEqual([699, 32, 761, 348]);
    expect(endpoints(container, 'sketch-document')).toEqual([699, 58, 761, 402]);
    fallback.mockClear();
    rerender(view());
    expect(endpoints(container, 'sketch-image')).toEqual([699, 32, 761, 348]);
    expect(endpoints(container, 'sketch-document')).toEqual([699, 58, 761, 402]);
    expect(fallback).not.toHaveBeenCalled();
    expect(JSON.stringify(workflow)).toBe(before);
  });
});

