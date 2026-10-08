// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowReactFlowSurface } from '@/components/workflow/WorkflowReactFlowSurface';
import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';
import { projectReactFlowRenderModel } from '@/lib/workflow-renderer/view-model';

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback([{
      target, contentRect: target.getBoundingClientRect(),
      borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [],
    }], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

function dispatchMouse(target: Element | Window, type: string, init: MouseEventInit): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'view', { configurable: true, value: document.defaultView });
  fireEvent(target, event);
}

function measuredModel(): {
  model: ReturnType<typeof projectReactFlowRenderModel>;
  labelReads: Map<string, number>;
} {
  const workflow = createEmptyWorkflow('real drag rendering');
  workflow.nodes = [
    createWorkflowNode('input-text', 40, 60, 'moving card'),
    createWorkflowNode('input-text', 360, 60, 'stationary card'),
  ];
  const model = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
  const labelReads = new Map<string, number>();
  // Instrument real product-card work, not a substitute component or render mock.
  for (const node of model.nodes) {
    const label = node.workflowNode.label;
    Object.defineProperty(node.workflowNode, 'label', {
      enumerable: true,
      get(): string {
        labelReads.set(node.id, (labelReads.get(node.id) ?? 0) + 1);
        return label;
      },
    });
  }
  return { model, labelReads };
}

describe('React Flow drag product-card rendering', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('DOMMatrixReadOnly', class { readonly m22 = 1; });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
      const width = Number.parseFloat(this.style.width) || 1000;
      const height = Number.parseFloat(this.style.height) || 700;
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement): number {
      return this.getBoundingClientRect().width;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement): number {
      return this.getBoundingClientRect().height;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['stationary', 'moving'] as const)(
    'does not repeat %s product-card work during position-only drag updates',
    async kind => {
      const { model, labelReads } = measuredModel();
      const onCommand = vi.fn();
      const { container } = render(<WorkflowReactFlowSurface model={model} onCommand={onCommand} readOnly={false} />);
      const movingId = model.nodes[0]!.id;
      const measuredId = model.nodes[kind === 'moving' ? 0 : 1]!.id;
      const flowNode = await waitFor(() => {
        const element = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${movingId}"]`);
        expect(element?.style.visibility).toBe('visible');
        expect(labelReads.get(measuredId)).toBeGreaterThan(0);
        return element!;
      });
      dispatchMouse(flowNode, 'mousedown', { button: 0, clientX: 100, clientY: 100 });
      let repeatedLabelReads = 0;
      try {
        dispatchMouse(document.defaultView!, 'mousemove', { buttons: 1, clientX: 160, clientY: 145 });
        await waitFor(() => expect(flowNode.classList.contains('dragging')).toBe(true));
        const initialTransform = flowNode.style.transform;
        const readsBeforeMoves = labelReads.get(measuredId)!;
        for (let step = 1; step <= 6; step++) {
          dispatchMouse(document.defaultView!, 'mousemove', { buttons: 1, clientX: 160 + step * 10, clientY: 145 + step * 5 });
        }
        expect(flowNode.style.transform).not.toBe(initialTransform);
        expect(onCommand).not.toHaveBeenCalled(); // Domain positions commit at mouse-up only.
        repeatedLabelReads = labelReads.get(measuredId)! - readsBeforeMoves;
      } finally {
        // Unmount alone does not release the active d3 window listeners/auto-pan.
        dispatchMouse(document.defaultView!, 'mouseup', { button: 0, clientX: 220, clientY: 175 });
      }
      expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'nodes.drag.commit' }));
      expect(repeatedLabelReads).toBe(0);
    },
  );

  it.each(['model', 'callback'] as const)('uses the current %s when only that host prop changes', async changedProp => {
    const { model } = measuredModel();
    const firstCommand = vi.fn();
    const nextCommand = vi.fn();
    const { container, rerender } = render(
      <WorkflowReactFlowSurface model={model} onCommand={firstCommand} readOnly={false} />,
    );
    const nextModel = changedProp === 'model'
      ? { ...model, nodes: model.nodes.map((node, index) => ({ ...node, selected: index === 0 })) }
      : model;
    const currentCommand = changedProp === 'callback' ? nextCommand : firstCommand;
    rerender(<WorkflowReactFlowSurface model={nextModel} onCommand={currentCommand} readOnly={false} />);
    const secondId = model.nodes[1]!.id;
    const secondNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${secondId}"]`);
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.click(secondNode, { ctrlKey: true });
    expect(changedProp === 'callback' ? firstCommand : nextCommand).not.toHaveBeenCalled();
    expect(currentCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'selection.set', nodeIds: changedProp === 'model' ? [model.nodes[0]!.id, secondId] : [secondId],
    }));
  });

  it('updates port connectability and selection permissions when read-only mode changes', async () => {
    const { model } = measuredModel();
    const onCommand = vi.fn();
    const { container, rerender } = render(<WorkflowReactFlowSurface model={model} onCommand={onCommand} readOnly={false} />);
    const nodeId = model.nodes[0]!.id;
    const readPort = (): Element | null => container.querySelector(`[data-port-id="${nodeId}-out-out-prompt"]`);
    await waitFor(() => expect(readPort()?.classList.contains('connectable')).toBe(true));

    rerender(<WorkflowReactFlowSurface model={model} onCommand={onCommand} readOnly />);
    await waitFor(() => expect(readPort()?.classList.contains('connectable')).toBe(false));
    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${nodeId}"]`)!);
    expect(onCommand).not.toHaveBeenCalled();

    rerender(<WorkflowReactFlowSurface model={model} onCommand={onCommand} readOnly={false} />);
    await waitFor(() => expect(readPort()?.classList.contains('connectable')).toBe(true));
    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${nodeId}"]`)!);
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'selection.set', nodeIds: [nodeId] }));
  });
});
