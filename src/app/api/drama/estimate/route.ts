import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { calculateConfiguredCreditCost } from '@/lib/credits';
import { loadCreditPricingConfig } from '@/lib/credit-pricing';
import { dbGetCredits } from '@/lib/db-storage';
import { MAX_SHOTS_PER_EPISODE } from '@/lib/drama/types';

export const dynamic = 'force-dynamic';

interface ShotEstimateInput {
  shotId: string;
  modelId: string;
  providerId?: string;
  durationSec: number;
  generateAudio: boolean;
  referenceImages: number;
}

function readShot(value: unknown): ShotEstimateInput | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const shotId = typeof item.shotId === 'string' ? item.shotId.slice(0, 128) : '';
  const rawModel = typeof item.modelId === 'string' ? item.modelId.trim() : '';
  // The panel sends `providerId::modelId`; pricing is keyed by the bare model id plus provider.
  const [prefixProvider, bareModel] = rawModel.includes('::') ? rawModel.split('::', 2) : ['', rawModel];
  const providerId = typeof item.providerId === 'string' && item.providerId ? item.providerId : prefixProvider || undefined;
  const durationSec = Number(item.durationSec);
  if (!shotId || !bareModel || !Number.isFinite(durationSec)) return null;
  return {
    shotId, modelId: bareModel, ...(providerId ? { providerId } : {}),
    durationSec: Math.max(1, Math.min(60, Math.round(durationSec))),
    generateAudio: item.generateAudio === true,
    referenceImages: Math.max(0, Math.min(10, Math.floor(Number(item.referenceImages) || 0))),
  };
}

/**
 * POST /api/drama/estimate { shots: [{ shotId, modelId, providerId?, durationSec, generateAudio?, referenceImages? }] }
 * → { total, perShot: { [shotId]: credits }, balance }
 * Uses the same pricing as /api/video/generate; the charge itself still happens at submission.
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { shots?: unknown } | null;
  if (!body || !Array.isArray(body.shots) || body.shots.length > MAX_SHOTS_PER_EPISODE) {
    return NextResponse.json({ error: `一次最多估算 ${MAX_SHOTS_PER_EPISODE} 个镜头` }, { status: 400 });
  }
  const shots = body.shots.map(readShot);
  if (shots.some(shot => !shot)) return NextResponse.json({ error: '镜头参数不完整，请先为每个镜头选择模型' }, { status: 400 });
  try {
    const pricingConfig = await loadCreditPricingConfig();
    const perShot: Record<string, number> = {};
    for (const shot of shots as ShotEstimateInput[]) {
      perShot[shot.shotId] = await calculateConfiguredCreditCost('video_generate', shot.modelId, {
        durationSeconds: shot.durationSec, audio: shot.generateAudio, inputImages: shot.referenceImages,
        ...(shot.providerId ? { providerId: shot.providerId } : {}), pricingConfig,
      });
    }
    const credits = await dbGetCredits(auth.userId, { throwOnError: true });
    return NextResponse.json({
      success: true,
      total: Object.values(perShot).reduce((sum, value) => sum + value, 0),
      perShot,
      balance: credits?.balance ?? 0,
    });
  } catch (error) {
    console.error({ code: 'DRAMA_ESTIMATE_FAILED', error });
    return NextResponse.json({ error: '积分估算失败，生成时仍按实际价格扣费' }, { status: 500 });
  }
}
