import { isTerminalGenerationStatus } from '@/lib/generation-batch';
import type { GenerationSubmitSlot } from '@/lib/task-core/generation-batch';
import {
  canvasSnapshotToNodes,
  createCanvasDocumentSnapshot,
  executeCanvasCommand,
  type CanvasCommandNode,
} from '@/lib/canvas-kernel/commands';
import {
  projectCanvasTaskEvent,
  type CanvasTaskEvent,
} from '@/lib/canvas-kernel/task-projection';

interface ProcessingPlaceholder {
  id?: string;
  isProcessingPlaceholder?: boolean;
  processing?: {
    status?: string;
    progress?: number;
    label?: string;
    taskId?: string;
    batchId?: string;
    slotId?: string;
    slotIndex?: number;
    outputIndex?: number;
    revision?: number;
  };
}

interface CanvasTaskSyncNode {
  id?: string;
  url?: string;
  sourceUrl?: string;
  processing?: unknown;
  isProcessingPlaceholder?: boolean;
  generationTaskId?: string;
  taskProjection?: {
    taskId: string;
    outputIndex: number;
    status: string;
    progress: number;
    revision?: number;
    source?: string;
    errorCode?: string;
  };
  mediaAvailability?: string;
  mediaErrorCode?: string;
  model?: string;
  modelName?: string;
  apiProvider?: string;
  apiProviderId?: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
}

function hasCanvasTaskIdentity(node: CanvasTaskSyncNode): boolean {
  const processingTaskId = node.processing && typeof node.processing === 'object'
    ? (node.processing as { taskId?: unknown }).taskId
    : undefined;
  return Boolean(node.taskProjection?.taskId || node.generationTaskId || processingTaskId);
}

export function mergeLocalCompletedTaskProjection<T extends CanvasTaskSyncNode>(
  serverNode: T,
  localNode?: CanvasTaskSyncNode,
): T {
  const isLocallyCompleted = Boolean(
    localNode?.url
    && hasCanvasTaskIdentity(localNode)
    && localNode.isProcessingPlaceholder === false
    && (
      localNode.taskProjection?.status === 'completed'
      || localNode.processing === undefined
    ),
  );
  if (!localNode || !isLocallyCompleted) return serverNode;

  return {
    ...serverNode,
    url: localNode.url,
    sourceUrl: localNode.sourceUrl || localNode.url,
    isProcessingPlaceholder: false,
    processing: undefined,
    generationTaskId: localNode.generationTaskId || serverNode.generationTaskId,
    taskProjection: localNode.taskProjection,
    mediaAvailability: localNode.mediaAvailability || 'ready',
    mediaErrorCode: localNode.mediaErrorCode,
    model: localNode.model || serverNode.model,
    modelName: localNode.modelName || serverNode.modelName,
    apiProvider: localNode.apiProvider || serverNode.apiProvider,
    apiProviderId: localNode.apiProviderId || serverNode.apiProviderId,
    assetId: localNode.assetId || serverNode.assetId,
    assetVersionId: localNode.assetVersionId || serverNode.assetVersionId,
    placementId: localNode.placementId || serverNode.placementId,
  } as T;
}

export function shouldPreserveProjectedCanvasCompletion(
  node: CanvasTaskSyncNode,
  resultUrl: string,
): boolean {
  return node.taskProjection?.status === 'completed'
    && node.url === resultUrl
    && node.isProcessingPlaceholder !== true;
}

export function preserveLocalCanvasTaskSlotOrder<T extends CanvasTaskSyncNode & { id: string }>(
  mergedNodes: readonly T[],
  localNodes: readonly T[],
): T[] {
  const localTaskIds = localNodes.filter(hasCanvasTaskIdentity).map(node => node.id);
  if (localTaskIds.length < 2) return [...mergedNodes];

  const taskIdSet = new Set(localTaskIds);
  const mergedById = new Map(mergedNodes.map(node => [node.id, node]));
  const orderedTaskNodes = localTaskIds.flatMap(id => {
    const node = mergedById.get(id);
    return node ? [node] : [];
  });
  const taskPositions = mergedNodes.flatMap((node, index) => (
    taskIdSet.has(node.id) ? [index] : []
  ));
  if (orderedTaskNodes.length !== taskPositions.length) return [...mergedNodes];

  const ordered = [...mergedNodes];
  taskPositions.forEach((position, index) => {
    ordered[position] = orderedTaskNodes[index];
  });
  return ordered;
}

export function applyCanvasTaskEventToProcessingPlaceholders<T extends CanvasCommandNode>(
  images: readonly T[],
  event: CanvasTaskEvent,
): T[] {
  const snapshot = createCanvasDocumentSnapshot(images);
  const commands = projectCanvasTaskEvent(snapshot, event);
  if (commands.length === 0) return images as T[];
  const next = commands.reduce(
    (current, command) => executeCanvasCommand(current, command).next,
    snapshot,
  );
  return canvasSnapshotToNodes(next) as T[];
}

export function shouldPersistProcessingPlaceholder(image: ProcessingPlaceholder): boolean {
  if (!image.isProcessingPlaceholder) return false;
  return !isTerminalGenerationStatus(image.processing?.status);
}

/**
 * A submitOnly response arrives after its visual placeholders have been added.
 * Persist the server task IDs immediately so a later project reload can resume
 * polling instead of leaving an anonymous "submitting" frame on the canvas.
 */
export function applyTaskIdsToProcessingPlaceholders<T extends ProcessingPlaceholder>(
  images: readonly T[],
  placeholderIds: readonly string[],
  taskIds: readonly string[],
): T[] {
  const taskByPlaceholderId = new Map(
    placeholderIds.map((placeholderId, index) => [placeholderId, taskIds[index]] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );

  return images.map((image) => {
    const taskId = image.id ? taskByPlaceholderId.get(image.id) : undefined;
    if (!image.isProcessingPlaceholder || !taskId || !image.processing) return image;
    if (isTerminalGenerationStatus(image.processing.status)) return image;

    return {
      ...image,
      processing: {
        ...image.processing,
        taskId,
        status: 'processing',
        progress: Math.max(image.processing.progress || 0, 10),
        label: '已提交，等待生成',
      },
    };
  });
}

/**
 * Bind submitOnly child tasks by their durable slot identity. Response order is
 * deliberately ignored because providers can acknowledge or complete slots in
 * any order. placeholderIds is only used to seed metadata onto newly-created
 * legacy placeholders that do not have a slot identity yet.
 */
export function applyGenerationSlotsToProcessingPlaceholders<T extends ProcessingPlaceholder>(
  images: readonly T[],
  slots: readonly GenerationSubmitSlot[],
  placeholderIds: readonly string[] = [],
): T[] {
  const slotsById = new Map(
    slots.flatMap((slot) => slot.slotId ? [[slot.slotId, slot] as const] : []),
  );
  const slotsByIndex = new Map(slots.map((slot) => [slot.slotIndex, slot]));
  const placeholderIndex = new Map(
    placeholderIds.map((placeholderId, index) => [placeholderId, index] as const),
  );

  return images.map((image) => {
    if (!image.isProcessingPlaceholder || !image.processing) return image;
    if (isTerminalGenerationStatus(image.processing.status)) return image;

    const persistedSlot = image.processing.slotId
      ? slotsById.get(image.processing.slotId)
      : undefined;
    const persistedIndex = typeof image.processing.slotIndex === 'number'
      ? image.processing.slotIndex
      : (image.id ? placeholderIndex.get(image.id) : undefined);
    const slot = persistedSlot
      ?? (typeof persistedIndex === 'number' ? slotsByIndex.get(persistedIndex) : undefined);

    if (!slot) return image;

    const isCompleted = slot.status === 'completed';
    const isTerminal = isTerminalGenerationStatus(slot.status);
    const boundStatus = isTerminal && !isCompleted
      ? image.processing.status
      : slot.status;

    return {
      ...image,
      processing: {
        ...image.processing,
        batchId: slot.batchId,
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        outputIndex: 0,
        taskId: slot.taskId,
        status: boundStatus,
        progress: isCompleted
          ? 100
          : (isTerminal ? image.processing.progress || 0 : Math.max(image.processing.progress || 0, 10)),
        label: '已提交，等待生成',
      },
    };
  });
}
