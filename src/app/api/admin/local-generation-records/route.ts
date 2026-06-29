import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { listGenerationRecords } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  const records = await listGenerationRecords({
    userId: request.nextUrl.searchParams.get('userId') || undefined,
    limit: Number(request.nextUrl.searchParams.get('limit') || 200),
  });
  return NextResponse.json({ success: true, records });
}
