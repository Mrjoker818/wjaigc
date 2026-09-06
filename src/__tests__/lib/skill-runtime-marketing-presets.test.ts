import { describe, expect, it } from 'vitest';

import { LOVART_MARKETING_SKILLS } from '@/lib/skill-runtime/marketing-presets';

describe('Lovart marketing Skill definitions', () => {
  it('defines three canvas/workflow-only built-ins with stable ids', () => {
    expect(LOVART_MARKETING_SKILLS.map(skill => skill.id)).toEqual([
      'preset-ad-ab-variants',
      'preset-retargeting-creative',
      'preset-omnichannel-campaign',
    ]);
    expect(LOVART_MARKETING_SKILLS.every(skill => (
      skill.version === 1
      && skill.executionContextVersion === 1
      && skill.builtIn
      && skill.enabled
      && skill.allowedSurfaces.join(',') === 'canvas,workflow'
    ))).toBe(true);
  });

  it('requires version-bound source images without exposing brand kits', () => {
    for (const skill of LOVART_MARKETING_SKILLS) {
      expect(skill.inputs.find(input => input.key === 'sourceImages')).toEqual({
        key: 'sourceImages',
        label: '来源图片',
        kind: 'images',
        required: true,
        maximumItems: 6,
        bindToSourceVersions: true,
      });
      expect(skill.inputs.some(input => input.key === 'brandKit')).toBe(false);
    }
  });

  it('defines the dedicated marketing inputs and choices', () => {
    const [variants, retargeting, omnichannel] = LOVART_MARKETING_SKILLS;

    expect(variants.inputs.slice(-3)).toEqual([
      { key: 'objective', label: '营销目标', kind: 'select', required: true, options: ['认知', '点击', '加购', '购买', '留资'] },
      { key: 'channel', label: '投放渠道', kind: 'select', required: true, options: ['信息流', '搜索展示', '社交媒体', '电商站内'] },
      { key: 'hypothesis', label: '测试假设', kind: 'text', required: false },
    ]);
    expect(retargeting.inputs.slice(-4)).toEqual([
      { key: 'funnelStage', label: '漏斗阶段', kind: 'select', required: true, options: ['浏览未点击', '点击未加购', '加购未购买', '老客复购'] },
      { key: 'objection', label: '购买顾虑', kind: 'text', required: false },
      { key: 'offer', label: '促销方案', kind: 'text', required: false },
      { key: 'urgency', label: '紧迫程度', kind: 'select', required: false, defaultValue: '温和', options: ['无', '温和', '明确'] },
    ]);
    expect(omnichannel.inputs.slice(-4)).toEqual([
      { key: 'channels', label: '投放渠道', kind: 'multi-select', required: true, defaultValue: ['小红书', '微信', 'Instagram', '电商站内'], options: ['小红书', '微信', 'Instagram', '电商站内'], maximumItems: 6 },
      { key: 'campaignMessage', label: '活动主张', kind: 'text', required: true },
      { key: 'callToAction', label: '行动号召', kind: 'text', required: true },
      { key: 'visualAnchor', label: '视觉锚点', kind: 'text', required: false },
    ]);
  });

  it('uses img2img for every finished creative', () => {
    for (const skill of LOVART_MARKETING_SKILLS) {
      const outputSteps = skill.steps.filter(step => step.modelRole === 'image');
      expect(outputSteps.length).toBeGreaterThan(0);
      expect(outputSteps.every(step => (
        step.toolId === 'img2img'
        && step.execution === 'parallel'
        && step.parallelGroup === `${skill.id}:outputs`
        && step.qualityGateIds.join(',') === 'output-present'
      ))).toBe(true);
      expect(skill.steps.some(step => step.toolId === 'generate_image')).toBe(false);
    }
  });

  it('keeps deterministic output steps and quality gates', () => {
    expect(LOVART_MARKETING_SKILLS.map(skill => skill.steps.map(step => ({
      id: step.id,
      toolId: step.toolId,
      execution: step.execution,
      parallelGroup: step.parallelGroup,
      role: step.modelRole,
      gates: step.qualityGateIds,
    })))).toMatchSnapshot();
  });
});
