import type {
  ComplianceJsonObject,
  PlatformComplianceReportV1Input,
} from '@/lib/platform-compliance/types';

export function validReport(
  overrides: Partial<PlatformComplianceReportV1Input> = {},
): PlatformComplianceReportV1Input {
  return {
    schemaVersion: 1,
    reportId: 'report-1',
    runId: 'run-1',
    generatedAt: '2026-09-07T00:00:00.000Z',
    platform: 'Amazon',
    region: 'US',
    assetType: 'main',
    productCategory: '',
    sourceVersionId: 'asset-version-1',
    sourceDigest: 'a'.repeat(64),
    ruleSetDigest: 'b'.repeat(64),
    verdict: 'passed',
    checks: [{
      ruleId: 'amazon-supported-format',
      ruleVersion: 1,
      title: '支持的图片格式',
      severity: 'blocking',
      evaluator: 'metadata',
      status: 'passed',
      evidence: ['format=jpeg'],
      measuredValue: 'jpeg',
      requiredValue: 'JPEG、TIFF、PNG 或非动态 GIF',
      confidence: 1,
      remediation: null,
    }],
    summary: { passed: 1, warning: 0, blocked: 0, unknown: 0 },
    visionModel: null,
    knownLimitations: [],
    technicalErrors: [],
    manualReviewRequired: false,
    extensions: {},
    ...overrides,
  };
}

export function deepReport(depth: number): PlatformComplianceReportV1Input {
  let nested: ComplianceJsonObject = {};
  for (let index = 0; index < depth; index += 1) {
    nested = { nested };
  }
  return validReport({ extensions: nested });
}

export function wideReport(keys: number): PlatformComplianceReportV1Input {
  const extensions: Record<string, string> = {};
  for (let index = 0; index < keys; index += 1) {
    extensions[`key-${index.toString().padStart(4, '0')}`] = 'value';
  }
  return validReport({ extensions });
}
