const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export type SkillPromptErrorCode =
  | 'SKILL_PROMPT_UNRESOLVED'
  | 'SKILL_PROMPT_FORBIDDEN_KEY'
  | 'SKILL_PROMPT_INVALID_VALUE';

export class SkillPromptError extends Error {
  constructor(
    readonly code: SkillPromptErrorCode,
    readonly field: string,
  ) {
    super(`${code}: ${field}`);
    this.name = 'SkillPromptError';
  }
}

function invalidPromptValue(field: string): never {
  throw new SkillPromptError('SKILL_PROMPT_INVALID_VALUE', field);
}

function forbiddenPromptKey(key: string): never {
  throw new SkillPromptError('SKILL_PROMPT_FORBIDDEN_KEY', key);
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
  field: string,
  ancestors = new Set<object>(),
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidPromptValue(field);
    return;
  }
  if (typeof value !== 'object') invalidPromptValue(field);
  if (ancestors.has(value)) invalidPromptValue(field);
  ancestors.add(value);

  const { descriptors, keys } = ownDescriptorSnapshot(value);
  for (const key of keys) {
    if (typeof key === 'string' && FORBIDDEN_KEYS.has(key)) forbiddenPromptKey(key);
    if (typeof key === 'symbol') invalidPromptValue(field);
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalidPromptValue(field);
    if (!descriptor.enumerable && !(Array.isArray(value) && key === 'length')) {
      invalidPromptValue(field);
    }
  }

  if (Array.isArray(value)) {
    const length = descriptors.length?.value;
    if (typeof length !== 'number') invalidPromptValue(field);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor) invalidPromptValue(field);
      assertStrictJsonValue(descriptor.value, field, ancestors);
    }
    if (keys.length !== length + 1) {
      invalidPromptValue(field);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalidPromptValue(field);
    for (const key of keys) {
      const descriptor = descriptors[key as keyof typeof descriptors];
      assertStrictJsonValue(descriptor.value, field, ancestors);
    }
  }

  ancestors.delete(value);
}

function formatPromptValue(value: unknown, field: string): string {
  assertStrictJsonValue(value, field);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) invalidPromptValue(field);
    return serialized;
  } catch (error) {
    if (error instanceof SkillPromptError) throw error;
    return invalidPromptValue(field);
  }
}

function unresolvedField(fragment: string): string {
  const start = fragment.indexOf('{{');
  if (start < 0) return '';
  const end = fragment.indexOf('}}', start + 2);
  return fragment.slice(start + 2, end < 0 ? undefined : end).trim();
}

export function compileSkillPrompt(
  template: string,
  values: Readonly<Record<string, unknown>>,
): string {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new SkillPromptError('SKILL_PROMPT_INVALID_VALUE', '');
  }
  const valuesSnapshot = ownDescriptorSnapshot(values);
  const valuesPrototype = Object.getPrototypeOf(values);
  if (valuesPrototype !== Object.prototype && valuesPrototype !== null) {
    throw new SkillPromptError('SKILL_PROMPT_INVALID_VALUE', '');
  }
  for (const key of valuesSnapshot.keys) {
    const label = String(key);
    if (typeof key === 'string' && FORBIDDEN_KEYS.has(key)) forbiddenPromptKey(key);
    if (typeof key === 'symbol') invalidPromptValue(label);
    const descriptor = valuesSnapshot.descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      invalidPromptValue(label);
    }
  }

  let compiled = '';
  let cursor = 0;

  while (cursor < template.length) {
    const start = template.indexOf('{{', cursor);
    const strayClose = template.indexOf('}}', cursor);
    if (strayClose >= 0 && (start < 0 || strayClose < start)) {
      throw new SkillPromptError('SKILL_PROMPT_UNRESOLVED', '');
    }
    if (start < 0) {
      compiled += template.slice(cursor);
      break;
    }
    compiled += template.slice(cursor, start);
    const end = template.indexOf('}}', start + 2);
    if (end < 0) {
      throw new SkillPromptError('SKILL_PROMPT_UNRESOLVED', template.slice(start + 2).trim());
    }
    const key = template.slice(start + 2, end).trim();
    if (!key || key.includes('{{')) {
      throw new SkillPromptError('SKILL_PROMPT_UNRESOLVED', key);
    }
    if (FORBIDDEN_KEYS.has(key)) {
      throw new SkillPromptError('SKILL_PROMPT_FORBIDDEN_KEY', key);
    }
    const valueDescriptor = valuesSnapshot.descriptors[key];
    if (!valueDescriptor) {
      throw new SkillPromptError('SKILL_PROMPT_UNRESOLVED', key);
    }
    compiled += formatPromptValue(valueDescriptor.value, key);
    cursor = end + 2;
  }

  if (compiled.includes('{{') || compiled.includes('}}')) {
    throw new SkillPromptError('SKILL_PROMPT_UNRESOLVED', unresolvedField(compiled));
  }
  return compiled;
}
