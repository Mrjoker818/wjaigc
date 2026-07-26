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
  onProgress?: (progress: number) => void;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function taskState(payload: unknown): {
  status: string;
  progress?: number;
  error?: string;
} {
  const root = asRecord(payload);
  const task = asRecord(root?.task);
  const status = String(task?.status || root?.status || '').toLowerCase();
  const progressValue = task?.progress ?? root?.progress;
  const errorValue = task?.error ?? root?.error ?? root?.message;
  return {
    status,
    progress: typeof progressValue === 'number' ? progressValue : undefined,
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

export function waitForAnnotationTaskResult(
  taskId: string,
  options: WaitForAnnotationTaskOptions = {},
): Promise<AnnotationTaskResult> {
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;

  return new Promise((resolve, reject) => {
    let settled = false;
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
    const handlePayload = (payload: unknown) => {
      const state = taskState(payload);
      if (state.progress !== undefined) options.onProgress?.(state.progress);
      if (state.status === 'completed' || state.status === 'success' || state.status === 'succeeded') {
        finish(() => {
          try {
            resolve(completedResult(taskId, payload));
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
        const response = await fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
          signal: options.signal,
        });
        const payload = await response.json().catch(() => ({})) as unknown;
        if (!response.ok) {
          const error = asRecord(payload);
          throw new AnnotationClientError({
            code: String(error?.code || `HTTP_${response.status}`),
            message: String(error?.message || error?.error || '批注任务状态查询失败'),
            retryable: response.status >= 500,
          });
        }
        if (handlePayload(payload)) return;
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
      pollTimer = setTimeout(poll, pollIntervalMs);
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
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
