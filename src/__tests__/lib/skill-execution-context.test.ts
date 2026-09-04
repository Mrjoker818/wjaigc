import { describe, expect, it } from 'vitest';
import { buildSkillStepPrompt, selectSkillPredecessorOutputs } from '@/lib/skill-runtime/execution-context';
import { CANVAS_PRESET_SKILLS } from '@/lib/skill-runtime/canvas-presets';

describe('frozen Skill execution context', () => {
  const original = CANVAS_PRESET_SKILLS.find(skill => skill.id === 'preset-food-photography')!;
  const definition = { ...original, executionContextVersion: 1 as const };
  const step = definition.steps[1];

  it('includes user requirements and completed planning, not only assistant boilerplate', () => {
    const prompt = buildSkillStepPrompt({ definition, step,
      inputValues: { dish: 'strawberry cake', cuisine: 'dessert', purpose: 'menu' },
      previousOutputs: [{ stepId: definition.steps[0].id, kind: 'text', content: 'side light, white plate' }],
    });
    expect(prompt).toContain('strawberry cake');
    expect(prompt).toContain('side light, white plate');
    expect(prompt).toContain(definition.systemPrompt);
  });

  it.each(CANVAS_PRESET_SKILLS.map(skill => [skill.id, skill] as const))('%s preserves every text field at delivery', (_id, skill) => {
    const values = Object.fromEntries(skill.inputs.map(field => [field.key, `requirement-${field.key}`]));
    const prompt = buildSkillStepPrompt({ definition: { ...skill, executionContextVersion: 1 },
      step: skill.steps[skill.steps.length - 1], inputValues: values });
    for (const value of Object.values(values)) expect(prompt).toContain(value);
  });

  it('keeps legacy prompt behavior without the new contract', () => {
    expect(buildSkillStepPrompt({ definition: original, step,
      inputValues: { dish: 'strawberry cake' } })).toBe(step.promptTemplate);
  });

  it('excludes same parallel group and future outputs', () => {
    const steps = [definition.steps[0],
      { ...step, id: 'a', execution: 'parallel' as const, parallelGroup: 'g' },
      { ...step, id: 'b', execution: 'parallel' as const, parallelGroup: 'g' },
      { ...step, id: 'future' }];
    const outputs = steps.map(s => ({ stepId: s.id, kind: 'text' as const, content: s.id }));
    expect(selectSkillPredecessorOutputs(steps, 'b', outputs)).toEqual([outputs[0]]);
  });

  it('is independent of input property insertion order', () => {
    const base = { definition, step };
    expect(buildSkillStepPrompt({ ...base, inputValues: { dish: 'cake', purpose: 'menu' } }))
      .toBe(buildSkillStepPrompt({ ...base, inputValues: { purpose: 'menu', dish: 'cake' } }));
  });

  it('rejects oversized context instead of silently truncating requirements', () => {
    expect(() => buildSkillStepPrompt({ definition, step, inputValues: { dish: 'x'.repeat(70000) } }))
      .toThrow('SKILL_CONTEXT_TOO_LARGE');
  });

  it('does not interpolate raw image data into provider text', () => {
    expect(() => buildSkillStepPrompt({ definition, step, inputValues: { dish: 'data:image/png;base64,AAAA' } }))
      .toThrow('SKILL_CONTEXT_UNSAFE_MEDIA');
  });
});
