import { describe, expect, it } from 'vitest';

import {
  bindCanvasSkillSourceInputs,
  collectCanvasSkillSourceVersionIds,
} from '@/lib/skill-runtime/canvas-source-inputs';
import type { SkillInputField } from '@/lib/skill-runtime/types';

const fields: readonly SkillInputField[] = [
  { key: 'sourceImages', label: '来源图片', kind: 'images', required: true, bindToSourceVersions: true },
  { key: 'campaignName', label: '活动名称', kind: 'text', required: true },
];

describe('Canvas Skill source inputs', () => {
  it('collects selected, pending, and mentioned versions once in display order', () => {
    expect(collectCanvasSkillSourceVersionIds({
      selected: { assetVersionId: 'version-selected' },
      pending: [{ assetVersionId: 'version-pending' }, { assetVersionId: 'version-selected' }],
      mentions: [{ assetVersionId: 'version-mentioned' }, {}],
    })).toEqual(['version-selected', 'version-pending', 'version-mentioned']);
  });

  it('binds the same source versions without replacing explicit input values', () => {
    expect(bindCanvasSkillSourceInputs(fields, { campaignName: '秋季活动' }, ['version-a', 'version-b']))
      .toEqual({ campaignName: '秋季活动', sourceImages: ['version-a', 'version-b'] });
    expect(bindCanvasSkillSourceInputs(fields, {
      campaignName: '秋季活动', sourceImages: ['version-manual'],
    }, ['version-a'])).toEqual({
      campaignName: '秋季活动', sourceImages: ['version-manual'],
    });
  });

  it('binds distinct single-image fields in source order without duplicating one frame', () => {
    const frameFields: readonly SkillInputField[] = [
      { key: 'startFrame', label: '首帧', kind: 'image', required: false, bindToSourceVersions: true },
      { key: 'endFrame', label: '尾帧', kind: 'image', required: false, bindToSourceVersions: true },
    ];

    expect(bindCanvasSkillSourceInputs(frameFields, {}, ['version-a']))
      .toEqual({ startFrame: 'version-a' });
    expect(bindCanvasSkillSourceInputs(frameFields, {}, ['version-a', 'version-b']))
      .toEqual({ startFrame: 'version-a', endFrame: 'version-b' });
  });
});
