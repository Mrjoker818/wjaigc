import 'server-only';

import { nanoid } from 'nanoid';

import type { BrandIpDirection, BrandIpProject } from '@/lib/brand-ip';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';

export interface CreateBrandIpGenerationTaskInput {
  userId: string;
  project: BrandIpProject;
  direction: BrandIpDirection;
  prompt: string;
}

export interface BrandIpGenerationTask {
  taskId: string;
  status: 'pending' | 'queued';
}

export async function createBrandIpGenerationTask(input: CreateBrandIpGenerationTaskInput): Promise<BrandIpGenerationTask> {
  const taskId = `brand-ip-${nanoid(16)}`;
  const task = registerTask(taskId, 'brand-generate', '正在生成品牌 IP 视觉资产', input.userId);
  updateTaskProgress(taskId, {
    status: task.status === 'queued' ? 'queued' : 'pending',
    progress: 0,
    result: {
      projectId: input.project.id,
      directionId: input.direction.id,
      prompt: input.prompt,
    },
  });

  return { taskId, status: task.status === 'queued' ? 'queued' : 'pending' };
}
