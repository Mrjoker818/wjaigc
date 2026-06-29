import { NextRequest, NextResponse } from 'next/server';
import { findBackup, getDesktopAuth, tokenFromHeader } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const token = tokenFromHeader(request.headers.get('authorization'), request.nextUrl.searchParams.get('token') || '');
    const auth = await getDesktopAuth(token);
    if (!auth) return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
    const { id } = await context.params;
    const backup = await findBackup(id);
    if (!backup) return NextResponse.json({ success: false, error: 'Backup not found' }, { status: 404 });
    if (auth.user.role !== 'admin' && backup.userId !== auth.user.id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const buffer = Buffer.from(backup.fileData || '', 'base64');
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': backup.contentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${encodeURIComponent(backup.originalFilename || backup.filename)}"`,
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Backup download failed' }, { status: 500 });
  }
}
