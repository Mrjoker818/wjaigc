import type { PlatformComplianceCheckV1, PlatformComplianceRule } from './types';
import type { ComplianceMediaFacts } from './media-audit';

export type ComplianceCheckResult = PlatformComplianceCheckV1;

const FORMAT_BY_MIME: Readonly<Record<string, string>> = {
  'image/gif': 'GIF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/tiff': 'TIFF',
};

function failedStatus(rule: PlatformComplianceRule): ComplianceCheckResult['status'] {
  return rule.severity === 'blocking' ? 'blocked' : 'warning';
}

function result(
  rule: PlatformComplianceRule,
  passed: boolean,
  evidence: readonly string[],
  measuredValue: ComplianceCheckResult['measuredValue'],
  requiredValue: ComplianceCheckResult['requiredValue'],
  remediation: string,
): ComplianceCheckResult {
  return Object.freeze({
    ruleId: rule.id,
    ruleVersion: rule.version,
    title: rule.title,
    severity: rule.severity,
    evaluator: rule.evaluator,
    status: passed ? 'passed' : failedStatus(rule),
    evidence: Object.freeze([...evidence]),
    measuredValue,
    requiredValue,
    confidence: 1,
    remediation: passed ? null : remediation,
  });
}

function evaluateFormat(
  facts: ComplianceMediaFacts,
  rule: PlatformComplianceRule,
): ComplianceCheckResult {
  const supportedFormats = String(rule.thresholds?.supportedFormats ?? '')
    .split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
  const format = FORMAT_BY_MIME[facts.mimeType] ?? facts.mimeType;
  const animatedGifAllowed = rule.thresholds?.animatedGifAllowed === true;
  const passed = supportedFormats.includes(format)
    && (format !== 'GIF' || !facts.isAnimated || animatedGifAllowed);
  return result(
    rule,
    passed,
    [`mimeType=${facts.mimeType}`, `format=${format}`, `animated=${facts.isAnimated}`],
    format,
    supportedFormats.join(','),
    'Convert the image to a supported non-animated format.',
  );
}

function evaluateDimensions(
  facts: ComplianceMediaFacts,
  rule: PlatformComplianceRule,
): ComplianceCheckResult {
  const minimum = Number(rule.thresholds?.minLongestEdge);
  const maximum = Number(rule.thresholds?.maxLongestEdge);
  const passed = Number.isFinite(minimum) && Number.isFinite(maximum)
    && facts.longestEdge >= minimum && facts.longestEdge <= maximum;
  return result(
    rule,
    passed,
    [`width=${facts.width}`, `height=${facts.height}`, `longestEdge=${facts.longestEdge}`],
    facts.longestEdge,
    `${minimum}-${maximum}`,
    `Resize the longest edge to between ${minimum} and ${maximum} pixels.`,
  );
}

function evaluateWhiteBackground(
  facts: ComplianceMediaFacts,
  rule: PlatformComplianceRule,
): ComplianceCheckResult {
  const requiredRatio = 0.99;
  const passed = !facts.hasTransparentPixels && facts.whiteBackgroundRatio >= requiredRatio;
  return result(
    rule,
    passed,
    [
      `hasAlpha=${facts.hasAlpha}`,
      `hasTransparentPixels=${facts.hasTransparentPixels}`,
      `backgroundSampleRings=${facts.backgroundSampleRingCount}`,
      `backgroundSamples=${facts.backgroundSampleCount}`,
      `whiteBackgroundSamples=${facts.whiteBackgroundSampleCount}`,
      `whiteBackgroundRatio=${facts.whiteBackgroundRatio}`,
      `whiteRgbDistanceThreshold=${WHITE_RGB_DISTANCE_EVIDENCE}`,
    ],
    facts.whiteBackgroundRatio,
    `opaque ${String(rule.thresholds?.backgroundColor ?? '#FFFFFF')} ratio>=${requiredRatio}`,
    'Use an opaque pure-white background across the image edges.',
  );
}

const WHITE_RGB_DISTANCE_EVIDENCE = 10;

export function evaluateTechnicalRules(
  facts: ComplianceMediaFacts,
  rules: readonly PlatformComplianceRule[],
): ComplianceCheckResult[] {
  return rules.flatMap(rule => {
    if (rule.id === 'amazon-supported-format') return [evaluateFormat(facts, rule)];
    if (rule.id === 'amazon-image-dimensions') return [evaluateDimensions(facts, rule)];
    if (rule.id === 'amazon-main-white-background') return [evaluateWhiteBackground(facts, rule)];
    return [];
  });
}
