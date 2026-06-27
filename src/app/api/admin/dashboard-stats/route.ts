import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { dbGetDashboardStats } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const stats = await dbGetDashboardStats();
    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error('[admin/dashboard-stats] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load dashboard stats' }, { status: 500 });
  }
}
