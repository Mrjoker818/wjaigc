const PLACEHOLDER_PATTERN = /{{\s*([^{}]+?)\s*}}/g;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export type SkillPromptErrorCode =
  | 'SKILL_PROMPT_UNRESOLVED'
  | 'SKILL_PROMPT_FORBIDDEN_KEY';

export class SkillPromptError extends Error {
  constructor(
    readonly code: SkillPromptErrorCode,
    readonly field: string,
  ) {
    super(`${code}: ${field}`);
    this.name = 'SkillPromptError';
  }
}

function formatPromptValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function compileSkillPrompt(
  template: string,
  values: Readonly<Record<string, unknown>>,
): string {
  const compiled = template.replace(PLACEHOLDER_PATTERN, (_placeholder, capturedKey: string) => {
    const key = capturedKey.trim();
    if (FORBIDDEN_KEYS.has(key)) {
      throw new SkillPromptError('SKILL_PROMPT_FORBIDDEN_KEY', key);
    }
    if (!Object.prototype.hasOwnProperty.call(values, key) || values[key] === undefined) {
      throw new SkillPromptError('SKILL_PROMPT_UNRESOLVED', key);
    }
    return formatPromptValue(values[key]);
  });

  const unresolved = compiled.match(/{{\s*([^{}]+?)\s*}}/);
  if (unresolved) {
    throw new SkillPromptError('SKILL_PROMPT_UNRESOLVED', unresolved[1].trim());
  }
  return compiled;
}
