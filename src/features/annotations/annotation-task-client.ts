'use client';

import { extractTaskResultImageUrl } from '@/lib/task-result-url';
import { taskEventsClient } from '@/lib/task-events-client';

import { AnnotationClientError } from './annotation-client';

type JsonRecord = Record<string, unknown>;

export interface AnnotationTaskResult {
  taskId: string;
  imageUrl: string;
  payload: unknown;
}

export interface WaitForAnnotationTaskOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onProgress?: (progress: number, stage: string) => void;
  /** Shared documents must wait for an owned poll, not an early SSE completion. */
  requireCanonicalPublication?: boolean;
  requestPoll?: (payload: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<Response>;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function taskState(payload: unknown): {
  status: string;
  progress?: number;
  stage?: string;
  error?: string;
} {
  const root = asRecord(payload);
  const task = asRecord(root?.task);
  const status = String(task?.status || root?.status || '').toLowerCase();
  const progressValue = task?.progress ?? root?.progress;
  const stageValue = task?.stage ?? task?.label ?? root?.stage ?? root?.label;
  const errorValue = task?.error ?? root?.error ?? root?.message;
  return {
    status,
    progress: typeof progressValue === 'number' ? progressValue : undefined,
    stage: typeof stageValue === 'string' ? stageValue : undefined,
    error: typeof errorValue === 'string' ? errorValue : undefined,
  };
}

function completedResult(taskId: string, payload: unknown): AnnotationTaskResult {
  const imageUrl = extractTaskResultImageUrl(payload);
  if (!imageUrl) {
    throw new AnnotationClientError({
      code: 'ANNOTATION_RESULT_MISSING',
      message: '批注任务已完成，但没有返回结果图片',
      retryable: true,
    });
  }
  return { taskId, imageUrl, payload };
}

export interface AnnotationCanonicalReference {
  assetId: string;
  assetVersionId: string;
  placementId: string;
  entityId: string;
  kind: 'image';
  url: string;
}

export function readAnnotationCanonicalReference(payload: unknown): AnnotationCanonicalReference | undefined {
  const root = asRecord(payload);
  const task = asRecord(root?.task);
  const projection = asRecord(root?.assetProjection)
    ?? asRecord(asRecord(root?.result)?.assetProjection)
    ?? asRecord(asRecord(task?.result)?.assetProjection);
  if (projection?.status !== 'completed' || !Array.isArray(projection.references)
    || projection.references.length !== 1) return undefined;
  const ref = asRecord(projection.references[0]);
  if (ref?.kind !== 'image' || ['assetId', 'assetVersionId', 'placementId', 'entityId'].some(key => {
    const value = ref?.[key];
    return typeof value !== 'string' || !value || value.trim() !== value
      || value.length > 256 || /\p{Cc}/u.test(value);
  })) return undefined;
  const url = ref?.url;
  if (typeof url !== 'string' || url.length > 8192
    || !/^\/api\/serve-upload\/[A-Za-z0-9._/-]+$/.test(url)
    || url.slice('/api/serve-upload/'.length).split('/').some(part => !part || part === '.' || part === '..')) return undefined;
  return { assetId: ref.assetId as string, assetVersionId: ref.assetVersionId as string,
    placementId: ref.placementId as string, entityId: ref.entityId as string, kind: 'image', url };
}

export function waitForAnnotationTaskResult(
  taskId: string,
  options: WaitForAnnotationTaskOptions = {},
): Promise<AnnotationTaskResult> {
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let lastProgress = 0;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      unsubscribe();
      if (pollTimer) clearTimeout(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handlePayload = (payload: unknown, ownedPoll = false) => {
      if (settled || options.signal?.aborted) return true;
      const state = taskState(payload);
      const completed = state.status === 'completed'
        || state.status === 'success'
        || state.status === 'succeeded';
      const canonicalUrl = options.requireCanonicalPublication && ownedPoll ? readAnnotationCanonicalReference(payload)?.url : undefined;
      if (completed && options.requireCanonicalPublication && !canonicalUrl) {
        options.onProgress?.(Math.min(95, lastProgress), '等待协作结果发布');
        return false;
      }
      if (completed) {
        lastProgress = 100;
        options.onProgress?.(100, '修改完成');
      } else if (state.progress !== undefined) {
        lastProgress = Math.max(
          lastProgress,
          Math.min(95, Math.max(0, Math.round(state.progress))),
        );
        options.onProgress?.(
          lastProgress,
          state.stage || '模型正在处理',
        );
      }
      if (completed) {
        finish(() => {
          try {
            resolve(canonicalUrl ? { taskId, imageUrl: canonicalUrl, payload } : completedResult(taskId, payload));
          } catch (error) {
            reject(error);
          }
        });
        return true;
      }
      if (
        state.status === 'failed'
        || state.status === 'error'
        || state.status === 'cancelled'
        || state.status === 'timeout'
      ) {
        finish(() => reject(new AnnotationClientError({
          code: state.status === 'cancelled'
            ? 'ANNOTATION_TASK_CANCELLED'
            : 'ANNOTATION_TASK_FAILED',
          message: state.error || '批注修改任务失败',
          retryable: state.status !== 'cancelled',
        })));
        return true;
      }
      return false;
    };
    const unsubscribe = taskEventsClient.onTaskEvent((event) => {
      if (event.taskId !== taskId) return;
      handlePayload({ ...event.task, task: event.task });
    });
    const onAbort = () => {
      finish(() => reject(new AnnotationClientError({
        code: 'ANNOTATION_TASK_CANCELLED',
        message: '批注修改已取消',
      })));
    };
    const poll = async () => {
      if (settled) return;
      try {
        const response = await (options.requestPoll ? options.requestPoll({ taskId }, { signal: options.signal }) : fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
          signal: options.signal,
        }));
        const payload = await response.json().catch(() => ({})) as unknown;
        if (settled || options.signal?.aborted) return;
        if (!response.ok) {
          const error = asRecord(payload);
          throw new AnnotationClientError({
            code: String(error?.code || `HTTP_${response.status}`),
            message: String(error?.message || error?.error || '批注任务状态查询失败'),
            retryable: response.status >= 500,
          });
        }
        if (handlePayload(payload, true)) return;
      } catch (error) {
        if (options.signal?.aborted) {
          onAbort();
          return;
        }
        if (error instanceof AnnotationClientError && !error.retryable) {
          finish(() => reject(error));
          return;
        }
      }
      if (!settled) pollTimer = setTimeout(poll, pollIntervalMs);
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) { onAbort(); return; }
    timeoutTimer = setTimeout(() => {
      finish(() => reject(new AnnotationClientError({
        code: 'ANNOTATION_TASK_TIMEOUT',
        message: '批注修改任务超时，请稍后重试',
        retryable: true,
      })));
    }, timeoutMs);
    pollTimer = setTimeout(poll, taskEventsClient.isConnected() ? pollIntervalMs : 0);
  });
}
