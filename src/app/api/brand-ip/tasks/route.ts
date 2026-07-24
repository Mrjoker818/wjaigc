import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getTaskInfo } from '@/lib/task-registry';
import { getCloudTaskById, getCloudTaskForUser, type CloudTask } from '@/lib/cloud-task-storage';

export const runtime = 'nodejs';

function isAuthRejection(value: Awaited<ReturnType<typeof requireApiAuthOrReject>>): value is NextResponse {
  return value instanceof NextResponse;
}

function toTaskResponse(task: CloudTask) {
  return {
    taskId: task.id,
    type: task.type,
    status: task.status,
    progress: task.progress,
    label: task.label,
    result: task.result,
    error: task.error,
    userId: task.userId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (isAuthRejection(auth)) return auth;

  const taskId = request.nextUrl.searchParams.get('taskId')?.trim();
  if (!taskId) return NextResponse.json({ error: '缺少 taskId 参数' }, { status: 400 });

  const memoryTask = getTaskInfo(taskId);
  if (memoryTask) {
    if (auth.userRole !== 'admin' && memoryTask.userId !== auth.userId) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true, task: memoryTask, source: 'memory' });
  }

  const cloudTask = auth.userRole === 'admin'
    ? await getCloudTaskById(taskId)
    : await getCloudTaskForUser(taskId, auth.userId);

  if (!cloudTask || cloudTask.type !== 'brand-generate') {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  return NextResponse.json({ success: true, task: toTaskResponse(cloudTask), source: 'persistent' });
}
