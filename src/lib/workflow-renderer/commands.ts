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
  | { type: 'clipboard.paste'; snapshot: WorkflowClipboardSnapshot; offset: { x: number; y: number }; transactionId: string }
  | { type: 'node.measure'; nodeId: string; size: { width: number; height: number } }
  | { type: 'workflow.hydrate'; workflow: Workflow; transactionId: string };

export interface WorkflowClipboardSnapshot {
  nodes: Workflow['nodes'];
  connections: WorkflowConnection[];
}

export interface WorkflowHistoryEntry {
  transactionId: string;
  before: Workflow;
  after: Workflow;
}

export interface WorkflowCommandResult {
  workflow: Workflow;
  historyEntries: WorkflowHistoryEntry[];
}

export interface WorkflowCommandHistory {
  entries: WorkflowHistoryEntry[];
  index: number;
}

export interface WorkflowCommandHistoryNavigation {
  history: WorkflowCommandHistory;
  workflow: Workflow;
}

export interface WorkflowEditorState {
  workflow: Workflow;
  history: WorkflowCommandHistory;
  broadcastRevision: number;
}

export type WorkflowEditorTransition =
  | { kind: 'command'; command: WorkflowInteractionCommand; baseWorkflow?: Workflow }
  | { kind: 'user.update'; update: (workflow: Workflow) => Workflow; transactionId: string }
  | { kind: 'system.update'; update: (workflow: Workflow) => Workflow }
  | { kind: 'history.undo' }
  | { kind: 'history.redo' };

const MAX_WORKFLOW_HISTORY_ENTRIES = 50;

export function createWorkflowCommandHistory(): WorkflowCommandHistory {
  return { entries: [], index: 0 };
}

export function recordWorkflowHistoryEntries(
  history: WorkflowCommandHistory,
  incomingEntries: ReadonlyArray<WorkflowHistoryEntry>,
): WorkflowCommandHistory {
  if (incomingEntries.length === 0) return history;
  const entries = history.entries.slice(0, history.index);

  for (const incoming of incomingEntries) {
    const previous = entries.at(-1);
    if (previous?.transactionId === incoming.transactionId) {
      entries[entries.length - 1] = { ...previous, after: incoming.after };
    } else {
      entries.push(incoming);
    }
    if (entries.length > MAX_WORKFLOW_HISTORY_ENTRIES) entries.shift();
  }

  return { entries, index: entries.length };
}

export function undoWorkflowCommandHistory(
  history: WorkflowCommandHistory,
): WorkflowCommandHistoryNavigation {
  if (history.index <= 0) throw new Error('Workflow history has no undo entry');
  const entry = history.entries[history.index - 1];
  if (!entry) throw new Error('Workflow history undo entry is missing');
  return {
    history: { ...history, index: history.index - 1 },
    workflow: entry.before,
  };
}

export function redoWorkflowCommandHistory(
  history: WorkflowCommandHistory,
): WorkflowCommandHistoryNavigation {
  if (history.index >= history.entries.length) throw new Error('Workflow history has no redo entry');
  const entry = history.entries[history.index];
  if (!entry) throw new Error('Workflow history redo entry is missing');
  return {
    history: { ...history, index: history.index + 1 },
    workflow: entry.after,
  };
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

function cloneSnapshotValue<T>(value: T): T {
  return structuredClone(value);
}

export function createWorkflowClipboardSnapshot(
  workflow: Workflow,
  nodeIds: ReadonlyArray<string>,
): WorkflowClipboardSnapshot {
  const selectedIds = new Set(nodeIds);
  return cloneSnapshotValue({
    nodes: workflow.nodes.filter(node => selectedIds.has(node.id)),
    connections: workflow.connections.filter(connection => (
      selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)
    )),
  });
}

function pasteWorkflowSnapshot(
  workflow: Workflow,
  snapshot: WorkflowClipboardSnapshot,
  offset: { x: number; y: number },
  transactionId: string,
): WorkflowCommandResult {
  if (snapshot.nodes.length === 0) return noChange(workflow);
  const occupiedNodeIds = new Set(workflow.nodes.map(node => node.id));
  const occupiedConnectionIds = new Set(workflow.connections.map(connection => connection.id));
  const nodeIdMap = new Map<string, string>();
  const copiedNodes = cloneSnapshotValue(snapshot.nodes).map((node, index) => {
    const id = copyId(`copy-${node.id}-${transactionId}-${index + 1}`, occupiedNodeIds);
    nodeIdMap.set(node.id, id);
    return {
      ...node,
      id,
      x: node.x + offset.x,
      y: node.y + offset.y,
      label: `${node.label} (副本)`,
    };
  });
  const copiedConnections = cloneSnapshotValue(snapshot.connections).flatMap(connection => {
    const fromNodeId = nodeIdMap.get(connection.fromNodeId);
    const toNodeId = nodeIdMap.get(connection.toNodeId);
    if (!fromNodeId || !toNodeId) return [];
    return [{
      ...connection,
      id: copyId(`copy-${connection.id}-${transactionId}`, occupiedConnectionIds),
      fromNodeId,
      toNodeId,
    }];
  });
  return result({
    ...workflow,
    nodes: [...workflow.nodes, ...copiedNodes],
    connections: [...workflow.connections, ...copiedConnections],
  }, workflow, transactionId);
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

  if (command.type === 'node.measure') {
    const measuredNode = workflow.nodes.find(node => node.id === command.nodeId);
    if (!measuredNode
      || (measuredNode.width === command.size.width && measuredNode.height === command.size.height)) {
      return noChange(workflow);
    }
    return noChange({
      ...workflow,
      nodes: workflow.nodes.map(node => node.id === command.nodeId
        ? { ...node, width: command.size.width, height: command.size.height }
        : node),
    });
  }

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

  if (command.type === 'clipboard.paste') {
    return pasteWorkflowSnapshot(workflow, command.snapshot, command.offset, command.transactionId);
  }

  return pasteWorkflowSnapshot(
    workflow,
    createWorkflowClipboardSnapshot(workflow, command.nodeIds),
    command.offset,
    command.transactionId,
  );
}

export function createWorkflowEditorState(workflow: Workflow): WorkflowEditorState {
  return { workflow, history: createWorkflowCommandHistory(), broadcastRevision: 0 };
}

export function reduceWorkflowEditorState(
  state: WorkflowEditorState,
  transition: WorkflowEditorTransition,
): WorkflowEditorState {
  if (transition.kind === 'history.undo') {
    if (state.history.index <= 0) return state;
    const navigation = undoWorkflowCommandHistory(state.history);
    return {
      workflow: navigation.workflow,
      history: navigation.history,
      broadcastRevision: state.broadcastRevision + 1,
    };
  }
  if (transition.kind === 'history.redo') {
    if (state.history.index >= state.history.entries.length) return state;
    const navigation = redoWorkflowCommandHistory(state.history);
    return {
      workflow: navigation.workflow,
      history: navigation.history,
      broadcastRevision: state.broadcastRevision + 1,
    };
  }
  if (transition.kind === 'system.update') {
    const workflow = transition.update(state.workflow);
    return workflow === state.workflow ? state : { ...state, workflow };
  }
  if (transition.kind === 'user.update') {
    const workflow = transition.update(state.workflow);
    if (workflow === state.workflow) return state;
    const historyEntry = { transactionId: transition.transactionId, before: state.workflow, after: workflow };
    return {
      workflow,
      history: recordWorkflowHistoryEntries(state.history, [historyEntry]),
      broadcastRevision: state.broadcastRevision + 1,
    };
  }

  const result = applyWorkflowCommand(transition.baseWorkflow ?? state.workflow, transition.command);
  if (transition.command.type === 'workflow.hydrate') {
    return {
      workflow: result.workflow,
      history: createWorkflowCommandHistory(),
      broadcastRevision: state.broadcastRevision,
    };
  }
  if (result.workflow === state.workflow && result.historyEntries.length === 0) return state;
  const recordsUserHistory = result.historyEntries.length > 0;
  return {
    workflow: result.workflow,
    history: recordsUserHistory
      ? recordWorkflowHistoryEntries(state.history, result.historyEntries)
      : state.history,
    broadcastRevision: recordsUserHistory
      ? state.broadcastRevision + 1
      : state.broadcastRevision,
  };
}
