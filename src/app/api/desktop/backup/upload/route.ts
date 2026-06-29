import { NextRequest, NextResponse } from 'next/server';
import { createBackup, getDesktopAuth, tokenFromHeader, SIZE_LIMITS } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

// Next.js 默认 body 大小限制为 100MB，这里我们显式收紧（base64≈66MB，对应二进制 50MB）
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await getDesktopAuth(tokenFromHeader(request.headers.get('authorization')));
    if (!auth) return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
    const contentLength = request.headers.get('content-length');
    if (contentLength) {
      const len = Number(contentLength);
      // 请求体大小上限：base64字符串 + JSON 开销 ≈ 70MB
      const MAX_REQ = SIZE_LIMITS.BACKUP_BASE64_LEN + 4 * 1024;
      if (!Number.isFinite(len) || len > MAX_REQ) {
        return NextResponse.json({ success: false, error: `请求体过大（上限 ${Math.round(SIZE_LIMITS.BACKUP_BYTES / 1024 / 1024)}MB）` }, { status: 413 });
      }
    }
    const body = await request.json();
    const dataBase64 = String(body.dataBase64 || '');
    if (!dataBase64) return NextResponse.json({ success: false, error: 'dataBase64 不能为空' }, { status: 400 });
    // data URL 前缀去除后的 base64 长度快速检查
    const pureB64 = dataBase64.replace(/^data:[^;]+;base64,/, '');
    if (pureB64.length > SIZE_LIMITS.BACKUP_BASE64_LEN) {
      return NextResponse.json({ success: false, error: `备份文件过大（上限 ${Math.round(SIZE_LIMITS.BACKUP_BYTES / 1024 / 1024)}MB）` }, { status: 413 });
    }
    const category = String(body.category || 'images');
    const allowedCategories = ['images', 'projects', 'models', 'prompts', 'settings', 'fonts', 'plugins', 'workflows', 'system'];
    if (!allowedCategories.includes(category)) {
      return NextResponse.json({ success: false, error: '不支持的备份类型' }, { status: 400 });
    }
    const targetUserId = auth.user.role === 'admin' && body.userId ? String(body.userId) : auth.user.id;
    const backup = await createBackup({
      userId: targetUserId,
      deviceId: request.headers.get('x-wujie-device-id') || String(body.deviceId || ''),
      category,
      filename: String(body.filename || 'backup.bin'),
      contentType: String(body.contentType || 'application/octet-stream'),
      dataBase64: pureB64,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    });
    return NextResponse.json({ success: true, backup });
  } catch (error) {
    // 安全错误响应：业务错误直接透传消息，系统错误统一返回友好文案
    const msg = error instanceof Error ? error.message : String(error);
    const isBusinessError = /过大|不能为空|不支持|上限/.test(msg);
    return NextResponse.json(
      { success: false, error: isBusinessError ? msg : '备份上传失败，请重试' },
      { status: isBusinessError ? 400 : 500 }
    );
  }
}
