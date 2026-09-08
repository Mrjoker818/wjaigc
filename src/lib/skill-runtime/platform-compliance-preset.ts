import type { SkillDefinition, SkillInputField } from './types';

const surfaces = ['canvas', 'workflow'] as const;

const PLATFORM_REGIONS = {
  '通用电商': ['GLOBAL'],
  Amazon: ['US', 'EU', 'JP'],
  '淘宝/天猫': ['CN'],
  '京东': ['CN'],
} as const;

export function complianceInputFields(): readonly SkillInputField[] {
  return [
    {
      key: 'sourceImages', label: '来源图片', kind: 'images', required: true,
      maximumItems: 20, uniqueItems: true, bindToSourceVersions: true,
    },
    {
      key: 'platform', label: '平台', kind: 'select', required: true,
      defaultValue: '通用电商', options: ['通用电商', 'Amazon', '淘宝/天猫', '京东'],
    },
    {
      key: 'region', label: '地区', kind: 'select', required: true,
      dependentOptions: { inputKey: 'platform', values: PLATFORM_REGIONS },
    },
    {
      key: 'assetType', label: '素材类型', kind: 'select', required: true,
      defaultValue: 'main', options: ['main', 'secondary', 'detail', 'a-plus'],
    },
    { key: 'productCategory', label: '商品分类', kind: 'text', required: false, defaultValue: '' },
    {
      key: 'productFacts', label: '商品事实', kind: 'text', required: false,
      defaultValue: '', maximumLength: 4_000,
    },
    {
      key: 'claims', label: '待审核声明', kind: 'text', required: false,
      defaultValue: '', maximumLength: 4_000,
    },
    {
      key: 'reportLanguage', label: '报告语言', kind: 'select', required: false,
      defaultValue: '中文', options: ['中文', 'English'],
    },
  ];
}

export const LOVART_PLATFORM_COMPLIANCE_SKILLS: readonly SkillDefinition[] = [{
  executionContextVersion: 1,
  id: 'preset-platform-compliance-audit',
  version: 1,
  name: '平台素材合规检查',
  category: 'commerce',
  description: '按平台、地区和素材类型逐张检查商品图片，并交付可追踪的合规报告。',
  systemPrompt: '严格依据冻结规则和可验证证据检查素材。不得把未知结论标记为通过。',
  allowedSurfaces: surfaces,
  inputs: complianceInputFields(),
  steps: [{
    id: 'audit-image',
    label: '检查素材',
    toolId: 'compliance_audit',
    execution: 'parallel',
    parallelGroup: 'preset-platform-compliance-audit:outputs',
    promptTemplate: '检查已授权来源图片，平台{{platform}}，地区{{region}}，素材类型{{assetType}}。',
    modelRole: 'vision',
    qualityGateIds: ['output-present', 'structured-report-present'],
    fanOut: {
      inputKey: 'sourceImages', itemAlias: 'sourceImage', maximumItems: 20, concurrency: 3,
    },
  }],
  enabled: true,
  builtIn: true,
  createdAt: 1,
  updatedAt: 1,
  usageCount: 0,
}];
