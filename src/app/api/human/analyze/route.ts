import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { analyzeHumanImageUrl } from '@/lib/human-repair-service';
import { validateImageUrl } from '@/lib/input-validation';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json() as { imageId?: string; imageUrl?: string };
  const imageUrl = body.imageUrl || body.imageId;
  if (!imageUrl || validateImageUrl(imageUrl)) return NextResponse.json({ error: '需要有效的 imageUrl' }, { status: 400 });
  const analysis = await analyzeHumanImageUrl(body.imageId || imageUrl, imageUrl, request.headers.get('cookie') ?? undefined);
  return NextResponse.json({ success: true, ...analysis });
}
