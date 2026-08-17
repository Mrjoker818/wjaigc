import {
  isWorkflowConnectionValid,
  type Workflow,
  type WorkflowConnection,
} from '@/lib/workflow-engine';

export type WorkflowInteractionCommand =
  | { type: 'nodes.move'; nodeIds: string[]; delta: { x: number; y: number }; transactionId: string }
  | { type: 'connection.create'; connection: WorkflowConnection; transactionId: string }
  | { type: 'connection.delete'; connectionId: string; transactionId: string }
  | { type: 'selection.set'; nodeIds: string[]; transactionId: string }
  | { type: 'nodes.delete'; nodeIds: string[]; transactionId: string }
  | { type: 'nodes.copy'; nodeIds: string[]; offset: { x: number; y: number }; transactionId: string }
  | { type: 'workflow.hydrate'; workflow: Workflow; transactionId: string };

export interface WorkflowHistoryEntry {
  transactionId: string;
  before: Workflow;
  after: Workflow;
}

export interface WorkflowCommandResult {
  workflow: Workflow;
  historyEntries: WorkflowHistoryEntry[];
}

function result(workflow: Workflow, before: Workflow, transactionId: string): WorkflowCommandResult {
  return {
    workflow,
    historyEntries: [{ transactionId, before, after: workflow }],
  };
}

function noChange(workflow: Workflow): WorkflowCommandResult {
  return { workflow, historyEntries: [] };
}

function copyId(base: string, occupied: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (occupied.has(candidate)) candidate = `${base}-${index++}`;
  occupied.add(candidate);
  return candidate;
}

/** Applies a user interaction to the workflow domain without rendering or persistence effects. */
export function applyWorkflowCommand(
  workflow: Workflow,
  command: WorkflowInteractionCommand,
): WorkflowCommandResult {
  if (command.type === 'workflow.hydrate') {
    return { workflow: command.workflow, historyEntries: [] };
  }

  if (command.type === 'selection.set') return noChange(workflow);

  if (command.type === 'nodes.move') {
    const movedIds = new Set(command.nodeIds);
    if (movedIds.size === 0 || !workflow.nodes.some(node => movedIds.has(node.id))) return noChange(workflow);
    const next = {
      ...workflow,
      nodes: workflow.nodes.map(node => movedIds.has(node.id)
        ? { ...node, x: node.x + command.delta.x, y: node.y + command.delta.y }
        : node),
    };
    return result(next, workflow, command.transactionId);
  }

  if (command.type === 'connection.create') {
    const duplicate = workflow.connections.some(connection => (
      connection.fromNodeId === command.connection.fromNodeId
      && connection.fromPortId === command.connection.fromPortId
      && connection.toNodeId === command.connection.toNodeId
      && connection.toPortId === command.connection.toPortId
    ));
    if (duplicate || !isWorkflowConnectionValid(workflow, command.connection)) return noChange(workflow);
    return result({ ...workflow, connections: [...workflow.connections, { ...command.connection }] }, workflow, command.transactionId);
  }

  if (command.type === 'connection.delete') {
    if (!workflow.connections.some(connection => connection.id === command.connectionId)) return noChange(workflow);
    return result({
      ...workflow,
      connections: workflow.connections.filter(connection => connection.id !== command.connectionId),
    }, workflow, command.transactionId);
  }

  if (command.type === 'nodes.delete') {
    const deletedIds = new Set(command.nodeIds);
    if (deletedIds.size === 0 || !workflow.nodes.some(node => deletedIds.has(node.id))) return noChange(workflow);
    return result({
      ...workflow,
      nodes: workflow.nodes.filter(node => !deletedIds.has(node.id)),
      connections: workflow.connections.filter(connection => (
        !deletedIds.has(connection.fromNodeId) && !deletedIds.has(connection.toNodeId)
      )),
    }, workflow, command.transactionId);
  }

  const selectedIds = new Set(command.nodeIds);
  const selectedNodes = workflow.nodes.filter(node => selectedIds.has(node.id));
  if (selectedNodes.length === 0) return noChange(workflow);
  const occupiedNodeIds = new Set(workflow.nodes.map(node => node.id));
  const occupiedConnectionIds = new Set(workflow.connections.map(connection => connection.id));
  const nodeIdMap = new Map<string, string>();
  const copiedNodes = selectedNodes.map((node, index) => {
    const id = copyId(`copy-${node.id}-${command.transactionId}-${index + 1}`, occupiedNodeIds);
    nodeIdMap.set(node.id, id);
    return {
      ...node,
      id,
      x: node.x + command.offset.x,
      y: node.y + command.offset.y,
      label: `${node.label} (副本)`,
      ports: node.ports.map(port => ({ ...port })),
      config: { ...node.config },
    };
  });
  const copiedConnections = workflow.connections.flatMap(connection => {
    const fromNodeId = nodeIdMap.get(connection.fromNodeId);
    const toNodeId = nodeIdMap.get(connection.toNodeId);
    if (!fromNodeId || !toNodeId) return [];
    return [{
      ...connection,
      id: copyId(`copy-${connection.id}-${command.transactionId}`, occupiedConnectionIds),
      fromNodeId,
      toNodeId,
    }];
  });
  return result({
    ...workflow,
    nodes: [...workflow.nodes, ...copiedNodes],
    connections: [...workflow.connections, ...copiedConnections],
  }, workflow, command.transactionId);
}
