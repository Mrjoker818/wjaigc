import { compileSkillPrompt } from './prompt-compiler';
import type { DurableSkillOutput, SkillDefinition, SkillStepDefinition } from './types';

export function selectSkillPredecessorOutputs(
  steps: readonly SkillStepDefinition[],
  stepId: string,
  outputs: readonly DurableSkillOutput[],
): DurableSkillOutput[] {
  let boundary = steps.findIndex(step => step.id === stepId);
  if (boundary < 0) return [];
  const current = steps[boundary];
  if (current.execution === 'parallel' && current.parallelGroup) {
    while (boundary > 0 && steps[boundary - 1].execution === 'parallel'
      && steps[boundary - 1].parallelGroup === current.parallelGroup) boundary -= 1;
  }
  return steps.slice(0, boundary).flatMap(step => {
    const output = outputs.find(item => item.stepId === step.id && item.kind === 'text');
    return output ? [output] : [];
  });
}

export function buildSkillStepPrompt(input: {
  definition: SkillDefinition;
  step: SkillStepDefinition;
  inputValues: Record<string, unknown>;
  previousOutputs?: readonly DurableSkillOutput[];
}): string {
  if (input.definition.executionContextVersion !== 1) {
    return compileSkillPrompt(input.step.promptTemplate, input.inputValues);
  }
  // Structured media stays on the authorized asset path, never in provider text.
  type PromptRequirementValue = string | number | boolean | null | readonly string[];
  const values: Record<string, PromptRequirementValue> = {};
  const requirements: Array<{ key: string; label: string; value: PromptRequirementValue }> = [];
  for (const field of input.definition.inputs) {
    if (!['text', 'select', 'multi-select', 'number', 'boolean'].includes(field.kind)) continue;
    const value = input.inputValues[field.key];
    if (value === undefined) continue;
    if (field.kind === 'multi-select') {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new Error('SKILL_CONTEXT_INVALID_VALUE');
      }
      values[field.key] = [...value];
      requirements.push({ key: field.key, label: field.label, value: [...value] });
      continue;
    }
    if (value !== null && typeof value !== 'string' && typeof value !== 'number'
      && typeof value !== 'boolean') throw new Error('SKILL_CONTEXT_INVALID_VALUE');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('SKILL_CONTEXT_INVALID_VALUE');
    values[field.key] = value;
    requirements.push({ key: field.key, label: field.label, value });
  }
  const prompt = [
    input.definition.systemPrompt,
    'User requirements (authoritative; preserve the requested subject):',
    JSON.stringify(requirements),
    'Completed predecessor planning (supporting context, not a replacement for user requirements):',
    JSON.stringify(selectSkillPredecessorOutputs(input.definition.steps, input.step.id, input.previousOutputs || [])),
    'Current step:',
    compileSkillPrompt(input.step.promptTemplate, values),
  ].join('\n\n');
  if (/data:[^\s,]*;base64,/i.test(prompt)) throw new Error('SKILL_CONTEXT_UNSAFE_MEDIA');
  if (new TextEncoder().encode(prompt).byteLength > 65536) throw new Error('SKILL_CONTEXT_TOO_LARGE');
  return prompt;
}
