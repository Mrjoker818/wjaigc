import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyWorkflow, createWorkflowNode, type Workflow } from '@/lib/workflow-engine';
import {
  createWorkflowEditorState,
  reduceWorkflowEditorState,
  type WorkflowInteractionCommand,
  type WorkflowNodePosition,
} from '@/lib/workflow-renderer/commands';
import { projectReactFlowRenderModel } from '@/lib/workflow-renderer/view-model';

interface CapturedReactFlowProps {
  onNodeDragStart?: (
    event: unknown,
    node: { id: string; position: { x: number; y: number } },
    selectedNodes: Array<{ id: string; position: { x: number; y: number } }>,
  ) => void;
  onNodesChange?: (changes: Array<{
    id: string;
    type: 'position';
    position: { x: number; y: number };
    dragging: boolean;
  }>) => void;
  onNodeDragStop?: (
    event: unknown,
    node: { id: string; position: { x: number; y: number } },
    selectedNodes: Array<{ id: string; position: { x: number; y: number } }>,
  ) => void;
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void;
}

const captured = vi.hoisted(() => ({ props: null as CapturedReactFlowProps | null }));

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: CapturedReactFlowProps) => {
    captured.props = props;
    return null;
  },
  Background: () => null,
  BaseEdge: () => null,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  getBezierPath: () => [''],
}));

import { WorkflowReactFlowSurface } from '@/components/workflow/WorkflowReactFlowSurface';

function previewPositions(workflow: Workflow, positions: WorkflowNodePosition[]): Workflow {
  const positionById = new Map(positions.map(item => [item.nodeId, item.position]));
  return {
    ...workflow,
    nodes: workflow.nodes.map(node => {
      const position = positionById.get(node.id);
      return position ? { ...node, x: position.x, y: position.y } : node;
    }),
  };
}

describe('controlled WorkflowReactFlowSurface behavior', () => {
  beforeEach(() => { captured.props = null; });

  it('mounts controlled preview, selected group commit, and viewport callbacks into host state', () => {
    const workflow = createEmptyWorkflow('mounted controlled flow');
    const first = createWorkflowNode('input-text', 0, 0, 'first');
    const second = createWorkflowNode('input-text', 240, 0, 'second');
    workflow.nodes = [first, second];
    let editorState = createWorkflowEditorState(workflow);
    let viewport = { x: 0, y: 0, zoom: 1 };
    const onCommand = (command: WorkflowInteractionCommand): void => {
      editorState = reduceWorkflowEditorState(editorState, { kind: 'command', command });
    };
    const onNodePositionPreview = (positions: WorkflowNodePosition[]): void => {
      editorState = reduceWorkflowEditorState(editorState, {
        kind: 'system.update',
        workflow: previewPositions(editorState.workflow, positions),
      });
    };

    renderToStaticMarkup(createElement(WorkflowReactFlowSurface, {
      model: projectReactFlowRenderModel(workflow, viewport, new Set([first.id, second.id])),
      onCommand,
      onNodePositionPreview,
      onViewportChange: next => { viewport = next; },
      readOnly: false,
    }));
    const mounted = captured.props;
    expect(mounted).not.toBeNull();
    expect(mounted!.onNodeDragStart).toBeTypeOf('function');

    mounted!.onNodeDragStart?.(
      {},
      { id: first.id, position: { x: 0, y: 0 } },
      [
        { id: first.id, position: { x: 0, y: 0 } },
        { id: second.id, position: { x: 240, y: 0 } },
      ],
    );

    mounted!.onNodesChange?.([
      { id: first.id, type: 'position', position: { x: 20, y: 30 }, dragging: true },
      { id: second.id, type: 'position', position: { x: 260, y: 30 }, dragging: true },
    ]);
    expect(editorState.workflow.nodes.map(node => ({ x: node.x, y: node.y }))).toEqual([
      { x: 20, y: 30 }, { x: 260, y: 30 },
    ]);
    expect(editorState.history.entries).toHaveLength(0);

    mounted!.onNodeDragStop?.(
      {},
      { id: first.id, position: { x: 20, y: 30 } },
      [
        { id: first.id, position: { x: 20, y: 30 } },
        { id: second.id, position: { x: 260, y: 30 } },
      ],
    );
    mounted!.onViewportChange?.({ x: -80, y: 45, zoom: 1.4 });

    expect(editorState.history.entries).toHaveLength(1);
    expect(editorState.workflow.nodes.map(node => ({ x: node.x, y: node.y }))).toEqual([
      { x: 20, y: 30 }, { x: 260, y: 30 },
    ]);
    expect(viewport).toEqual({ x: -80, y: 45, zoom: 1.4 });

    editorState = reduceWorkflowEditorState(editorState, {
      kind: 'system.update',
      workflow: {
        ...editorState.workflow,
        nodes: editorState.workflow.nodes.map(node => node.id === first.id
          ? { ...node, width: 420, config: { ...node.config, imageUrl: '/after-drag.png' } }
          : node),
      },
    });
    editorState = reduceWorkflowEditorState(editorState, { kind: 'history.undo' });
    expect(editorState.workflow.nodes[0]).toMatchObject({
      x: 0, y: 0, width: 420, config: expect.objectContaining({ imageUrl: '/after-drag.png' }),
    });
    editorState = reduceWorkflowEditorState(editorState, { kind: 'history.redo' });
    expect(editorState.workflow.nodes[0]).toMatchObject({
      x: 20, y: 30, width: 420, config: expect.objectContaining({ imageUrl: '/after-drag.png' }),
    });
  });
});
