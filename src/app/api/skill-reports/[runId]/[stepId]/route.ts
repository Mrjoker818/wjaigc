import { createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { listAgentRunEvents } from '@/lib/agent-runtime/service';
import { parseWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { createPostgresAssetStorage } from '@/lib/asset-core/storage';
import { getCloudTaskForUser } from '@/lib/cloud-task-storage';
import {
  COMPLIANCE_REPORT_SCHEMA_ID,
  complianceReportLineageMatches,
  renderComplianceReportHtml,
  reportDownloadUrl,
} from '@/lib/platform-compliance/report-asset';
import {
  canonicalComplianceReportJson,
  parsePlatformComplianceReport,
} from '@/lib/platform-compliance/report-schema';
import { getSessionUser } from '@/lib/server-auth';

interface RouteContext {
  params: Promise<{ runId: string; stepId: string }>;
}

type ReportFormat = 'json' | 'html';

function notFound(): NextResponse {
  return NextResponse.json({ error: 'REPORT_NOT_FOUND' }, { status: 404 });
}

function decodeStepId(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded
      && decoded.length <= 256
      && !/[\\/\u0000-\u001f\u007f]/u.test(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  if (value.some(item => typeof item !== 'string' || !item || item.length > 256)) return null;
  const strings = value as string[];
  return new Set(strings).size === strings.length ? strings : null;
}

function downloadHeaders(format: ReportFormat): HeadersInit {
  return {
    'Content-Type': format === 'json'
      ? 'application/json; charset=utf-8'
      : 'text/html; charset=utf-8',
    'Content-Disposition': `attachment; filename="platform-compliance-report.${format}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const { runId, stepId: encodedStepId } = await context.params;
  const stepId = decodeStepId(encodedStepId);
  const projectId = request.nextUrl.searchParams.get('projectId')?.trim() ?? '';
  const checksum = request.nextUrl.searchParams.get('checksum')?.trim() ?? '';
  const formatValue = request.nextUrl.searchParams.get('format') ?? 'json';
  if (
    !projectId
    || !runId
    || !stepId
    || !/^[a-f0-9]{64}$/u.test(checksum)
    || (formatValue !== 'json' && formatValue !== 'html')
  ) {
    return NextResponse.json({ error: 'REPORT_REQUEST_INVALID' }, { status: 400 });
  }
  const format = formatValue as ReportFormat;

  const task = await getCloudTaskForUser(runId, sessionUser.id);
  if (!task || task.type !== 'agent-run' || task.projectId !== projectId) return notFound();
  const events = await listAgentRunEvents({ actorUserId: sessionUser.id, runId });
  const created = events.find(event => event.type === 'run.created');
  const runSourceVersionIds = stringArray(created?.payload.sourceVersionIds);
  const skillSnapshot = created?.payload.skillSnapshot;
  if (
    !runSourceVersionIds
    || !skillSnapshot
    || typeof skillSnapshot !== 'object'
    || Array.isArray(skillSnapshot)
  ) return notFound();
  const skill = skillSnapshot as Record<string, unknown>;
  if (
    skill.id !== 'preset-platform-compliance-audit'
    || !Number.isSafeInteger(skill.version)
    || Number(skill.version) < 1
  ) return notFound();
  const reportVersionIds = [...new Set(events.flatMap(event => (
    event.type === 'asset.created'
      && event.payload.stepId === stepId
      && typeof event.payload.assetVersionId === 'string'
      ? [event.payload.assetVersionId]
      : []
  )))];
  if (reportVersionIds.length === 0) return notFound();

  const reportContent = await createPostgresAssetStorage().read(async transaction => {
    if (!await transaction.findProject(sessionUser.id, projectId)) return null;
    for (const versionId of reportVersionIds) {
      const version = await transaction.findVersion(sessionUser.id, projectId, versionId);
      if (!version) continue;
      const asset = await transaction.findAsset(sessionUser.id, projectId, version.assetId);
      if (!asset || asset.kind !== 'document' || asset.status !== 'active') continue;
      const metadata = version.metadata;
      const sourceVersionIds = stringArray(metadata?.sourceVersionIds);
      const sourceTrace = parseWorkspaceSourceTrace(metadata?.sourceTrace);
      const content = metadata?.reportContent;
      if (
        version.file.availability !== 'ready'
        || version.file.mimeType !== 'application/json'
        || version.file.checksum !== checksum
        || metadata?.schemaId !== COMPLIANCE_REPORT_SCHEMA_ID
        || typeof content !== 'string'
        || !sourceVersionIds
        || !complianceReportLineageMatches(version.parentVersionIds, sourceVersionIds)
        || sourceVersionIds.some(sourceVersionId => !runSourceVersionIds.includes(sourceVersionId))
        || sourceTrace?.source !== 'canvas-skill'
        || sourceTrace.runId !== runId
        || sourceTrace.skillId !== skill.id
        || sourceTrace.skillVersion !== skill.version
        || !sameStrings(sourceTrace.sourceVersionIds, sourceVersionIds)
      ) continue;
      const sourceVersions = await Promise.all(sourceVersionIds.map(sourceVersionId => (
        transaction.findVersion(sessionUser.id, projectId, sourceVersionId)
      )));
      if (sourceVersions.some(sourceVersion => sourceVersion === null)) continue;
      let canonical: string;
      try {
        const report = parsePlatformComplianceReport(JSON.parse(content) as unknown);
        canonical = canonicalComplianceReportJson(report);
        if (
          canonical !== content
          || report.runId !== runId
          || !sourceVersionIds.includes(report.sourceVersionId)
        ) continue;
      } catch {
        continue;
      }
      const actualChecksum = createHash('sha256').update(canonical).digest('hex');
      if (
        actualChecksum !== checksum
        || version.file.byteSize !== Buffer.byteLength(canonical)
        || version.file.url !== reportDownloadUrl(runId, stepId, checksum, projectId)
      ) continue;
      return canonical;
    }
    return null;
  });
  if (reportContent === null) return notFound();

  const body = format === 'json'
    ? reportContent
    : renderComplianceReportHtml(JSON.parse(reportContent) as unknown);
  return new NextResponse(body, { status: 200, headers: downloadHeaders(format) });
}
