import { NextRequest, NextResponse } from 'next/server';
import { getDesktopAuth, listBackups, tokenFromHeader } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await getDesktopAuth(tokenFromHeader(request.headers.get('authorization')));
    if (!auth) return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
    const userId = auth.user.role === 'admin' && request.nextUrl.searchParams.get('userId')
      ? String(request.nextUrl.searchParams.get('userId'))
      : auth.user.id;
    const backups = await listBackups({
      userId,
      category: request.nextUrl.searchParams.get('category') || undefined,
      limit: Number(request.nextUrl.searchParams.get('limit') || 100),
      admin: auth.user.role === 'admin',
    });
    return NextResponse.json({ success: true, backups });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Backup list failed', backups: [] }, { status: 500 });
  }
}
