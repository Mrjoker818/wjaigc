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
  waitForQueueSlot,
  cleanupExpiredTasks,
  cleanupPendingDurableTaskMarkers,
  getPendingDurableTaskMarkerCount,
  markTaskDurable,
  PENDING_DURABLE_MARKER_TTL_MS,
  MAX_CONCURRENT_PER_USER,
  MAX_TASKS,
} from '@/lib/task-registry';

describe('task-registry 模块', () => {
  let counter = 0;
  const uniqueId = () => `test_task_${Date.now()}_${++counter}`;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupPendingDurableTaskMarkers(
      Date.now() + PENDING_DURABLE_MARKER_TTL_MS + 1,
    );
  });

  describe('registerTask', () => {
    it('注册任务返回包含taskId的TaskInfo', () => {
      const id = uniqueId();
      const task = registerTask(id, 'generate', '图像生成', 'user1');
      expect(task.taskId).toBe(id);
      expect(task.type).toBe('generate');
      expect(task.label).toBe('图像生成');
      expect(task.persistence).toBe('memory');
    });

    it('records durable persistence only when explicitly requested', () => {
      const id = uniqueId();
      const task = registerTask(
        id,
        'generate',
        '图像生成',
        'user1',
        'durable',
      );

      expect(task.persistence).toBe('durable');
      expect(getTaskInfo(id)?.persistence).toBe('durable');
    });

    it('upgrades an existing registry task to durable without changing its status', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成', 'user1');
      updateTaskProgress(id, { status: 'processing', progress: 45 });

      markTaskDurable(id);

      expect(getTaskInfo(id)).toMatchObject({
        persistence: 'durable',
        status: 'processing',
        progress: 45,
      });
      expect(getPendingDurableTaskMarkerCount()).toBe(0);
    });

    it('registers a task as durable when persistence was marked first', () => {
      const id = uniqueId();

      markTaskDurable(id);
      expect(getPendingDurableTaskMarkerCount()).toBe(1);
      const task = registerTask(id, 'generate', '图像生成', 'user1');

      expect(task.persistence).toBe('durable');
      expect(getTaskInfo(id)?.persistence).toBe('durable');
      expect(getPendingDurableTaskMarkerCount()).toBe(0);
    });

    it('expires an unconsumed durable marker before a later registration', () => {
      const id = uniqueId();
      const markedAt = Date.now();

      markTaskDurable(id, markedAt);
      cleanupPendingDurableTaskMarkers(
        markedAt + PENDING_DURABLE_MARKER_TTL_MS + 1,
      );

      expect(getPendingDurableTaskMarkerCount()).toBe(0);
      expect(registerTask(id, 'generate', '图像生成', 'user1').persistence)
        .toBe('memory');
    });

    it('does not let an evicted durable task make a reused id durable', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成', 'user1');
      markTaskDurable(id);
      updateTaskProgress(id, { status: 'completed', progress: 100 });

      cleanupExpiredTasks(Date.now() + PENDING_DURABLE_MARKER_TTL_MS + 1);
      expect(getTaskInfo(id)).toBeUndefined();

      expect(registerTask(id, 'generate', '图像生成', 'user1').persistence)
        .toBe('memory');
    });

    it('does not retain durable identity after capacity eviction', () => {
      cleanupExpiredTasks(Date.now() + 2 * 60 * 60 * 1000 + 1);
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成', 'user1');
      markTaskDurable(id);
      updateTaskProgress(id, { status: 'completed', progress: 100 });

      for (let index = 0; index < MAX_TASKS; index++) {
        const fillerId = uniqueId();
        registerTask(fillerId, 'generate', '图像生成', 'user1');
        updateTaskProgress(fillerId, { status: 'completed', progress: 100 });
      }

      expect(getTaskInfo(id)).toBeUndefined();
      expect(registerTask(id, 'generate', '图像生成', 'user1').persistence)
        .toBe('memory');
    });

    it('reinitializes pending markers for a legacy HMR global store', () => {
      const store = (
        globalThis as unknown as Record<string, Record<string, unknown>>
      ).__wujie_task_store__;
      delete store.pendingDurableTaskMarkers;

      expect(getPendingDurableTaskMarkerCount()).toBe(0);
      markTaskDurable(uniqueId());
      expect(getPendingDurableTaskMarkerCount()).toBe(1);
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

    it('keeps the cancellation signal without announcing a terminal state', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成');
      updateTaskProgress(id, { status: 'processing', progress: 35 });
      cancelTask(id);
      const task = getTaskInfo(id);
      expect(task?.status).toBe('processing');
      expect(task?.progress).toBe(35);
      expect(isTaskCancelled(id)).toBe(true);
    });

    it('不存在的任务返回false', () => {
      expect(isTaskCancelled('non-existent')).toBe(false);
    });
  });

  describe('cancelTask', () => {
    it('records a cancellation request but waits for the database projection', () => {
      const id = uniqueId();
      registerTask(id, 'generate', '图像生成');
      updateTaskProgress(id, { status: 'processing' });
      const result = cancelTask(id);
      expect(result).toBe(true);
      const task = getTaskInfo(id);
      expect(task?.status).toBe('processing');

      updateTaskProgress(id, { status: 'cancelled', progress: 0 });
      expect(getTaskInfo(id)?.status).toBe('cancelled');
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

  describe('queue lifecycle', () => {
    it('resolves a queued waiter when stale task cleanup evicts the task', async () => {
      const userId = `cleanup-user-${uniqueId()}`;
      for (let index = 0; index < MAX_CONCURRENT_PER_USER; index += 1) {
        registerTask(uniqueId(), 'generate', '图像生成', userId);
      }
      const queuedId = uniqueId();
      registerTask(queuedId, 'generate', '图像生成', userId);

      const waiting = waitForQueueSlot(queuedId, 10_000);
      cleanupExpiredTasks(Date.now() + 2 * 60 * 60 * 1000 + 1);

      await expect(waiting).resolves.toBe(false);
      expect(getTaskInfo(queuedId)).toBeUndefined();
    });
  });
});
