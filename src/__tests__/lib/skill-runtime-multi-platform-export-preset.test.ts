import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredSkillModelRoles } from '@/lib/skill-runtime/types';

vi.mock('server-only', () => ({}));

describe('multi-platform export Skill preset', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defines a zero-model local Skill without changing the original 21 identities', async () => {
    const { createMultiPlatformExportSkill } = await import(
      '@/lib/skill-runtime/multi-platform-export-preset'
    );
    const { CANVAS_PRESET_SKILLS } = await import('@/lib/skill-runtime/canvas-presets');
    const originalIds = CANVAS_PRESET_SKILLS.map(skill => skill.id);
    const skill = createMultiPlatformExportSkill(true);

    expect(skill).toMatchObject({
      id: 'preset-multi-platform-export',
      version: 1,
      allowedSurfaces: ['canvas', 'workflow', 'simple-chat'],
      catalogSurfaces: ['canvas', 'workflow'],
      enabled: true,
      builtIn: true,
    });
    expect(skill.inputs.map(field => field.key)).toEqual([
      'sourceAssetVersionIds', 'targetPresetIds', 'fit', 'background', 'namingTemplate',
    ]);
    expect(skill.inputs[0]).toMatchObject({
      kind: 'images', maximumItems: 20, uniqueItems: true, bindToSourceVersions: true,
    });
    expect(skill.steps).toEqual([expect.objectContaining({
      id: 'export', toolId: 'multi_platform_export', runtime: 'local',
      execution: 'sequential', promptTemplate: '', qualityGateIds: ['output-present'],
    })]);
    expect(requiredSkillModelRoles(skill)).toEqual([]);
    expect(CANVAS_PRESET_SKILLS.map(candidate => candidate.id)).toEqual(originalIds);
    expect(originalIds).toHaveLength(21);
  });

  it('is visible only in Canvas and Workflow while Simple Chat remains authorized', async () => {
    vi.stubEnv('MULTI_PLATFORM_EXPORT_ENABLED', 'true');
    const { listSkillsForSurface, requireSkillForSurface } = await import(
      '@/lib/skill-runtime/catalog'
    );

    expect(listSkillsForSurface('canvas').some(skill => skill.id === 'preset-multi-platform-export')).toBe(true);
    expect(listSkillsForSurface('workflow').some(skill => skill.id === 'preset-multi-platform-export')).toBe(true);
    expect(listSkillsForSurface('simple-chat').some(skill => skill.id === 'preset-multi-platform-export')).toBe(false);
    expect(requireSkillForSurface('preset-multi-platform-export', 'simple-chat').id)
      .toBe('preset-multi-platform-export');
  });

  it('does not enter a new-run catalog when disabled', async () => {
    vi.stubEnv('MULTI_PLATFORM_EXPORT_ENABLED', 'false');
    const { listSkillsForSurface, requireSkillForSurface, SkillSurfaceForbiddenError } = await import(
      '@/lib/skill-runtime/catalog'
    );

    expect(listSkillsForSurface('canvas').some(skill => skill.id === 'preset-multi-platform-export')).toBe(false);
    expect(() => requireSkillForSurface('preset-multi-platform-export', 'canvas'))
      .toThrowError(SkillSurfaceForbiddenError);
  });
});
