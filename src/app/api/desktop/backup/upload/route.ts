import { NextRequest, NextResponse } from 'next/server';
import { createBackup, getDesktopAuth, tokenFromHeader } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await getDesktopAuth(tokenFromHeader(request.headers.get('authorization')));
    if (!auth) return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
    const body = await request.json();
    const dataBase64 = String(body.dataBase64 || '');
    if (!dataBase64) return NextResponse.json({ success: false, error: 'dataBase64 is required' }, { status: 400 });
    const targetUserId = auth.user.role === 'admin' && body.userId ? String(body.userId) : auth.user.id;
    const backup = await createBackup({
      userId: targetUserId,
      deviceId: request.headers.get('x-wujie-device-id') || String(body.deviceId || ''),
      category: String(body.category || 'images'),
      filename: String(body.filename || 'backup.bin'),
      contentType: String(body.contentType || 'application/octet-stream'),
      dataBase64,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    });
    return NextResponse.json({ success: true, backup });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Backup upload failed' }, { status: 500 });
  }
}
