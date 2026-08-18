// @vitest-environment jsdom

import { useCallback, useReducer, useRef, useState, type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyWorkflow, createWorkflowNode, type Workflow } from '@/lib/workflow-engine';
import {
  createWorkflowEditorState,
  mergeExternalWorkflowWithPositions,
  reduceWorkflowEditorState,
  type WorkflowInteractionCommand,
  type WorkflowNodePosition,
} from '@/lib/workflow-renderer/commands';
import { projectReactFlowRenderModel } from '@/lib/workflow-renderer/view-model';

interface HarnessNode {
  id: string;
  position: { x: number; y: number };
  selected?: boolean;
}

interface FaithfulReactFlowProps {
  nodes: HarnessNode[];
  onNodeDragStart?: (event: unknown, node: HarnessNode, selectedNodes: HarnessNode[]) => void;
  onNodesChange?: (changes: Array<{
    id: string;
    type: 'position';
    position: { x: number; y: number };
    dragging: boolean;
  }>) => void;
  onNodeDragStop?: (event: unknown, node: HarnessNode, selectedNodes: HarnessNode[]) => void;
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void;
  children?: ReactNode;
}

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    useNodesState: (initialNodes: HarnessNode[]) => {
      const [nodes, setNodes] = React.useState(initialNodes);
      const onNodesChange = (changes: Array<{
        id: string;
        type: 'position';
        position: { x: number; y: number };
      }>) => {
        setNodes(current => current.map(node => {
          const change = changes.find(candidate => candidate.id === node.id && candidate.type === 'position');
          return change ? { ...node, position: { ...change.position } } : node;
        }));
      };
      return [nodes, setNodes, onNodesChange] as const;
    },
    ReactFlow: ({ nodes, onNodeDragStart, onNodesChange, onNodeDragStop, onViewportChange, children }: FaithfulReactFlowProps) => {
      const selectedNodes = nodes.filter(node => node.selected);
      const draggedNodes = selectedNodes.length > 0 ? selectedNodes : nodes.slice(0, 1);
      const dragStartNodesRef = React.useRef<HarnessNode[]>([]);
      const movedNodesRef = React.useRef<HarnessNode[]>([]);
      const beginDrag = () => {
        dragStartNodesRef.current = draggedNodes.map(node => ({ ...node, position: { ...node.position } }));
        movedNodesRef.current = dragStartNodesRef.current.map(node => ({
          ...node,
          position: { x: node.position.x + 20, y: node.position.y + 30 },
        }));
        onNodeDragStart?.({}, dragStartNodesRef.current[0]!, dragStartNodesRef.current);
      };
      return (
        <div
          data-testid="react-flow-harness"
          onMouseDown={beginDrag}
          onMouseMove={() => onNodesChange?.(movedNodesRef.current.map(node => ({
            id: node.id,
            type: 'position',
            position: node.position,
            dragging: true,
          })))}
          onMouseUp={() => onNodeDragStop?.({}, movedNodesRef.current[0]!, movedNodesRef.current)}
        >
          {nodes.map(node => <button type="button" data-node-id={node.id} key={node.id}>{node.id}</button>)}
          <button
            type="button"
            data-testid="viewport-control"
            onClick={() => onViewportChange?.({ x: -80, y: 45, zoom: 1.4 })}
          >viewport</button>
          {children}
        </div>
      );
    },
    Background: () => <div data-testid="flow-background" />,
    BaseEdge: () => <div data-testid="flow-edge" />,
    Handle: ({ id }: { id?: string }) => <span data-handle-id={id} />,
    Position: { Left: 'left', Right: 'right' },
    getBezierPath: () => [''],
  };
});

import {
  useWorkflowDragSynchronization,
} from '@/components/node-editor';
import {
  DEFAULT_WORKFLOW_NODE_THEME,
} from '@/components/workflow/WorkflowLegacySurface';
import { WorkflowLegacyNodeCard } from '@/components/workflow/WorkflowLegacyNodeCard';
import { WorkflowReactFlowSurface } from '@/components/workflow/WorkflowReactFlowSurface';

const resizeObserve = vi.fn();

interface ControlledHostProps {
  externalWorkflow: Workflow;
}

function ControlledHost({ externalWorkflow }: ControlledHostProps) {
  const [editorState, dispatch] = useReducer(
    reduceWorkflowEditorState,
    externalWorkflow,
    createWorkflowEditorState,
  );
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const lastEmittedWorkflowRef = useRef<Workflow | null>(externalWorkflow);
  const hydrateWorkflow = useCallback((workflow: Workflow) => {
    dispatch({
      kind: 'command',
      command: { type: 'workflow.hydrate', workflow, transactionId: 'test-external-hydrate' },
    });
  }, []);
  const applyDeferredWorkflow = useCallback((workflow: Workflow, positions: WorkflowNodePosition[]) => {
    dispatch({
      kind: 'system.update',
      workflow: mergeExternalWorkflowWithPositions(workflow, positions),
    });
  }, []);
  const dragSynchronization = useWorkflowDragSynchronization({
    externalWorkflow,
    lastEmittedWorkflowRef,
    hydrateWorkflow,
    applyDeferredWorkflow,
  });
  const onCommand = useCallback((command: WorkflowInteractionCommand) => {
    dispatch({ kind: 'command', command });
  }, []);
  return (
    <>
      <WorkflowReactFlowSurface
        model={projectReactFlowRenderModel(
          editorState.workflow,
          viewport,
          new Set(editorState.workflow.nodes.map(node => node.id)),
        )}
        onCommand={onCommand}
        onNodeDragStart={dragSynchronization.beginWorkflowDrag}
        onNodeDragEnd={dragSynchronization.finishWorkflowDrag}
        onViewportChange={setViewport}
        readOnly={false}
      />
      <output data-testid="workflow-state">{JSON.stringify(editorState.workflow)}</output>
      <output data-testid="history-count">{editorState.history.entries.length}</output>
      <output data-testid="viewport-state">{JSON.stringify(viewport)}</output>
    </>
  );
}

function readWorkflow(): Workflow {
  return JSON.parse(screen.getByTestId('workflow-state').textContent || '') as Workflow;
}

describe('controlled WorkflowReactFlowSurface behavior', () => {
  beforeEach(() => {
    resizeObserve.mockClear();
    class ResizeObserverMock {
      observe(): void { resizeObserve(); }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  it('does not install a second size observer inside React Flow managed nodes', () => {
    const node = createWorkflowNode('input-text', 0, 0, 'first');

    const { container } = render(
      <WorkflowLegacyNodeCard
        node={node}
        isSelected={false}
        isHighlighted={false}
        isHovered={false}
        isRunning={false}
        theme={DEFAULT_WORKFLOW_NODE_THEME}
        onSelect={vi.fn()}
        onHover={vi.fn()}
        onDragStart={vi.fn()}
        onPortMouseDown={vi.fn()}
        onPortMouseUp={vi.fn()}
        onDelete={vi.fn()}
        onDeselect={vi.fn()}
        onPreviewImage={vi.fn()}
        onUpdateNodeSize={vi.fn()}
        layout="embedded"
      />,
    );

    expect(container.querySelector('.node-card')?.classList.contains('react-flow-embedded')).toBe(true);
    expect(resizeObserve).not.toHaveBeenCalled();
  });

  it('mounts DOM interactions through host drag guarding, deferred hydration, group commit, and viewport control', async () => {
    const workflow = createEmptyWorkflow('mounted controlled flow');
    const first = createWorkflowNode('input-text', 0, 0, 'first');
    const second = createWorkflowNode('input-text', 240, 0, 'second');
    workflow.nodes = [first, second];
    const { rerender } = render(<ControlledHost externalWorkflow={workflow} />);
    const surface = screen.getByTestId('react-flow-harness');

    fireEvent.mouseDown(surface);
    fireEvent.mouseMove(surface);
    expect(readWorkflow().nodes.map(node => ({ x: node.x, y: node.y }))).toEqual([
      { x: 0, y: 0 }, { x: 240, y: 0 },
    ]);
    expect(screen.getByTestId('history-count').textContent).toBe('0');

    const externalWorkflow = {
      ...workflow,
      nodes: workflow.nodes.map(node => node.id === first.id
        ? { ...node, width: 444, config: { ...node.config, externalImage: '/during-drag.png' } }
        : node),
    };
    await act(async () => { rerender(<ControlledHost externalWorkflow={externalWorkflow} />); });
    expect(readWorkflow().nodes[0]?.config.externalImage).toBeUndefined();

    fireEvent.mouseUp(surface);
    fireEvent.click(screen.getByTestId('viewport-control'));

    const finalWorkflow = readWorkflow();
    expect(finalWorkflow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, x: 20, y: 30, width: 444, config: expect.objectContaining({ externalImage: '/during-drag.png' }) }),
      expect.objectContaining({ id: second.id, x: 260, y: 30 }),
    ]));
    expect(screen.getByTestId('history-count').textContent).toBe('1');
    expect(screen.getByTestId('viewport-state').textContent).toBe(JSON.stringify({ x: -80, y: 45, zoom: 1.4 }));
    expect(screen.getByRole('button', { name: first.id }).getAttribute('data-node-id')).toBe(first.id);
    expect(screen.getByRole('button', { name: second.id }).getAttribute('data-node-id')).toBe(second.id);
  });
});
