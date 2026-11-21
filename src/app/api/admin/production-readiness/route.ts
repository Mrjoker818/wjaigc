import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
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

interface RuntimeDatabaseIdentity {
  source: 'application-runtime'; readOnly: true; observedAt: string;
  role: string; sessionRole: string; schema: string | null; bypassRls: boolean; superuser: boolean;
  databaseNameSha256: string | null; serverAddressSha256: string | null; serverVersionSha256: string | null;
}

/** This opt-in diagnostic observes the application's actual pool, not a platform SQL tool. */
async function readRuntimeDatabaseIdentity(): Promise<RuntimeDatabaseIdentity> {
  const { getPool } = await import('@/lib/db-client');
  const client = await getPool().connect();
  let discard = false;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '2000ms'");
    const result = await client.query<{
      role: string; session_role: string; schema: string | null; database_name: string;
      server_address: string | null; server_version: string; bypass_rls: boolean; superuser: boolean;
    }>(`/* wujie_admin_runtime_database_identity_v1 */
      SELECT current_user::text AS role, session_user::text AS session_role,
        current_schema() AS schema, current_database() AS database_name,
        inet_server_addr()::text AS server_address,
        current_setting('server_version') AS server_version,
        rolbypassrls AS bypass_rls, rolsuper AS superuser
      FROM pg_catalog.pg_roles WHERE rolname = current_user`);
    const row = result.rows[0];
    if (!row) throw new Error('DATABASE_IDENTITY_UNAVAILABLE');
    const sha = (value: string | null): string | null => value === null ? null : createHash('sha256').update(value).digest('hex');
    return {
      source: 'application-runtime', readOnly: true, observedAt: new Date().toISOString(),
      role: row.role, sessionRole: row.session_role, schema: row.schema,
      bypassRls: row.bypass_rls, superuser: row.superuser,
      databaseNameSha256: sha(row.database_name), serverAddressSha256: sha(row.server_address),
      serverVersionSha256: sha(row.server_version),
    };
  } finally {
    try { await client.query('ROLLBACK'); }
    catch { discard = true; throw new Error('DATABASE_IDENTITY_UNAVAILABLE'); }
    finally { client.release(discard); }
  }
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
  // Keep this branch before collectors: the ordinary readiness path can ensure
  // tables, while identity diagnosis must never initialize or migrate schema.
  if (request.nextUrl.searchParams.has('diagnostics')) {
    const modes = request.nextUrl.searchParams.getAll('diagnostics');
    if (modes.length !== 1 || modes[0] !== 'database-identity') {
      return NextResponse.json({ success: false, code: 'UNKNOWN_READINESS_DIAGNOSTIC' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    try {
      return NextResponse.json({ success: true, identity: await readRuntimeDatabaseIdentity() },
        { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json({ success: false, code: 'DATABASE_IDENTITY_UNAVAILABLE' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
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
