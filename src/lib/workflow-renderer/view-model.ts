import type {
  NodePort,
  NodeType,
  PortType,
  Workflow,
  WorkflowConnection,
  WorkflowNode,
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
  workflowNode: WorkflowNode;
}

export interface WorkflowRenderEdge {
  id: string;
  source: { nodeId: string; portId: string };
  target: { nodeId: string; portId: string };
  type: PortType;
  workflowConnection: WorkflowConnection;
}

export interface WorkflowRenderModel {
  nodes: WorkflowRenderNode[];
  edges: WorkflowRenderEdge[];
  viewport: WorkflowRenderViewport;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => cloneValue(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    ) as T;
  }
  return value;
}

function cloneWorkflowNode(node: WorkflowNode): WorkflowNode {
  return {
    ...node,
    ports: node.ports.map(port => ({ ...port })),
    config: cloneValue(node.config),
    execResult: node.execResult ? cloneValue(node.execResult) : undefined,
  };
}

/** Creates an immutable renderer input from the workflow domain state. */
export function projectWorkflowRenderModel(
  workflow: Workflow,
  viewport: WorkflowRenderViewport,
  selectedNodeIds: ReadonlySet<string> = new Set(),
): WorkflowRenderModel {
  return {
    nodes: workflow.nodes.map(node => ({
      id: node.id,
      type: node.type,
      label: node.label,
      position: { x: node.x, y: node.y },
      size: { width: node.width, height: node.height },
      ports: node.ports.map(port => ({ ...port })),
      selected: selectedNodeIds.has(node.id),
      workflowNode: cloneWorkflowNode(node),
    })),
    edges: workflow.connections.map(connection => ({
      id: connection.id,
      source: { nodeId: connection.fromNodeId, portId: connection.fromPortId },
      target: { nodeId: connection.toNodeId, portId: connection.toPortId },
      type: connection.type,
      workflowConnection: { ...connection },
    })),
    viewport: { ...viewport },
  };
}

export function projectLegacyRenderModel(
  workflow: Workflow,
  viewport: WorkflowRenderViewport,
  selectedNodeIds: ReadonlySet<string> = new Set(),
): WorkflowRenderModel {
  return {
    nodes: workflow.nodes.map(node => ({
      id: node.id,
      type: node.type,
      label: node.label,
      position: { x: node.x, y: node.y },
      size: { width: node.width, height: node.height },
      ports: node.ports.map(port => ({ ...port })),
      selected: selectedNodeIds.has(node.id),
      workflowNode: cloneWorkflowNode(node),
    })),
    edges: workflow.connections.map(connection => ({
      id: connection.id,
      source: { nodeId: connection.fromNodeId, portId: connection.fromPortId },
      target: { nodeId: connection.toNodeId, portId: connection.toPortId },
      type: connection.type,
      workflowConnection: { ...connection },
    })),
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  };
}

export function projectReactFlowRenderModel(
  workflow: Workflow,
  viewport: WorkflowRenderViewport,
  selectedNodeIds: ReadonlySet<string> = new Set(),
): WorkflowRenderModel {
  const nodes: WorkflowRenderNode[] = [];
  for (const node of workflow.nodes) {
    nodes.push({
      id: node.id,
      type: node.type,
      label: node.label,
      position: { x: node.x, y: node.y },
      size: { width: node.width, height: node.height },
      ports: node.ports.map(port => ({ ...port })),
      selected: selectedNodeIds.has(node.id),
      workflowNode: cloneWorkflowNode(node),
    });
  }

  const edges: WorkflowRenderEdge[] = [];
  for (const connection of workflow.connections) {
    edges.push({
      id: connection.id,
      source: { nodeId: connection.fromNodeId, portId: connection.fromPortId },
      target: { nodeId: connection.toNodeId, portId: connection.toPortId },
      type: connection.type,
      workflowConnection: { ...connection },
    });
  }

  return {
    nodes,
    edges,
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  };
}
