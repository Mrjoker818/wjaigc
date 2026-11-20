/** Owner-scoped original receipt lookup for persisted drama video takes and image operations. */
import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getCloudTaskForUserByIdempotencyKey, listCloudTasks } from '@/lib/cloud-task-storage';
import { videoForbidden } from '@/lib/drama/access';
import { uncertainDramaSubmission } from '@/lib/drama/receipt-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No trimming, colon separators, paths or normalization: these identities must round-trip exactly.
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const safeModel = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 256 && !/[\s\u0000-\u001f\u007f]/u.test(value);
const reply = (data: Record<string, unknown>, status = 200) => NextResponse.json(data, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});

function mediaUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384
    && (/^\/(?!\/)/u.test(value) || /^https?:\/\//u.test(value));
}

/** Only media fields leave this route. In particular, result.submissionPayload never does. */
function mappedResult(result: Record<string, unknown> | undefined, kind: 'image' | 'video'): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  if (!result) return mapped;
  const fields = kind === 'image' ? ['imageUrl'] : ['videoUrl', 'videoThumbnailUrl', 'thumbnailUrl'];
  for (const field of fields) if (mediaUrl(result[field])) mapped[field] = result[field];
  if (kind === 'image' && Array.isArray(result.imageUrls)) {
    mapped.imageUrls = result.imageUrls.filter(mediaUrl);
  }
  return mapped;
}

/** Lookup only. Never submit generation, change billing, or fall back to a skill child key. */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const denied = videoForbidden(auth.user);
  if (denied) return denied;
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return reply({ code: 'DRAMA_RECEIPT_INVALID_IDENTITY', error: '原任务标识无效' }, 400);
  }
  const body = raw as Record<string, unknown>;
  const kind = body.kind === 'image' ? 'image' : 'video';
  if ((body.kind !== undefined && body.kind !== 'video' && body.kind !== 'image')
    || !safeId(body.providerId) || !safeModel(body.modelId)
    || (kind === 'image' ? !safeId(body.operationId) : !safeId(body.shotId) || !safeId(body.takeId))) {
    return reply({ code: 'DRAMA_RECEIPT_INVALID_IDENTITY', error: '原任务标识无效' }, 400);
  }
  const key = kind === 'image' ? `drama:image:${body.operationId}` : `drama:${body.shotId}:${body.takeId}`;
  try {
    let task = await getCloudTaskForUserByIdempotencyKey(auth.userId, key);
    const messageId = String(kind === 'image' ? body.operationId : body.takeId);
    const sessionId = kind === 'image' ? `drama-image:${messageId}` : `drama-take:${body.shotId}:${messageId}`;
    if (!task) {
      // Legacy task entry already persists these exact source identities in every submission path.
      // Query only this owner and operation; never choose an arbitrary recent or same-named task.
      const candidates = await listCloudTasks({ userId: auth.userId, sessionId, messageId, providerId: String(body.providerId), limit: 3 });
      const exact = candidates.filter(item => item.userId === auth.userId && item.sessionId === sessionId && item.messageId === messageId && item.providerId === body.providerId
        && (item.model === body.modelId || item.model === `${body.providerId}::${body.modelId}`) && (kind === 'video' ? item.type === 'video' : ['generate', 'generate-async', 'image'].includes(item.type)));
      if (exact.length > 1) return reply({ code: 'DRAMA_RECEIPT_AMBIGUOUS', error: '原任务存在多条回执，请在任务列表核对' }, 409);
      task = exact[0] ?? null;
    }
    if (!task) return reply({ status: 'pending', code: 'DRAMA_RECEIPT_PENDING', error: '尚未查到原任务回执，请稍后恢复查询，勿重复提交。' }, 202);
    if (task.userId !== auth.userId || (kind === 'video' ? task.type !== 'video' : !['generate', 'generate-async', 'image'].includes(task.type)) || task.providerId !== body.providerId || (task.model !== body.modelId && task.model !== `${body.providerId}::${body.modelId}`)) {
      return reply({ status: 'pending', code: 'DRAMA_RECEIPT_MISMATCH', error: '原任务身份不匹配，无法恢复此回执。' }, 409);
    }
    return reply({ taskId: task.id, status: uncertainDramaSubmission(task.error) ? 'pending' : task.status, creditStatus: task.creditStatus,
      ...(task.status === 'completed' ? { result: mappedResult(task.result, kind) } : {}),
    });
  } catch {
    return reply({ status: 'pending', code: 'DRAMA_RECEIPT_UNAVAILABLE', error: '原任务回执暂不可查询，请稍后恢复查询。' }, 503);
  }
}
