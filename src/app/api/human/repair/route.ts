import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/server-auth';
import { startHumanRepair } from '@/lib/human-repair-service';
import { validateImageUrl } from '@/lib/input-validation';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const sourceImageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  if (!sourceImageUrl || validateImageUrl(sourceImageUrl)) return NextResponse.json({ error: '需要有效的 imageUrl' }, { status: 400 });
  const task = await startHumanRepair({
    userId: user.id,
    sourceImageId: typeof body.imageId === 'string' ? body.imageId : sourceImageUrl,
    sourceImageUrl,
    targetIds: Array.isArray(body.targetIds) ? body.targetIds.filter((value): value is string => typeof value === 'string') : undefined,
    candidateCount: typeof body.candidateCount === 'number' ? body.candidateCount : undefined,
    options: typeof body.options === 'object' && body.options ? body.options as never : undefined,
    model: typeof body.model === 'string' ? body.model : undefined,
    providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
    mode: body.mode === 'mock' || body.mode === 'auto' || body.mode === 'gpt-image-edit' || body.mode === 'flux-edit' ? body.mode : 'auto',
    manualMaskImage: typeof body.manualMaskImage === 'string' ? body.manualMaskImage : undefined,
    requestCookie: request.headers.get('cookie') || undefined,
  });
  return NextResponse.json({ success: true, taskId: task.id, status: task.status, analysis: task.analysis });
}
