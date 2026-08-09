import { NextRequest, NextResponse } from 'next/server';
import { getCloudTaskProviderSummary, listCloudTasks, type CloudTaskStatus } from '@/lib/cloud-task-storage';
import { requireAdminUser } from '@/lib/server-auth';
import { getApiProviders } from '@/lib/server-api-config';
import type { TaskEntryAudit } from '@/lib/task-core/entry-migration';

const VALID_STATUSES = new Set<CloudTaskStatus>(['queued', 'pending', 'processing', 'completed', 'failed', 'cancelled', 'timeout']);

function readTaskEntryAudit(result: Record<string, unknown> | undefined): Partial<TaskEntryAudit> {
  const audit = result?.taskEntryAudit;
  return audit && typeof audit === 'object' && !Array.isArray(audit)
    ? audit as Partial<TaskEntryAudit>
    : {};
}

function readTaskErrorSource(result: Record<string, unknown> | undefined): string | undefined {
  const taskError = result?.taskError;
  if (!taskError || typeof taskError !== 'object' || Array.isArray(taskError)) return undefined;
  const source = (taskError as Record<string, unknown>).source;
  return typeof source === 'string' && source.length > 0 ? source : undefined;
}

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
  const enrichedTasks = tasks.map(task => {
    const audit = readTaskEntryAudit(task.result);
    const actualProviderId = audit.actualProviderId || task.providerId;
    const actualModelId = audit.actualModelId || task.model;
    return {
      ...task,
      providerName: actualProviderId ? (providerNames.get(actualProviderId) || actualProviderId) : undefined,
      requestId: audit.requestId,
      handlerVersion: audit.handlerVersion || 'legacy',
      requestedProviderId: audit.requestedProviderId || task.providerId,
      requestedModelId: audit.requestedModelId || task.model,
      actualProviderId,
      actualModelId,
      durationMs: Math.max(0, task.updatedAt - task.createdAt),
      errorSource: readTaskErrorSource(task.result),
      billing: {
        status: task.creditStatus,
        cost: task.creditCost || 0,
        chargedTransactionId: task.chargedTransactionId || null,
        refundedTransactionId: task.refundedTransactionId || null,
      },
    };
  });

  return NextResponse.json({ success: true, tasks: enrichedTasks });
}
