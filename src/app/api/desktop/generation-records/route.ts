import { NextRequest, NextResponse } from 'next/server';
import { addGenerationRecord, getDesktopAuth, tokenFromHeader } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await getDesktopAuth(tokenFromHeader(request.headers.get('authorization')));
    if (!auth) return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
    const body = await request.json();
    const id = await addGenerationRecord({
      userId: auth.user.id,
      deviceId: request.headers.get('x-wujie-device-id') || String(body.deviceId || ''),
      thumbnailUrl: String(body.thumbnailUrl || body.thumbnail || ''),
      prompt: String(body.prompt || ''),
      negativePrompt: String(body.negativePrompt || body.negative_prompt || ''),
      model: String(body.model || ''),
      providerId: String(body.providerId || body.provider_id || ''),
      providerName: String(body.providerName || body.provider_name || ''),
      params: body.params && typeof body.params === 'object' ? body.params : {},
      source: String(body.source || 'generated'),
      createdAt: Number(body.createdAt || Date.now()),
    });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Generation record failed' }, { status: 500 });
  }
}
