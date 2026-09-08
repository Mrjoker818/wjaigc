import { createHash } from 'node:crypto';

import { isAssetVersionId } from '@/lib/asset-core/asset-version-id';
import {
  assertCompiledSkillFanOutContracts,
  assertCompiledSkillFanOutFieldContract,
} from './compiled-fan-out';

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

function valueDigest(value: unknown, stepId: string): string {
  try {
    const serialized = JSON.stringify(canonicalize(value));
    if (serialized === undefined) throw new TypeError('Value is not JSON serializable');
    return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
  } catch {
    throw new SkillStepFanOutError(stepId);
  }
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
  const isDataset = field?.kind === 'dataset';
  const isImages = field?.kind === 'images';
  if (
    !field
    || (!isDataset && !isImages)
    || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(fanOut.itemAlias)
    || (isDataset && (
      typeof fanOut.keyField !== 'string'
      || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(fanOut.keyField)
    ))
    || (isImages && (fanOut.keyField !== undefined || field.bindToSourceVersions !== true))
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
  if (isDataset) {
    const rowPlaceholder = new RegExp(
      `{{\\s*${fanOut.itemAlias}\\.[A-Za-z][A-Za-z0-9_-]*\\s*}}`,
    );
    if (!rowPlaceholder.test(step.promptTemplate)) throw new SkillStepFanOutError(step.id);
  }

  const base = { ...step };
  delete base.fanOut;
  if (!Object.hasOwn(inputValues, fanOut.inputKey)) return [base];
  const values = inputValues[fanOut.inputKey];
  if (values === undefined) return [base];
  const maximumItems = isImages ? Math.min(fanOut.maximumItems, 20) : fanOut.maximumItems;
  if (!Array.isArray(values) || values.length === 0 || values.length > maximumItems) {
    throw new SkillStepFanOutError(step.id);
  }

  if (isImages && new Set(values).size !== values.length) {
    throw new SkillStepFanOutError(step.id);
  }

  return values.map((value, index) => {
    if (isImages) {
      if (!isAssetVersionId(value)) {
        throw new SkillStepFanOutError(step.id);
      }
      const digest = valueDigest(value, step.id);
      return {
        ...base,
        id: `${step.id}:${digest}`,
        label: `${step.label} ${index + 1}`,
        parallelGroup: `${step.parallelGroup}:chunk:${Math.floor(index / fanOut.concurrency)}`,
        compiledFanOut: {
          inputKey: fanOut.inputKey,
          itemIndex: index,
          itemDigest: digest,
        },
      };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new SkillStepFanOutError(step.id);
    }
    const row = value as Readonly<Record<string, unknown>>;
    const digest = valueDigest(row, step.id);
    const keyField = fanOut.keyField!;
    if (typeof row[keyField] !== 'string' || !row[keyField]) {
      throw new SkillStepFanOutError(step.id);
    }
    return {
      ...base,
      id: `${step.id}:${digest}`,
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

export function compiledSkillFanOutValue(
  step: SkillStepDefinition,
  inputValues: Readonly<Record<string, unknown>>,
): string | Record<string, unknown> {
  const compiled = step.compiledFanOut;
  if (
    !compiled
    || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(compiled.inputKey)
    || !Number.isSafeInteger(compiled.itemIndex)
    || compiled.itemIndex < 0
    || !/^[a-f0-9]{16}$/.test(compiled.itemDigest)
    || !step.id.endsWith(`:${compiled.itemDigest}`)
  ) throw new SkillStepFanOutError(step.id);
  const values = inputValues[compiled.inputKey];
  if (!Array.isArray(values) || compiled.itemIndex >= values.length) {
    throw new SkillStepFanOutError(step.id);
  }
  const value = values[compiled.itemIndex];
  const validValue = typeof value === 'string'
    ? isAssetVersionId(value)
    : Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (
    !validValue
    || valueDigest(value, step.id) !== compiled.itemDigest
  ) throw new SkillStepFanOutError(step.id);
  return value as string | Record<string, unknown>;
}

export function assertCompiledSkillFanOutValues(
  definition: {
    inputs: readonly unknown[];
    steps: readonly SkillStepDefinition[];
  },
  inputValues: Readonly<Record<string, unknown>>,
): void {
  try {
    assertCompiledSkillFanOutContracts(definition);
  } catch {
    const stepId = definition.steps.find(step => step.compiledFanOut)?.id ?? 'skill';
    throw new SkillStepFanOutError(stepId);
  }
  for (const step of definition.steps) {
    if (!step.compiledFanOut) continue;
    try {
      const compiled = assertCompiledSkillFanOutFieldContract(
        step as unknown as Readonly<Record<string, unknown>>,
        definition.inputs,
      )!;
      const value = compiledSkillFanOutValue(step, inputValues);
      const field = definition.inputs.find(candidate => (
        candidate !== null
        && typeof candidate === 'object'
        && !Array.isArray(candidate)
        && (candidate as Record<string, unknown>).key === compiled.inputKey
      )) as SkillDefinition['inputs'][number] | undefined;
      if (
        (field?.kind === 'images' && typeof value !== 'string')
        || (field?.kind === 'dataset' && (
          !value || typeof value !== 'object' || Array.isArray(value)
        ))
      ) throw new SkillStepFanOutError(step.id);
    } catch (error) {
      if (error instanceof SkillStepFanOutError) throw error;
      throw new SkillStepFanOutError(step.id);
    }
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
    const compiled = { ...step };
    delete compiled.when;
    return compiled.fanOut
      ? compileFanOutStep(definition, compiled, compiled.fanOut, inputValues)
      : [compiled];
  });
}
