import type { SkillDefinition, SkillStepCondition, SkillStepDefinition } from './types';

export class SkillStepConditionError extends Error {
  readonly code = 'SKILL_STEP_CONDITION_INVALID';
  readonly status = 400;

  constructor(readonly stepId: string) {
    super(`Invalid Skill step condition: ${stepId}`);
    this.name = 'SkillStepConditionError';
  }
}

function conditionMatches(
  definition: SkillDefinition,
  step: SkillStepDefinition,
  condition: SkillStepCondition,
  inputValues: Readonly<Record<string, unknown>>,
): boolean {
  const field = definition.inputs.find(candidate => candidate.key === condition.input);
  if (
    !field
    || !['select', 'multi-select', 'number', 'boolean'].includes(field.kind)
    || !Array.isArray(condition.includes)
    || condition.includes.length === 0
    || condition.includes.some(value => !['string', 'number', 'boolean'].includes(typeof value))
  ) {
    throw new SkillStepConditionError(step.id);
  }
  const value = inputValues[condition.input] ?? field.defaultValue;
  if (Array.isArray(value)) {
    return value.some(candidate => condition.includes.includes(
      candidate as string | number | boolean,
    ));
  }
  return condition.includes.includes(value as string | number | boolean);
}

export function compileConditionalSkillSteps(
  definition: SkillDefinition,
  inputValues: Readonly<Record<string, unknown>>,
): SkillStepDefinition[] {
  return definition.steps.flatMap(step => {
    if (step.when && !conditionMatches(definition, step, step.when, inputValues)) return [];
    const { when: _condition, ...compiled } = step;
    return [compiled];
  });
}
