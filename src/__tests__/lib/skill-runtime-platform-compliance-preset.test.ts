import { describe, expect, it } from 'vitest';

import { requireSkillForSurface } from '@/lib/skill-runtime/catalog';
import { compileConditionalSkillSteps } from '@/lib/skill-runtime/step-compiler';
import { resolveSkillInputOptions, resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';
import { LOVART_PLATFORM_COMPLIANCE_SKILLS } from '@/lib/skill-runtime/platform-compliance-preset';

function validComplianceInputs(count = 1): Record<string, unknown> {
  return {
    sourceImages: Array.from({ length: count }, (_, index) => `asset-version-${index + 1}`),
    platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
    productFacts: '', claims: '', reportLanguage: '中文',
  };
}

describe('platform compliance Skill preset', () => {
  it('publishes one exact built-in definition for Canvas and Workflow only', () => {
    expect(LOVART_PLATFORM_COMPLIANCE_SKILLS).toHaveLength(1);
    expect(LOVART_PLATFORM_COMPLIANCE_SKILLS[0]).toMatchObject({
      executionContextVersion: 1,
      id: 'preset-platform-compliance-audit', version: 1,
      name: '平台素材合规检查', category: 'commerce',
      allowedSurfaces: ['canvas', 'workflow'], enabled: true, builtIn: true,
    });
    expect(requireSkillForSurface('preset-platform-compliance-audit', 'canvas'))
      .toBe(LOVART_PLATFORM_COMPLIANCE_SKILLS[0]);
    expect(requireSkillForSurface('preset-platform-compliance-audit', 'workflow'))
      .toBe(LOVART_PLATFORM_COMPLIANCE_SKILLS[0]);
  });

  it.each([1, 3, 20])('compiles one parallel vision audit per source image (%i)', count => {
    const skill = requireSkillForSurface('preset-platform-compliance-audit', 'canvas');
    const steps = compileConditionalSkillSteps(
      skill,
      resolveSkillInputs(skill, validComplianceInputs(count)),
    );
    expect(steps).toHaveLength(count);
    expect(steps.every(step => (
      step.toolId === 'compliance_audit'
      && step.execution === 'parallel'
      && step.modelRole === 'vision'
      && step.qualityGateIds.join(',') === 'output-present,structured-report-present'
    ))).toBe(true);
    expect(steps.map(step => step.parallelGroup)).toEqual(
      Array.from({ length: count }, (_, index) => (
        `preset-platform-compliance-audit:outputs:chunk:${Math.floor(index / 3)}`
      )),
    );
  });

  it('declares field-specific limits and platform-dependent region options', () => {
    const [skill] = LOVART_PLATFORM_COMPLIANCE_SKILLS;
    expect(skill.inputs.find(field => field.key === 'sourceImages')).toMatchObject({
      kind: 'images', required: true, maximumItems: 20, bindToSourceVersions: true,
      uniqueItems: true,
    });
    expect(skill.inputs.find(field => field.key === 'productFacts')?.maximumLength).toBe(4_000);
    expect(skill.inputs.find(field => field.key === 'claims')?.maximumLength).toBe(4_000);
    expect(resolveSkillInputOptions(skill.inputs, { platform: 'Amazon' }, 'region'))
      .toEqual(['US', 'EU', 'JP']);
    expect(resolveSkillInputOptions(skill.inputs, { platform: '淘宝/天猫' }, 'region'))
      .toEqual(['CN']);
  });

  it('rejects invalid combinations, asset types, source identities, and oversized facts', () => {
    const [skill] = LOVART_PLATFORM_COMPLIANCE_SKILLS;
    for (const input of [
      { ...validComplianceInputs(), region: 'CN' },
      { ...validComplianceInputs(), assetType: 'thumbnail' },
      { ...validComplianceInputs(), sourceImages: [] },
      { ...validComplianceInputs(), sourceImages: ['asset-version-1', 'asset-version-1'] },
      { ...validComplianceInputs(), sourceImages: ['asset-version-1', '   '] },
      { ...validComplianceInputs(), productFacts: 'x'.repeat(4_001) },
      { ...validComplianceInputs(), claims: 'x'.repeat(4_001) },
    ]) expect(() => resolveSkillInputs(skill, input)).toThrow();
  });
});
