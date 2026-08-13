import {
  isTerminalTaskStatus,
  type DurableTaskStatus,
} from '@/lib/task-core/task-state';
import type { UnifiedTaskError } from '@/lib/task-core/task-error';
import {
  normalizeTaskError,
  type TaskErrorDefaults,
} from '@/lib/task-core/task-error';

import type {
  CanvasCommand,
  CanvasCommandNode,
  CanvasDocumentSnapshot,
} from './commands';

export type CanvasTaskEventSource = 'submit' | 'sse' | 'poll' | 'recovery' | 'cancel';

export interface CanvasTaskEventResult {
  url: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  sourceUrl?: string;
  metadata?: Partial<CanvasCommandNode>;
}

export interface CanvasTaskEvent {
  taskId: string;
  batchId?: string;
  slotId?: string;
  slotIndex?: number;
  outputIndex: number;
  status: DurableTaskStatus;
  progress: number;
  revision?: number;
  source?: CanvasTaskEventSource;
  label?: string;
  providerId?: string;
  providerName?: string;
  modelId?: string;
  modelName?: string;
  result?: CanvasTaskEventResult;
  error?: UnifiedTaskError;
}

interface CanvasProcessingProjection {
  taskId?: string;
  batchId?: string;
  slotId?: string;
  slotIndex?: number;
  outputIndex?: number;
  status?: string;
  progress?: number;
  label?: string;
  revision?: number;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
  requestId?: string;
  [key: string]: unknown;
}

const statusRank: Record<DurableTaskStatus, number> = {
  created: 0,
  submitting: 1,
  queued: 2,
  processing: 3,
  uploading: 4,
  completed: 5,
  failed: 5,
  cancelled: 5,
  timeout: 5,
};

const defaultLabels: Record<DurableTaskStatus, string> = {
  created: '准备生成',
  submitting: '正在提交',
  queued: '排队中',
  processing: '生成中',
  uploading: '正在保存结果',
  completed: '生成完成',
  failed: '生成失败',
  cancelled: '已取消',
  timeout: '生成超时',
};

function processingOf(node: CanvasCommandNode): CanvasProcessingProjection | undefined {
  if (!node.processing || typeof node.processing !== 'object') return undefined;
  return node.processing as CanvasProcessingProjection;
}

function nodeOutputIndex(node: CanvasCommandNode): number {
  const processing = processingOf(node);
  if (typeof processing?.outputIndex === 'number') return processing.outputIndex;
  return 0;
}

function matchesEvent(node: CanvasCommandNode, event: CanvasTaskEvent): boolean {
  const processing = processingOf(node);
  if (processing?.slotId && event.slotId && processing.slotId === event.slotId) return true;
  const taskId = processing?.taskId || node.generationTaskId || node.taskProjection?.taskId;
  return taskId === event.taskId && nodeOutputIndex(node) === event.outputIndex;
}

function findProjectedNode(
  snapshot: CanvasDocumentSnapshot,
  event: CanvasTaskEvent,
): CanvasCommandNode | undefined {
  if (event.result?.placementId) {
    const byPlacement = snapshot.order
      .map(id => snapshot.byId[id])
      .find(node => node.placementId === event.result?.placementId);
    if (byPlacement) return byPlacement;
  }
  if (event.result?.assetVersionId) {
    const byVersion = snapshot.order
      .map(id => snapshot.byId[id])
      .find(node => (
        node.assetVersionId === event.result?.assetVersionId
        && (node.taskProjection?.taskId === event.taskId || node.generationTaskId === event.taskId)
      ));
    if (byVersion) return byVersion;
  }
  return snapshot.order.map(id => snapshot.byId[id]).find(node => matchesEvent(node, event));
}

function isDuplicateOrRegression(node: CanvasCommandNode, event: CanvasTaskEvent): boolean {
  const processing = processingOf(node);
  const currentStatus = (node.taskProjection?.status || processing?.status) as DurableTaskStatus | undefined;
  const currentProgress = node.taskProjection?.progress ?? processing?.progress ?? 0;
  const currentRevision = node.taskProjection?.revision ?? processing?.revision;

  if (currentStatus && isTerminalTaskStatus(currentStatus)) {
    const legacyCompletedPlaceholder = currentStatus === 'completed'
      && node.isProcessingPlaceholder === true
      && !node.taskProjection
      && event.status === 'completed'
      && Boolean(event.result?.url);
    const completedIdentityEnrichment = currentStatus === 'completed'
      && event.status === 'completed'
      && Boolean(event.result?.url)
      && (
        (!node.assetVersionId && Boolean(event.result?.assetVersionId))
        || (!node.placementId && Boolean(event.result?.placementId))
        || (!node.assetId && Boolean(event.result?.assetId))
      );
    if (!legacyCompletedPlaceholder && !completedIdentityEnrichment) return true;
  }
  if (typeof currentRevision === 'number' && typeof event.revision === 'number') {
    if (event.revision < currentRevision) return true;
    if (
      event.revision === currentRevision
      && currentStatus === event.status
      && currentProgress >= event.progress
    ) return true;
  }
  if (currentStatus && statusRank[event.status] < statusRank[currentStatus]) return true;
  return currentStatus === event.status
    && currentProgress >= event.progress
    && event.status !== 'completed';
}

export function createCanvasTaskEventError(
  error: unknown,
  defaults: TaskErrorDefaults,
): UnifiedTaskError {
  return normalizeTaskError(error, defaults);
}

function safeResultMetadata(result: CanvasTaskEventResult): Partial<CanvasCommandNode> {
  const metadata = { ...(result.metadata || {}) };
  delete metadata.id;
  delete metadata.x;
  delete metadata.y;
  delete metadata.width;
  delete metadata.height;
  delete metadata.processing;
  delete metadata.isProcessingPlaceholder;
  return metadata;
}

/**
 * Converts one durable task event into canvas commands. This function is pure:
 * provider I/O, persistence and billing remain owned by their existing layers.
 */
export function projectCanvasTaskEvent(
  snapshot: CanvasDocumentSnapshot,
  event: CanvasTaskEvent,
): CanvasCommand[] {
  const node = findProjectedNode(snapshot, event);
  if (!node || isDuplicateOrRegression(node, event)) return [];
  if (event.status === 'completed' && !event.result?.url) return [];

  const processing = processingOf(node);
  const providerId = event.providerId || node.apiProviderId;
  const modelId = event.modelId || node.model;
  const projection = {
    taskId: event.taskId,
    outputIndex: event.outputIndex,
    status: event.status,
    progress: Math.max(0, Math.min(100, event.progress)),
    ...(typeof event.revision === 'number' ? { revision: event.revision } : {}),
    ...(event.source ? { source: event.source } : {}),
    ...(event.error?.code ? { errorCode: event.error.code } : {}),
  };

  let patch: Partial<CanvasCommandNode>;
  if (event.status === 'completed' && event.result) {
    patch = {
      ...safeResultMetadata(event.result),
      url: event.result.url,
      sourceUrl: event.result.sourceUrl || event.result.url,
      assetId: event.result.assetId || node.assetId,
      assetVersionId: event.result.assetVersionId || node.assetVersionId,
      placementId: event.result.placementId || node.placementId,
      generationTaskId: event.taskId,
      isProcessingPlaceholder: false,
      processing: undefined,
      taskProjection: projection,
      ...(providerId ? { apiProviderId: providerId } : {}),
      ...(event.providerName || node.apiProvider ? { apiProvider: event.providerName || node.apiProvider } : {}),
      ...(modelId ? { model: modelId } : {}),
      ...(event.modelName || node.modelName ? { modelName: event.modelName || node.modelName } : {}),
      mediaAvailability: 'ready',
      mediaErrorCode: undefined,
    };
  } else {
    const label = event.error?.message || event.label || defaultLabels[event.status];
    patch = {
      processing: {
        ...(processing || {}),
        taskId: event.taskId,
        batchId: event.batchId || processing?.batchId,
        slotId: event.slotId || processing?.slotId,
        slotIndex: event.slotIndex ?? processing?.slotIndex,
        outputIndex: event.outputIndex,
        status: event.status,
        progress: projection.progress,
        label,
        ...(typeof event.revision === 'number' ? { revision: event.revision } : {}),
        ...(event.error ? {
          error: event.error.message,
          errorCode: event.error.code,
          retryable: event.error.retryable,
          requestId: event.error.requestId,
        } : {}),
      },
      taskProjection: projection,
      ...(event.error?.code ? { mediaErrorCode: event.error.code } : {}),
      ...(providerId ? { apiProviderId: providerId } : {}),
      ...(event.providerName ? { apiProvider: event.providerName } : {}),
      ...(modelId ? { model: modelId } : {}),
      ...(event.modelName ? { modelName: event.modelName } : {}),
    };
  }

  return [{
    type: 'task-result',
    id: node.id,
    taskId: event.taskId,
    outputIndex: event.outputIndex,
    patch,
    terminal: isTerminalTaskStatus(event.status),
  }];
}
