import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock db-client 以避免数据库连接
vi.mock('@/lib/db-client', () => ({
  execSql: vi.fn(),
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

import {
  registerTask,
  updateTaskProgress,
  getTaskInfo,
  isTaskCancelled,
  cancelTask,
  getActiveTaskCount,
  MAX_CONCURRENT_PER_USER,
  MAX_TASKS,
} from '@/lib/task-registry';

describe('task-registry 模块', () => {
  let counter = 0;
  const uniqueId = () => `test_task_${Date.now()}_${++counter}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerTask', () => {
    it('注册任务返回包含taskId的TaskInfo', () => {
      const id = uniqueId();
      const task = registerTask(id, 'generate', '图像生成', 'user1');
      expect(task.taskId).toBe(id);
      expect(task.type).toBe('generate');
      expect(task.label).toBe('图像生成');
    });

    it('注册的任务可以通过getTaskInfo查询到', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成', 'user1');
      const task = getTaskInfo(id);
      expect(task).toBeDefined();
      expect(task?.taskId).toBe(id);
    });

    it('注册多个任务ID不同', () => {
      const id1 = uniqueId();
      const id2 = uniqueId();
      registerTask(id1, 'generate', '图像1');
      registerTask(id2, 'generate', '图像2');
      expect(getTaskInfo(id1)).toBeDefined();
      expect(getTaskInfo(id2)).toBeDefined();
      expect(id1).not.toBe(id2);
    });
  });

  describe('updateTaskProgress', () => {
    it('更新进度和状态', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成');
      updateTaskProgress(id, { progress: 50, status: 'processing' });
      const task = getTaskInfo(id);
      expect(task?.progress).toBe(50);
      expect(task?.status).toBe('processing');
    });

    it('更新creditCost', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成');
      updateTaskProgress(id, { creditCost: 28 });
      const task = getTaskInfo(id);
      expect(task?.creditCost).toBe(28);
    });

    it('更新label', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成');
      updateTaskProgress(id, { label: 'DALL-E 3 生成' });
      const task = getTaskInfo(id);
      expect(task?.label).toBe('DALL-E 3 生成');
    });

    it('releases a user queue slot when a task reaches a terminal state', () => {
      const userId = `terminal-user-${uniqueId()}`;
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成', userId);

      expect(getActiveTaskCount(userId)).toBe(1);
      updateTaskProgress(id, { status: 'completed', progress: 100 });

      expect(getActiveTaskCount(userId)).toBe(0);
    });

    it('does not reduce active capacity when cancelling a task that was only queued', () => {
      const userId = `queued-user-${uniqueId()}`;
      for (let index = 0; index < MAX_CONCURRENT_PER_USER; index += 1) {
        registerTask(uniqueId(), 'generate', '图像生成', userId);
      }
      const queuedId = uniqueId();
      registerTask(queuedId, 'generate', '图像生成', userId);

      expect(getActiveTaskCount(userId)).toBe(MAX_CONCURRENT_PER_USER);
      cancelTask(queuedId);

      expect(getActiveTaskCount(userId)).toBe(MAX_CONCURRENT_PER_USER);
    });
  });

  describe('isTaskCancelled', () => {
    it('未取消的任务返回false', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成');
      expect(isTaskCancelled(id)).toBe(false);
    });

    it('取消后状态为cancelled（终态清理后isTaskCancelled可能为false，但任务状态正确）', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成');
      cancelTask(id);
      // cancelTask内部: add到cancelledTasks → updateTaskProgress(cancelled) → 终态清理delete
      // 所以isTaskCancelled可能返回false，但任务状态一定是cancelled
      const task = getTaskInfo(id);
      expect(task?.status).toBe('cancelled');
    });

    it('不存在的任务返回false', () => {
      expect(isTaskCancelled('non-existent')).toBe(false);
    });
  });

  describe('cancelTask', () => {
    it('取消任务成功', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成');
      const result = cancelTask(id);
      expect(result).toBe(true);
      const task = getTaskInfo(id);
      expect(task?.status).toBe('cancelled');
    });

    it('不存在的任务也返回true（幂等设计）', () => {
      const result = cancelTask('non-existent');
      expect(result).toBe(true);
    });
  });

  describe('getTaskInfo', () => {
    it('不存在的taskId返回undefined', () => {
      expect(getTaskInfo('non-existent')).toBeUndefined();
    });

    it('返回正确的任务信息', () => {
      const id = uniqueId();
      registerTask(id, 'edit', '图像编辑');
      updateTaskProgress(id, { progress: 75, creditCost: 15 });
      const task = getTaskInfo(id);
      expect(task).toMatchObject({
        taskId: id,
        type: 'edit',
        label: '图像编辑',
        progress: 75,
        creditCost: 15,
      });
    });
  });

  describe('常量', () => {
    it('MAX_CONCURRENT_PER_USER 为正数', () => {
      expect(MAX_CONCURRENT_PER_USER).toBeGreaterThan(0);
    });

    it('MAX_TASKS 为正数', () => {
      expect(MAX_TASKS).toBeGreaterThan(0);
    });
  });
});
