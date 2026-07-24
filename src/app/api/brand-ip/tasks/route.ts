import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getTaskInfo } from '@/lib/task-registry';
import { getBrandIpProject } from '@/lib/brand-ip-storage';
import { getCloudTaskById, getCloudTaskForUser, listCloudTasks, type CloudTask } from '@/lib/cloud-task-storage';

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
  const projectId = request.nextUrl.searchParams.get('projectId')?.trim();

  if (projectId) {
    // Project recovery is always scoped to the caller. Admins may inspect a
    // project only after the same ownership check, avoiding a task enumeration path.
    const project = await getBrandIpProject(projectId, auth.userId);
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    const tasks = (await listCloudTasks({ userId: auth.userId, projectId, limit: 50 }))
      .filter((task) => task.type === 'brand-generate')
      .filter((task) => ['queued', 'pending', 'processing'].includes(task.status))
      .map(toTaskResponse);

    return NextResponse.json({ success: true, tasks, source: 'persistent' });
  }

  if (!taskId) return NextResponse.json({ error: '缺少 taskId 或 projectId 参数' }, { status: 400 });

  const memoryTask = getTaskInfo(taskId);
  if (memoryTask) {
    if (auth.userRole !== 'admin' && memoryTask.userId !== auth.userId) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }
    if (memoryTask.type !== 'brand-generate') {
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
