import 'server-only';

import { createHash } from 'node:crypto';

import {
  createAssetService,
  type AssetService,
  type CreateAssetVersionInput,
  type ResolveAssetReferenceInput,
} from '@/lib/asset-core/service';
import {
  parseWorkspaceSourceTrace,
  type WorkspaceSourceTrace,
} from '@/lib/asset-core/source-trace';
import type { AssetVersion } from '@/lib/asset-core/types';

import {
  canonicalComplianceReportJson,
  parsePlatformComplianceReport,
} from './report-schema';
import type { PlatformComplianceReportV1 } from './types';

export const COMPLIANCE_REPORT_SCHEMA_ID = 'platform-compliance-report-v1';

export interface ComplianceReportAssetService {
  createAssetVersion(input: CreateAssetVersionInput): ReturnType<AssetService['createAssetVersion']>;
  resolveAssetReference(input: ResolveAssetReferenceInput): ReturnType<AssetService['resolveAssetReference']>;
}

export interface PersistComplianceReportInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  stepId: string;
  report: PlatformComplianceReportV1;
  sourceVersionIds: readonly string[];
  sourceTrace: WorkspaceSourceTrace;
  idempotencyKey: string;
  requestDigest: string;
  assetService?: ComplianceReportAssetService;
}

function requireIdentifier(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TypeError(`${name} is invalid`);
  }
  return normalized;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function complianceReportLineageMatches(
  parentVersionIds: readonly string[],
  sourceVersionIds: readonly string[],
): boolean {
  return parentVersionIds.length === 0 || sameStrings(parentVersionIds, sourceVersionIds);
}

function validatedSourceTrace(
  value: WorkspaceSourceTrace,
  runId: string,
  sourceVersionIds: readonly string[],
): WorkspaceSourceTrace {
  const trace = parseWorkspaceSourceTrace(value);
  if (
    trace?.source !== 'canvas-skill'
    || trace.runId !== runId
    || !sameStrings(trace.sourceVersionIds, sourceVersionIds)
  ) {
    throw new TypeError('sourceTrace is inconsistent with the compliance report source');
  }
  return trace;
}

export function reportDownloadUrl(
  runId: string,
  stepId: string,
  checksum: string,
  projectId: string,
): string {
  const safeRunId = requireIdentifier('runId', runId);
  const safeStepId = requireIdentifier('stepId', stepId);
  const safeProjectId = requireIdentifier('projectId', projectId);
  if (!/^[a-f0-9]{64}$/u.test(checksum)) throw new TypeError('checksum is invalid');
  return `/api/skill-reports/${encodeURIComponent(safeRunId)}/${encodeURIComponent(safeStepId)}`
    + `?projectId=${encodeURIComponent(safeProjectId)}&checksum=${checksum}`;
}

export async function persistComplianceReportAsset(
  input: PersistComplianceReportInput,
): Promise<AssetVersion> {
  const actorUserId = requireIdentifier('actorUserId', input.actorUserId);
  const projectId = requireIdentifier('projectId', input.projectId);
  const runId = requireIdentifier('runId', input.runId);
  const stepId = requireIdentifier('stepId', input.stepId);
  const idempotencyKey = requireIdentifier('idempotencyKey', input.idempotencyKey);
  const requestDigest = requireIdentifier('requestDigest', input.requestDigest);
  const sourceVersionIds = input.sourceVersionIds.map(sourceVersionId => (
    requireIdentifier('sourceVersionId', sourceVersionId)
  ));
  if (
    sourceVersionIds.length === 0
    || sourceVersionIds.length > 20
    || new Set(sourceVersionIds).size !== sourceVersionIds.length
  ) {
    throw new TypeError('sourceVersionIds are invalid');
  }

  const report = parsePlatformComplianceReport(input.report);
  if (report.runId !== runId) throw new TypeError('report runId is inconsistent');
  if (!sourceVersionIds.includes(report.sourceVersionId)) {
    throw new TypeError('report sourceVersionId is inconsistent');
  }
  const sourceTrace = validatedSourceTrace(input.sourceTrace, runId, sourceVersionIds);
  const assetService = input.assetService ?? createAssetService();
  await Promise.all(sourceVersionIds.map(assetVersionId => assetService.resolveAssetReference({
    actorUserId,
    projectId,
    assetVersionId,
  })));

  const reportContent = canonicalComplianceReportJson(report);
  const checksum = createHash('sha256').update(reportContent).digest('hex');
  const metadata = {
    schemaId: COMPLIANCE_REPORT_SCHEMA_ID,
    reportContent,
    sourceVersionIds: [...sourceVersionIds],
    sourceTrace,
  };
  const created = await assetService.createAssetVersion({
    actorUserId,
    projectId,
    kind: 'document',
    parentVersionIds: [],
    idempotencyKey,
    requestDigest,
    file: {
      url: reportDownloadUrl(runId, stepId, checksum, projectId),
      availability: 'ready',
      mimeType: 'application/json',
      byteSize: Buffer.byteLength(reportContent),
      checksum,
    },
    metadata,
  });
  return created.version.metadata ? created.version : { ...created.version, metadata };
}

export function complianceReportFromAssetVersion(
  version: AssetVersion,
): PlatformComplianceReportV1 {
  const content = version.metadata?.reportContent;
  const sourceVersionIds = Array.isArray(version.metadata?.sourceVersionIds)
    && version.metadata.sourceVersionIds.every(value => typeof value === 'string')
    ? version.metadata.sourceVersionIds as string[]
    : [];
  if (
    sourceVersionIds.length === 0
    || !complianceReportLineageMatches(version.parentVersionIds, sourceVersionIds)
    || version.file.availability !== 'ready'
    || version.file.mimeType !== 'application/json'
    || version.metadata?.schemaId !== COMPLIANCE_REPORT_SCHEMA_ID
    || typeof content !== 'string'
  ) {
    throw new TypeError('Compliance report asset is invalid');
  }
  let report: PlatformComplianceReportV1;
  try {
    report = parsePlatformComplianceReport(JSON.parse(content) as unknown);
  } catch (error) {
    throw new TypeError('Compliance report asset content is invalid', { cause: error });
  }
  const canonical = canonicalComplianceReportJson(report);
  const checksum = createHash('sha256').update(canonical).digest('hex');
  if (
    canonical !== content
    || version.file.checksum !== checksum
    || version.file.byteSize !== Buffer.byteLength(canonical)
  ) {
    throw new TypeError('Compliance report asset checksum is invalid');
  }
  return report;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderComplianceReportHtml(reportValue: unknown): string {
  const report = parsePlatformComplianceReport(reportValue);
  const checks = report.checks.map(check => `
      <tr>
        <td>${escapeHtml(check.title)}</td>
        <td>${escapeHtml(check.status)}</td>
        <td>${escapeHtml(check.measuredValue)}</td>
        <td>${escapeHtml(check.requiredValue)}</td>
        <td>${escapeHtml(check.evidence.join('; '))}</td>
        <td>${escapeHtml(check.remediation ?? '')}</td>
      </tr>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>平台素材合规报告</title></head>
<body>
  <main>
    <h1>平台素材合规报告</h1>
    <dl>
      <dt>报告 ID</dt><dd>${escapeHtml(report.reportId)}</dd>
      <dt>平台</dt><dd>${escapeHtml(report.platform)}</dd>
      <dt>地区</dt><dd>${escapeHtml(report.region)}</dd>
      <dt>结论</dt><dd>${escapeHtml(report.verdict)}</dd>
      <dt>检测时间</dt><dd>${escapeHtml(report.generatedAt)}</dd>
    </dl>
    <table>
      <thead><tr><th>检查项</th><th>状态</th><th>实测值</th><th>要求值</th><th>证据</th><th>修复建议</th></tr></thead>
      <tbody>${checks}
      </tbody>
    </table>
  </main>
</body>
</html>`;
}
