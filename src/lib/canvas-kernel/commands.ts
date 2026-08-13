import type { CanvasPoint } from './types';

export interface CanvasCommandNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
  groupId?: string;
  url?: string;
  videoUrl?: string;
  videoThumbnailUrl?: string;
  mediaType?: string;
  sourceId?: string;
  processing?: unknown;
  isProcessingPlaceholder?: boolean;
  generationTaskId?: string;
  prompt?: string;
  quality?: string;
  aspectRatio?: string;
  stylePreset?: string;
  category?: string;
  size?: string;
  model?: string;
  modelName?: string;
  apiProvider?: string;
  apiProviderId?: string;
  apiBaseUrl?: string;
  generationRouteAudit?: unknown;
  createdAt?: number;
  originalWidth?: number;
  originalHeight?: number;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  sourceUrl?: string;
  mediaAvailability?: string;
  mediaErrorCode?: string;
  taskProjection?: {
    taskId: string;
    outputIndex: number;
    status: string;
    progress: number;
    revision?: number;
    source?: string;
    errorCode?: string;
  };
}

export interface CanvasDocumentSnapshot {
  byId: Record<string, CanvasCommandNode>;
  order: string[];
}

export interface QueuedCanvasSnapshotChange {
  projectId: string | null;
  before: CanvasDocumentSnapshot;
  after: CanvasDocumentSnapshot;
}

interface IndexedNodes {
  nodes: CanvasCommandNode[];
  indices?: number[];
}

export type CanvasCommand =
  | ({ type: 'add' } & IndexedNodes)
  | { type: 'move'; ids: string[]; delta: CanvasPoint }
  | { type: 'resize'; id: string; bounds: { x: number; y: number; width: number; height: number } }
  | { type: 'delete'; ids: string[] }
  | ({ type: 'duplicate' } & IndexedNodes)
  | { type: 'reorder'; order: string[]; zIndexes?: Record<string, number | undefined> }
  | { type: 'assign-group'; ids: string[]; groupId?: string; assignments?: Record<string, string | undefined> }
  | {
      type: 'task-result';
      id: string;
      taskId?: string;
      outputIndex?: number;
      patch: Partial<CanvasCommandNode>;
      terminal: boolean;
    };

export interface CanvasCommandResult {
  next: CanvasDocumentSnapshot;
  inverse: CanvasCommand;
  affectedIds: string[];
  history: 'record' | 'skip';
  persistence: 'schedule' | 'immediate' | 'skip';
}

function cloneSnapshot(snapshot: CanvasDocumentSnapshot): CanvasDocumentSnapshot {
  return { byId: { ...snapshot.byId }, order: [...snapshot.order] };
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function assertNodesExist(snapshot: CanvasDocumentSnapshot, ids: readonly string[]): string[] {
  const normalized = uniqueIds(ids);
  for (const id of normalized) {
    if (!snapshot.byId[id]) throw new Error(`Canvas node ${id} is missing`);
  }
  return normalized;
}

function insertNodes(
  snapshot: CanvasDocumentSnapshot,
  nodes: readonly CanvasCommandNode[],
  indices?: readonly number[],
): CanvasDocumentSnapshot {
  const next = cloneSnapshot(snapshot);
  const entries = nodes.map((node, offset) => ({ node, offset, requested: indices?.[offset] }));
  if (indices) {
    entries.sort((left, right) => {
      const leftIndex = Number.isInteger(left.requested) ? Number(left.requested) : Number.POSITIVE_INFINITY;
      const rightIndex = Number.isInteger(right.requested) ? Number(right.requested) : Number.POSITIVE_INFINITY;
      return leftIndex - rightIndex || left.offset - right.offset;
    });
  }
  entries.forEach(({ node, requested }) => {
    if (!node.id) throw new Error('Canvas node ID is required');
    if (next.byId[node.id]) throw new Error(`Canvas node ${node.id} already exists`);
    next.byId[node.id] = { ...node };
    const index = Number.isInteger(requested)
      ? Math.max(0, Math.min(Number(requested), next.order.length))
      : next.order.length;
    next.order.splice(index, 0, node.id);
  });
  return next;
}

export function createCanvasDocumentSnapshot(nodes: readonly CanvasCommandNode[]): CanvasDocumentSnapshot {
  return insertNodes({ byId: {}, order: [] }, nodes);
}

export function canvasSnapshotToNodes(snapshot: CanvasDocumentSnapshot): CanvasCommandNode[] {
  return snapshot.order.map((id) => ({ ...snapshot.byId[id] }));
}

export function rebaseCanvasSnapshotChanges(
  target: CanvasDocumentSnapshot,
  before: CanvasDocumentSnapshot,
  latest: CanvasDocumentSnapshot,
): CanvasDocumentSnapshot {
  const beforeIds = new Set(before.order);
  const targetIds = new Set(target.order);
  const latestIds = new Set(latest.order);
  const userAdded = target.order.filter((id) => !beforeIds.has(id));
  const concurrentAdded = latest.order.filter((id) => !beforeIds.has(id));
  const concurrentRemoved = new Set(before.order.filter((id) => !latestIds.has(id)));
  const resultIds = new Set(target.order.filter((id) => !concurrentRemoved.has(id)));
  concurrentAdded.forEach((id) => resultIds.add(id));

  const byId: Record<string, CanvasCommandNode> = {};
  for (const id of resultIds) {
    const targetNode = target.byId[id];
    const latestNode = latest.byId[id];
    const beforeNode = before.byId[id];
    if (!targetNode && latestNode && !beforeNode) {
      byId[id] = { ...latestNode };
      continue;
    }
    if (!targetNode) continue;
    const merged = { ...targetNode } as Record<string, unknown>;
    if (beforeNode && latestNode) {
      const keys = new Set([...Object.keys(beforeNode), ...Object.keys(latestNode)]);
      for (const key of keys) {
        const beforeValue = (beforeNode as unknown as Record<string, unknown>)[key];
        const targetValue = (targetNode as unknown as Record<string, unknown>)[key];
        const latestValue = (latestNode as unknown as Record<string, unknown>)[key];
        const targetChanged = JSON.stringify(targetValue) !== JSON.stringify(beforeValue);
        const latestChanged = JSON.stringify(latestValue) !== JSON.stringify(beforeValue);
        if (!latestChanged || targetChanged) continue;
        if (key in latestNode) merged[key] = latestValue;
        else delete merged[key];
      }
    }
    byId[id] = merged as unknown as CanvasCommandNode;
  }

  const beforeCommon = before.order.filter((id) => targetIds.has(id));
  const targetCommon = target.order.filter((id) => beforeIds.has(id));
  const targetReordered = JSON.stringify(beforeCommon) !== JSON.stringify(targetCommon);
  const order = (targetReordered ? target.order : latest.order)
    .filter((id) => resultIds.has(id));
  const referenceOrder = targetReordered ? latest.order : target.order;
  const idsToInsert = targetReordered ? concurrentAdded : userAdded;
  for (const id of idsToInsert) insertIdByReference(order, id, referenceOrder, resultIds);
  for (const id of resultIds) {
    if (!order.includes(id)) order.push(id);
  }
  return { byId, order };
}

export function replayQueuedCanvasSnapshotChange(
  currentProjectId: string | null,
  latest: CanvasDocumentSnapshot,
  queued: QueuedCanvasSnapshotChange,
): CanvasDocumentSnapshot | null {
  if (queued.projectId !== currentProjectId) return null;
  return rebaseCanvasSnapshotChanges(queued.after, queued.before, latest);
}

function insertIdByReference(
  order: string[],
  id: string,
  referenceOrder: readonly string[],
  allowedIds: ReadonlySet<string>,
): void {
  if (order.includes(id) || !allowedIds.has(id)) return;
  const referenceIndex = referenceOrder.indexOf(id);
  for (let index = referenceIndex - 1; index >= 0; index -= 1) {
    const anchor = referenceOrder[index];
    const anchorIndex = order.indexOf(anchor);
    if (anchorIndex >= 0) {
      order.splice(anchorIndex + 1, 0, id);
      return;
    }
  }
  for (let index = referenceIndex + 1; index < referenceOrder.length; index += 1) {
    const anchor = referenceOrder[index];
    const anchorIndex = order.indexOf(anchor);
    if (anchorIndex >= 0) {
      order.splice(anchorIndex, 0, id);
      return;
    }
  }
  order.push(id);
}

const CANVAS_TASK_PROJECTION_FIELDS = new Set([
  'processing',
  'isProcessingPlaceholder',
  'isProcessing',
  'processingLabel',
  'url',
  'videoUrl',
  'videoThumbnailUrl',
  'mediaType',
  'mediaAvailability',
  'mediaErrorCode',
  'originalWidth',
  'originalHeight',
  'model',
  'modelName',
  'apiProvider',
  'apiProviderId',
  'generationRouteAudit',
  'sourceUrl',
  'assetId',
  'assetVersionId',
  'placementId',
  'generationTaskId',
  'taskProjection',
  'prompt',
  'quality',
  'aspectRatio',
  'stylePreset',
  'category',
  'size',
  'apiBaseUrl',
  'createdAt',
]);

export function isCanvasTaskProjectionChange<T extends { id: string; processing?: unknown; isProcessingPlaceholder?: boolean }>(
  before: readonly T[],
  after: readonly T[],
): boolean {
  if (before.length !== after.length || before.length === 0) return false;
  const afterById = new Map(after.map((node) => [node.id, node]));
  let changed = false;
  for (const previous of before) {
    const next = afterById.get(previous.id);
    if (!next) return false;
    const changedKeys = new Set([
      ...Object.keys(previous),
      ...Object.keys(next),
    ].filter((key) => (
      (previous as Record<string, unknown>)[key]
      !== (next as Record<string, unknown>)[key]
    )));
    if (changedKeys.size === 0) continue;
    changed = true;
    if (!previous.processing && !next.processing
      && !previous.isProcessingPlaceholder && !next.isProcessingPlaceholder) return false;
    if ([...changedKeys].some((key) => !CANVAS_TASK_PROJECTION_FIELDS.has(key))) return false;
  }
  return changed;
}

export function executeCanvasCommand(
  snapshot: CanvasDocumentSnapshot,
  command: CanvasCommand,
): CanvasCommandResult {
  switch (command.type) {
    case 'add':
    case 'duplicate': {
      const next = insertNodes(snapshot, command.nodes, command.indices);
      const affectedIds = command.nodes.map((node) => node.id);
      return {
        next,
        inverse: { type: 'delete', ids: affectedIds },
        affectedIds,
        history: 'record',
        persistence: 'immediate',
      };
    }

    case 'delete': {
      const affectedIds = assertNodesExist(snapshot, command.ids);
      const nodes = affectedIds.map((id) => ({ ...snapshot.byId[id] }));
      const indices = affectedIds.map((id) => snapshot.order.indexOf(id));
      const removed = new Set(affectedIds);
      const next = cloneSnapshot(snapshot);
      affectedIds.forEach((id) => delete next.byId[id]);
      next.order = next.order.filter((id) => !removed.has(id));
      return {
        next,
        inverse: { type: 'add', nodes, indices },
        affectedIds,
        history: 'record',
        persistence: 'immediate',
      };
    }

    case 'move': {
      assertFinite(command.delta.x, 'move delta.x');
      assertFinite(command.delta.y, 'move delta.y');
      const affectedIds = assertNodesExist(snapshot, command.ids);
      const next = cloneSnapshot(snapshot);
      affectedIds.forEach((id) => {
        const node = snapshot.byId[id];
        next.byId[id] = { ...node, x: node.x + command.delta.x, y: node.y + command.delta.y };
      });
      return {
        next,
        inverse: { type: 'move', ids: affectedIds, delta: { x: -command.delta.x, y: -command.delta.y } },
        affectedIds,
        history: 'record',
        persistence: 'schedule',
      };
    }

    case 'resize': {
      const [id] = assertNodesExist(snapshot, [command.id]);
      const node = snapshot.byId[id];
      Object.entries(command.bounds).forEach(([key, value]) => assertFinite(value, `resize ${key}`));
      if (command.bounds.width <= 0 || command.bounds.height <= 0) {
        throw new Error('Canvas node dimensions must be positive');
      }
      const next = cloneSnapshot(snapshot);
      next.byId[id] = { ...node, ...command.bounds };
      return {
        next,
        inverse: {
          type: 'resize',
          id,
          bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
        },
        affectedIds: [id],
        history: 'record',
        persistence: 'schedule',
      };
    }

    case 'reorder': {
      const currentIds = [...snapshot.order].sort();
      const requestedIds = uniqueIds(command.order);
      if (requestedIds.length !== snapshot.order.length
        || requestedIds.length !== command.order.length
        || requestedIds.slice().sort().some((id, index) => id !== currentIds[index])) {
        throw new Error('Reorder must contain the same node IDs exactly once');
      }
      const previousZIndexes = Object.fromEntries(
        snapshot.order.map((id) => [id, snapshot.byId[id].zIndex]),
      );
      const next = cloneSnapshot(snapshot);
      next.order = [...command.order];
      next.order.forEach((id, index) => {
        const zIndex = command.zIndexes ? command.zIndexes[id] : index;
        next.byId[id] = { ...snapshot.byId[id], zIndex };
      });
      return {
        next,
        inverse: { type: 'reorder', order: [...snapshot.order], zIndexes: previousZIndexes },
        affectedIds: [...command.order],
        history: 'record',
        persistence: 'schedule',
      };
    }

    case 'assign-group': {
      const affectedIds = assertNodesExist(snapshot, command.ids);
      const previousAssignments = Object.fromEntries(
        affectedIds.map((id) => [id, snapshot.byId[id].groupId as string | undefined]),
      );
      const next = cloneSnapshot(snapshot);
      affectedIds.forEach((id) => {
        const groupId = command.assignments ? command.assignments[id] : command.groupId;
        next.byId[id] = { ...snapshot.byId[id], groupId };
      });
      return {
        next,
        inverse: { type: 'assign-group', ids: affectedIds, assignments: previousAssignments },
        affectedIds,
        history: 'record',
        persistence: 'schedule',
      };
    }

    case 'task-result': {
      const [id] = assertNodesExist(snapshot, [command.id]);
      const previousPatch = Object.fromEntries(
        Object.keys(command.patch).map((key) => [key, (snapshot.byId[id] as unknown as Record<string, unknown>)[key]]),
      ) as Partial<CanvasCommandNode>;
      const next = cloneSnapshot(snapshot);
      next.byId[id] = { ...snapshot.byId[id], ...command.patch };
      return {
        next,
        inverse: { type: 'task-result', id, patch: previousPatch, terminal: command.terminal },
        affectedIds: [id],
        history: command.terminal ? 'record' : 'skip',
        persistence: command.terminal ? 'immediate' : 'skip',
      };
    }
  }
}
