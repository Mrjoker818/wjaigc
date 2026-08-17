import type {
  NodePort,
  NodeType,
  PortType,
  Workflow,
} from '@/lib/workflow-engine';

export interface WorkflowRenderViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkflowRenderNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  size: { width: number; height: number };
  ports: NodePort[];
  selected: boolean;
  label: string;
}

export interface WorkflowRenderEdge {
  id: string;
  source: { nodeId: string; portId: string };
  target: { nodeId: string; portId: string };
  type: PortType;
}

export interface WorkflowRenderModel {
  nodes: WorkflowRenderNode[];
  edges: WorkflowRenderEdge[];
  viewport: WorkflowRenderViewport;
}

/** Creates an immutable renderer input from the workflow domain state. */
export function projectWorkflowRenderModel(
  workflow: Workflow,
  viewport: WorkflowRenderViewport,
): WorkflowRenderModel {
  return {
    nodes: workflow.nodes.map(node => ({
      id: node.id,
      type: node.type,
      label: node.label,
      position: { x: node.x, y: node.y },
      size: { width: node.width, height: node.height },
      ports: node.ports.map(port => ({ ...port })),
      selected: false,
    })),
    edges: workflow.connections.map(connection => ({
      id: connection.id,
      source: { nodeId: connection.fromNodeId, portId: connection.fromPortId },
      target: { nodeId: connection.toNodeId, portId: connection.toPortId },
      type: connection.type,
    })),
    viewport: { ...viewport },
  };
}

export function projectLegacyRenderModel(
  workflow: Workflow,
  viewport: WorkflowRenderViewport,
): WorkflowRenderModel {
  return projectWorkflowRenderModel(workflow, viewport);
}

export function projectReactFlowRenderModel(
  workflow: Workflow,
  viewport: WorkflowRenderViewport,
): WorkflowRenderModel {
  return projectWorkflowRenderModel(workflow, viewport);
}
