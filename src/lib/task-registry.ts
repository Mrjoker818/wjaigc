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

export type TaskType = 'generate' | 'image-edit' | 'edit' | 'svg-trace' | 'upscale' | 'removebg' | 'extend' | 'mask' | 'erase' | 'vectorize' | 'segment' | 'batch' | 'outpaint' | 'multi-angle' | 'brand-generate' | 'brand-ecommerce' | 'refine-engine' | 'font-design' | 'ai-psd';
export type TaskStatus = 'queued' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface TaskInfo {
  taskId: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;       // 0-100
  label?: string;         // 人类可读标签，如 "生成图片"、"移除背景"
  result?: unknown;
  error?: string;
  queuePosition?: number; // 排队位置（0=不在排队）
  partialResults?: unknown; // ★ 增量结果：部分已完成的子结果
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
  cancelled: Set<string>;
  eventBus: EventEmitter;
}

function getGlobalTaskStore(): GlobalTaskStore {
  const key = '__wujie_task_store__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = {
      registry: new Map<string, TaskInfo>(),
      cancelled: new Set<string>(),
      eventBus: new EventEmitter(),
    };
    ((globalThis as Record<string, unknown>)[key] as GlobalTaskStore).eventBus.setMaxListeners(200);
  }
  return (globalThis as Record<string, unknown>)[key] as GlobalTaskStore;
}

const taskRegistry = getGlobalTaskStore().registry;
const cancelledTasks = getGlobalTaskStore().cancelled;
const taskEventBus = getGlobalTaskStore().eventBus;

// ─── 任务操作 ─────────────────────────────────────────────────────────

/** 注册新任务（现有路由创建任务时调用） */
export function registerTask(taskId: string, type: TaskType, label?: string): TaskInfo {
  const task: TaskInfo = {
    taskId,
    type,
    status: 'pending',
    progress: 0,
    label: label || type,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  taskRegistry.set(taskId, task);
  emitEvent('created', task);
  return task;
}

/** 更新任务进度/状态 */
export function updateTaskProgress(
  taskId: string,
  update: Partial<Pick<TaskInfo, 'status' | 'progress' | 'label' | 'result' | 'error' | 'queuePosition' | 'partialResults'>>
): void {
  const task = taskRegistry.get(taskId);
  if (!task) return;

  const oldStatus = task.status;
  Object.assign(task, { ...update, updatedAt: Date.now() });

  // 推断事件类型
  if (update.status === 'completed') {
    emitEvent('completed', task);
  } else if (update.status === 'failed') {
    emitEvent('failed', task);
  } else if (update.progress !== undefined && update.progress !== task.progress) {
    emitEvent('progress', task);
  } else if (oldStatus === 'queued' && task.status !== 'queued') {
    emitEvent('updated', task);
  } else {
    emitEvent('updated', task);
  }
}

/** 获取任务信息 */
export function getTaskInfo(taskId: string): TaskInfo | undefined {
  return taskRegistry.get(taskId);
}

/** 取消任务 */
export function cancelTask(taskId: string): boolean {
  if (cancelledTasks.has(taskId)) return true;
  cancelledTasks.add(taskId);
  updateTaskProgress(taskId, { status: 'cancelled' });

  // ★ 释放排队槽位：取消的任务不应再占用并发位置
  const task = taskRegistry.get(taskId);
  if (task) {
    releaseQueueSlot(taskId);
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

const defaultQueueConfig: QueueConfig = { maxConcurrent: 3, perUser: true };

// 每个用户的排队队列
const userQueues = new Map<string, string[]>();  // userId → [taskId, ...]
// 当前每用户活跃任务数
const userActiveCount = new Map<string, number>();
// ★ 任务→用户映射，用于取消/完成时释放槽位
const taskUserMap = new Map<string, string>();

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
    userActiveCount.set(userId, Math.max(0, (userActiveCount.get(userId) || 1) - 1));
    return null;
  }

  const nextTaskId = queue.shift()!;
  if (queue.length === 0) userQueues.delete(userId);
  else userQueues.set(userId, queue);

  // 更新排队中所有任务的位置
  queue.forEach((id, idx) => {
    updateTaskProgress(id, { queuePosition: idx + 1 });
  });

  return nextTaskId;
}

/**
 * ★ 释放队列槽位 — 在任务完成/失败/取消时调用
 * 确保并发计数正确递减，避免队列槽位泄露
 */
export function releaseQueueSlot(taskId: string): void {
  const userId = taskUserMap.get(taskId);
  if (!userId) return;

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

// 定期清理过期任务（>30分钟）
// ★ 只清理终态任务（completed/failed/cancelled），避免误删仍在处理的任务
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    const THIRTY_MIN = 30 * 60 * 1000;
    const ACTIVE_STATUSES: TaskStatus[] = ['pending', 'processing', 'queued'];
    for (const [id, task] of taskRegistry) {
      // 仅清理超时的终态任务，或超时极久(>2h)的活跃任务（防僵尸）
      const isOld = now - task.updatedAt > THIRTY_MIN;
      const isTerminal = !ACTIVE_STATUSES.includes(task.status);
      const isZombie = now - task.updatedAt > 2 * 60 * 60 * 1000; // 2小时
      if ((isOld && isTerminal) || isZombie) {
        taskRegistry.delete(id);
        cancelledTasks.delete(id);
        // 从排队队列中也移除
        for (const [, queue] of userQueues) {
          const idx = queue.indexOf(id);
          if (idx !== -1) queue.splice(idx, 1);
        }
      }
    }
  }, 5 * 60 * 1000);
}
