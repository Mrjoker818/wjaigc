import { NextRequest, NextResponse } from 'next/server';

import { listCloudTasks } from '@/lib/cloud-task-storage';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const PENDING_STATUSES = new Set(['queued', 'pending', 'processing']);

export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser?.id) {
    return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get('projectId') || '';
  const sessionId = request.nextUrl.searchParams.get('sessionId') || '';
  if (!projectId || !sessionId) {
    return NextResponse.json({ success: false, error: 'projectId and sessionId are required' }, { status: 400 });
  }

  const tasks = await listCloudTasks({
    userId: sessionUser.id,
    projectId,
    sessionId,
    limit: 100,
  });
  const pendingTasks = tasks
    .filter(task => PENDING_STATUSES.has(task.status))
    .map(task => ({
      id: task.id,
      messageId: task.messageId,
      type: task.type,
      status: task.status,
      providerId: task.providerId,
      model: task.model,
      progress: task.progress,
      label: task.label,
      updatedAt: task.updatedAt,
    }));

  return NextResponse.json({ success: true, tasks: pendingTasks });
}
