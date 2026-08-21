import { NextRequest, NextResponse } from 'next/server';
import { ensureCloudTaskTables } from '@/lib/cloud-task-storage';
import { getApiProviders } from '@/lib/server-api-config';
import { getProductionPaymentConfigurationIssues } from '@/lib/payment-config';
import { getProductionAuthConfigurationIssues, requireAdminUser } from '@/lib/server-auth';
import { getTaskEventTransportReadinessIssue } from '@/lib/task-event-transport';
import { collectAssetGraphReleaseReadiness } from '@/lib/asset-core/asset-release-readiness';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface ProviderReadiness {
  id: string;
  name: string;
  modelType: string;
  status: CheckStatus;
  issues: string[];
}

interface SecurityReadiness {
  status: CheckStatus;
  issues: string[];
}

function getSecurityReadiness(): SecurityReadiness {
  const issues = [
    ...getProductionAuthConfigurationIssues(),
    ...getProductionPaymentConfigurationIssues(),
  ];

  return { status: issues.length > 0 ? 'fail' : 'pass', issues };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }
  const assetGraph = await collectAssetGraphReleaseReadiness();

  let database: { status: CheckStatus; detail: string };
  try {
    await ensureCloudTaskTables();
    database = { status: 'pass', detail: 'Cloud task storage is available' };
  } catch (error) {
    database = {
      status: 'fail',
      detail: error instanceof Error ? `Cloud task storage unavailable: ${error.message}` : 'Cloud task storage unavailable',
    };
  }

  const providers = await getApiProviders();
  const readiness: ProviderReadiness[] = providers
    .filter(provider => provider.isEnabled !== false)
    .map(provider => {
      const issues: string[] = [];
      if (!provider.baseUrl?.trim()) issues.push('Missing base URL');
      if (!provider.apiKey?.trim()) issues.push('Missing API key');
      if (!provider.selectedModels?.length) issues.push('No selected model');
      const status: CheckStatus = issues.some(issue => issue !== 'No selected model')
        ? 'fail'
        : issues.length > 0
          ? 'warn'
          : 'pass';

      return {
        id: provider.id,
        name: provider.displayName || provider.name,
        modelType: provider.modelType || provider.type || 'unknown',
        status,
        issues,
      };
    });

  const summary = {
    total: providers.length,
    enabled: readiness.length,
    ready: readiness.filter(provider => provider.status === 'pass').length,
    warnings: readiness.filter(provider => provider.status === 'warn').length,
    failures: readiness.filter(provider => provider.status === 'fail').length,
  };
  const security = getSecurityReadiness();
  const taskEventIssue = getTaskEventTransportReadinessIssue();
  const taskEvents = taskEventIssue
    ? { status: 'warn' as const, issue: taskEventIssue }
    : { status: 'pass' as const, issue: null };

  return NextResponse.json({
    success: database.status !== 'fail' && security.status !== 'fail' && !assetGraph.blockingCurrentRelease,
    database,
    security,
    taskEvents,
    assetGraph,
    summary,
    providers: readiness,
  });
}
