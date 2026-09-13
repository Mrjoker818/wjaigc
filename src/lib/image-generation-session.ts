import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { normalizeGenerationSubmitSlots } from '@/lib/task-core/generation-batch';

export type ImageGenerationSlotStatus =
  | 'submitting'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface ImageGenerationError {
  code?: string;
  message: string;
  retryable?: boolean;
}

export interface ImageGenerationRequest {
  projectId: string;
  outputCount: number;
  prompt: string;
  providerId: string;
  model: string;
  [key: string]: unknown;
}

export interface ImageGenerationTaskUpdate {
  taskId: string;
  projectId?: string;
  status: string;
  progress?: number;
  result?: unknown;
  error?: ImageGenerationError | string;
}

export interface RestoredImageGenerationTask extends ImageGenerationTaskUpdate {
  id?: string;
  projectId: string;
  request?: ImageGenerationRequest;
}

export interface ImageGenerationSlot {
  id: string;
  projectId: string;
  taskId?: string;
  status: ImageGenerationSlotStatus;
  progress: number;
  assetVersionId?: string;
  placementId?: string;
  url?: string;
  error?: ImageGenerationError;
}

interface SubmitResponse {
  batchId?: unknown;
  slots?: unknown;
  taskId?: unknown;
  taskIds?: unknown;
}

type PollHandle = ReturnType<typeof setTimeout> | number;

export interface ImageGenerationSessionDependencies {
  submit(request: ImageGenerationRequest & { submitOnly: true }): Promise<SubmitResponse>;
  subscribeTaskEvents(listener: (update: ImageGenerationTaskUpdate) => void): () => void;
  isTaskEventsConnected(): boolean;
  cancelTask(taskId: string): Promise<{ success?: boolean; message?: string }>;
  restoreTasks(projectId: string): Promise<RestoredImageGenerationTask[]>;
  extractAssetReferences(payload: unknown): WorkspaceAssetReference[];
  pollTask?(taskId: string): Promise<ImageGenerationTaskUpdate>;
  schedulePoll?(callback: () => void | Promise<void>, delayMs: number): PollHandle;
  clearScheduledPoll?(handle: PollHandle): void;
  createSlotId?(): string;
}

export interface ImageGenerationSession {
  submit(request: ImageGenerationRequest): Promise<ImageGenerationSlot[]>;
  restore(projectId: string): Promise<ImageGenerationSlot[]>;
  cancel(slotId: string): Promise<boolean>;
  retry(slotId: string): Promise<ImageGenerationSlot | null>;
  dispose(): void;
  subscribe(listener: (slots: ImageGenerationSlot[]) => void): () => void;
  snapshot(): ImageGenerationSlot[];
}

const TERMINAL_STATUSES = new Set<ImageGenerationSlotStatus>([
  'completed',
  'failed',
  'cancelled',
  'timeout',
]);

function normalizeStatus(status: string): ImageGenerationSlotStatus {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'timeout':
      return 'timeout';
    case 'created':
    case 'submitting':
      return 'submitting';
    default:
      return 'processing';
  }
}

function normalizeError(error: ImageGenerationTaskUpdate['error'], fallback: string): ImageGenerationError {
  if (typeof error === 'string') return { message: error };
  if (error && typeof error.message === 'string' && error.message.trim()) return { ...error };
  return { message: fallback };
}

function cloneSlot(slot: ImageGenerationSlot): ImageGenerationSlot {
  return {
    ...slot,
    ...(slot.error ? { error: { ...slot.error } } : {}),
  };
}

export function createImageGenerationSession(
  dependencies: ImageGenerationSessionDependencies,
): ImageGenerationSession {
  let disposed = false;
  let sequence = 0;
  let slots: ImageGenerationSlot[] = [];
  const listeners = new Set<(value: ImageGenerationSlot[]) => void>();
  const taskToSlot = new Map<string, string>();
  const requestBySlot = new Map<string, ImageGenerationRequest>();
  const pollHandles = new Map<string, PollHandle>();

  const snapshot = (): ImageGenerationSlot[] => slots.map(cloneSlot);
  const publish = (): void => {
    if (disposed) return;
    const value = snapshot();
    listeners.forEach(listener => listener(value));
  };
  const createSlotId = (): string => dependencies.createSlotId?.()
    || `generation-slot-${Date.now()}-${++sequence}`;
  const replaceSlot = (slotId: string, next: ImageGenerationSlot): boolean => {
    const index = slots.findIndex(slot => slot.id === slotId);
    if (index < 0 || JSON.stringify(slots[index]) === JSON.stringify(next)) return false;
    slots = slots.map((slot, slotIndex) => slotIndex === index ? next : slot);
    publish();
    return true;
  };
  const clearPoll = (taskId: string): void => {
    const handle = pollHandles.get(taskId);
    if (handle === undefined) return;
    (dependencies.clearScheduledPoll || clearTimeout)(handle as ReturnType<typeof setTimeout>);
    pollHandles.delete(taskId);
  };

  const applyUpdate = (update: ImageGenerationTaskUpdate): void => {
    const slotId = taskToSlot.get(update.taskId);
    if (!slotId) return;
    const current = slots.find(slot => slot.id === slotId);
    if (!current || TERMINAL_STATUSES.has(current.status)) return;

    const status = normalizeStatus(update.status);
    const next: ImageGenerationSlot = {
      ...current,
      status,
      progress: typeof update.progress === 'number' ? update.progress : current.progress,
    };

    if (status === 'completed') {
      const reference = dependencies.extractAssetReferences(update.result)[0];
      if (!reference?.assetVersionId) {
        next.status = 'failed';
        next.error = {
          code: 'MISSING_ASSET_PROJECTION',
          message: '生成任务已完成，但未返回可管理的资产版本',
          retryable: true,
        };
      } else {
        next.progress = 100;
        next.assetVersionId = reference.assetVersionId;
        next.placementId = reference.placementId;
        next.url = reference.url;
        delete next.error;
      }
    } else if (status === 'failed' || status === 'timeout') {
      next.error = normalizeError(update.error, status === 'timeout' ? '生成任务超时' : '生成任务失败');
    }

    if (replaceSlot(slotId, next) && TERMINAL_STATUSES.has(next.status)) clearPoll(update.taskId);
  };

  const schedulePoll = (taskId: string): void => {
    if (
      disposed
      || !dependencies.pollTask
      || pollHandles.has(taskId)
    ) return;
    const schedule = dependencies.schedulePoll
      || ((callback: () => void | Promise<void>, delayMs: number) => setTimeout(() => void callback(), delayMs));
    const handle = schedule(async () => {
      pollHandles.delete(taskId);
      if (disposed) return;
      if (dependencies.isTaskEventsConnected()) {
        schedulePoll(taskId);
        return;
      }
      try {
        applyUpdate(await dependencies.pollTask!(taskId));
      } catch {
        // A transient poll failure keeps the authoritative task active for the next attempt.
      }
      const slotId = taskToSlot.get(taskId);
      const slot = slots.find(value => value.id === slotId);
      if (slot && !TERMINAL_STATUSES.has(slot.status)) schedulePoll(taskId);
    }, 1_200);
    pollHandles.set(taskId, handle);
  };

  const bindSubmission = (
    targetSlots: ImageGenerationSlot[],
    response: SubmitResponse,
  ): void => {
    const submitted = normalizeGenerationSubmitSlots(response);
    for (const serverSlot of submitted) {
      const target = targetSlots[serverSlot.slotIndex];
      if (!target) continue;
      taskToSlot.set(serverSlot.taskId, target.id);
      const next: ImageGenerationSlot = {
        ...target,
        taskId: serverSlot.taskId,
        status: normalizeStatus(serverSlot.status),
      };
      replaceSlot(target.id, next);
      schedulePoll(serverSlot.taskId);
    }
    const boundIndexes = new Set(submitted.map(slot => slot.slotIndex));
    targetSlots.forEach((target, slotIndex) => {
      if (boundIndexes.has(slotIndex)) return;
      replaceSlot(target.id, {
        ...target,
        status: 'failed',
        error: {
          code: 'MISSING_GENERATION_TASK',
          message: '服务器未为该图片槽位返回生成任务',
          retryable: true,
        },
      });
    });
  };

  const submitIntoSlots = async (
    request: ImageGenerationRequest,
    targetSlots: ImageGenerationSlot[],
  ): Promise<void> => {
    try {
      bindSubmission(targetSlots, await dependencies.submit({ ...request, submitOnly: true }));
    } catch (error) {
      for (const target of targetSlots) {
        const current = slots.find(slot => slot.id === target.id);
        if (!current || TERMINAL_STATUSES.has(current.status)) continue;
        replaceSlot(target.id, {
          ...current,
          status: 'failed',
          error: normalizeError(
            error instanceof Error ? error.message : undefined,
            '生成任务提交失败',
          ),
        });
      }
    }
  };

  const unsubscribeEvents = dependencies.subscribeTaskEvents(applyUpdate);

  return {
    async submit(request) {
      const outputCount = Math.max(1, Math.min(4, Math.trunc(request.outputCount)));
      const created = Array.from({ length: outputCount }, (): ImageGenerationSlot => ({
        id: createSlotId(),
        projectId: request.projectId,
        status: 'submitting',
        progress: 0,
      }));
      slots = [...slots, ...created];
      created.forEach(slot => requestBySlot.set(slot.id, { ...request, outputCount }));
      publish();
      await submitIntoSlots({ ...request, outputCount }, created);
      return created.map(slot => slots.find(value => value.id === slot.id) || slot).map(cloneSlot);
    },

    async restore(projectId) {
      const restored = (await dependencies.restoreTasks(projectId)).filter(task => task.projectId === projectId);
      slots = restored.map((task): ImageGenerationSlot => {
        const reference = dependencies.extractAssetReferences(task.result)[0];
        const restoredStatus = normalizeStatus(task.status);
        const missingCompletedProjection = restoredStatus === 'completed' && !reference?.assetVersionId;
        const status = missingCompletedProjection ? 'failed' : restoredStatus;
        const slot: ImageGenerationSlot = {
          id: task.id || createSlotId(),
          projectId,
          taskId: task.taskId,
          status,
          progress: typeof task.progress === 'number' ? task.progress : (status === 'completed' ? 100 : 0),
          ...(reference?.assetVersionId ? { assetVersionId: reference.assetVersionId } : {}),
          ...(reference?.placementId ? { placementId: reference.placementId } : {}),
          ...(reference?.url ? { url: reference.url } : {}),
          ...(missingCompletedProjection
            ? {
                error: {
                  code: 'MISSING_ASSET_PROJECTION',
                  message: '已完成任务尚未生成可管理的资产版本',
                  retryable: Boolean(task.request),
                },
              }
            : (status === 'failed' || status === 'timeout')
              ? { error: normalizeError(task.error, '生成任务失败') }
            : {}),
        };
        taskToSlot.set(task.taskId, slot.id);
        if (task.request) requestBySlot.set(slot.id, task.request);
        if (!TERMINAL_STATUSES.has(slot.status)) schedulePoll(task.taskId);
        return slot;
      });
      publish();
      return snapshot();
    },

    async cancel(slotId) {
      const slot = slots.find(value => value.id === slotId);
      if (!slot?.taskId || TERMINAL_STATUSES.has(slot.status)) return false;
      const result = await dependencies.cancelTask(slot.taskId);
      if (result.success !== true) return false;
      clearPoll(slot.taskId);
      replaceSlot(slotId, { ...slot, status: 'cancelled' });
      return true;
    },

    async retry(slotId) {
      const slot = slots.find(value => value.id === slotId);
      const request = requestBySlot.get(slotId);
      if (!slot || !request || (slot.status !== 'failed' && slot.status !== 'timeout')) return null;
      if (slot.taskId) {
        clearPoll(slot.taskId);
        taskToSlot.delete(slot.taskId);
      }
      const retrySlot: ImageGenerationSlot = {
        id: slot.id,
        projectId: slot.projectId,
        status: 'submitting',
        progress: 0,
      };
      replaceSlot(slotId, retrySlot);
      await submitIntoSlots({ ...request, outputCount: 1 }, [retrySlot]);
      return cloneSlot(slots.find(value => value.id === slotId) || retrySlot);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeEvents();
      for (const taskId of pollHandles.keys()) clearPoll(taskId);
      listeners.clear();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    snapshot,
  };
}
