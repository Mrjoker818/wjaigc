import { createHash } from 'node:crypto';

import type {
  SkillDefinition,
  SkillStepCondition,
  SkillStepDefinition,
  SkillStepFanOut,
} from './types';

export class SkillStepConditionError extends Error {
  readonly code = 'SKILL_STEP_CONDITION_INVALID';
  readonly status = 400;

  constructor(readonly stepId: string) {
    super(`Invalid Skill step condition: ${stepId}`);
    this.name = 'SkillStepConditionError';
  }
}

export class SkillStepFanOutError extends Error {
  readonly code = 'SKILL_STEP_FAN_OUT_INVALID';
  readonly status = 400;

  constructor(readonly stepId: string) {
    super(`Invalid Skill step fan-out: ${stepId}`);
    this.name = 'SkillStepFanOutError';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

function rowDigest(row: Readonly<Record<string, unknown>>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(row)))
    .digest('hex')
    .slice(0, 16);
}

function formatRowValue(value: unknown, stepId: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new SkillStepFanOutError(stepId);
}

function materializeRowPrompt(
  template: string,
  alias: string,
  row: Readonly<Record<string, unknown>>,
  stepId: string,
): string {
  const placeholder = new RegExp(`{{\\s*${alias}\\.([A-Za-z][A-Za-z0-9_-]*)\\s*}}`, 'g');
  return template.replace(placeholder, (_match, key: string) => formatRowValue(row[key], stepId));
}

function compileFanOutStep(
  definition: SkillDefinition,
  step: SkillStepDefinition,
  fanOut: SkillStepFanOut,
  inputValues: Readonly<Record<string, unknown>>,
): SkillStepDefinition[] {
  const field = definition.inputs.find(candidate => candidate.key === fanOut.inputKey);
  if (
    !field
    || field.kind !== 'dataset'
    || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(fanOut.itemAlias)
    || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(fanOut.keyField)
    || !Number.isSafeInteger(fanOut.maximumItems)
    || fanOut.maximumItems < 1
    || fanOut.maximumItems > (field.maximumItems ?? fanOut.maximumItems)
    || !Number.isSafeInteger(fanOut.concurrency)
    || fanOut.concurrency < 1
    || fanOut.concurrency > 10
    || step.execution !== 'parallel'
    || !step.parallelGroup
  ) {
    throw new SkillStepFanOutError(step.id);
  }
  const rowPlaceholder = new RegExp(
    `{{\\s*${fanOut.itemAlias}\\.[A-Za-z][A-Za-z0-9_-]*\\s*}}`,
  );
  if (!rowPlaceholder.test(step.promptTemplate)) throw new SkillStepFanOutError(step.id);

  const base = { ...step };
  delete base.fanOut;
  if (!Object.hasOwn(inputValues, fanOut.inputKey)) return [base];
  const rows = inputValues[fanOut.inputKey];
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > fanOut.maximumItems) {
    throw new SkillStepFanOutError(step.id);
  }

  return rows.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new SkillStepFanOutError(step.id);
    }
    const row = value as Readonly<Record<string, unknown>>;
    if (typeof row[fanOut.keyField] !== 'string' || !row[fanOut.keyField]) {
      throw new SkillStepFanOutError(step.id);
    }
    return {
      ...base,
      id: `${step.id}:${rowDigest(row)}`,
      label: `${step.label} ${index + 1}`,
      parallelGroup: `${step.parallelGroup}:chunk:${Math.floor(index / fanOut.concurrency)}`,
      promptInstructionTemplate: step.promptTemplate,
      promptTemplate: materializeRowPrompt(
        step.promptTemplate,
        fanOut.itemAlias,
        row,
        step.id,
      ),
    };
  });
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
    const compiled = { ...step };
    delete compiled.when;
    return compiled.fanOut
      ? compileFanOutStep(definition, compiled, compiled.fanOut, inputValues)
      : [compiled];
  });
}
