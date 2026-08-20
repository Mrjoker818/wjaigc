import { NextRequest, NextResponse } from 'next/server';
import { listManagedUsers, requireAdminUser } from '@/lib/server-auth';
import { dbGetDashboardStats } from '@/lib/db-storage';
import { getApiProviders } from '@/lib/server-api-config';
import { projectDashboardMetrics } from '@/lib/admin-dashboard-projection';

export const dynamic = 'force-dynamic';

interface DashboardProviderView {
  name: string;
  selected_models?: string[];
  selectedModels?: string[];
  balance?: number | string | null;
  balanceCurrency?: string;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const period = request.nextUrl.searchParams.get('period') || '7';
    const [stats, managedUsers] = await Promise.all([
      dbGetDashboardStats(Number(period)),
      listManagedUsers(),
    ]);

    const providers = await getApiProviders();
    const providerViews = providers as DashboardProviderView[];
    const metrics = projectDashboardMetrics(stats);

    // Build alerts from providers with issues
    const alerts: Array<{ type: string; severity: string; items: Array<{ name: string; value: string }> }> = [];
    const lowBalance = providerViews.filter((p) => p.balance !== undefined && p.balance !== null && Number(p.balance) < 10);
    if (lowBalance.length > 0) {
      alerts.push({
        type: 'balance',
        severity: 'warning',
        items: lowBalance.map((p) => ({ name: p.name, value: `${p.balanceCurrency || '$'}${Number(p.balance).toFixed(2)}` })),
      });
    }

    const payload = {
      // User management is the authoritative user directory. The database
      // aggregate can lag behind it during user creation or cloud recovery.
      totalUsers: managedUsers.length,
      weekActive: stats.weekActive,
      totalCredits: stats.totalCredits,
      creditsRecharged: stats.creditsRecharged || 0,
      creditsConsumed: stats.creditsConsumed || 0,
      todayGenerations: stats.todayGenerations || 0,
      totalApiCalls: stats.totalApiCalls || 0,
      userTrend: stats.userTrend || [],
      creditTrend: stats.creditTrend || [],
      modelRank: metrics.modelRank,
      providerStatus: metrics.providerStatus,
      metricsCoverage: metrics.metricsCoverage,
      alerts: stats.alerts && stats.alerts.length > 0 ? stats.alerts : alerts,
      recentUsers: stats.recentUsers || [],
    };

    return NextResponse.json({
      success: true,
      ...payload,
      // dashboard-view still consumes the original nested response shape.
      stats: payload,
    });
  } catch (error) {
    console.error('[admin/dashboard-stats] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load dashboard stats' }, { status: 500 });
  }
}
