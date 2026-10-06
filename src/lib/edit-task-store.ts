/**
 * 语言修图任务共享存储
 * 
 * 独立于 /api/edit/route.ts，避免 Next.js HMR 热重载时 Map 被清空。
 * poll-task 通过 import此模块读取任务状态，确保与 edit route 使用同一个 Map 实例。
 */

import type { ApiCompatProfile } from '@/lib/api-compatibility';

export interface EditTask {
  id: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  progress: number;
  stage: string;
  error?: string;
  result?: Record<string, unknown>;
  createdAt: number;
  completedAt?: number;
  /** 远程轮询信息（当 edit 走 /images/generations 异步模式时） */
  remotePollInfo?: {
    taskId: string;
    apiBaseUrl: string;
    providerId?: string;
    model: string;
    prompt: string;
    allTaskIds: string[];
    compatProfile?: ApiCompatProfile;
  };
}

const MAX_EDIT_TASKS = 100;

/** 全局任务存储 —— 使用 globalThis 确保 HMR / Turbopack 下路由间共享同一 Map 实例 */
const _storeKey = '__wujie_edit_task_store__';
if (!(globalThis as Record<string, unknown>)[_storeKey]) {
  (globalThis as Record<string, unknown>)[_storeKey] = new Map<string, EditTask>();
}
const editTaskStore = (globalThis as Record<string, unknown>)[_storeKey] as Map<string, EditTask>;

// 定期清理过期任务（>30分钟）
// ★ 只清理终态任务（completed/failed），避免误删 processing 任务
const _cleanupKey = '__wujie_edit_task_cleanup__';
if (typeof setInterval !== 'undefined' && !(globalThis as Record<string, unknown>)[_cleanupKey]) {
  (globalThis as Record<string, unknown>)[_cleanupKey] = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, task] of editTaskStore) {
      const isOld = now - task.createdAt > 30 * 60 * 1000;
      const isTerminal = task.status === 'completed'
        || task.status === 'failed'
        || task.status === 'cancelled'
        || task.status === 'timeout';
      const isZombie = now - task.createdAt > 30 * 60 * 1000; // 30分钟僵尸（processing太久也应清理，释放apiKey）
      if ((isOld && isTerminal) || isZombie) {
        editTaskStore.delete(id);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}

export function getEditTask(taskId: string): EditTask | undefined {
  return editTaskStore.get(taskId);
}

export function deleteEditTask(taskId: string): boolean {
  return editTaskStore.delete(taskId);
}

export function setEditTask(taskId: string, task: EditTask): void {
  const existing = editTaskStore.get(taskId);
  const terminalStatuses: EditTask['status'][] = ['completed', 'failed', 'cancelled', 'timeout'];
  if (
    existing
    && terminalStatuses.includes(existing.status)
    && task.status !== existing.status
  ) {
    return;
  }
  // 超过上限时清理最老的任务
  if (!editTaskStore.has(taskId) && editTaskStore.size >= MAX_EDIT_TASKS) {
    let oldestId = '';
    let oldestTime = Infinity;
    for (const [id, t] of editTaskStore) {
      if (t.createdAt < oldestTime) {
        oldestTime = t.createdAt;
        oldestId = id;
      }
    }
    if (oldestId) editTaskStore.delete(oldestId);
  }
  editTaskStore.set(taskId, task);
}

export function updateTaskStage(
  taskId: string,
  stage: string,
  progress?: number,
): void {
  const task = editTaskStore.get(taskId);
  if (task?.status === 'processing') {
    const nextProgress = progress === undefined
      ? task.progress
      : Math.min(99, Math.max(0, Math.round(progress)));
    if (nextProgress < task.progress) return;
    editTaskStore.set(taskId, { ...task, stage, progress: nextProgress });
  }
}

export function failEditTask(
  taskId: string,
  error: string,
  networkError = false,
  status: 'failed' | 'timeout' = 'failed',
): void {
  const existing = editTaskStore.get(taskId);
  if (existing && existing.status !== 'processing') return;
  editTaskStore.set(taskId, {
    id: taskId,
    status,
    progress: 0,
    stage: status === 'timeout' ? '已超时' : '失败',
    error,
    result: { success: false, error, networkError },
    createdAt: existing?.createdAt || Date.now(),
    completedAt: Date.now(),
  });
}

export function cancelEditTask(taskId: string): boolean {
  const task = editTaskStore.get(taskId);
  if (task && task.status === 'processing') {
    editTaskStore.set(taskId, {
      ...task,
      status: 'cancelled',
      stage: '已取消',
      completedAt: Date.now(),
    });
    return true;
  }
  return false;
}

export function isEditTaskCancelled(taskId: string): boolean {
  const task = editTaskStore.get(taskId);
  return task?.status === 'cancelled';
}
