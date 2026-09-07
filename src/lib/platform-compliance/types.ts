export type ComplianceStatus = 'passed' | 'warning' | 'blocked' | 'unknown';

export type CompliancePlatform = '通用电商' | 'Amazon' | '淘宝/天猫' | '京东';
export type ComplianceAssetType = 'main' | 'secondary' | 'detail' | 'a-plus';
export type ComplianceSeverity = 'warning' | 'blocking';
export type ComplianceEvaluator = 'metadata' | 'pixel' | 'vision';

export type ComplianceJsonScalar = string | number | boolean | null;
export interface ComplianceJsonObject {
  readonly [key: string]: ComplianceJsonValue;
}
export type ComplianceJsonValue =
  | ComplianceJsonScalar
  | readonly ComplianceJsonValue[]
  | ComplianceJsonObject;

export interface PlatformComplianceRule {
  id: string;
  version: number;
  platform: CompliancePlatform;
  regions: readonly string[];
  assetTypes: readonly ComplianceAssetType[];
  categories?: readonly string[];
  title: string;
  severity: ComplianceSeverity;
  evaluator: ComplianceEvaluator;
  sourceUrl: string;
  sourceUpdatedAt: string | null;
  effectiveAt: string | null;
  snapshotCapturedAt: string;
  thresholds?: Readonly<Record<string, number | string | boolean>>;
}

export interface FrozenComplianceRuleSet {
  platform: PlatformComplianceRule['platform'];
  region: string;
  assetType: PlatformComplianceRule['assetTypes'][number];
  productCategory: string;
  digest: string;
  rules: readonly PlatformComplianceRule[];
}

export interface ResolveComplianceRuleSetInput {
  platform: CompliancePlatform;
  region: string;
  assetType: ComplianceAssetType;
  productCategory: string;
}

export interface PlatformComplianceCheckV1 {
  ruleId: string;
  ruleVersion: number;
  title: string;
  severity: ComplianceSeverity;
  evaluator: ComplianceEvaluator;
  status: ComplianceStatus;
  evidence: readonly string[];
  measuredValue: ComplianceJsonScalar;
  requiredValue: ComplianceJsonScalar;
  confidence: number | null;
  remediation: string | null;
}

export interface PlatformComplianceSummaryV1 {
  passed: number;
  warning: number;
  blocked: number;
  unknown: number;
}

export interface PlatformComplianceVisionModelV1 {
  providerId: string;
  modelId: string;
}

export interface PlatformComplianceTechnicalErrorV1 {
  code: string;
  message: string;
  retryable: boolean;
  providerId?: string;
  modelId?: string;
  requestId?: string;
}

export interface PlatformComplianceReportV1 {
  schemaVersion: 1;
  reportId: string;
  runId: string;
  generatedAt: string;
  platform: CompliancePlatform;
  region: string;
  assetType: ComplianceAssetType;
  productCategory: string;
  sourceVersionId: string;
  sourceDigest: string;
  ruleSetDigest: string;
  verdict: ComplianceStatus;
  checks: readonly PlatformComplianceCheckV1[];
  summary: Readonly<PlatformComplianceSummaryV1>;
  visionModel: Readonly<PlatformComplianceVisionModelV1> | null;
  knownLimitations: readonly string[];
  technicalErrors: readonly Readonly<PlatformComplianceTechnicalErrorV1>[];
  manualReviewRequired: boolean;
  extensions: ComplianceJsonObject;
}

export type PlatformComplianceReportV1Input = PlatformComplianceReportV1;
