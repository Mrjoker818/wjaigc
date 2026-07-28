import { createHash } from 'node:crypto';

import type { LayerTaskResponse } from '@/lib/layer-decomposition/types';
import type { ExecutionResult } from '@/lib/workflow-engine';

type WorkflowFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ExecuteLayerWorkflowTaskOptions {
  submitUrl: string;
  body: Record<string, unknown>;
  fetchOptions: RequestInit;
  nodeId: string;
  idempotencyKey: string;
  fetcher?: WorkflowFetch;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  maxWaitMs?: number;
  onTaskId?: (taskId: string) => void | Promise<void>;
  onProgress?: (task: LayerTaskResponse) => void | Promise<void>;
}

export function buildWorkflowLayerIdempotencyKey(
  executionId: string,
  nodeId: string,
  attemptCount: number,
): string {
  const digest = createHash('sha256')
    .update(`${executionId}\0${nodeId}\0${attemptCount}`)
    .digest('hex');
  return `workflow-layer-${digest}`;
}

function layerTaskError(task: LayerTaskResponse): string {
  const code = task.error?.code || `LAYER_TASK_${task.status.toUpperCase()}`;
  const message = task.error?.message || '图片分层任务未完成';
  return `${code}: ${message}`;
}

async function readLayerTaskResponse(response: Response): Promise<LayerTaskResponse> {
  const data = await response.json() as LayerTaskResponse & {
    code?: string;
    message?: string;
  };
  if (!response.ok || data.success === false) {
    throw new Error(`${data.code || 'LAYER_REQUEST_FAILED'}: ${data.message || `HTTP ${response.status}`}`);
  }
  if (!data.taskId || !data.status) {
    throw new Error('LAYER_RESPONSE_INVALID: 图片分层响应缺少任务状态');
  }
  return data;
}

export async function executeLayerWorkflowTask(
  options: ExecuteLayerWorkflowTaskOptions,
): Promise<ExecutionResult> {
  const now = options.now || Date.now;
  const startedAt = now();
  const maxWaitMs = Math.max(100, options.maxWaitMs ?? 600_000);
  const fetcher = options.fetcher || fetch;
  const wait = options.wait
    || ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  const submitResponse = await fetcher(options.submitUrl, {
    ...options.fetchOptions,
    method: 'POST',
    headers: {
      ...(options.fetchOptions.headers as Record<string, string> | undefined),
      'Content-Type': 'application/json',
      'Idempotency-Key': options.idempotencyKey,
    },
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(600000),
  });
  let task = await readLayerTaskResponse(submitResponse);
  await options.onTaskId?.(task.taskId);
  let delayMs = 800;

  while (task.status === 'pending' || task.status === 'processing') {
    if (now() - startedAt >= maxWaitMs) {
      try {
        await cancelLayerWorkflowTask(
          options.submitUrl,
          task.taskId,
          options.fetchOptions,
          fetcher,
        );
      } catch {
        // The persisted task remains authoritative if cancellation races with a terminal state.
      }
      return {
        nodeId: options.nodeId,
        status: 'failed',
        error: 'LAYER_WORKFLOW_TIMEOUT: 图片分层任务等待超时',
        durationMs: now() - startedAt,
      };
    }
    await options.onProgress?.(task);
    await wait(delayMs);
    const previousPhase = task.phase;
    const statusResponse = await fetcher(
      `${options.submitUrl}?taskId=${encodeURIComponent(task.taskId)}`,
      {
        method: 'GET',
        headers: options.fetchOptions.headers,
        signal: AbortSignal.timeout(30000),
      },
    );
    task = await readLayerTaskResponse(statusResponse);
    delayMs = task.phase !== previousPhase
      ? 800
      : Math.min(2000, Math.round(delayMs * 1.35));
  }

  await options.onProgress?.(task);
  if (task.status !== 'completed' || !task.result) {
    return {
      nodeId: options.nodeId,
      status: 'failed',
      error: layerTaskError(task),
      durationMs: now() - startedAt,
    };
  }

  const result = task.result as unknown as Record<string, unknown>;
  return {
    nodeId: options.nodeId,
    status: 'success',
    output: {
      ...result,
      imageUrl: result.imageUrl || options.body.imageUrl || '',
      taskId: task.taskId,
      phase: task.phase,
      progress: task.progress,
    },
    durationMs: now() - startedAt,
  };
}

export async function cancelLayerWorkflowTask(
  submitUrl: string,
  taskId: string,
  fetchOptions: RequestInit,
  fetcher: WorkflowFetch = fetch,
): Promise<void> {
  const response = await fetcher(`${submitUrl}?taskId=${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    headers: fetchOptions.headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`取消图片分层任务失败 HTTP ${response.status}`);
  }
}
