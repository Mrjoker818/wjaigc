import type {
  SkillQualityContext,
  SkillQualityGate,
  SkillQualityResult,
  SkillStepResult,
} from './types';

export const QUALITY_GATES = {
  'output-present': (result: SkillStepResult) => result.assetVersionIds.length > 0,
  'expected-count': (result: SkillStepResult, context: SkillQualityContext) => (
    typeof context.expectedCount === 'number'
    && Number.isInteger(context.expectedCount)
    && context.expectedCount >= 0
    && result.assetVersionIds.length === context.expectedCount
  ),
  'transparent-alpha': (result: SkillStepResult) => (
    result.media.some(media => media.hasTransparency === true)
  ),
  'valid-html': (result: SkillStepResult) => (
    typeof result.html === 'string' && result.html.length > 0
  ),
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
