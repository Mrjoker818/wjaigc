import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/server-auth';
import { startHumanRepair } from '@/lib/human-repair-service';
import { validateImageUrl } from '@/lib/input-validation';
import { findProviderById } from '@/lib/server-api-config';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const sourceImageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!sourceImageUrl || validateImageUrl(sourceImageUrl)) return NextResponse.json({ error: '需要有效的 imageUrl' }, { status: 400 });
  if (!providerId || !model) return NextResponse.json({ error: '请选择已授权的图像编辑模型' }, { status: 400 });
  if (body.mode === 'mock') return NextResponse.json({ error: '人物精修不支持 Mock 模式' }, { status: 400 });
  const provider = await findProviderById(providerId);
  if (!provider || !(provider.selectedModels || []).includes(model)) {
    return NextResponse.json({ error: '所选模型未授权或已停用' }, { status: 403 });
  }
  const task = await startHumanRepair({
    userId: user.id,
    sourceImageId: typeof body.imageId === 'string' ? body.imageId : sourceImageUrl,
    sourceImageUrl,
    targetIds: Array.isArray(body.targetIds) ? body.targetIds.filter((value): value is string => typeof value === 'string') : undefined,
    candidateCount: typeof body.candidateCount === 'number' ? body.candidateCount : undefined,
    options: typeof body.options === 'object' && body.options ? body.options as never : undefined,
    model,
    providerId,
    mode: body.mode === 'gpt-image-edit' || body.mode === 'flux-edit' ? body.mode : 'auto',
    manualMaskImage: typeof body.manualMaskImage === 'string' ? body.manualMaskImage : undefined,
  });
  return NextResponse.json({ success: true, taskId: task.id, status: task.status, analysis: task.analysis });
}
