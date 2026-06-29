import { NextRequest, NextResponse } from 'next/server';
import { addGenerationRecord, getDesktopAuth, tokenFromHeader } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

function safeError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const auth = await getDesktopAuth(tokenFromHeader(request.headers.get('authorization')));
    if (!auth) return safeError('Authorization required', 401);

    const text = await request.text();
    if (text && text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return safeError('请求参数格式错误');
      }
    }

    // content-length 预检：缩略图 base64 不应过大
    const contentLength = request.headers.get('content-length');
    const MAX_REQ = 2 * 1024 * 1024; // 2MB 请求体上限
    if (contentLength) {
      const len = Number(contentLength);
      if (Number.isFinite(len) && len > MAX_REQ) {
        return safeError('请求体过大（缩略图建议压缩到 1MB 以内）', 413);
      }
    }

    const id = await addGenerationRecord({
      userId: auth.user.id,
      deviceId: request.headers.get('x-wujie-device-id') || (typeof body.deviceId === 'string' ? body.deviceId : ''),
      thumbnailUrl: typeof body.thumbnailUrl === 'string'
        ? body.thumbnailUrl
        : (typeof body.thumbnail === 'string' ? body.thumbnail : ''),
      prompt: typeof body.prompt === 'string' ? body.prompt : '',
      negativePrompt: typeof body.negativePrompt === 'string'
        ? body.negativePrompt
        : (typeof body.negative_prompt === 'string' ? body.negative_prompt : ''),
      model: typeof body.model === 'string' ? body.model : '',
      providerId: typeof body.providerId === 'string'
        ? body.providerId
        : (typeof body.provider_id === 'string' ? body.provider_id : ''),
      providerName: typeof body.providerName === 'string'
        ? body.providerName
        : (typeof body.provider_name === 'string' ? body.provider_name : ''),
      params: body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params as Record<string, unknown> : {},
      source: typeof body.source === 'string' ? body.source : 'generated',
      createdAt: Number(body.createdAt) || Date.now(),
    });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isBusiness = /过大|过长|上限|不能为空|参数格式|Authorization/.test(msg);
    return NextResponse.json(
      { success: false, error: isBusiness ? msg : '生成记录上报失败，请重试' },
      { status: isBusiness ? 400 : 500 }
    );
  }
}
