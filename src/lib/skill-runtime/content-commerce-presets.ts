import type { SkillDefinition, SkillInputField, SkillStepDefinition } from './types';

const surfaces = ['canvas', 'workflow'] as const;
const now = 1;

function definition(input: {
  id: string;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  inputs: readonly SkillInputField[];
  steps: readonly SkillStepDefinition[];
}): SkillDefinition {
  return {
    executionContextVersion: 1,
    version: 1,
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

function sourceImages(): SkillInputField {
  return {
    key: 'sourceImages', label: '来源图片', kind: 'images', required: true,
    maximumItems: 6, bindToSourceVersions: true,
  };
}

function planStep(id: string, label: string, promptTemplate: string): SkillStepDefinition {
  return {
    id, label, toolId: 'chat', execution: 'sequential', promptTemplate,
    modelRole: 'orchestrator', qualityGateIds: ['text-output-present'],
  };
}

function imageStep(
  skillId: string,
  id: string,
  label: string,
  promptTemplate: string,
): SkillStepDefinition {
  return {
    id, label, toolId: 'img2img', execution: 'parallel',
    parallelGroup: `${skillId}:outputs`, promptTemplate,
    modelRole: 'image', qualityGateIds: ['output-present'],
  };
}

const thumbnailsId = 'preset-video-platform-thumbnails';
const pinterestId = 'preset-pinterest-pins';
const batchSkuId = 'preset-batch-sku-assets';

export const LOVART_CONTENT_COMMERCE_SKILLS: readonly SkillDefinition[] = [
  definition({
    id: thumbnailsId,
    name: 'YouTube/B站缩略图',
    category: 'marketing',
    description: '基于来源素材分别生成适配 YouTube 与 B站观看情境的 16:9 视频缩略图。',
    systemPrompt: '你是视频内容包装设计师。先明确点击动机、信息层级和平台差异，再保持来源主体身份制作缩略图。不得虚构视频内容，生成文字必须提醒人工校对。',
    inputs: [
      sourceImages(),
      { key: 'videoTitle', label: '视频标题', kind: 'text', required: true },
      { key: 'subject', label: '主体', kind: 'text', required: true },
      { key: 'audience', label: '目标观众', kind: 'text', required: true },
      { key: 'hook', label: '点击动机', kind: 'text', required: true },
      { key: 'brandTone', label: '品牌调性', kind: 'text', required: false, defaultValue: '醒目、清晰、可信' },
      { key: 'headline', label: '封面短文案', kind: 'text', required: false, defaultValue: '由编排步骤提出' },
      { key: 'faceEmphasis', label: '突出人物表情', kind: 'boolean', required: false, defaultValue: false },
      { key: 'negativeConstraints', label: '禁止内容', kind: 'text', required: false, defaultValue: '禁止水印、乱码和无关文字' },
    ],
    steps: [
      planStep('thumbnail-plan', '制定缩略图方案', '为《{{videoTitle}}》制定 YouTube 与B站缩略图方案，主体为{{subject}}，面向{{audience}}，点击动机为{{hook}}，短文案为{{headline}}。'),
      imageStep(thumbnailsId, 'youtube-thumbnail', 'YouTube 缩略图', '基于来源图片生成16:9 YouTube缩略图，强化远距离识别、{{subject}}和{{hook}}，保持{{brandTone}}，人物表情强调为{{faceEmphasis}}，避免{{negativeConstraints}}。'),
      imageStep(thumbnailsId, 'bilibili-thumbnail', 'B站缩略图', '基于来源图片生成16:9 B站缩略图，强化中文信息层级、{{subject}}和{{hook}}，保持{{brandTone}}，人物表情强调为{{faceEmphasis}}，避免{{negativeConstraints}}。'),
    ],
  }),
  definition({
    id: pinterestId,
    name: 'Pinterest 图钉',
    category: 'marketing',
    description: '生成具有统一内容支柱和视觉连续性的 2:3 Pinterest 图钉系列。',
    systemPrompt: '你是 Pinterest 内容设计师。围绕可收藏价值、清晰层级和行动路径建立系列视觉，不得虚构优惠、稀缺信息或产品事实。',
    inputs: [
      sourceImages(),
      { key: 'topic', label: '内容主题', kind: 'text', required: true },
      { key: 'audience', label: '目标受众', kind: 'text', required: true },
      { key: 'goal', label: '目标', kind: 'select', required: true, defaultValue: '收藏', options: ['收藏', '访问', '购买', '品牌认知'] },
      { key: 'style', label: '视觉风格', kind: 'text', required: false, defaultValue: '编辑感、可收藏、层级清晰' },
      { key: 'callToAction', label: '行动号召', kind: 'text', required: false, defaultValue: '不使用虚假优惠或稀缺信息' },
      { key: 'seriesCount', label: '图钉数量', kind: 'select', required: true, defaultValue: '3', options: ['2', '3'] },
      { key: 'negativeConstraints', label: '禁止内容', kind: 'text', required: false, defaultValue: '禁止水印、乱码和无关文字' },
    ],
    steps: [
      planStep('pin-plan', '制定图钉系列方案', '围绕{{topic}}制定面向{{audience}}、目标为{{goal}}的 Pinterest 系列方案，确保内容支柱、视觉连续性和行动路径一致。'),
      imageStep(pinterestId, 'pin-hero', '主图钉', '基于来源图片生成2:3主图钉，主题{{topic}}，风格{{style}}，目标{{goal}}，避免{{negativeConstraints}}。'),
      imageStep(pinterestId, 'pin-detail', '细节图钉', '基于来源图片生成2:3细节或步骤型图钉，面向{{audience}}，保持{{style}}，避免{{negativeConstraints}}。'),
      {
        ...imageStep(pinterestId, 'pin-conversion', '转化图钉', '基于来源图片生成2:3转化图钉，行动号召为{{callToAction}}，保持{{style}}，避免{{negativeConstraints}}。'),
        when: { input: 'seriesCount', includes: ['3'] },
      },
    ],
  }),
  definition({
    id: batchSkuId,
    name: '批量 SKU 商品素材',
    category: 'commerce',
    description: '从 CSV 或 JSON 商品数据逐项生成可追踪、可单独重试的 SKU 商品素材。',
    systemPrompt: '你是电商商品素材生产负责人。严格使用用户数据和来源图片，不得补造参数、优惠、认证、销量或评价；每个 SKU 独立交付。',
    inputs: [
      sourceImages(),
      { key: 'rows', label: 'SKU 数据', kind: 'dataset', required: true, maximumItems: 20 },
      { key: 'platform', label: '平台', kind: 'select', required: true, defaultValue: '通用电商', options: ['通用电商', '淘宝/天猫', '京东', 'Amazon'] },
      { key: 'assetType', label: '素材类型', kind: 'select', required: true, defaultValue: '主图', options: ['主图', '卖点图', '场景图'] },
      { key: 'aspectRatio', label: '生成比例', kind: 'select', required: true, defaultValue: '1:1', options: ['1:1', '4:5', '3:4'] },
      { key: 'brandTone', label: '品牌调性', kind: 'text', required: false, defaultValue: '沿用来源图片和品牌信息' },
      { key: 'negativeConstraints', label: '禁止内容', kind: 'text', required: false, defaultValue: '禁止虚构参数、优惠、认证、销量和评价' },
    ],
    steps: [
      planStep('sku-plan', '检查批次规则', '检查{{platform}}商品数据和{{assetType}}生产规则，不补造商品事实。'),
      imageStep(batchSkuId, 'sku-creative', 'SKU 商品素材', '基于来源图片和 SKU 数据生成{{platform}}{{assetType}}，比例{{aspectRatio}}，保持{{brandTone}}，避免{{negativeConstraints}}。'),
    ],
  }),
];
