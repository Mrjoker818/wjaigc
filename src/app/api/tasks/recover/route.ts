import { NextRequest, NextResponse } from 'next/server';
import { listCloudTasks } from '@/lib/cloud-task-storage';
import { getSessionUser } from '@/lib/server-auth';
import { getTaskRecoveryBackoff } from '@/lib/task-core/task-abort';
import { projectPersistedCompletedTask } from '@/lib/cloud-task-persistence';

export const dynamic = 'force-dynamic';

function toRecoveryTask(task: Awaited<ReturnType<typeof listCloudTasks>>[number]) {
  const payload = task.result?.submissionPayload;
  const prompt = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).prompt
    : undefined;

  const recovery = getTaskRecoveryBackoff(task);
  const result = task.result;
  const safeResult = result ? {
    ...(typeof result.imageUrl === 'string' ? { imageUrl: result.imageUrl } : {}),
    ...(Array.isArray(result.imageUrls)
      ? { imageUrls: result.imageUrls.filter((value): value is string => typeof value === 'string') }
      : {}),
    ...(typeof result.videoUrl === 'string' ? { videoUrl: result.videoUrl } : {}),
    ...(typeof result.videoThumbnailUrl === 'string'
      ? { videoThumbnailUrl: result.videoThumbnailUrl }
      : {}),
    ...(result.assetProjection && typeof result.assetProjection === 'object'
      ? { assetProjection: result.assetProjection }
      : {}),
  } : undefined;
  return {
    id: task.id,
    projectId: task.projectId,
    type: task.type,
    status: task.status,
    providerId: task.providerId,
    model: task.model,
    progress: task.progress,
    label: task.label,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    prompt: typeof prompt === 'string' ? prompt : undefined,
    ...(safeResult && Object.keys(safeResult).length > 0 ? { result: safeResult } : {}),
    ...(typeof task.error === 'string' && task.error ? { error: task.error } : {}),
    recoveryAllowed: recovery.recoveryAllowed,
    retryAfterMs: recovery.retryAfterMs,
    nextRecoveryAt: recovery.nextRecoveryAt,
    recoveryReason: recovery.reason,
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
  await Promise.allSettled(projectTasks.map(async (task) => {
    const assetProjection = task.result?.assetProjection as Record<string, unknown> | undefined;
    if (task.status === 'completed' && assetProjection?.status === 'projection_pending') {
      await projectPersistedCompletedTask(task.id, user.id);
    }
  }));
  const legacyTasks = includeLegacyUnassigned
    ? allTasks.filter((task) => !task.projectId && (task.type === 'generate' || task.type === 'generate-async'))
    : [];
  const tasks = [...projectTasks, ...legacyTasks]
    .filter((task, index, entries) => entries.findIndex((candidate) => candidate.id === task.id) === index)
    .map(toRecoveryTask);

  const activeRetryDelays = tasks
    .filter((task) => ['queued', 'pending', 'processing'].includes(task.status))
    .map((task) => task.retryAfterMs)
    .filter((delay) => delay > 0);
  const retryAfterMs = activeRetryDelays.length > 0
    ? Math.min(...activeRetryDelays)
    : 3_000;
  const response = NextResponse.json({ success: true, tasks, retryAfterMs });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1_000))));
  return response;
}
