import type { SkillDefinition } from './types';

export const MULTI_PLATFORM_EXPORT_SKILL_ID = 'preset-multi-platform-export';

export function createMultiPlatformExportSkill(enabled: boolean): SkillDefinition {
  return {
    executionContextVersion: 1,
    id: MULTI_PLATFORM_EXPORT_SKILL_ID,
    version: 1,
    name: '多平台批量导出',
    category: '画布工具',
    description: '将受管图片批量转换为多个平台尺寸，并生成可追溯清单与 ZIP。',
    systemPrompt: '使用本地确定性图片转换，不调用模型。',
    allowedSurfaces: ['canvas', 'workflow', 'simple-chat'],
    catalogSurfaces: ['canvas', 'workflow'],
    inputs: [
      {
        key: 'sourceAssetVersionIds', label: '素材', kind: 'images', required: true,
        maximumItems: 20, uniqueItems: true, bindToSourceVersions: true,
      },
      {
        key: 'targetPresetIds', label: '目标平台', kind: 'multi-select', required: true,
        maximumItems: 20, uniqueItems: true,
      },
      {
        key: 'fit', label: '适配方式', kind: 'select', required: true,
        options: ['cover', 'contain'], defaultValue: 'cover',
      },
      {
        key: 'background', label: '背景', kind: 'text', required: true,
        defaultValue: '#ffffffff', maximumLength: 32,
      },
      {
        key: 'namingTemplate', label: '命名模板', kind: 'text', required: true,
        defaultValue: '{project}-{asset}-{platform}-{size}-{index}', maximumLength: 160,
      },
    ],
    steps: [{
      id: 'export', label: '生成平台尺寸', toolId: 'multi_platform_export',
      runtime: 'local', execution: 'sequential', promptTemplate: '',
      qualityGateIds: ['output-present'],
    }],
    enabled,
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  };
}

export const MULTI_PLATFORM_EXPORT_SKILL = createMultiPlatformExportSkill(
  process.env.MULTI_PLATFORM_EXPORT_ENABLED === 'true',
);
