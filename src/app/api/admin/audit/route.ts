import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { dbAddAuditLog, dbGetAuditLogs, dbGetAuditStats } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || undefined;
    const userId = searchParams.get('userId') || undefined;
    const startTime = searchParams.get('startTime') ? Number(searchParams.get('startTime')) : undefined;
    const endTime = searchParams.get('endTime') ? Number(searchParams.get('endTime')) : undefined;
    const limit = Math.min(Number(searchParams.get('limit') || '50'), 200);
    const offset = Number(searchParams.get('offset') || '0');
    const statsOnly = searchParams.get('stats') === 'true';

    if (statsOnly) {
      const stats = await dbGetAuditStats();
      return NextResponse.json({ success: true, stats });
    }

    const result = await dbGetAuditLogs({ action, userId, startTime, endTime, limit, offset });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[admin/audit] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load audit logs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json() as {
      action: string;
      targetType?: string;
      targetId?: string;
      detail?: string;
    };

    const id = await dbAddAuditLog({
      user_id: admin.id,
      user_name: admin.name,
      action: body.action,
      target_type: body.targetType || null,
      target_id: body.targetId || null,
      detail: body.detail || null,
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
      created_at: Date.now(),
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[admin/audit] POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to add audit log' }, { status: 500 });
  }
}
