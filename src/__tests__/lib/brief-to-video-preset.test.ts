import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BRIEF_TO_VIDEO_SKILL_ID,
  createBriefToVideoSkill,
} from '@/lib/skill-runtime/brief-to-video-preset';

describe('brief to video Skill preset', () => {
  afterEach(() => {
    delete process.env.BRIEF_TO_VIDEO_SKILL_ENABLED;
    delete process.env.MULTI_PLATFORM_EXPORT_ENABLED;
    vi.resetModules();
  });

  it('declares one approval-gated plan followed by one exact video step', () => {
    const skill = createBriefToVideoSkill(true);

    expect(skill.id).toBe(BRIEF_TO_VIDEO_SKILL_ID);
    expect(skill.allowedSurfaces).toEqual(['canvas', 'workflow', 'simple-chat']);
    expect(skill.catalogSurfaces).toEqual(['canvas', 'workflow']);
    expect(skill.steps).toEqual([
      expect.objectContaining({
        id: 'plan-film',
        toolId: 'brief_video_plan',
        modelRole: 'orchestrator',
        approvalCheckpoint: {
          kind: 'user-approval',
          outputSchemaId: 'brief-to-video-plan-v1',
          nextStepId: 'generate-film',
          allowRevision: true,
        },
      }),
      expect.objectContaining({
        id: 'generate-film',
        toolId: 'video_generate',
        modelRole: 'video',
      }),
    ]);
  });

  it('keeps the Skill disabled unless the environment flag is exactly true', async () => {
    process.env.MULTI_PLATFORM_EXPORT_ENABLED = 'true';
    process.env.BRIEF_TO_VIDEO_SKILL_ENABLED = 'true';
    let catalog = await import('@/lib/skill-runtime/catalog');

    expect(catalog.listSkillsForSurface('canvas')).toHaveLength(30);
    expect(catalog.listSkillsForSurface('workflow')).toHaveLength(30);
    expect(catalog.listSkillsForSurface('simple-chat')).toHaveLength(16);
    expect(catalog.listSkillsForSurface('simple-chat').some(
      skill => skill.id === BRIEF_TO_VIDEO_SKILL_ID,
    )).toBe(false);
    expect(catalog.requireSkillForSurface(BRIEF_TO_VIDEO_SKILL_ID, 'simple-chat').id)
      .toBe(BRIEF_TO_VIDEO_SKILL_ID);

    vi.resetModules();
    process.env.BRIEF_TO_VIDEO_SKILL_ENABLED = 'TRUE';
    catalog = await import('@/lib/skill-runtime/catalog');
    expect(catalog.listSkillsForSurface('canvas').some(
      skill => skill.id === BRIEF_TO_VIDEO_SKILL_ID,
    )).toBe(false);
  });
});
