import { NextRequest, NextResponse } from 'next/server';
import { listCloudTasks } from '@/lib/cloud-task-storage';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/** Returns recent task state for the signed-in user and one canvas project. */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get('projectId')?.trim();
  if (!projectId) {
    return NextResponse.json({ success: false, error: 'Missing projectId.' }, { status: 400 });
  }

  const tasks = await listCloudTasks({ userId: user.id, projectId, limit: 100 });
  return NextResponse.json({ success: true, tasks });
}
