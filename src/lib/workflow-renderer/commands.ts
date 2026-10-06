import {
  isWorkflowConnectionValid,
  type Workflow,
  type WorkflowConnection,
  type WorkflowNode,
} from '@/lib/workflow-engine';

const EDIT_MASK_INPUT_PORT = { id: 'in-mask', label: '蒙版', type: 'mask', direction: 'in' } as const;

function restoreLegacyEditMaskPorts(workflow: Workflow): Workflow {
  if (!workflow.nodes.some(node => node.type === 'ai-edit'
    && !node.ports.some(port => port.id === EDIT_MASK_INPUT_PORT.id))) return workflow;
  return {
    ...workflow,
    nodes: workflow.nodes.map(node => node.type === 'ai-edit'
      && !node.ports.some(port => port.id === EDIT_MASK_INPUT_PORT.id)
      ? { ...node, ports: [...node.ports, { ...EDIT_MASK_INPUT_PORT }] }
      : node),
  };
}

export type WorkflowInteractionCommand =
  | { type: 'nodes.move'; nodeIds: string[]; delta: { x: number; y: number }; transactionId: string }
  | { type: 'nodes.drag.commit'; initialPositions: WorkflowNodePosition[]; positions: WorkflowNodePosition[]; transactionId: string }
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

export interface WorkflowNodePosition {
  nodeId: string;
  position: { x: number; y: number };
}

export function mergeExternalWorkflowWithPositions(
  workflow: Workflow,
  positions: ReadonlyArray<WorkflowNodePosition>,
): Workflow {
  if (positions.length === 0) return workflow;
  const positionById = new Map(positions.map(item => [item.nodeId, item.position]));
  return {
    ...workflow,
    nodes: workflow.nodes.map(node => {
      const position = positionById.get(node.id);
      return position ? { ...node, x: position.x, y: position.y } : node;
    }),
  };
}

export interface WorkflowHistoryEntry {
  transactionId: string;
  undo: WorkflowPatchOperation[];
  redo: WorkflowPatchOperation[];
}

export interface WorkflowCommandResult {
  workflow: Workflow;
  historyEntries: WorkflowHistoryEntry[];
  createdNodeIds: string[];
}

type WorkflowPatchOperation =
  | { type: 'workflow.set'; path: string[]; value?: unknown; remove?: true }
  | { type: 'node.set'; nodeId: string; path: string[]; value?: unknown; remove?: true }
  | { type: 'node.add'; node: WorkflowNode; index: number }
  | { type: 'node.remove'; nodeId: string }
  | { type: 'connection.set'; connectionId: string; path: string[]; value?: unknown; remove?: true }
  | { type: 'connection.add'; connection: WorkflowConnection; index: number }
  | { type: 'connection.remove'; connection: WorkflowConnection };

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
  | { kind: 'command'; command: WorkflowInteractionCommand }
  | { kind: 'user.update'; workflow: Workflow; transactionId: string }
  | { kind: 'system.update'; workflow: Workflow }
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
      entries[entries.length - 1] = {
        transactionId: previous.transactionId,
        undo: [...incoming.undo, ...previous.undo],
        redo: [...previous.redo, ...incoming.redo],
      };
    } else {
      entries.push(incoming);
    }
    if (entries.length > MAX_WORKFLOW_HISTORY_ENTRIES) entries.shift();
  }

  return { entries, index: entries.length };
}

export function undoWorkflowCommandHistory(
  history: WorkflowCommandHistory,
  workflow: Workflow,
): WorkflowCommandHistoryNavigation {
  if (history.index <= 0) throw new Error('Workflow history has no undo entry');
  const entry = history.entries[history.index - 1];
  if (!entry) throw new Error('Workflow history undo entry is missing');
  return {
    history: { ...history, index: history.index - 1 },
    workflow: applyWorkflowPatch(workflow, entry.undo),
  };
}

export function redoWorkflowCommandHistory(
  history: WorkflowCommandHistory,
  workflow: Workflow,
): WorkflowCommandHistoryNavigation {
  if (history.index >= history.entries.length) throw new Error('Workflow history has no redo entry');
  const entry = history.entries[history.index];
  if (!entry) throw new Error('Workflow history redo entry is missing');
  return {
    history: { ...history, index: history.index + 1 },
    workflow: applyWorkflowPatch(workflow, entry.redo),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every(key => valuesEqual(left[key], right[key]));
  }
  return false;
}

function collectValuePatch(
  before: unknown,
  after: unknown,
  path: string[],
  emit: (path: string[], value: unknown, remove: boolean) => void,
): void {
  if (valuesEqual(before, after)) return;
  if (isPlainRecord(before) && isPlainRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (!(key in after)) emit([...path, key], undefined, true);
      else if (!(key in before)) emit([...path, key], after[key], false);
      else collectValuePatch(before[key], after[key], [...path, key], emit);
    }
    return;
  }
  emit(path, after, false);
}

function buildWorkflowPatch(before: Workflow, after: Workflow): WorkflowPatchOperation[] {
  const operations: WorkflowPatchOperation[] = [];
  const beforeNodes = new Map(before.nodes.map(node => [node.id, node]));
  const afterNodes = new Map(after.nodes.map(node => [node.id, node]));
  const beforeConnections = new Map(before.connections.map(connection => [connection.id, connection]));
  const afterConnections = new Map(after.connections.map(connection => [connection.id, connection]));

  before.connections.forEach(connection => {
    if (!afterConnections.has(connection.id)) {
      operations.push({ type: 'connection.remove', connection: cloneSnapshotValue(connection) });
    }
  });
  before.nodes.forEach(node => {
    if (!afterNodes.has(node.id)) operations.push({ type: 'node.remove', nodeId: node.id });
  });
  after.nodes.forEach((node, index) => {
    if (!beforeNodes.has(node.id)) operations.push({ type: 'node.add', node: cloneSnapshotValue(node), index });
  });
  after.connections.forEach((connection, index) => {
    if (!beforeConnections.has(connection.id)) {
      operations.push({ type: 'connection.add', connection: cloneSnapshotValue(connection), index });
    }
  });

  const beforeWorkflowFields = { ...before } as Record<string, unknown>;
  const afterWorkflowFields = { ...after } as Record<string, unknown>;
  delete beforeWorkflowFields.nodes;
  delete beforeWorkflowFields.connections;
  delete afterWorkflowFields.nodes;
  delete afterWorkflowFields.connections;
  collectValuePatch(beforeWorkflowFields, afterWorkflowFields, [], (path, value, remove) => {
    operations.push(remove
      ? { type: 'workflow.set', path, remove: true }
      : { type: 'workflow.set', path, value: cloneSnapshotValue(value) });
  });

  after.nodes.forEach(node => {
    const previous = beforeNodes.get(node.id);
    if (!previous) return;
    collectValuePatch(previous, node, [], (path, value, remove) => {
      operations.push(remove
        ? { type: 'node.set', nodeId: node.id, path, remove: true }
        : { type: 'node.set', nodeId: node.id, path, value: cloneSnapshotValue(value) });
    });
  });
  after.connections.forEach(connection => {
    const previous = beforeConnections.get(connection.id);
    if (!previous) return;
    collectValuePatch(previous, connection, [], (path, value, remove) => {
      operations.push(remove
        ? { type: 'connection.set', connectionId: connection.id, path, remove: true }
        : { type: 'connection.set', connectionId: connection.id, path, value: cloneSnapshotValue(value) });
    });
  });
  return operations;
}

function applyValuePatch(target: Record<string, unknown>, path: string[], value: unknown, remove: boolean): void {
  if (path.length === 0) return;
  let cursor = target;
  for (const key of path.slice(0, -1)) {
    const child = cursor[key];
    if (!isPlainRecord(child)) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  const key = path[path.length - 1]!;
  if (remove) delete cursor[key];
  else cursor[key] = cloneSnapshotValue(value);
}

function applyWorkflowPatch(workflow: Workflow, operations: ReadonlyArray<WorkflowPatchOperation>): Workflow {
  const next = cloneSnapshotValue(workflow);
  let graphStructureChanged = false;
  for (const operation of operations) {
    if (operation.type === 'node.remove') {
      next.nodes = next.nodes.filter(node => node.id !== operation.nodeId);
      next.connections = next.connections.filter(connection => (
        connection.fromNodeId !== operation.nodeId && connection.toNodeId !== operation.nodeId
      ));
      graphStructureChanged = true;
      continue;
    }
    if (operation.type === 'node.add') {
      if (!next.nodes.some(node => node.id === operation.node.id)) {
        next.nodes.splice(Math.min(operation.index, next.nodes.length), 0, cloneSnapshotValue(operation.node));
        graphStructureChanged = true;
      }
      continue;
    }
    if (operation.type === 'connection.remove') {
      next.connections = next.connections.filter(connection => (
        connection.id !== operation.connection.id || !valuesEqual(connection, operation.connection)
      ));
      continue;
    }
    if (operation.type === 'connection.add') {
      const duplicate = next.connections.some(connection => (
        connection.id === operation.connection.id
        || (
          connection.fromNodeId === operation.connection.fromNodeId
          && connection.fromPortId === operation.connection.fromPortId
          && connection.toNodeId === operation.connection.toNodeId
          && connection.toPortId === operation.connection.toPortId
        )
      ));
      if (!duplicate && isWorkflowConnectionValid(next, operation.connection)) {
        next.connections.splice(
          Math.min(operation.index, next.connections.length),
          0,
          cloneSnapshotValue(operation.connection),
        );
        graphStructureChanged = true;
      }
      continue;
    }
    if (operation.type === 'workflow.set') {
      applyValuePatch(next as unknown as Record<string, unknown>, operation.path, operation.value, operation.remove === true);
      continue;
    }
    const collection = operation.type === 'node.set' ? next.nodes : next.connections;
    const id = operation.type === 'node.set' ? operation.nodeId : operation.connectionId;
    const target = collection.find(item => item.id === id);
    if (target) {
      applyValuePatch(target as unknown as Record<string, unknown>, operation.path, operation.value, operation.remove === true);
      if (operation.type === 'connection.set'
        || operation.path[0] === 'id'
        || operation.path[0] === 'ports') {
        graphStructureChanged = true;
      }
    }
  }
  if (graphStructureChanged) {
    next.connections = next.connections.filter(connection => isWorkflowConnectionValid(next, connection));
  }
  return next;
}

function createHistoryEntry(before: Workflow, after: Workflow, transactionId: string): WorkflowHistoryEntry {
  return {
    transactionId,
    undo: buildWorkflowPatch(after, before),
    redo: buildWorkflowPatch(before, after),
  };
}

function result(
  workflow: Workflow,
  before: Workflow,
  transactionId: string,
  createdNodeIds: string[] = [],
): WorkflowCommandResult {
  return {
    workflow,
    historyEntries: [createHistoryEntry(before, workflow, transactionId)],
    createdNodeIds,
  };
}

function noChange(workflow: Workflow): WorkflowCommandResult {
  return { workflow, historyEntries: [], createdNodeIds: [] };
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
  }, workflow, transactionId, copiedNodes.map(node => node.id));
}

/** Applies a user interaction to the workflow domain without rendering or persistence effects. */
export function applyWorkflowCommand(
  workflow: Workflow,
  command: WorkflowInteractionCommand,
): WorkflowCommandResult {
  if (command.type === 'workflow.hydrate') {
    return { workflow: restoreLegacyEditMaskPorts(command.workflow), historyEntries: [], createdNodeIds: [] };
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

  if (command.type === 'nodes.drag.commit') {
    const initialById = new Map(command.initialPositions.map(item => [item.nodeId, item.position]));
    const finalById = new Map(command.positions.map(item => [item.nodeId, item.position]));
    const movedIds = new Set(workflow.nodes.flatMap(node => {
      const initial = initialById.get(node.id);
      const final = finalById.get(node.id);
      return initial && final && (initial.x !== final.x || initial.y !== final.y) ? [node.id] : [];
    }));
    if (movedIds.size === 0) return noChange(workflow);
    const before = {
      ...workflow,
      nodes: workflow.nodes.map(node => {
        const initial = movedIds.has(node.id) ? initialById.get(node.id) : undefined;
        return initial ? { ...node, x: initial.x, y: initial.y } : node;
      }),
    };
    const after = {
      ...workflow,
      nodes: workflow.nodes.map(node => {
        const final = movedIds.has(node.id) ? finalById.get(node.id) : undefined;
        return final ? { ...node, x: final.x, y: final.y } : node;
      }),
    };
    return result(after, before, command.transactionId);
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
  return { workflow: restoreLegacyEditMaskPorts(workflow), history: createWorkflowCommandHistory(), broadcastRevision: 0 };
}

export function reduceWorkflowEditorState(
  state: WorkflowEditorState,
  transition: WorkflowEditorTransition,
): WorkflowEditorState {
  if (transition.kind === 'history.undo') {
    if (state.history.index <= 0) return state;
    const navigation = undoWorkflowCommandHistory(state.history, state.workflow);
    return {
      workflow: navigation.workflow,
      history: navigation.history,
      broadcastRevision: state.broadcastRevision + 1,
    };
  }
  if (transition.kind === 'history.redo') {
    if (state.history.index >= state.history.entries.length) return state;
    const navigation = redoWorkflowCommandHistory(state.history, state.workflow);
    return {
      workflow: navigation.workflow,
      history: navigation.history,
      broadcastRevision: state.broadcastRevision + 1,
    };
  }
  if (transition.kind === 'system.update') {
    const workflow = restoreLegacyEditMaskPorts(transition.workflow);
    return workflow === state.workflow ? state : { ...state, workflow };
  }
  if (transition.kind === 'user.update') {
    const workflow = restoreLegacyEditMaskPorts(transition.workflow);
    if (workflow === state.workflow) return state;
    const historyEntry = createHistoryEntry(state.workflow, workflow, transition.transactionId);
    return {
      workflow,
      history: recordWorkflowHistoryEntries(state.history, [historyEntry]),
      broadcastRevision: state.broadcastRevision + 1,
    };
  }

  const result = applyWorkflowCommand(state.workflow, transition.command);
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
