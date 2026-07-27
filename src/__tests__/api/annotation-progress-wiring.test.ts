import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const editRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/edit/route.ts'),
  'utf8',
);

describe('annotation edit progress wiring', () => {
  it('reports real execution boundaries before completion', () => {
    expect(editRouteSource).toMatch(
      /reportEditTaskProgress\(\s*taskId,\s*15,\s*'正在准备图片和蒙版'/,
    );
    expect(editRouteSource).toMatch(
      /reportEditTaskProgress\(\s*taskId,\s*30,\s*'正在提交模型'/,
    );
    expect(editRouteSource).toMatch(
      /reportEditTaskProgress\(\s*taskId,\s*45,\s*'模型正在处理'/,
    );
    expect(editRouteSource).toMatch(
      /reportEditTaskProgress\(\s*taskId,\s*90,\s*'正在保存结果'/,
    );
  });

  it('updates local, event-stream, and persisted task state together', () => {
    expect(editRouteSource).toContain('updateTaskStage(taskId, stage, progress)');
    expect(editRouteSource).toContain(
      "updateTaskProgress(taskId, { status: 'processing', progress, label: stage })",
    );
    expect(editRouteSource).toContain(
      "await updateCloudTask(taskId, { status: 'processing', progress, label: stage })",
    );
  });
});
