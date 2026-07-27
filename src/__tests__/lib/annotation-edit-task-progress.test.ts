import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteEditTask,
  getEditTask,
  setEditTask,
  updateTaskStage,
} from '@/lib/edit-task-store';

describe('edit task stage progress', () => {
  const taskId = 'edit_progress_test';

  afterEach(() => {
    deleteEditTask(taskId);
  });

  it('advances processing progress monotonically and ignores stale stages', () => {
    setEditTask(taskId, {
      id: taskId,
      status: 'processing',
      progress: 5,
      stage: '正在校验批注',
      createdAt: Date.now(),
    });

    updateTaskStage(taskId, '正在准备图片和蒙版', 15);
    updateTaskStage(taskId, '模型正在处理', 45);
    updateTaskStage(taskId, '过期阶段', 30);

    expect(getEditTask(taskId)).toMatchObject({
      status: 'processing',
      progress: 45,
      stage: '模型正在处理',
    });
  });

  it('does not mutate a terminal task', () => {
    setEditTask(taskId, {
      id: taskId,
      status: 'completed',
      progress: 100,
      stage: '修改完成',
      createdAt: Date.now(),
    });

    updateTaskStage(taskId, '模型正在处理', 45);

    expect(getEditTask(taskId)).toMatchObject({
      status: 'completed',
      progress: 100,
      stage: '修改完成',
    });
  });
});
