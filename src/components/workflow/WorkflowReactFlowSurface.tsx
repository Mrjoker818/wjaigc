import {
  Background,
  ReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react';

import { WorkflowNodeCard, type WorkflowFlowNode } from './WorkflowNodeCard';
import type { WorkflowInteractionCommand } from '@/lib/workflow-renderer/commands';
import type { WorkflowRenderModel } from '@/lib/workflow-renderer/view-model';

interface WorkflowReactFlowSurfaceProps {
  model: WorkflowRenderModel;
  onCommand: (command: WorkflowInteractionCommand) => void;
  readOnly?: boolean;
}

const nodeTypes = { workflow: WorkflowNodeCard };

export function createReactFlowCommandHandlers(
  model: WorkflowRenderModel,
  onCommand: (command: WorkflowInteractionCommand) => void,
) {
  return {
    moveNode(nodeId: string, position: { x: number; y: number }, transactionId: string): void {
      const node = model.nodes.find(candidate => candidate.id === nodeId);
      if (!node) return;
      const delta = { x: position.x - node.position.x, y: position.y - node.position.y };
      if (delta.x === 0 && delta.y === 0) return;
      onCommand({ type: 'nodes.move', nodeIds: [nodeId], delta, transactionId });
    },
    createConnection(connection: Connection, transactionId: string): void {
      if (!connection.source || !connection.sourceHandle || !connection.target || !connection.targetHandle) return;
      const source = model.nodes.find(node => node.id === connection.source);
      const sourcePort = source?.ports.find(port => port.id === connection.sourceHandle);
      if (!sourcePort || sourcePort.direction !== 'out') return;
      onCommand({
        type: 'connection.create',
        transactionId,
        connection: {
          id: `react-flow:${transactionId}`,
          fromNodeId: connection.source,
          fromPortId: connection.sourceHandle,
          toNodeId: connection.target,
          toPortId: connection.targetHandle,
          type: sourcePort.type,
        },
      });
    },
  };
}

function toFlowNodes(model: WorkflowRenderModel): WorkflowFlowNode[] {
  return model.nodes.map(node => ({
    id: node.id,
    type: 'workflow',
    position: node.position,
    width: node.size.width,
    height: node.size.height,
    data: { node },
    selectable: false,
    draggable: false,
    connectable: false,
  }));
}

function toFlowEdges(model: WorkflowRenderModel): Edge[] {
  return model.edges.map(edge => ({
    id: edge.id,
    source: edge.source.nodeId,
    sourceHandle: edge.source.portId,
    target: edge.target.nodeId,
    targetHandle: edge.target.portId,
    type: 'straight',
    selectable: false,
    focusable: false,
  }));
}

/** Controlled, read-only renderer. The workflow model remains the sole source of truth. */
export function WorkflowReactFlowSurface({ model, onCommand, readOnly = true }: WorkflowReactFlowSurfaceProps) {
  const commandHandlers = createReactFlowCommandHandlers(model, onCommand);
  return (
    <div data-workflow-react-flow-surface aria-hidden={readOnly ? 'true' : undefined} className="absolute inset-0">
      <ReactFlow<WorkflowFlowNode, Edge>
        nodes={toFlowNodes(model)}
        edges={toFlowEdges(model)}
        nodeTypes={nodeTypes}
        viewport={model.viewport}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        panOnDrag={!readOnly}
        zoomOnScroll={!readOnly}
        zoomOnPinch={!readOnly}
        zoomOnDoubleClick={!readOnly}
        onNodeDragStop={readOnly ? undefined : (_event, node) => {
          commandHandlers.moveNode(node.id, node.position, `react-flow-drag:${node.id}`);
        }}
        onConnect={readOnly ? undefined : connection => {
          commandHandlers.createConnection(
            connection,
            `react-flow-connect:${connection.source ?? 'unknown'}:${connection.sourceHandle ?? 'unknown'}:${connection.target ?? 'unknown'}:${connection.targetHandle ?? 'unknown'}`,
          );
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
