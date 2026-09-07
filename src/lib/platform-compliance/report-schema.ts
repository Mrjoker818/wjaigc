import type {
  ComplianceAssetType,
  ComplianceEvaluator,
  ComplianceJsonScalar,
  ComplianceJsonValue,
  CompliancePlatform,
  ComplianceSeverity,
  ComplianceStatus,
  PlatformComplianceCheckV1,
  PlatformComplianceReportV1,
  PlatformComplianceSummaryV1,
  PlatformComplianceTechnicalErrorV1,
  PlatformComplianceVisionModelV1,
} from './types';

const MAX_REPORT_BYTES = 256 * 1024;
const MAX_REPORT_DEPTH = 12;
const MAX_REPORT_KEYS = 4096;
const MAX_REPORT_ARRAY_ITEMS = 4096;
const MAX_REPORT_NODES = 8192;
const MAX_REPORT_STRING_LENGTH = 16_384;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PLATFORMS = new Set<CompliancePlatform>(['通用电商', 'Amazon', '淘宝/天猫', '京东']);
const ASSET_TYPES = new Set<ComplianceAssetType>(['main', 'secondary', 'detail', 'a-plus']);
const STATUSES = new Set<ComplianceStatus>(['passed', 'warning', 'blocked', 'unknown']);
const SEVERITIES = new Set<ComplianceSeverity>(['warning', 'blocking']);
const EVALUATORS = new Set<ComplianceEvaluator>(['metadata', 'pixel', 'vision']);
const REPORT_KEYS = new Set([
  'schemaVersion', 'reportId', 'runId', 'generatedAt', 'platform', 'region', 'assetType',
  'productCategory', 'sourceVersionId', 'sourceDigest', 'ruleSetDigest', 'verdict', 'checks',
  'summary', 'visionModel', 'knownLimitations', 'technicalErrors', 'manualReviewRequired', 'extensions',
]);
const CHECK_KEYS = new Set([
  'ruleId', 'ruleVersion', 'title', 'severity', 'evaluator', 'status', 'evidence',
  'measuredValue', 'requiredValue', 'confidence', 'remediation',
]);
const SUMMARY_KEYS = new Set(['passed', 'warning', 'blocked', 'unknown']);
const VISION_MODEL_KEYS = new Set(['providerId', 'modelId']);
const TECHNICAL_ERROR_KEYS = new Set([
  'code', 'message', 'retryable', 'providerId', 'modelId', 'requestId',
]);

function reportError(code: string): Error {
  return new Error(code);
}

function canonicalize(
  value: unknown,
  depth: number,
  state: { keys: number; nodes: number; bytes: number; ancestors: WeakSet<object> },
): ComplianceJsonValue {
  if (depth > MAX_REPORT_DEPTH) throw reportError('REPORT_DEPTH_LIMIT');
  state.nodes += 1;
  if (state.nodes > MAX_REPORT_NODES) throw reportError('REPORT_NODE_LIMIT');

  const addBytes = (fragment: string): void => {
    state.bytes += new TextEncoder().encode(fragment).byteLength;
    if (state.bytes > MAX_REPORT_BYTES) throw reportError('REPORT_SIZE_LIMIT');
  };
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > MAX_REPORT_STRING_LENGTH) {
      throw reportError('REPORT_STRING_LIMIT');
    }
    addBytes(JSON.stringify(value));
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw reportError('REPORT_NON_JSON_VALUE');
    addBytes(JSON.stringify(value));
    return value;
  }
  if (typeof value !== 'object') throw reportError('REPORT_NON_JSON_VALUE');
  if (state.ancestors.has(value)) throw reportError('REPORT_CYCLE');

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_REPORT_ARRAY_ITEMS) throw reportError('REPORT_ARRAY_LIMIT');
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) throw reportError('REPORT_FORBIDDEN_KEY');
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
          throw reportError('REPORT_ARRAY_PROPERTY');
        }
      }
      addBytes('[');
      const result: ComplianceJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) addBytes(',');
        result.push(canonicalize(value[index], depth + 1, state));
      }
      addBytes(']');
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw reportError('REPORT_PROTOTYPE_INVALID');
    }

    const keys: string[] = [];
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      state.keys += 1;
      if (state.keys > MAX_REPORT_KEYS) throw reportError('REPORT_KEY_LIMIT');
      if (FORBIDDEN_KEYS.has(key)) throw reportError('REPORT_FORBIDDEN_KEY');
      if (key.length > MAX_REPORT_STRING_LENGTH) throw reportError('REPORT_STRING_LIMIT');
      keys.push(key);
    }
    keys.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const result: Record<string, ComplianceJsonValue> = Object.create(null);
    addBytes('{');
    for (const [index, key] of keys.entries()) {
      if (index > 0) addBytes(',');
      addBytes(`${JSON.stringify(key)}:`);
      result[key] = canonicalize((value as Record<string, unknown>)[key], depth + 1, state);
    }
    addBytes('}');
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}

export function canonicalComplianceReportJson(report: unknown): string {
  const canonical = canonicalize(report, 0, {
    keys: 0,
    nodes: 0,
    bytes: 0,
    ancestors: new WeakSet(),
  });
  return JSON.stringify(canonical);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(): never {
  throw reportError('REPORT_SCHEMA_INVALID');
}

function requireExactKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(record).some(key => !allowed.has(key))) invalid();
}

function requiredString(record: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = record[key];
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) return invalid();
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') return invalid();
  return value;
}

function requiredInteger(record: Record<string, unknown>, key: string, minimum = 0): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return invalid();
  return value;
}

function enumValue<T extends string>(value: unknown, values: Set<T>): T {
  if (typeof value !== 'string' || !values.has(value as T)) return invalid();
  return value as T;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return invalid();
  return [...value];
}

function evidenceArray(value: unknown): string[] {
  return stringArray(value).map(item => item.trim()).filter(item => item.length > 0);
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== 'string') return invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (match === null || !Number.isFinite(Date.parse(value))) return invalid();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const [year, month, day, hour, minute, second] = [
    yearText, monthText, dayText, hourText, minuteText, secondText,
  ].map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59
  ) return invalid();
  return value;
}

function jsonScalar(value: unknown): ComplianceJsonScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return invalid();
}

function parseCheck(value: unknown): PlatformComplianceCheckV1 {
  if (!isRecord(value)) return invalid();
  requireExactKeys(value, CHECK_KEYS);
  const evidence = evidenceArray(value.evidence);
  const inputStatus = enumValue(value.status, STATUSES);
  const confidence = value.confidence;
  if (confidence !== null && (
    typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
  )) return invalid();

  return {
    ruleId: requiredString(value, 'ruleId'),
    ruleVersion: requiredInteger(value, 'ruleVersion', 1),
    title: requiredString(value, 'title'),
    severity: enumValue(value.severity, SEVERITIES),
    evaluator: enumValue(value.evaluator, EVALUATORS),
    status: evidence.length === 0 ? 'unknown' : inputStatus,
    evidence,
    measuredValue: jsonScalar(value.measuredValue),
    requiredValue: jsonScalar(value.requiredValue),
    confidence,
    remediation: value.remediation === null ? null : requiredString(value, 'remediation'),
  };
}

function summarize(checks: readonly PlatformComplianceCheckV1[]): PlatformComplianceSummaryV1 {
  const summary: PlatformComplianceSummaryV1 = { passed: 0, warning: 0, blocked: 0, unknown: 0 };
  for (const check of checks) summary[check.status] += 1;
  return summary;
}

function verdictFor(summary: PlatformComplianceSummaryV1): ComplianceStatus {
  if (summary.blocked > 0) return 'blocked';
  if (summary.unknown > 0) return 'unknown';
  if (summary.warning > 0) return 'warning';
  if (summary.passed === 0) return 'unknown';
  return 'passed';
}

function validateInputSummary(value: unknown): void {
  if (!isRecord(value)) invalid();
  requireExactKeys(value, SUMMARY_KEYS);
  for (const key of SUMMARY_KEYS) requiredInteger(value, key);
}

function parseVisionModel(value: unknown): PlatformComplianceVisionModelV1 | null {
  if (value === null) return null;
  if (!isRecord(value)) return invalid();
  requireExactKeys(value, VISION_MODEL_KEYS);
  return { providerId: requiredString(value, 'providerId'), modelId: requiredString(value, 'modelId') };
}

function parseTechnicalError(value: unknown): PlatformComplianceTechnicalErrorV1 {
  if (!isRecord(value)) return invalid();
  requireExactKeys(value, TECHNICAL_ERROR_KEYS);
  const error: PlatformComplianceTechnicalErrorV1 = {
    code: requiredString(value, 'code'),
    message: requiredString(value, 'message'),
    retryable: requiredBoolean(value, 'retryable'),
  };
  for (const key of ['providerId', 'modelId', 'requestId'] as const) {
    if (value[key] !== undefined) error[key] = requiredString(value, key);
  }
  return error;
}

function deepFreezeJson(value: ComplianceJsonValue): ComplianceJsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeJson(item);
    return Object.freeze(value);
  }
  for (const item of Object.values(value)) deepFreezeJson(item);
  return Object.freeze(value);
}

function freezeReport(report: PlatformComplianceReportV1): PlatformComplianceReportV1 {
  for (const check of report.checks) {
    Object.freeze(check.evidence);
    Object.freeze(check);
  }
  for (const error of report.technicalErrors) Object.freeze(error);
  Object.freeze(report.checks);
  Object.freeze(report.summary);
  if (report.visionModel !== null) Object.freeze(report.visionModel);
  Object.freeze(report.knownLimitations);
  Object.freeze(report.technicalErrors);
  deepFreezeJson(report.extensions);
  return Object.freeze(report);
}

export function parsePlatformComplianceReport(value: unknown): PlatformComplianceReportV1 {
  const canonical = canonicalComplianceReportJson(value);
  const parsed: unknown = JSON.parse(canonical);
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) return invalid();
  requireExactKeys(parsed, REPORT_KEYS);
  const checksValue = parsed.checks;
  const errorsValue = parsed.technicalErrors;
  if (!Array.isArray(checksValue) || !Array.isArray(errorsValue) || !isRecord(parsed.extensions)) {
    return invalid();
  }
  const sourceDigest = requiredString(parsed, 'sourceDigest');
  const ruleSetDigest = requiredString(parsed, 'ruleSetDigest');
  if (!/^[a-f0-9]{64}$/u.test(sourceDigest) || !/^[a-f0-9]{64}$/u.test(ruleSetDigest)) return invalid();
  enumValue(parsed.verdict, STATUSES);
  validateInputSummary(parsed.summary);

  const checks = checksValue.map(parseCheck);
  const summary = summarize(checks);
  const report: PlatformComplianceReportV1 = {
    schemaVersion: 1,
    reportId: requiredString(parsed, 'reportId'),
    runId: requiredString(parsed, 'runId'),
    generatedAt: isoTimestamp(parsed.generatedAt),
    platform: enumValue(parsed.platform, PLATFORMS),
    region: requiredString(parsed, 'region'),
    assetType: enumValue(parsed.assetType, ASSET_TYPES),
    productCategory: requiredString(parsed, 'productCategory', true),
    sourceVersionId: requiredString(parsed, 'sourceVersionId'),
    sourceDigest,
    ruleSetDigest,
    verdict: verdictFor(summary),
    checks,
    summary,
    visionModel: parseVisionModel(parsed.visionModel),
    knownLimitations: stringArray(parsed.knownLimitations),
    technicalErrors: errorsValue.map(parseTechnicalError),
    manualReviewRequired: requiredBoolean(parsed, 'manualReviewRequired')
      || summary.unknown > 0
      || summary.warning > 0
      || checks.length === 0,
    extensions: parsed.extensions as Record<string, ComplianceJsonValue>,
  };
  return freezeReport(report);
}
