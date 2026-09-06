import { describe, expect, it } from 'vitest';
import { buildSkillStepPrompt, selectSkillPredecessorOutputs } from '@/lib/skill-runtime/execution-context';
import { CANVAS_PRESET_SKILLS } from '@/lib/skill-runtime/canvas-presets';
import { LOVART_MARKETING_SKILLS } from '@/lib/skill-runtime/marketing-presets';
import { resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';

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

  it('includes validated multi-select requirements but excludes source media identifiers', () => {
    const ad = LOVART_MARKETING_SKILLS[2];
    const resolved = resolveSkillInputs(ad, {
      sourceImages: ['version-source-1'], campaignName: '秋季上新', product: '耳机',
      audience: '通勤人群', sellingPoints: '降噪', channels: ['微信', 'Instagram'],
      campaignMessage: '安静抵达', callToAction: '了解更多',
    });
    const prompt = buildSkillStepPrompt({
      definition: ad, step: ad.steps[1], inputValues: resolved,
      previousOutputs: [{ stepId: 'campaign-plan', kind: 'text', content: '只测试利益点表达' }],
    });
    expect(prompt).toContain('只测试利益点表达');
    expect(prompt).toContain('秋季上新');
    expect(prompt).toContain('["微信","Instagram"]');
    expect(prompt).not.toContain('data:image');
    expect(prompt).not.toContain('version-source-1');
  });

  it('excludes source-bound multi-select values from requirements and step interpolation', () => {
    const sourceBound = {
      ...definition,
      inputs: [{
        key: 'sources', label: 'Sources', kind: 'multi-select' as const, required: true,
        options: ['version-source-1'], maximumItems: 1, bindToSourceVersions: true,
      }],
    };
    const prompt = buildSkillStepPrompt({
      definition: sourceBound,
      step: { ...step, promptTemplate: 'Never expose {{sources}} here' },
      inputValues: { sources: ['version-source-1'] },
    });

    expect(prompt).not.toContain('version-source-1');
    expect(prompt).not.toContain('"key":"sources"');
    expect(prompt).toContain('Never expose  here');
  });
});
