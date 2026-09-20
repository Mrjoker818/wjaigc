import {
  createTaskRequestId,
  normalizeTaskError,
  type UnifiedTaskError,
} from '@/lib/task-core/task-error';

interface TaskAbortStore {
  controllers: Map<string, AbortController>;
}

interface TaskAbortScopeOptions {
  timeoutMs?: number;
  requestId?: string;
  signals?: AbortSignal[];
  /**
   * Keep an active scope for the same task and inherit its cancellation.
   * Used by nested recovery work that must not abort its parent execution.
   */
  preserveExisting?: boolean;
}

export interface TaskAbortScope {
  taskId: string;
  controller: AbortController;
  signal: AbortSignal;
  dispose: () => void;
}

export interface TaskRecoveryState {
  status: string;
  updatedAt: number;
  leaseExpiresAt?: number;
  attemptCount?: number;
}

export interface TaskRecoveryBackoff {
  recoveryAllowed: boolean;
  retryAfterMs: number;
  nextRecoveryAt: number;
  reason: 'terminal' | 'lease-active' | 'lease-expired' | 'recent-update' | 'ready';
}

const MIN_RECOVERY_RETRY_MS = 3_000;

function getTaskAbortStore(): TaskAbortStore {
  const key = '__wujie_task_abort_store__';
  const root = globalThis as Record<string, unknown>;
  if (!root[key]) {
    root[key] = { controllers: new Map<string, AbortController>() };
  }
  return root[key] as TaskAbortStore;
}

function createAbortReason(
  kind: 'cancelled' | 'timeout' | 'replaced',
  requestId?: string,
): UnifiedTaskError {
  if (kind === 'timeout') {
    return normalizeTaskError(null, {
      code: 'TASK_TIMEOUT',
      message: '任务处理超时，请重试',
      source: 'wujie',
      retryable: true,
      requestId,
    });
  }
  if (kind === 'replaced') {
    return normalizeTaskError(null, {
      code: 'TASK_EXECUTION_REPLACED',
      message: '任务执行实例已切换',
      source: 'wujie',
      retryable: true,
      requestId,
    });
  }
  return normalizeTaskError(null, {
    code: 'TASK_CANCELLED',
    message: '任务已取消',
    source: 'client',
    retryable: false,
    requestId,
  });
}

function normalizeAbortReason(reason: unknown): unknown {
  if (reason === 'cancelled' || reason === undefined) {
    return createAbortReason('cancelled');
  }
  if (reason === 'timeout') return createAbortReason('timeout');
  if (reason === 'replaced') return createAbortReason('replaced');
  return reason;
}

export function registerTaskAbortController(
  taskId: string,
  controller: AbortController,
): void {
  const controllers = getTaskAbortStore().controllers;
  const existing = controllers.get(taskId);
  if (existing && existing !== controller && !existing.signal.aborted) {
    existing.abort(createAbortReason('replaced'));
  }
  controllers.set(taskId, controller);
}

export function unregisterTaskAbortController(
  taskId: string,
  controller?: AbortController,
): void {
  const controllers = getTaskAbortStore().controllers;
  if (!controller || controllers.get(taskId) === controller) {
    controllers.delete(taskId);
  }
}

export function abortTaskExecution(taskId: string, reason?: unknown): boolean {
  const controller = getTaskAbortStore().controllers.get(taskId);
  if (!controller) return false;
  if (!controller.signal.aborted) {
    controller.abort(normalizeAbortReason(reason));
  }
  return true;
}

export function createTaskAbortScope(
  taskId: string,
  options: TaskAbortScopeOptions = {},
): TaskAbortScope {
  const controller = new AbortController();
  const requestId = options.requestId || createTaskRequestId();
  const cleanupCallbacks: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const existingController = options.preserveExisting
    ? getTaskAbortStore().controllers.get(taskId)
    : undefined;
  const ownsRegistration = !existingController;

  if (ownsRegistration) registerTaskAbortController(taskId, controller);

  const inheritedSignals = existingController
    ? [existingController.signal, ...(options.signals || [])]
    : options.signals || [];
  for (const signal of inheritedSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const forwardAbort = () => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    };
    signal.addEventListener('abort', forwardAbort, { once: true });
    cleanupCallbacks.push(() => signal.removeEventListener('abort', forwardAbort));
  }

  if (
    !controller.signal.aborted
    && typeof options.timeoutMs === 'number'
    && options.timeoutMs > 0
  ) {
    timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(createAbortReason('timeout', requestId));
      }
    }, options.timeoutMs);
    if (timer && typeof timer === 'object' && 'unref' in timer) timer.unref();
  }

  return {
    taskId,
    controller,
    signal: controller.signal,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
      cleanupCallbacks.forEach((cleanup) => cleanup());
      if (ownsRegistration) unregisterTaskAbortController(taskId, controller);
    },
  };
}

export function getTaskRecoveryBackoff(
  task: TaskRecoveryState,
  now: number = Date.now(),
): TaskRecoveryBackoff {
  if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) {
    return {
      recoveryAllowed: false,
      retryAfterMs: 0,
      nextRecoveryAt: now,
      reason: 'terminal',
    };
  }

  const leaseExpiresAt = task.leaseExpiresAt || 0;
  if (leaseExpiresAt > now) {
    return {
      recoveryAllowed: false,
      retryAfterMs: leaseExpiresAt - now,
      nextRecoveryAt: leaseExpiresAt,
      reason: 'lease-active',
    };
  }
  if (leaseExpiresAt > 0) {
    return {
      recoveryAllowed: true,
      retryAfterMs: 0,
      nextRecoveryAt: now,
      reason: 'lease-expired',
    };
  }

  const age = Math.max(0, now - task.updatedAt);
  const retryWindow = Math.min(
    30_000,
    MIN_RECOVERY_RETRY_MS * Math.max(1, task.attemptCount || 1),
  );
  if (age < retryWindow) {
    const nextRecoveryAt = task.updatedAt + retryWindow;
    return {
      recoveryAllowed: false,
      retryAfterMs: nextRecoveryAt - now,
      nextRecoveryAt,
      reason: 'recent-update',
    };
  }

  return {
    recoveryAllowed: true,
    retryAfterMs: 0,
    nextRecoveryAt: now,
    reason: 'ready',
  };
}
