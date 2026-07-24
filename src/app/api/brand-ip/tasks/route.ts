import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getTaskInfo } from '@/lib/task-registry';

export const runtime = 'nodejs';

function isAuthRejection(value: Awaited<ReturnType<typeof requireApiAuthOrReject>>): value is NextResponse {
  return value instanceof NextResponse;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (isAuthRejection(auth)) return auth;

  const taskId = request.nextUrl.searchParams.get('taskId')?.trim();
  if (!taskId) return NextResponse.json({ error: '缺少 taskId 参数' }, { status: 400 });

  const task = getTaskInfo(taskId);
  if (!task || (auth.userRole !== 'admin' && task.userId !== auth.userId)) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  return NextResponse.json({ success: true, task });
}
