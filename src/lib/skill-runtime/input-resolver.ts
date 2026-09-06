import type { SkillDefinition, SkillInputField } from './types';
import { normalizeSkuDataset, SkillDatasetSchemaError } from './dataset-schema';

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
  | 'SKILL_INPUT_FORBIDDEN_KEY'
  | 'SKILL_DATASET_DUPLICATE_SKU'
  | 'SKILL_DATASET_UNKNOWN_FIELD'
  | 'SKILL_DATASET_INVALID_ROW'
  | 'SKILL_DATASET_FORMULA_VALUE';

export class SkillInputError extends Error {
  constructor(
    readonly code: SkillInputErrorCode,
    readonly field?: string,
  ) {
    super(field ? `${code}: ${field}` : code);
    this.name = 'SkillInputError';
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

function forbiddenKey(key: string): never {
  throw new SkillInputError('SKILL_INPUT_FORBIDDEN_KEY', key);
}

function ownDescriptorSnapshot(value: object): {
  descriptors: PropertyDescriptorMap;
  keys: readonly PropertyKey[];
} {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return { descriptors, keys: Reflect.ownKeys(value) };
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

  const { descriptors, keys } = ownDescriptorSnapshot(value);
  for (const key of keys) {
    if (typeof key === 'string' && FORBIDDEN_KEYS.has(key)) forbiddenKey(key);
    if (typeof key === 'symbol') invalidValue(field);
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalidValue(field);
    if (!descriptor.enumerable && !(Array.isArray(value) && key === 'length')) {
      invalidValue(field);
    }
  }

  if (Array.isArray(value)) {
    const length = descriptors.length?.value;
    if (typeof length !== 'number') invalidValue(field);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor) invalidValue(field);
      assertStrictJsonValue(descriptor.value, field, ancestors);
    }
    if (keys.length !== length + 1) {
      invalidValue(field);
    }
  } else {
    if (!isPlainObject(value)) invalidValue(field);
    for (const key of keys) {
      const descriptor = descriptors[key as keyof typeof descriptors];
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

function validateMultiSelect(field: SkillInputField, value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    return invalidType(field);
  }
  const limit = field.maximumItems ?? SKILL_INPUT_LIMITS.images;
  if (value.length > limit) {
    throw new SkillInputError('SKILL_INPUT_LIMIT_EXCEEDED', field.key);
  }
  if (new Set(value).size !== value.length
    || (field.options && value.some(item => !field.options!.includes(item)))) {
    throw new SkillInputError('SKILL_INPUT_INVALID_VALUE', field.key);
  }
  return value;
}

function validateDataset(field: SkillInputField, value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(row => (
    row === null || typeof row !== 'object' || Array.isArray(row)
  ))) {
    return invalidType(field);
  }
  const limit = Math.min(
    field.maximumItems ?? SKILL_INPUT_LIMITS.datasetRows,
    SKILL_INPUT_LIMITS.datasetRows,
  );
  if (value.length > limit) {
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
    case 'multi-select':
      return validateMultiSelect(field, value);
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
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SkillInputError('SKILL_INPUT_INVALID_TYPE');
  }

  const fields = new Map(definition.inputs.map(field => [field.key, field]));
  const rawSnapshot = ownDescriptorSnapshot(raw);
  if (!isPlainObject(raw)) {
    throw new SkillInputError('SKILL_INPUT_INVALID_TYPE');
  }
  for (const key of rawSnapshot.keys) {
    const label = String(key);
    if (typeof key === 'string' && FORBIDDEN_KEYS.has(key)) forbiddenKey(key);
    if (typeof key !== 'string' || !fields.has(key)) {
      throw new SkillInputError('SKILL_INPUT_UNKNOWN_FIELD', label);
    }
    const descriptor = rawSnapshot.descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new SkillInputError('SKILL_INPUT_INVALID_VALUE', label);
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
      || field.maximumItems < 1
    )) {
      throw new SkillInputError('SKILL_INPUT_INVALID_DEFINITION', field.key);
    }
    const rawDescriptor = rawSnapshot.descriptors[field.key];
    const rawValue = rawDescriptor?.value;
    const value = rawValue ?? field.defaultValue;
    if (field.required && isEmpty(value)) {
      throw new SkillInputError('SKILL_INPUT_REQUIRED', field.key);
    }
    if (value !== undefined) assertStrictJsonValue(value, field);
    const resolved = validateField(field, value);
    output[field.key] = resolved;
  }
  for (const field of definition.inputs) {
    if (field.kind !== 'dataset' || field.datasetSchema === undefined) continue;
    if (field.datasetSchema !== 'sku-v1') {
      throw new SkillInputError('SKILL_INPUT_INVALID_DEFINITION', field.key);
    }
    try {
      output[field.key] = normalizeSkuDataset(output[field.key]);
    } catch (error) {
      if (error instanceof SkillDatasetSchemaError) {
        throw new SkillInputError(error.code, field.key);
      }
      throw error;
    }
  }
  assertSerializedBytes(output);
  return output;
}
