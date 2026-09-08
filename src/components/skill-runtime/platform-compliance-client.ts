import { canonicalComplianceReportJson, parsePlatformComplianceReport } from '@/lib/platform-compliance/report-schema';
import type { PlatformComplianceReportV1 } from '@/lib/platform-compliance/types';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';
import type { DurableSkillOutput } from '@/lib/skill-runtime/types';

const REPORT_SCHEMA_ID = 'platform-compliance-report-v1';

export interface PlatformComplianceReportProjection {
  stepId: string;
  report: PlatformComplianceReportV1;
  downloadUrls: { json: string; html: string };
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前浏览器不支持报告完整性校验');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function reportDownloadUrl(
  runId: string,
  stepId: string,
  projectId: string,
  checksum: string,
  format: 'json' | 'html',
): string {
  const query = new URLSearchParams({ projectId, checksum, format });
  return `/api/skill-reports/${encodeURIComponent(runId)}/${encodeURIComponent(stepId)}?${query}`;
}

export async function projectPlatformComplianceReports(
  outputs: unknown,
  input: { runId: string; projectId: string },
): Promise<PlatformComplianceReportProjection[]> {
  if (!Array.isArray(outputs)) return [];
  const reports: PlatformComplianceReportProjection[] = [];
  for (const candidate of outputs) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const output = candidate as Partial<DurableSkillOutput>;
    if (
      output.kind !== 'json'
      || output.schemaId !== REPORT_SCHEMA_ID
      || typeof output.stepId !== 'string'
      || !output.stepId
      || typeof output.content !== 'string'
    ) continue;
    try {
      const report = parsePlatformComplianceReport(JSON.parse(output.content) as unknown);
      if (report.runId !== input.runId) continue;
      const canonical = canonicalComplianceReportJson(report);
      if (canonical !== output.content) continue;
      const checksum = await sha256(output.content);
      reports.push({
        stepId: output.stepId,
        report,
        downloadUrls: {
          json: reportDownloadUrl(input.runId, output.stepId, input.projectId, checksum, 'json'),
          html: reportDownloadUrl(input.runId, output.stepId, input.projectId, checksum, 'html'),
        },
      });
    } catch {
      // Invalid or unverifiable structured output is never rendered as a trusted report.
    }
  }
  return reports;
}

export function createPlatformComplianceRecheckRequest(
  historical: SkillRunRequest,
  idempotencyKey: string,
): SkillRunRequest {
  return {
    ...historical,
    inputValues: structuredClone(historical.inputValues),
    sourceVersionIds: [...historical.sourceVersionIds],
    modelBindings: structuredClone(historical.modelBindings),
    idempotencyKey,
  };
}
