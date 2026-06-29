import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { findBackup } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });

  const { id } = await context.params;
  const backup = await findBackup(id);
  if (!backup) return NextResponse.json({ success: false, error: 'Backup not found' }, { status: 404 });

  const buffer = Buffer.from(backup.fileData, 'base64');
  const filename = encodeURIComponent(backup.originalFilename || backup.filename || `${backup.id}.backup`);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': backup.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'Content-Length': String(buffer.length),
    },
  });
}
