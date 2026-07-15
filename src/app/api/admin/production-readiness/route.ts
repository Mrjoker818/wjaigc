import { NextRequest, NextResponse } from 'next/server';
import { ensureCloudTaskTables } from '@/lib/cloud-task-storage';
import { getApiProviders } from '@/lib/server-api-config';
import { requireAdminUser } from '@/lib/server-auth';

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
  if (process.env.COZE_PROJECT_ENV !== 'PROD') {
    return { status: 'pass', issues: [] };
  }

  const issues: string[] = [];
  const authSecret = process.env.WUJIE_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  const adminPassword = process.env.WUJIE_ADMIN_PASSWORD;

  if (!authSecret?.trim() || authSecret === 'change-me') {
    issues.push('Missing WUJIE_AUTH_SECRET or NEXTAUTH_SECRET');
  }
  if (!adminPassword?.trim() || adminPassword === 'change-me') {
    issues.push('Missing WUJIE_ADMIN_PASSWORD');
  }

  return { status: issues.length > 0 ? 'fail' : 'pass', issues };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

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

  return NextResponse.json({
    success: database.status !== 'fail' && security.status !== 'fail',
    database,
    security,
    summary,
    providers: readiness,
  });
}
