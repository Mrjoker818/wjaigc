import { NextRequest, NextResponse } from 'next/server';
import { getCloudTaskProviderSummary, listCloudTasks, type CloudTaskStatus } from '@/lib/cloud-task-storage';
import { requireAdminUser } from '@/lib/server-auth';
import { getApiProviders } from '@/lib/server-api-config';

const VALID_STATUSES = new Set<CloudTaskStatus>(['queued', 'pending', 'processing', 'completed', 'failed', 'cancelled', 'timeout']);

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { searchParams } = request.nextUrl;
  if (searchParams.get('view') === 'provider-summary') {
    const providers = await getCloudTaskProviderSummary();
    return NextResponse.json({ success: true, providers });
  }
  const statusValue = searchParams.get('status') || undefined;
  const limitValue = Number(searchParams.get('limit') || '100');
  const [tasks, providers] = await Promise.all([
    listCloudTasks({
    userId: searchParams.get('userId') || undefined,
    providerId: searchParams.get('providerId') || undefined,
    model: searchParams.get('model') || undefined,
    status: statusValue && VALID_STATUSES.has(statusValue as CloudTaskStatus) ? statusValue as CloudTaskStatus : undefined,
    limit: Number.isFinite(limitValue) ? limitValue : 100,
    }),
    getApiProviders(),
  ]);
  const providerNames = new Map(providers.map(provider => [provider.id, provider.displayName || provider.name || provider.id]));
  const enrichedTasks = tasks.map(task => ({
    ...task,
    providerName: task.providerId ? (providerNames.get(task.providerId) || task.providerId) : undefined,
  }));

  return NextResponse.json({ success: true, tasks: enrichedTasks });
}
