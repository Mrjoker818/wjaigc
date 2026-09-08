import { describe, expect, it } from 'vitest';

import { CANVAS_WORKFLOW_SKILLS, listSkillsForSurface } from '@/lib/skill-runtime/catalog';

const secondBatchIds = [
  'preset-video-platform-thumbnails',
  'preset-pinterest-pins',
  'preset-batch-sku-assets',
];

describe('Lovart content and commerce Skill definitions', () => {
  it('publishes the three second-batch workflows only to canvas and workflow', () => {
    expect(CANVAS_WORKFLOW_SKILLS.map(skill => skill.id).slice(24, 27)).toEqual(secondBatchIds);
    expect(listSkillsForSurface('canvas').map(skill => skill.id)).toEqual(
      CANVAS_WORKFLOW_SKILLS.map(skill => skill.id),
    );
    expect(listSkillsForSurface('workflow').map(skill => skill.id)).toEqual(
      CANVAS_WORKFLOW_SKILLS.map(skill => skill.id),
    );
    expect(listSkillsForSurface('simple-chat').map(skill => skill.id))
      .not.toEqual(expect.arrayContaining(secondBatchIds));
  });
});
