import type { SkillDefinition, SkillInputField } from './types';

export const SKILL_INPUT_LIMITS = {
  text: 16_384,
  images: 16,
  datasetRows: 1_000,
  serialized: 512 * 1024,
} as const;

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export type SkillInputErrorCode =
  | 'SKILL_INPUT_REQUIRED'
  | 'SKILL_INPUT_UNKNOWN_FIELD'
  | 'SKILL_INPUT_INVALID_TYPE'
  | 'SKILL_INPUT_INVALID_VALUE'
  | 'SKILL_INPUT_INVALID_DEFINITION'
  | 'SKILL_INPUT_LIMIT_EXCEEDED'
  | 'SKILL_INPUT_SERIALIZED_LIMIT_EXCEEDED'
  | 'SKILL_INPUT_FORBIDDEN_KEY';

export class SkillInputError extends Error {
  constructor(
    readonly code: SkillInputErrorCode,
    readonly field?: string,
  ) {
    super(field ? `${code}: ${field}` : code);
    this.name = 'SkillInputError';
  }
}

function assertNoForbiddenKeys(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new SkillInputError('SKILL_INPUT_FORBIDDEN_KEY', key);
    }
    assertNoForbiddenKeys((value as Record<string, unknown>)[key], seen);
  }
}

function assertSerializedBytes(value: Record<string, unknown>): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new SkillInputError('SKILL_INPUT_INVALID_VALUE');
  }

  if (Buffer.byteLength(serialized, 'utf8') > SKILL_INPUT_LIMITS.serialized) {
    throw new SkillInputError('SKILL_INPUT_SERIALIZED_LIMIT_EXCEEDED');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidValue(field: SkillInputField): never {
  throw new SkillInputError('SKILL_INPUT_INVALID_VALUE', field.key);
}

function assertStrictJsonValue(
  value: unknown,
  field: SkillInputField,
  ancestors = new Set<object>(),
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidValue(field);
    return;
  }
  if (typeof value !== 'object') invalidValue(field);
  if (ancestors.has(value)) invalidValue(field);
  ancestors.add(value);

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => (
      typeof key === 'symbol'
      || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))
    ))) invalidValue(field);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) invalidValue(field);
      assertStrictJsonValue(value[index], field, ancestors);
    }
  } else {
    if (!isPlainObject(value)) invalidValue(field);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') invalidValue(field);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalidValue(field);
      assertStrictJsonValue(descriptor.value, field, ancestors);
    }
  }

  ancestors.delete(value);
}

function isEmpty(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === 'string' && value.trim().length === 0)
    || (Array.isArray(value) && value.length === 0);
}

function invalidType(field: SkillInputField): never {
  throw new SkillInputError('SKILL_INPUT_INVALID_TYPE', field.key);
}

function validateString(field: SkillInputField, value: unknown): string {
  if (typeof value !== 'string') invalidType(field);
  if (value.length > SKILL_INPUT_LIMITS.text) {
    throw new SkillInputError('SKILL_INPUT_LIMIT_EXCEEDED', field.key);
  }
  return value;
}

function validateImages(field: SkillInputField, value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    return invalidType(field);
  }
  const limit = Math.min(
    SKILL_INPUT_LIMITS.images,
    field.maximumItems ?? SKILL_INPUT_LIMITS.images,
  );
  if (value.length > limit) {
    throw new SkillInputError('SKILL_INPUT_LIMIT_EXCEEDED', field.key);
  }
  return value;
}

function validateDataset(field: SkillInputField, value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(row => !isPlainObject(row))) {
    return invalidType(field);
  }
  if (value.length > SKILL_INPUT_LIMITS.datasetRows) {
    throw new SkillInputError('SKILL_INPUT_LIMIT_EXCEEDED', field.key);
  }
  return value;
}

function validateField(field: SkillInputField, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;

  switch (field.kind) {
    case 'text':
    case 'image':
    case 'brand-kit':
      return validateString(field, value);
    case 'images':
      return validateImages(field, value);
    case 'dataset':
      return validateDataset(field, value);
    case 'select': {
      const selected = validateString(field, value);
      if (field.options && !field.options.includes(selected)) {
        throw new SkillInputError('SKILL_INPUT_INVALID_VALUE', field.key);
      }
      return selected;
    }
    case 'number':
      if (typeof value !== 'number') invalidType(field);
      if (!Number.isFinite(value)) {
        throw new SkillInputError('SKILL_INPUT_INVALID_VALUE', field.key);
      }
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') invalidType(field);
      return value;
  }
}

export function resolveSkillInputs(
  definition: SkillDefinition,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new SkillInputError('SKILL_INPUT_INVALID_TYPE');
  }
  assertNoForbiddenKeys(raw);

  const fields = new Map(definition.inputs.map(field => [field.key, field]));
  for (const key of Object.keys(raw)) {
    if (!fields.has(key)) {
      throw new SkillInputError('SKILL_INPUT_UNKNOWN_FIELD', key);
    }
  }

  const output: Record<string, unknown> = {};
  for (const field of definition.inputs) {
    if (FORBIDDEN_KEYS.has(field.key)) {
      throw new SkillInputError('SKILL_INPUT_FORBIDDEN_KEY', field.key);
    }
    if (field.maximumItems !== undefined && (
      typeof field.maximumItems !== 'number'
      || !Number.isFinite(field.maximumItems)
      || !Number.isInteger(field.maximumItems)
      || field.maximumItems < 0
    )) {
      throw new SkillInputError('SKILL_INPUT_INVALID_DEFINITION', field.key);
    }
    const rawValue = Object.hasOwn(raw, field.key) ? raw[field.key] : undefined;
    const value = rawValue ?? field.defaultValue;
    assertNoForbiddenKeys(value);
    if (field.required && isEmpty(value)) {
      throw new SkillInputError('SKILL_INPUT_REQUIRED', field.key);
    }
    const resolved = validateField(field, value);
    if (resolved !== undefined) assertStrictJsonValue(resolved, field);
    output[field.key] = resolved;
  }
  assertSerializedBytes(output);
  return output;
}
