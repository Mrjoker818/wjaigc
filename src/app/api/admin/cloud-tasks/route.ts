import { NextRequest, NextResponse } from 'next/server';
import { listCloudTasks, type CloudTaskStatus } from '@/lib/cloud-task-storage';
import { requireAdminUser } from '@/lib/server-auth';

const VALID_STATUSES = new Set<CloudTaskStatus>(['queued', 'pending', 'processing', 'completed', 'failed', 'cancelled', 'timeout']);

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { searchParams } = request.nextUrl;
  const statusValue = searchParams.get('status') || undefined;
  const limitValue = Number(searchParams.get('limit') || '100');
  const tasks = await listCloudTasks({
    userId: searchParams.get('userId') || undefined,
    providerId: searchParams.get('providerId') || undefined,
    model: searchParams.get('model') || undefined,
    status: statusValue && VALID_STATUSES.has(statusValue as CloudTaskStatus) ? statusValue as CloudTaskStatus : undefined,
    limit: Number.isFinite(limitValue) ? limitValue : 100,
  });

  return NextResponse.json({ success: true, tasks });
}
