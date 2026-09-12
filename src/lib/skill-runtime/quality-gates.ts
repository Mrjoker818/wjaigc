import type {
  SkillQualityContext,
  SkillQualityGate,
  SkillQualityResult,
  SkillStepResult,
} from './types';
import { durableSkillOutputFromStructuredResult } from './structured-output';

function hasKnownDimensions(media: SkillStepResult['media'][number]): boolean {
  return Number.isInteger(media.width) && Number(media.width) > 0
    && Number.isInteger(media.height) && Number(media.height) > 0;
}

function expectedRatio(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function matchesRatioWithinOnePercent(
  result: SkillStepResult,
  context: SkillQualityContext,
): boolean {
  const target = expectedRatio(context.expectedAspectRatio);
  if (
    !target
    || result.media.length === 0
    || result.media.length !== result.assetVersionIds.length
  ) return false;
  return result.media.every(media => {
    if (!hasKnownDimensions(media)) return false;
    const actual = Number(media.width) / Number(media.height);
    return Math.abs(actual - target) / target <= 0.01;
  });
}

export const QUALITY_GATES = {
  'output-present': (result: SkillStepResult) => result.assetVersionIds.length > 0,
  'text-output-present': (result: SkillStepResult) => (
    typeof result.text === 'string' && result.text.trim().length > 0
  ),
  'expected-count': (result: SkillStepResult, context: SkillQualityContext) => (
    typeof context.expectedCount === 'number'
    && Number.isInteger(context.expectedCount)
    && context.expectedCount >= 0
    && result.assetVersionIds.length === context.expectedCount
  ),
  'transparent-alpha': (result: SkillStepResult) => (
    result.media.some(media => media.hasTransparency === true)
  ),
  'image-dimensions-known': (result: SkillStepResult) => (
    result.media.length > 0
    && result.media.length === result.assetVersionIds.length
    && result.media.every(hasKnownDimensions)
  ),
  'aspect-ratio-match': matchesRatioWithinOnePercent,
  'valid-html': (result: SkillStepResult) => (
    typeof result.html === 'string' && result.html.length > 0
  ),
  'structured-output-present': (result: SkillStepResult) => {
    if (!result.structured) return false;
    try {
      durableSkillOutputFromStructuredResult('quality-gate', result.structured);
      return true;
    } catch {
      return false;
    }
  },
  'structured-report-present': (result: SkillStepResult) => {
    if (result.structured?.schemaId !== 'platform-compliance-report-v1') return false;
    try {
      durableSkillOutputFromStructuredResult('quality-gate', result.structured);
      return true;
    } catch {
      return false;
    }
  },
} satisfies Record<string, SkillQualityGate>;

export function runSkillQualityGates(
  ids: readonly string[],
  result: SkillStepResult,
  context: SkillQualityContext,
): SkillQualityResult[] {
  return ids.map(id => {
    const gate = QUALITY_GATES[id as keyof typeof QUALITY_GATES];
    if (!gate) {
      return {
        id,
        passed: false,
        error: `Unknown quality gate: ${id}`,
      };
    }
    return { id, passed: gate(result, context) === true };
  });
}
