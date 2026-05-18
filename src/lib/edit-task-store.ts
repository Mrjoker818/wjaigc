/**
 * 语言修图任务共享存储
 * 
 * 独立于 /api/edit/route.ts，避免 Next.js HMR 热重载时 Map 被清空。
 * poll-task 通过 import此模块读取任务状态，确保与 edit route 使用同一个 Map 实例。
 */

export interface EditTask {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  stage: string;
  error?: string;
  result?: Record<string, unknown>;
  createdAt: number;
  completedAt?: number;
}

const MAX_EDIT_TASKS = 100;

/** 全局任务存储 —— 模块级单例，HMR 安全 */
const editTaskStore = new Map<string, EditTask>();

// 定期清理过期任务（>30分钟）
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [id, task] of editTaskStore) {
      if (now - task.createdAt > 30 * 60 * 1000) {
        editTaskStore.delete(id);
      }
    }
  }, 5 * 60 * 1000);
}

export function getEditTask(taskId: string): EditTask | undefined {
  return editTaskStore.get(taskId);
}

export function deleteEditTask(taskId: string): boolean {
  return editTaskStore.delete(taskId);
}

export function setEditTask(taskId: string, task: EditTask): void {
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

export function updateTaskStage(taskId: string, stage: string): void {
  const task = editTaskStore.get(taskId);
  if (task) {
    editTaskStore.set(taskId, { ...task, stage });
  }
}

export function failEditTask(taskId: string, error: string, networkError = false): void {
  editTaskStore.set(taskId, {
    id: taskId,
    status: 'failed',
    progress: 0,
    stage: '失败',
    error,
    result: { success: false, error, networkError },
    createdAt: editTaskStore.get(taskId)?.createdAt || Date.now(),
    completedAt: Date.now(),
  });
}
