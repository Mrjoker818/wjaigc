import { describe, expect, it } from 'vitest';

import { buildSkillStepPrompt } from '@/lib/skill-runtime/execution-context';
import { resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';
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
    expect(LOVART_MARKETING_SKILLS.map(skill => skill.name)).toEqual([
      '广告 A/B 变体',
      '再营销素材',
      '全渠道活动素材包',
    ]);
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
      { key: 'hypothesis', label: '测试假设', kind: 'text', required: false, defaultValue: '未指定；请提出一个可验证的单变量假设' },
    ]);
    expect(retargeting.inputs.slice(-4)).toEqual([
      { key: 'funnelStage', label: '漏斗阶段', kind: 'select', required: true, options: ['浏览未点击', '点击未加购', '加购未购买', '老客复购'] },
      { key: 'objection', label: '购买顾虑', kind: 'text', required: false, defaultValue: '未提供；请根据漏斗阶段判断常见顾虑，但不得编造事实' },
      { key: 'offer', label: '促销方案', kind: 'text', required: false, defaultValue: '未提供优惠；使用非价格行动理由，不得虚构折扣' },
      { key: 'urgency', label: '紧迫程度', kind: 'select', required: false, defaultValue: '温和', options: ['无', '温和', '明确'] },
    ]);
    expect(omnichannel.inputs.slice(-4)).toEqual([
      { key: 'channels', label: '投放渠道', kind: 'multi-select', required: true, defaultValue: ['小红书', '微信', 'Instagram', '电商站内'], options: ['小红书', '微信', '微博', '抖音', 'Instagram', 'Facebook', '电商站内', '品牌官网', '邮件'], maximumItems: 6 },
      { key: 'campaignMessage', label: '活动主张', kind: 'text', required: true },
      { key: 'callToAction', label: '行动号召', kind: 'text', required: true },
      { key: 'visualAnchor', label: '视觉锚点', kind: 'text', required: false, defaultValue: '沿用来源图片中的产品身份与核心视觉元素' },
    ]);
  });

  it('provides safe defaults for every optional field referenced by prompts', () => {
    for (const skill of LOVART_MARKETING_SKILLS) {
      for (const field of skill.inputs.filter(input => !input.required)) {
        const referenced = skill.steps.some(step => step.promptTemplate.includes(`{{${field.key}}}`));
        if (referenced) expect(field.defaultValue, `${skill.id}:${field.key}`).toBeDefined();
      }
    }
    expect(LOVART_MARKETING_SKILLS[0].inputs.find(input => input.key === 'negativeConstraints')).toMatchObject({
      defaultValue: '无额外禁止内容',
    });
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

  it('carries tone, aspect ratio, and negative constraints into every finished creative', () => {
    for (const skill of LOVART_MARKETING_SKILLS) {
      for (const step of skill.steps.filter(candidate => candidate.modelRole === 'image')) {
        expect(step.promptTemplate, `${skill.id}:${step.id}`).toContain('{{tone}}');
        expect(step.promptTemplate, `${skill.id}:${step.id}`).toContain('{{aspectRatio}}');
        expect(step.promptTemplate, `${skill.id}:${step.id}`).toContain('{{negativeConstraints}}');
      }
    }
  });

  it('resolves omitted optional inputs and builds every step without placeholders', () => {
    const requiredInputsBySkill: Record<string, Record<string, unknown>> = {
      'preset-ad-ab-variants': {
        sourceImages: ['asset-version-1'],
        campaignName: '秋季上新',
        product: '降噪耳机',
        audience: '通勤人群',
        sellingPoints: '轻盈佩戴与主动降噪',
        objective: '点击',
        channel: '信息流',
      },
      'preset-retargeting-creative': {
        sourceImages: ['asset-version-1'],
        campaignName: '召回计划',
        product: '降噪耳机',
        audience: '加购未购买用户',
        sellingPoints: '轻盈佩戴与主动降噪',
        funnelStage: '加购未购买',
      },
      'preset-omnichannel-campaign': {
        sourceImages: ['asset-version-1'],
        campaignName: '秋季整合营销',
        product: '降噪耳机',
        audience: '通勤人群',
        sellingPoints: '轻盈佩戴与主动降噪',
        campaignMessage: '安静抵达每一程',
        callToAction: '了解更多',
      },
    };

    for (const skill of LOVART_MARKETING_SKILLS) {
      const resolved = resolveSkillInputs(skill, requiredInputsBySkill[skill.id]);
      for (const step of skill.steps) {
        expect(() => buildSkillStepPrompt({ definition: skill, step, inputValues: resolved }))
          .not.toThrow();
        const prompt = buildSkillStepPrompt({ definition: skill, step, inputValues: resolved });
        expect(prompt, `${skill.id}:${step.id}`).not.toMatch(/{{|}}/);
      }
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
