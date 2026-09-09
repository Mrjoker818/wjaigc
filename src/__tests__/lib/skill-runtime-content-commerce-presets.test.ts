import { describe, expect, it } from 'vitest';

import { CANVAS_WORKFLOW_SKILLS, listSkillsForSurface } from '@/lib/skill-runtime/catalog';
import { MULTI_PLATFORM_EXPORT_SKILL } from '@/lib/skill-runtime/multi-platform-export-preset';

const secondBatchIds = [
  'preset-video-platform-thumbnails',
  'preset-pinterest-pins',
  'preset-batch-sku-assets',
];

const originalCanvasWorkflowSkillIds = [
  'preset-ecommerce-listing', 'preset-logo-brand', 'preset-storyboard',
  'preset-marketing-brochure', 'preset-social-media', 'preset-ip-character',
  'preset-product-packaging', 'preset-concept-art', 'preset-interior-design',
  'preset-poster-design', 'preset-ppt-design', 'preset-magazine-cover',
  'preset-apparel-fashion', 'preset-business-card', 'preset-book-cover',
  'preset-sticker-emoji', 'preset-comic-manga', 'preset-mockup-showcase',
  'preset-illustration', 'preset-ui-design', 'preset-food-photography',
  'preset-ad-ab-variants', 'preset-retargeting-creative', 'preset-omnichannel-campaign',
  ...secondBatchIds,
  'preset-platform-compliance-audit',
];

describe('Lovart content and commerce Skill definitions', () => {
  it('publishes the three second-batch workflows only to canvas and workflow', () => {
    expect(CANVAS_WORKFLOW_SKILLS.map(skill => skill.id).slice(24, 27)).toEqual(secondBatchIds);
    expect(CANVAS_WORKFLOW_SKILLS.slice(0, 28).map(skill => skill.id))
      .toEqual(originalCanvasWorkflowSkillIds);
    expect(listSkillsForSurface('simple-chat').map(skill => skill.id))
      .not.toEqual(expect.arrayContaining(secondBatchIds));
  });

  it('lists optional multi-platform export only when enabled and only on catalog surfaces', () => {
    const previous = MULTI_PLATFORM_EXPORT_SKILL.enabled;
    try {
      MULTI_PLATFORM_EXPORT_SKILL.enabled = false;
      expect(listSkillsForSurface('canvas').map(skill => skill.id))
        .toEqual(originalCanvasWorkflowSkillIds);
      expect(listSkillsForSurface('workflow').map(skill => skill.id))
        .toEqual(originalCanvasWorkflowSkillIds);
      MULTI_PLATFORM_EXPORT_SKILL.enabled = true;
      expect(listSkillsForSurface('canvas').map(skill => skill.id)).toEqual([
        ...originalCanvasWorkflowSkillIds, 'preset-multi-platform-export',
      ]);
      expect(listSkillsForSurface('workflow').map(skill => skill.id)).toEqual([
        ...originalCanvasWorkflowSkillIds, 'preset-multi-platform-export',
      ]);
      expect(listSkillsForSurface('simple-chat').map(skill => skill.id))
        .not.toContain('preset-multi-platform-export');
      expect(MULTI_PLATFORM_EXPORT_SKILL.catalogSurfaces).toEqual(['canvas', 'workflow']);
    } finally {
      MULTI_PLATFORM_EXPORT_SKILL.enabled = previous;
    }
  });
});
