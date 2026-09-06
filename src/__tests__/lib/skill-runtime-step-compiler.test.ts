import { describe, expect, it } from 'vitest';

import { skillExecutionSteps } from '@/lib/skill-runtime/cost-estimator';
import { LOVART_CONTENT_COMMERCE_SKILLS } from '@/lib/skill-runtime/content-commerce-presets';
import { resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

const conditionalSkill = {
  id: 'conditional-test', version: 1, name: 'Conditional', category: 'test',
  description: 'test', systemPrompt: 'test', allowedSurfaces: ['canvas'], inputs: [
    { key: 'seriesCount', label: 'Count', kind: 'select', required: true, options: ['2', '3'] },
  ],
  steps: [
    {
      id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential',
      promptTemplate: 'plan', modelRole: 'orchestrator', qualityGateIds: [],
    },
    {
      id: 'first', label: 'First', toolId: 'img2img', execution: 'parallel',
      parallelGroup: 'outputs', promptTemplate: 'first', modelRole: 'image', qualityGateIds: [],
    },
    {
      id: 'third', label: 'Third', toolId: 'img2img', execution: 'parallel',
      parallelGroup: 'outputs', promptTemplate: 'third', modelRole: 'image', qualityGateIds: [],
      when: { input: 'seriesCount', includes: ['3'] },
    },
  ],
  enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
} as SkillDefinition;

describe('Skill execution step compiler', () => {
  it('omits a conditional step when the resolved input does not match', () => {
    expect(skillExecutionSteps(conditionalSkill, { seriesCount: '2' }).map(step => step.id))
      .toEqual(['plan', 'first']);
  });

  it('keeps a conditional step when the resolved input matches', () => {
    expect(skillExecutionSteps(conditionalSkill, { seriesCount: '3' }).map(step => step.id))
      .toEqual(['plan', 'first', 'third']);
  });

  it('compiles the real Pinterest series count without changing its definition', () => {
    const pinterest = LOVART_CONTENT_COMMERCE_SKILLS.find(
      skill => skill.id === 'preset-pinterest-pins',
    )!;

    expect(skillExecutionSteps(pinterest, { seriesCount: '2' }).map(step => step.id))
      .toEqual(['pin-plan', 'pin-hero', 'pin-detail']);
    expect(skillExecutionSteps(pinterest, { seriesCount: '3' }).map(step => step.id))
      .toEqual(['pin-plan', 'pin-hero', 'pin-detail', 'pin-conversion']);
    expect(pinterest.steps.at(-1)?.when).toEqual({ input: 'seriesCount', includes: ['3'] });
  });

  it('freezes the advertised output ratio for thumbnail and Pinterest presets', () => {
    const thumbnails = LOVART_CONTENT_COMMERCE_SKILLS.find(
      skill => skill.id === 'preset-video-platform-thumbnails',
    )!;
    const pinterest = LOVART_CONTENT_COMMERCE_SKILLS.find(
      skill => skill.id === 'preset-pinterest-pins',
    )!;

    expect(resolveSkillInputs(thumbnails, {
      sourceImages: ['source-1'], videoTitle: 'Title', subject: 'Cake',
      audience: 'Bakers', hook: 'Learn quickly',
    }).aspectRatio).toBe('16:9');
    expect(resolveSkillInputs(pinterest, {
      sourceImages: ['source-1'], topic: 'Cake', audience: 'Bakers', goal: '收藏',
    }).aspectRatio).toBe('2:3');
  });

  it('rejects a condition that references an undeclared input', () => {
    const invalid = {
      ...conditionalSkill,
      steps: conditionalSkill.steps.map(step => step.id === 'third'
        ? { ...step, when: { input: 'missing', includes: ['3'] } }
        : step),
    } as SkillDefinition;

    expect(() => skillExecutionSteps(invalid, {})).toThrowError(expect.objectContaining({
      code: 'SKILL_STEP_CONDITION_INVALID',
      stepId: 'third',
    }));
  });
});
