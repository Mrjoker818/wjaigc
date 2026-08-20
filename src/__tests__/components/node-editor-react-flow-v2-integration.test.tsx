// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow, createWorkflowNode, type Workflow } from '@/lib/workflow-engine';

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    const rect = target.getBoundingClientRect();
    this.callback([{
      target,
      contentRect: rect,
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }], this);
  }

  unobserve(): void {}
  disconnect(): void {}
}

class BroadcastChannelMock implements BroadcastChannel {
  readonly name: string;
  onmessage: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null;
  onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null;

  constructor(name: string) {
    this.name = name;
  }

  close(): void {}
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return true; }
}

class PointerEventMock extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

class DOMMatrixReadOnlyMock {
  readonly m22 = 1;
}

function workflowFixture(): Workflow {
  const workflow = createEmptyWorkflow('NodeEditor React Flow integration');
  workflow.nodes = [createWorkflowNode('input-text', 40, 60, 'drag source')];
  return workflow;
}

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function dispatchMouse(target: Element | Node | Window | Document, type: string, init: MouseEventInit): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'view', { configurable: true, value: document.defaultView });
  fireEvent(target, event);
  return event;
}

describe('NodeEditor react-flow-v2 integration', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageMock());
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock);
    vi.stubGlobal('PointerEvent', PointerEventMock);
    vi.stubGlobal('DOMMatrixReadOnly', DOMMatrixReadOnlyMock);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function getBoundingClientRect(): DOMRect {
        const width = Number.parseFloat(this.style.width) || (this.classList.contains('react-flow__node') ? 280 : 1000);
        const height = Number.parseFloat(this.style.height) || (this.classList.contains('react-flow__node') ? 180 : 700);
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: height,
          width,
          height,
          toJSON: () => ({}),
        } as DOMRect;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(): number { return this.getBoundingClientRect().width; },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(): number { return this.getBoundingClientRect().height; },
    });
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('synchronizes a React Flow node click with the domain selection and property panel', async () => {
    const workflow = workflowFixture();
    const node = workflow.nodes[0]!;
    const { container } = render(
      <NodeEditor
        workflow={workflow}
        userId="integration-user"
        projectId="integration-project"
        canvasImages={[]}
        rendererMode="react-flow-v2"
      />,
    );
    const flowNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`);
      expect(element).not.toBeNull();
      return element!;
    });
    expect(screen.getByText('选中节点查看属性')).toBeTruthy();

    fireEvent.click(flowNode);

    await waitFor(() => {
      expect(screen.queryByText('选中节点查看属性')).toBeNull();
    });
  });

  it('saves the latest node name when blur and save happen in the same click', async () => {
    const workflow = workflowFixture();
    const node = workflow.nodes[0]!;
    const onWorkflowSaved = vi.fn<(workflow: Workflow) => Promise<void>>().mockResolvedValue(undefined);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === '/api/workflow/save') {
        return new Response(JSON.stringify({ success: true, workflowId: workflow.id }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const { container } = render(
      <NodeEditor
        workflow={workflow}
        userId="integration-user"
        projectId="integration-project"
        onWorkflowSaved={onWorkflowSaved}
        canvasImages={[]}
        rendererMode="react-flow-v2"
      />,
    );
    const flowNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`);
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.click(flowNode);
    const nameInput = await screen.findByDisplayValue('drag source');

    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'renamed before save' } });
    fireEvent.blur(nameInput);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([input]) => (
        (typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url) === '/api/workflow/save'
      ));
      expect(saveCall).toBeDefined();
      const request = JSON.parse(String(saveCall?.[1]?.body)) as { workflow: Workflow };
      expect(request.workflow.nodes[0]?.label).toBe('renamed before save');
      expect(onWorkflowSaved).toHaveBeenCalledWith(expect.objectContaining({
        nodes: [expect.objectContaining({ label: 'renamed before save' })],
      }));
    });
  });

  it('uses one domain selection path for the embedded card mouse sequence', async () => {
    const workflow = workflowFixture();
    const second = createWorkflowNode('input-text', 360, 60, 'second source');
    workflow.nodes.push(second);
    const { container } = render(
      <NodeEditor
        workflow={workflow}
        userId="integration-user"
        projectId="integration-project"
        canvasImages={[]}
        rendererMode="react-flow-v2"
      />,
    );
    const [firstFlowNode, secondFlowNode] = await waitFor(() => {
      const nodes = [...container.querySelectorAll<HTMLElement>('.react-flow__node')];
      expect(nodes).toHaveLength(2);
      return nodes;
    });
    const firstCard = firstFlowNode!.querySelector<HTMLElement>('[data-node-id]')!;
    const secondCard = secondFlowNode!.querySelector<HTMLElement>('[data-node-id]')!;

    dispatchMouse(firstCard, 'mousedown', { button: 0 });
    dispatchMouse(firstCard, 'mouseup', { button: 0 });
    fireEvent.click(firstCard);
    dispatchMouse(secondCard, 'mousedown', { button: 0, ctrlKey: true });
    dispatchMouse(secondCard, 'mouseup', { button: 0, ctrlKey: true });
    fireEvent.click(secondCard, { ctrlKey: true });

    await waitFor(() => {
      expect(container.querySelectorAll('.react-flow__node.selected')).toHaveLength(2);
    });
  });

  it('defers an external workflow during an actual React Flow drag and merges it at drag end', async () => {
    const workflow = workflowFixture();
    const node = workflow.nodes[0]!;
    const onWorkflowChange = vi.fn<(workflow: Workflow | null) => void>();
    const { container, rerender } = render(
      <NodeEditor
        workflow={workflow}
        userId="integration-user"
        projectId="integration-project"
        onWorkflowChange={onWorkflowChange}
        canvasImages={[]}
        rendererMode="react-flow-v2"
      />,
    );
    const flowNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`);
      expect(element).not.toBeNull();
      return element!;
    });
    expect(container.querySelector('[data-workflow-react-flow-surface]')?.getAttribute('aria-hidden'))
      .toBe('false');
    expect(screen.getByText(/drag source/i)).toBeTruthy();
    await waitFor(() => {
      const listeners = (flowNode as HTMLElement & { __on?: Array<{ type: string }> }).__on;
      expect(listeners?.some(listener => listener.type === 'mousedown')).toBe(true);
    });

    const initialTransform = flowNode.style.transform;
    dispatchMouse(flowNode, 'mousedown', { button: 0, clientX: 100, clientY: 100 });
    const windowListeners = (document.defaultView as Window & { __on?: Array<{ type: string }> }).__on;
    expect(windowListeners?.some(listener => listener.type === 'mousemove')).toBe(true);
    dispatchMouse(document.defaultView!, 'mousemove', { buttons: 1, clientX: 160, clientY: 145 });
    dispatchMouse(document.defaultView!, 'mousemove', { buttons: 1, clientX: 180, clientY: 160 });
    await waitFor(() => expect(flowNode.style.transform).not.toBe(initialTransform));

    const externalWorkflow: Workflow = {
      ...workflow,
      nodes: workflow.nodes.map(item => item.id === node.id
        ? {
            ...item,
            label: 'external during drag',
            config: { ...item.config, externalImage: '/during-drag.png' },
          }
        : item),
    };
    rerender(
      <NodeEditor
        workflow={externalWorkflow}
        userId="integration-user"
        projectId="integration-project"
        onWorkflowChange={onWorkflowChange}
        canvasImages={[]}
        rendererMode="react-flow-v2"
      />,
    );

    expect(screen.queryByText(/external during drag/i)).toBeNull();

    dispatchMouse(document.defaultView!, 'mouseup', { button: 0, clientX: 180, clientY: 160 });

    await waitFor(() => {
      const emitted = onWorkflowChange.mock.calls.at(-1)?.[0];
      const emittedNode = emitted?.nodes.find(item => item.id === node.id);
      expect(emittedNode?.config.externalImage).toBe('/during-drag.png');
      expect(emittedNode?.x).not.toBe(node.x);
      expect(emittedNode?.y).not.toBe(node.y);
    });
    expect(screen.getByText(/external during drag/i)).toBeTruthy();
  });
});
