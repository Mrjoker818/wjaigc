import { NextRequest, NextResponse } from 'next/server';
import { listCloudTasks } from '@/lib/cloud-task-storage';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

function toRecoveryTask(task: Awaited<ReturnType<typeof listCloudTasks>>[number]) {
  const payload = task.result?.submissionPayload;
  const prompt = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).prompt
    : undefined;

  return {
    id: task.id,
    type: task.type,
    status: task.status,
    providerId: task.providerId,
    model: task.model,
    progress: task.progress,
    label: task.label,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    prompt: typeof prompt === 'string' ? prompt : undefined,
  };
}

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

  const includeLegacyUnassigned = request.nextUrl.searchParams.get('includeLegacyUnassigned') === '1';
  const allTasks = await listCloudTasks({ userId: user.id, limit: 100 });
  const projectTasks = allTasks.filter((task) => task.projectId === projectId);
  const legacyTasks = includeLegacyUnassigned
    ? allTasks.filter((task) => !task.projectId && (task.type === 'generate' || task.type === 'generate-async'))
    : [];
  const tasks = [...projectTasks, ...legacyTasks]
    .filter((task, index, entries) => entries.findIndex((candidate) => candidate.id === task.id) === index)
    .map(toRecoveryTask);

  return NextResponse.json({ success: true, tasks });
}
