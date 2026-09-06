import type { SkillDefinition, SkillInputField, SkillStepDefinition } from './types';

const surfaces = ['canvas', 'workflow'] as const;
const now = 1;

function definition(input: {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  inputs: readonly SkillInputField[];
  steps: readonly SkillStepDefinition[];
}): SkillDefinition {
  return {
    executionContextVersion: 1,
    version: 1,
    category: 'marketing',
    allowedSurfaces: surfaces,
    enabled: true,
    builtIn: true,
    ownerId: undefined,
    createdAt: now,
    updatedAt: now,
    usageCount: 0,
    ...input,
  };
}

const commonInputs: readonly SkillInputField[] = [
  { key: 'sourceImages', label: '来源图片', kind: 'images', required: true, maximumItems: 6, bindToSourceVersions: true },
  { key: 'campaignName', label: '活动名称', kind: 'text', required: true },
  { key: 'product', label: '产品或服务', kind: 'text', required: true },
  { key: 'audience', label: '目标受众', kind: 'text', required: true },
  { key: 'sellingPoints', label: '核心卖点', kind: 'text', required: true },
  { key: 'tone', label: '品牌调性', kind: 'text', required: false, defaultValue: '清晰、可信、具有行动感' },
  { key: 'aspectRatio', label: '生成比例', kind: 'select', required: false, defaultValue: '1:1', options: ['1:1', '4:5', '3:4', '16:9', '9:16'] },
  { key: 'negativeConstraints', label: '禁止内容', kind: 'text', required: false, defaultValue: '无额外禁止内容' },
];

function planStep(id: string, label: string, promptTemplate: string): SkillStepDefinition {
  return {
    id,
    label,
    toolId: 'chat',
    promptTemplate,
    modelRole: 'orchestrator',
    execution: 'sequential',
    qualityGateIds: ['text-output-present'],
  };
}

function imageStep(
  skillId: string,
  id: string,
  label: string,
  promptTemplate: string,
): SkillStepDefinition {
  return {
    id,
    label,
    toolId: 'img2img',
    promptTemplate,
    modelRole: 'image',
    execution: 'parallel',
    parallelGroup: `${skillId}:outputs`,
    qualityGateIds: ['output-present'],
  };
}

const adVariantsId = 'preset-ad-ab-variants';
const retargetingId = 'preset-retargeting-creative';
const omnichannelId = 'preset-omnichannel-campaign';

export const LOVART_MARKETING_SKILLS: readonly SkillDefinition[] = [
  definition({
    id: adVariantsId,
    name: '广告 A/B 变体',
    description: '基于来源图片和营销假设生成两套可对照验证的广告创意。',
    systemPrompt: '你是增长营销创意策略师。先明确唯一测试变量和成功指标，再交付两套保持品牌一致的对照创意。',
    inputs: [
      ...commonInputs,
      { key: 'objective', label: '营销目标', kind: 'select', required: true, options: ['认知', '点击', '加购', '购买', '留资'] },
      { key: 'channel', label: '投放渠道', kind: 'select', required: true, options: ['信息流', '搜索展示', '社交媒体', '电商站内'] },
      { key: 'hypothesis', label: '测试假设', kind: 'text', required: false, defaultValue: '未指定；请提出一个可验证的单变量假设' },
    ],
    steps: [
      planStep('plan', '制定 A/B 测试方案', '为{{campaignName}}制定面向{{audience}}的{{channel}} A/B 创意方案，目标为{{objective}}，假设为{{hypothesis}}。'),
      imageStep(adVariantsId, 'variant-a', 'A 版创意', '基于来源图片制作 A 版广告，突出{{sellingPoints}}，保持{{tone}}，比例{{aspectRatio}}，避免{{negativeConstraints}}。'),
      imageStep(adVariantsId, 'variant-b', 'B 版创意', '基于来源图片制作 B 版广告，仅改变测试假设指定的创意变量，突出{{sellingPoints}}，保持{{tone}}，比例{{aspectRatio}}，避免{{negativeConstraints}}。'),
    ],
  }),
  definition({
    id: retargetingId,
    name: '再营销素材',
    description: '根据用户所处漏斗阶段生成消除顾虑、强化利益和促进转化的创意。',
    systemPrompt: '你是再营销策略师。诊断当前漏斗阻力，再用信任证明、利益表达和合理促销分别制作创意，避免夸大或虚假稀缺。不得虚构价格、不得虚构折扣、不得虚构销量、不得虚构认证、不得虚构用户评价。',
    inputs: [
      ...commonInputs,
      { key: 'funnelStage', label: '漏斗阶段', kind: 'select', required: true, options: ['浏览未点击', '点击未加购', '加购未购买', '老客复购'] },
      { key: 'objection', label: '购买顾虑', kind: 'text', required: false, defaultValue: '未提供；请根据漏斗阶段判断常见顾虑，但不得编造事实' },
      { key: 'offer', label: '促销方案', kind: 'text', required: false, defaultValue: '未提供优惠；使用非价格行动理由，不得虚构折扣' },
      { key: 'urgency', label: '紧迫程度', kind: 'select', required: false, defaultValue: '温和', options: ['无', '温和', '明确'] },
    ],
    steps: [
      planStep('diagnose', '诊断转化阻力', '诊断{{funnelStage}}阶段的再营销阻力，重点处理{{objection}}，评估{{offer}}与{{urgency}}的表达方式。'),
      imageStep(retargetingId, 'proof', '信任证明创意', '基于来源图片生成信任证明型再营销创意，回应{{objection}}，保持{{tone}}，比例{{aspectRatio}}，避免{{negativeConstraints}}。'),
      imageStep(retargetingId, 'benefit', '核心利益创意', '基于来源图片生成利益型再营销创意，突出{{sellingPoints}}与{{product}}价值，保持{{tone}}，比例{{aspectRatio}}，避免{{negativeConstraints}}。'),
      imageStep(retargetingId, 'offer', '促销转化创意', '基于来源图片生成促销型再营销创意，表达{{offer}}并体现{{urgency}}紧迫感，保持{{tone}}，比例{{aspectRatio}}，避免{{negativeConstraints}}。'),
    ],
  }),
  definition({
    id: omnichannelId,
    name: '全渠道活动素材包',
    description: '从主视觉出发，生成适配社交、电商与自有媒体的统一活动创意。',
    systemPrompt: '你是全渠道整合营销创意总监。先建立统一活动主张和视觉锚点，再针对各渠道的浏览情境进行适配，保持品牌与信息一致。',
    inputs: [
      ...commonInputs,
      { key: 'channels', label: '投放渠道', kind: 'multi-select', required: true, defaultValue: ['小红书', '微信', 'Instagram', '电商站内'], options: ['小红书', '微信', '微博', '抖音', 'Instagram', 'Facebook', '电商站内', '品牌官网', '邮件'], maximumItems: 6 },
      { key: 'campaignMessage', label: '活动主张', kind: 'text', required: true },
      { key: 'callToAction', label: '行动号召', kind: 'text', required: true },
      { key: 'visualAnchor', label: '视觉锚点', kind: 'text', required: false, defaultValue: '沿用来源图片中的产品身份与核心视觉元素' },
    ],
    steps: [
      planStep('campaign-plan', '制定全渠道方案', '为{{campaignName}}制定覆盖所选投放渠道的全渠道方案，主张为{{campaignMessage}}，行动号召为{{callToAction}}。'),
      imageStep(omnichannelId, 'master-key-visual', '活动主视觉', '基于来源图片生成全渠道活动主视觉，围绕{{campaignMessage}}与{{visualAnchor}}，保持{{tone}}，比例{{aspectRatio}}，避免{{negativeConstraints}}。'),
      imageStep(omnichannelId, 'social-adaptation', '社交媒体适配', '基于来源图片和主视觉策略生成社交媒体适配创意，突出{{callToAction}}，保持{{tone}}，比例{{aspectRatio}}，避免{{negativeConstraints}}。'),
      imageStep(omnichannelId, 'commerce-adaptation', '电商渠道适配', '基于来源图片和主视觉策略生成电商站内适配创意，突出{{sellingPoints}}，保持{{tone}}，比例{{aspectRatio}}，避免{{negativeConstraints}}。'),
      imageStep(omnichannelId, 'owned-media-adaptation', '自有媒体适配', '基于来源图片和主视觉策略生成微信等自有媒体适配创意，完整传达{{campaignMessage}}与{{callToAction}}，保持{{tone}}，比例{{aspectRatio}}，避免{{negativeConstraints}}。'),
    ],
  }),
];
