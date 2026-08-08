/**
 * 统一任务注册中心 — 增量叠加层
 *
 * 设计原则：
 * 1. 不替换现有 editTaskStore / generate 中的任务管理，而是在其之上叠加
 * 2. 提供取消、SSE推送、排队等新能力
 * 3. 各现有 store 继续正常工作，本模块仅作为增强
 *
 * 使用方式：
 * - 现有路由在创建/更新任务时，额外调用 registerTask / updateTaskProgress
 * - 取消功能通过 cancelTask / isTaskCancelled 检查
 * - SSE 通过 subscribe 领取事件流
 */

import { EventEmitter } from 'events';

// ─── 类型 ────────────────────────────────────────────────────────────

export type TaskType = 'generate' | 'generate-async' | 'image-edit' | 'edit' | 'svg-trace' | 'upscale' | 'removebg' | 'extend' | 'mask' | 'erase' | 'vectorize' | 'segment' | 'batch' | 'outpaint' | 'multi-angle' | 'display-decompose' | 'brand-generate' | 'brand-ecommerce' | 'refine-engine' | 'font-design' | 'ai-psd' | 'video' | 'packaging' | 'display3d' | 'display3d-decompose' | '3d' | '3d-auto-multi-view' | '3d-retexture' | '3d-remesh' | 'venue-analyze' | 'venue-proposals' | 'venue-lock-design' | 'venue-render' | 'venue-qc' | 'human-repair' | 'aspect-recompose';
export type TaskStatus = 'queued' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type TaskPersistence = 'memory' | 'durable';

export interface TaskInfo {
  taskId: string;
  type: TaskType;
  status: TaskStatus;
  persistence?: TaskPersistence;
  progress: number;       // 0-100
  label?: string;         // 人类可读标签，如 "生成图片"、"移除背景"
  result?: unknown;
  error?: string;
  queuePosition?: number; // 排队位置（0=不在排队）
  partialResults?: unknown; // ★ 增量结果：部分已完成的子结果
  creditCost?: number;    // 已扣除的积分（用于失败/取消时退款）
  userId?: string;        // 任务所属用户ID（用于退款和SSE过滤）
  createdAt: number;
  updatedAt: number;
}

export interface TaskEvent {
  taskId: string;
  type: 'created' | 'updated' | 'completed' | 'failed' | 'cancelled' | 'progress' | 'queued';
  task: TaskInfo;
}

// ─── 核心存储 ─────────────────────────────────────────────────────────
// 使用 globalThis 确保跨路由共享同一实例（Next.js dev 模式下模块可能被多次实例化）

interface GlobalTaskStore {
  registry: Map<string, TaskInfo>;
  cancelled: Map<string, number>;
  abortControllers: Map<string, AbortController>;
  eventBus: EventEmitter;
  userQueues: Map<string, string[]>;
  userActiveCount: Map<string, number>;
  taskUserMap: Map<string, string>;
}

function getGlobalTaskStore(): GlobalTaskStore {
  const key = '__wujie_task_store__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = {
      registry: new Map<string, TaskInfo>(),
      cancelled: new Map<string, number>(),
      abortControllers: new Map<string, AbortController>(),
      eventBus: new EventEmitter(),
      userQueues: new Map<string, string[]>(),
      userActiveCount: new Map<string, number>(),
      taskUserMap: new Map<string, string>(),
    };
    ((globalThis as Record<string, unknown>)[key] as GlobalTaskStore).eventBus.setMaxListeners(200);
  }
  const store = (globalThis as Record<string, unknown>)[key] as GlobalTaskStore;
  store.abortControllers ||= new Map<string, AbortController>();
  return store;
}

const taskRegistry = getGlobalTaskStore().registry;
const cancelledTasks = getGlobalTaskStore().cancelled;
const taskAbortControllers = getGlobalTaskStore().abortControllers;
const taskEventBus = getGlobalTaskStore().eventBus;
const userQueues = getGlobalTaskStore().userQueues;
const userActiveCount = getGlobalTaskStore().userActiveCount;
const taskUserMap = getGlobalTaskStore().taskUserMap;

// ─── 任务操作 ─────────────────────────────────────────────────────────

/** 注册新任务（现有路由创建任务时调用）
 *  ★ 当传入 userId 时，自动接入并发排队机制：
 *  - 当前用户活跃任务 < MAX_CONCURRENT_PER_USER → 立即执行（返回 queuePosition=0）
 *  - 当前用户活跃任务 ≥ MAX_CONCURRENT_PER_USER → 任务排队等待（状态=queued）
 *  - 需要等待的路由可调用 await waitForQueueSlot(taskId) 阻塞直到获得槽位
 *  ★ 未传入 userId 时，使用 'anonymous' 分组（所有匿名用户共享并发限制）
 */
export function registerTask(
  taskId: string,
  type: TaskType,
  label?: string,
  userId?: string,
  persistence: TaskPersistence = 'memory',
): TaskInfo {
  const effectiveUserId = userId || 'anonymous';
  cancelledTasks.delete(taskId);

  const task: TaskInfo = {
    taskId,
    type,
    status: 'pending',
    persistence,
    progress: 0,
    label: label || type,
    userId: effectiveUserId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  taskRegistry.set(taskId, task);
  evictOldestTerminalTasks();

  // ★ 自动接入排队机制
  enqueueTask(taskId, effectiveUserId);
  // enqueueTask 内部已通过 updateTaskProgress 更新了 status 和 queuePosition
  // 这里需要回读最新状态
  const updated = taskRegistry.get(taskId);
  if (updated) Object.assign(task, updated);

  return task;
}

/**
 * ★ 等待排队槽位 — 在并发已满时阻塞，直到获得执行槽位
 * API 路由可在 registerTask 后调用此函数，实现"提交后等待执行"的排队模式
 * 如果任务未被排队或已获得槽位，立即返回
 * @param taskId 任务ID
 * @param timeoutMs 最大等待时间（默认 5 分钟）
 * @returns true=获得槽位可执行, false=超时/取消
 */
export function waitForQueueSlot(taskId: string, timeoutMs: number = 5 * 60 * 1000): Promise<boolean> {
  const task = taskRegistry.get(taskId);
  if (!task || task.status !== 'queued') return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    // 超时兜底
    const timer = setTimeout(() => {
      subscription();
      resolve(false); // 超时
    }, timeoutMs);

    // 监听任务状态变化
    const subscription = subscribeToTaskEvents((event) => {
      if (event.taskId !== taskId) return;
      if (isTaskCancelled(taskId)) {
        clearTimeout(timer);
        subscription();
        resolve(false);
      } else if (event.task.status === 'pending' || event.task.status === 'processing') {
        clearTimeout(timer);
        subscription();
        resolve(true); // 获得槽位
      } else if (event.task.status === 'cancelled' || event.task.status === 'failed') {
        clearTimeout(timer);
        subscription();
        resolve(false); // 被取消或失败
      }
    });
  });
}

/** 更新任务进度/状态 */
export function updateTaskProgress(
  taskId: string,
  update: Partial<Pick<TaskInfo, 'status' | 'progress' | 'label' | 'result' | 'error' | 'queuePosition' | 'partialResults' | 'creditCost'>>
): void {
  const task = taskRegistry.get(taskId);
  if (!task) return;

  const terminalStatuses: TaskStatus[] = ['completed', 'failed', 'cancelled'];
  if (
    terminalStatuses.includes(task.status)
    && update.status
    && update.status !== task.status
  ) {
    return;
  }

  const oldStatus = task.status;
  const oldProgress = task.progress;
  Object.assign(task, { ...update, updatedAt: Date.now() });

  // ★ 任务进入终态（completed/failed/cancelled）时，清理 cancelledTasks 中的记录
  const reachedTerminalState = terminalStatuses.includes(task.status) && !terminalStatuses.includes(oldStatus);
  if (task.status === 'completed' || task.status === 'failed') {
    cancelledTasks.delete(taskId);
  }

  // 推断事件类型
  if (update.status === 'completed') {
    emitEvent('completed', task);
  } else if (update.status === 'failed') {
    emitEvent('failed', task);
  } else if (update.progress !== undefined && update.progress !== oldProgress) {
    emitEvent('progress', task);
  } else if (oldStatus === 'queued' && task.status !== 'queued') {
    emitEvent('updated', task);
  } else {
    emitEvent('updated', task);
  }

  if (reachedTerminalState) {
    releaseQueueSlot(taskId);
  }
}

/** 获取任务信息 */
export function getTaskInfo(taskId: string): TaskInfo | undefined {
  return taskRegistry.get(taskId);
}

/** 取消任务 */
export function cancelTask(taskId: string): boolean {
  if (cancelledTasks.has(taskId)) return true;
  cancelledTasks.set(taskId, Date.now());
  abortTaskExecution(taskId, new Error(`Task ${taskId} was cancelled`));
  const task = taskRegistry.get(taskId);
  if (task) emitEvent('updated', task);
  return true;
}

/** Register the controller that owns the live backend work for a task. */
export function registerTaskAbortController(taskId: string, controller: AbortController): void {
  const existing = taskAbortControllers.get(taskId);
  if (existing && existing !== controller && !existing.signal.aborted) {
    existing.abort(new Error(`Task ${taskId} execution was replaced`));
  }
  taskAbortControllers.set(taskId, controller);
}

/** Remove a controller only if the caller still owns the registration. */
export function unregisterTaskAbortController(
  taskId: string,
  controller?: AbortController,
): void {
  if (!controller || taskAbortControllers.get(taskId) === controller) {
    taskAbortControllers.delete(taskId);
  }
}

/** Actively stop the network and image work associated with a task. */
export function abortTaskExecution(taskId: string, reason?: unknown): boolean {
  const controller = taskAbortControllers.get(taskId);
  if (!controller) return false;
  if (!controller.signal.aborted) {
    controller.abort(reason);
  }
  return true;
}

/** 检查任务是否已取消（现有路由在处理循环中检查） */
export function isTaskCancelled(taskId: string): boolean {
  return cancelledTasks.has(taskId);
}

/** 清除取消标记 */
export function clearCancelledTask(taskId: string): void {
  cancelledTasks.delete(taskId);
}

// ─── SSE 订阅 ─────────────────────────────────────────────────────────

/** 订阅任务事件（供 SSE route 使用） */
export function subscribeToTaskEvents(
  callback: (event: TaskEvent) => void
): () => void {
  const handler = (event: TaskEvent) => {
    try { callback(event); } catch { /* client disconnected */ }
  };
  taskEventBus.on('task-event', handler);
  return () => { taskEventBus.off('task-event', handler); };
}

function emitEvent(type: TaskEvent['type'], task: TaskInfo): void {
  try {
    taskEventBus.emit('task-event', { taskId: task.taskId, type, task: { ...task } });
  } catch {
    // 静默，不影响业务
  }
}

// ─── 排队管理 ─────────────────────────────────────────────────────────

interface QueueConfig {
  maxConcurrent: number;  // 最大并发数
  perUser: boolean;       // 是否按用户限流
}

/** 每用户最大并发任务数（可通过环境变量 TASK_MAX_CONCURRENT 覆盖） */
export const MAX_CONCURRENT_PER_USER = parseInt(process.env.TASK_MAX_CONCURRENT || '15', 10);
/** 全局最大存储任务数 */
export const MAX_TASKS = 500;
/** 任务过期时间（毫秒） */
export const TASK_TTL_MS = 30 * 60 * 1000;

const defaultQueueConfig: QueueConfig = { maxConcurrent: MAX_CONCURRENT_PER_USER, perUser: true };

// 每个用户的排队队列
// Queue state is stored with the global registry above so HMR cannot reset capacity.
// 当前每用户活跃任务数
// ★ 任务→用户映射，用于取消/完成时释放槽位

/** 将任务加入排队 */
export function enqueueTask(taskId: string, userId: string, config?: Partial<QueueConfig>): number {
  const cfg = { ...defaultQueueConfig, ...config };
  const active = userActiveCount.get(userId) || 0;

  // ★ 记录任务→用户映射
  taskUserMap.set(taskId, userId);

  if (active < cfg.maxConcurrent) {
    // 可以立即执行
    userActiveCount.set(userId, active + 1);
    updateTaskProgress(taskId, { status: 'pending', queuePosition: 0 });
    return 0; // 不需要排队
  }

  // 需要排队
  const queue = userQueues.get(userId) || [];
  queue.push(taskId);
  userQueues.set(userId, queue);
  updateTaskProgress(taskId, { status: 'queued', queuePosition: queue.length });
  return queue.length;
}

/** 任务完成后释放槽位，激活下一个排队任务 */
export function dequeueNextTask(userId: string): string | null {
  const queue = userQueues.get(userId);
  if (!queue || queue.length === 0) {
    return null;
  }

  const nextTaskId = queue.shift()!;
  if (queue.length === 0) userQueues.delete(userId);
  else userQueues.set(userId, queue);

  // 更新排队中所有任务的位置
  const updatedQueue = userQueues.get(userId);
  if (updatedQueue) {
    updatedQueue.forEach((id, idx) => {
      updateTaskProgress(id, { queuePosition: idx + 1 });
    });
  }

  return nextTaskId;
}

/**
 * ★ 获取任务所属用户ID — 用于SSE事件过滤，确保用户数据隔离
 */
export function getTaskUserId(taskId: string): string | undefined {
  // 优先从 TaskInfo 中读取 userId（新方案），回退到 taskUserMap（旧方案）
  const task = taskRegistry.get(taskId);
  if (task?.userId && task.userId !== 'anonymous') return task.userId;
  return taskUserMap.get(taskId);
}

/**
 * ★ 释放队列槽位 — 在任务完成/失败/取消时调用
 * 确保并发计数正确递减，避免队列槽位泄露
 */
export function releaseQueueSlot(taskId: string): void {
  const userId = taskUserMap.get(taskId);
  if (!userId) return;

  const queue = userQueues.get(userId);
  const queuedIndex = queue?.indexOf(taskId) ?? -1;
  if (queuedIndex >= 0 && queue) {
    queue.splice(queuedIndex, 1);
    if (queue.length === 0) userQueues.delete(userId);
    else {
      queue.forEach((id, index) => updateTaskProgress(id, { queuePosition: index + 1 }));
    }
    taskUserMap.delete(taskId);
    return;
  }

  const currentCount = userActiveCount.get(userId) || 0;
  if (currentCount > 0) {
    userActiveCount.set(userId, currentCount - 1);
    // 尝试激活下一个排队任务
    const nextId = dequeueNextTask(userId);
    if (nextId) {
      // 将排队任务提升为活跃
      userActiveCount.set(userId, (userActiveCount.get(userId) || 0) + 1);
      updateTaskProgress(nextId, { status: 'pending', queuePosition: 0 });
    }
  }

  taskUserMap.delete(taskId);
}

/** 获取用户当前排队位置 */
export function getQueuePosition(taskId: string): number {
  return taskRegistry.get(taskId)?.queuePosition || 0;
}

/** 获取活跃任务数 */
export function getActiveTaskCount(userId: string): number {
  return userActiveCount.get(userId) || 0;
}

// ─── 清理 ──────────────────────────────────────────────────────────────

/** 淘汰最老的终态任务，确保 registry 不超过上限 */
function evictOldestTerminalTasks(): void {
  if (taskRegistry.size <= MAX_TASKS) return;
  const ACTIVE_STATUSES: TaskStatus[] = ['pending', 'processing', 'queued'];
  // 按 updatedAt 升序排列终态任务，优先淘汰最老的
  const terminalEntries: [string, TaskInfo][] = [];
  for (const [id, task] of taskRegistry) {
    if (!ACTIVE_STATUSES.includes(task.status)) {
      terminalEntries.push([id, task]);
    }
  }
  terminalEntries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const excess = taskRegistry.size - MAX_TASKS;
  for (let i = 0; i < Math.min(excess, terminalEntries.length); i++) {
    const id = terminalEntries[i][0];
    releaseQueueSlot(id);
    taskRegistry.delete(id);
    cancelledTasks.delete(id);
    taskAbortControllers.delete(id);
  }
}

/** Remove expired tasks without leaving queue waiters or capacity behind. */
export function cleanupExpiredTasks(now: number = Date.now()): void {
  const activeStatuses: TaskStatus[] = ['pending', 'processing', 'queued'];
  const expiredTasks: Array<[string, TaskInfo]> = [];
  for (const entry of taskRegistry) {
    const [, task] = entry;
    const age = now - task.updatedAt;
    const isTerminal = !activeStatuses.includes(task.status);
    const isZombie = age > 2 * 60 * 60 * 1000;
    const isExpiredTerminal = isTerminal && age > TASK_TTL_MS;
    if (isZombie || isExpiredTerminal) expiredTasks.push(entry);
  }

  // Remove queued zombies first. Otherwise releasing an expired active task
  // can promote another expired queued task into a live slot.
  expiredTasks.sort(([, left], [, right]) => Number(left.status !== 'queued') - Number(right.status !== 'queued'));
  for (const [id, task] of expiredTasks) {
    const isTerminal = !activeStatuses.includes(task.status);

    // Emit cancellation before deletion so a queued waiter resolves immediately.
    if (!isTerminal) cancelTask(id);
    else releaseQueueSlot(id);

    taskRegistry.delete(id);
    cancelledTasks.delete(id);
    taskAbortControllers.delete(id);
  }

  // Unknown IDs may be cancelled after a restart. Bound their recovery marker.
  for (const [id, cancelledAt] of cancelledTasks) {
    if (now - cancelledAt > TASK_TTL_MS) cancelledTasks.delete(id);
  }
  evictOldestTerminalTasks();
}

// 定期清理过期任务（>30分钟）
// ★ 只清理终态任务（completed/failed/cancelled），避免误删仍在处理的任务
if (typeof setInterval !== 'undefined') {
  const cleanupTimer = setInterval(() => {
    cleanupExpiredTasks();
  }, 5 * 60 * 1000);
  // 不阻止进程退出
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}
