import { randomUUID } from 'node:crypto';

import { parsePlatformComplianceReport } from './report-schema';
import type {
  FrozenComplianceRuleSet,
  PlatformComplianceCheckV1,
  PlatformComplianceReportV1,
  PlatformComplianceTechnicalErrorV1,
  PlatformComplianceVisionModelV1,
} from './types';
import type { VisionComplianceResult } from './vision-client';

export interface BuildComplianceReportInput {
  reportId?: string;
  runId: string;
  generatedAt?: string;
  sourceVersionId: string;
  sourceDigest: string;
  ruleSet: FrozenComplianceRuleSet;
  technicalChecks: readonly PlatformComplianceCheckV1[];
  visionModel: PlatformComplianceVisionModelV1;
  visionResult?: VisionComplianceResult;
  visionError?: PlatformComplianceTechnicalErrorV1;
  technicalErrors?: readonly PlatformComplianceTechnicalErrorV1[];
}

function unknownVisionCheck(rule: FrozenComplianceRuleSet['rules'][number]): PlatformComplianceCheckV1 {
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    title: rule.title,
    severity: rule.severity,
    evaluator: rule.evaluator,
    status: 'unknown',
    evidence: ['visionResult=unavailable'],
    measuredValue: 'unknown',
    requiredValue: JSON.stringify(rule.thresholds ?? {}),
    confidence: null,
    remediation: 'Retry the frozen vision check or request manual review.',
  };
}

export function buildComplianceReport(
  input: BuildComplianceReportInput,
): PlatformComplianceReportV1 {
  const technicalByRule = new Map(input.technicalChecks.map(check => [check.ruleId, check]));
  const visionByRule = new Map(input.visionResult?.checks.map(check => [check.ruleId, check]) ?? []);
  const checks = input.ruleSet.rules.map(rule => {
    if (rule.evaluator === 'vision') return visionByRule.get(rule.id) ?? unknownVisionCheck(rule);
    return technicalByRule.get(rule.id) ?? {
      ...unknownVisionCheck(rule),
      evidence: ['technicalResult=unavailable'],
      remediation: 'Retry the deterministic media check.',
    };
  });
  const partial = input.visionResult === undefined;
  return parsePlatformComplianceReport({
    schemaVersion: 1,
    reportId: input.reportId ?? `compliance-${randomUUID()}`,
    runId: input.runId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    platform: input.ruleSet.platform,
    region: input.ruleSet.region,
    assetType: input.ruleSet.assetType,
    productCategory: input.ruleSet.productCategory,
    sourceVersionId: input.sourceVersionId,
    sourceDigest: input.sourceDigest,
    ruleSetDigest: input.ruleSet.digest,
    verdict: 'unknown',
    checks,
    summary: { passed: 0, warning: 0, blocked: 0, unknown: 0 },
    visionModel: input.visionModel,
    knownLimitations: partial ? ['Vision evaluation is unavailable or pending.'] : [],
    technicalErrors: [
      ...(input.visionError ? [input.visionError] : []),
      ...(input.technicalErrors ?? []),
    ],
    manualReviewRequired: partial,
    extensions: { partial },
  });
}
