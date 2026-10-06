import { NextRequest, NextResponse } from 'next/server';
import { parseOrdinaryGenerationOutputGroup } from '@/lib/task-core/ordinary-generation-output-group';
import { ordinaryTaskResponse } from '@/lib/task-core/ordinary-generation-task';
import { getCloudTaskForUserByIdempotencyKey, listCloudTasks } from '@/lib/cloud-task-storage';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getTaskRecoveryBackoff } from '@/lib/task-core/task-abort';
import { projectPersistedCompletedTask } from '@/lib/cloud-task-persistence';
import { hasPersistedCanvasPublicationIntent } from '@/lib/collaboration/task-result-publication';
import { isCoherentPublishedCpuRemoveBgResult } from '@/lib/collaboration/image-edit-publication-output';
import { authorizeGenerationProject, GenerationProjectAccessError,
  type GenerationProjectAccess } from '@/lib/collaboration/generation-project-access';

export const dynamic = 'force-dynamic';

function toRecoveryTask(task: Awaited<ReturnType<typeof listCloudTasks>>[number]) {
  const payload = task.result?.submissionPayload;
  const prompt = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).prompt
    : undefined;

  const recovery = getTaskRecoveryBackoff(task);
  const result = task.result;
  const outputGroup = parseOrdinaryGenerationOutputGroup(result?.outputGroup, task.id);
  let ordinary: Record<string, unknown> = {};
  if (outputGroup) {
    try {
      const safe = ordinaryTaskResponse(task).result as Record<string, unknown>;
      ordinary = Object.fromEntries(['providerName', 'routeAudit', 'enhancedPrompt', 'originalPrompt', 'alphaVerification', 'warning', 'nextAction']
        .filter(key => safe[key] !== undefined).map(key => [key, safe[key]]));
    } catch { /* A public marker alone cannot authorize descriptor-derived diagnostics. */ }
  }
  const safeResult = result ? {
    ...ordinary,
    ...(outputGroup ? { outputGroup } : {}),
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

function isDocumentInpaintTask(task: Awaited<ReturnType<typeof listCloudTasks>>[number]): boolean {
  const admission = task.result?.imageEditAdmission as Record<string, unknown> | undefined;
  return task.type === 'image-edit' && admission?.kind === 'ordinary-inpaint'
    && admission.documentSource === true;
}

function matchesDocumentInpaintGrant(
  task: Awaited<ReturnType<typeof listCloudTasks>>[number],
  access: GenerationProjectAccess | null,
): boolean {
  if (!isDocumentInpaintTask(task)) return true;
  if (access?.kind !== 'document') return false;
  const admission = task.result?.imageEditAdmission as Record<string, unknown>;
  return access.actorUserId === task.userId && access.projectId === task.projectId
    && access.ownerId === admission.documentOwnerId
    && access.grantGeneration === admission.documentGrantGeneration;
}

/** Returns recent task state for the signed-in user and one canvas project. */
export async function GET(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const projectId = request.nextUrl.searchParams.get('projectId')?.trim();
  // A missing row is inconclusive: the original paid request may still create it.
  // This branch never projects a result, settles credits, or issues a new task.
  if (request.nextUrl.searchParams.has('idempotencyKey')) {
    const idempotencyKey = request.nextUrl.searchParams.get('idempotencyKey')?.trim() || '';
    if (!idempotencyKey || idempotencyKey.length > 256) {
      return NextResponse.json({ success: false, error: 'Invalid idempotencyKey.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const task = await getCloudTaskForUserByIdempotencyKey(userId, idempotencyKey);
    const admission = task?.result?.imageEditAdmission as Record<string, unknown> | undefined;
    const quote = task?.result?.imageEditQuote as Record<string, unknown> | undefined;
    const upscaleFound = (task?.projectId || '') === (projectId || '') && task?.type === 'upscale'
      && admission?.route === '/api/image-edit' && admission.kind === 'requested-302-upscale'
      && quote?.confirmed === true && Number.isSafeInteger(quote.total)
      && Number.isSafeInteger(quote.upscale) && Number.isSafeInteger(quote.enhance)
      && (quote.total as number) >= 0 && (quote.upscale as number) >= 0
      && (quote.enhance as number) >= 0
      && (quote.upscale as number) + (quote.enhance as number) === quote.total;
    const removeBgComponents = quote?.components as Record<string, unknown> | undefined;
    const sourceVersionId = request.nextUrl.searchParams.get('sourceVersionId')?.trim();
    const removeBgFound = (task?.projectId || '') === (projectId || '')
      && task?.type === 'image-edit' && task.providerId === 'local-rembg'
      && admission?.kind === 'document-cpu-removebg' && quote?.confirmed === true
      && Boolean(sourceVersionId) && Array.isArray(admission.parentVersionIds)
      && admission.parentVersionIds.length === 1
      && admission.parentVersionIds[0] === sourceVersionId
      && Number.isSafeInteger(quote.total) && (quote.total as number) >= 0
      && Number.isSafeInteger(removeBgComponents?.removebg)
      && removeBgComponents?.removebg === quote.total;
    const assetProjection = task?.result?.assetProjection as Record<string, unknown> | undefined;
    const references = assetProjection?.references;
    const publication = task && removeBgFound && isCoherentPublishedCpuRemoveBgResult(task)
      && Array.isArray(references)
      ? { imageUrl: references[0].url, maskUrl: references[1].url, references } : null;
    return NextResponse.json(upscaleFound
      ? { success: true, found: true, taskId: task!.id, status: task!.status,
        quote: { total: quote!.total, components: { upscale: quote!.upscale, enhance: quote!.enhance } } }
      : removeBgFound
        ? { success: true, found: true, taskId: task!.id, status: task!.status,
          quote: { total: quote!.total, components: { removebg: removeBgComponents!.removebg } },
          assetProjectionStatus: typeof assetProjection?.status === 'string'
            ? assetProjection.status : 'pending', ...(publication ? { publication } : {}) }
      : { success: true, found: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (!projectId) {
    return NextResponse.json({ success: false, error: 'Missing projectId.' }, { status: 400 });
  }

  const includeLegacyUnassigned = request.nextUrl.searchParams.get('includeLegacyUnassigned') === '1';
  let allTasks = await listCloudTasks({ userId, limit: 100 });
  let documentInpaintAccess: GenerationProjectAccess | null = null;
  if (allTasks.some(task => task.projectId === projectId && isDocumentInpaintTask(task))) {
    try {
      documentInpaintAccess = await authorizeGenerationProject({ actorUserId: userId, projectId });
    } catch (error) {
      if (error instanceof GenerationProjectAccessError) {
        return NextResponse.json({ success: false, code: error.code }, { status: error.status });
      }
      return NextResponse.json({ success: false, code: 'GENERATION_PROJECT_UNAVAILABLE' }, { status: 503 });
    }
  }
  let projectTasks = allTasks.filter(task => task.projectId === projectId
    && matchesDocumentInpaintGrant(task, documentInpaintAccess));
  await Promise.allSettled(projectTasks.map(async (task) => {
    const assetProjection = task.result?.assetProjection as Record<string, unknown> | undefined;
    if (task.status === 'completed' && (assetProjection?.status === 'projection_pending'
      || (!assetProjection && await hasPersistedCanvasPublicationIntent(userId, task.id)))) {
      await projectPersistedCompletedTask(task.id, userId);
    }
  }));
  allTasks = await listCloudTasks({ userId, limit: 100 });
  projectTasks = allTasks.filter(task => task.projectId === projectId
    && matchesDocumentInpaintGrant(task, documentInpaintAccess));
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
