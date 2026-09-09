import { describe, expect, it } from 'vitest';

import {
  skillStepModelRole,
  skillStepRuntime,
  validateSkillStep,
} from '@/lib/skill-runtime/step-compiler';

describe('Skill runtime local steps', () => {
  const localStep = {
    id: 'export', label: '批量导出', toolId: 'multi_platform_export',
    runtime: 'local' as const, execution: 'sequential' as const,
    promptTemplate: '', qualityGateIds: ['output-present'],
  };

  it('accepts a local step without a model role', () => {
    expect(validateSkillStep(localStep)).toEqual(localStep);
    expect(skillStepRuntime(localStep)).toBe('local');
    expect(skillStepModelRole(localStep)).toBeUndefined();
  });

  it('rejects model fields on local steps and missing bindings on model steps', () => {
    expect(() => validateSkillStep({ ...localStep, modelRole: 'image' }))
      .toThrow('SKILL_LOCAL_STEP_MODEL_ROLE_FORBIDDEN');
    expect(() => validateSkillStep({ ...localStep, runtime: 'model' }))
      .toThrow('SKILL_MODEL_BINDING_REQUIRED');
  });

  it('keeps legacy steps model-backed without rewriting their serialized shape', () => {
    const legacyStep = { ...localStep, runtime: undefined, modelRole: 'image' as const };
    delete legacyStep.runtime;

    expect(skillStepRuntime(legacyStep)).toBe('model');
    expect(skillStepModelRole(legacyStep)).toBe('image');
    expect(validateSkillStep(legacyStep)).toEqual(legacyStep);
    expect(legacyStep).not.toHaveProperty('runtime');
  });
});
