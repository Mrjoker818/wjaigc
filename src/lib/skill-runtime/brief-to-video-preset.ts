import type { SkillDefinition } from './types';

export const BRIEF_TO_VIDEO_SKILL_ID = 'preset-brief-to-video-film';

export function createBriefToVideoSkill(enabled: boolean): SkillDefinition {
  return {
    executionContextVersion: 1,
    id: BRIEF_TO_VIDEO_SKILL_ID,
    version: 1,
    name: 'Brief 到视频成片',
    category: '视频创作',
    description: '将创作 Brief 规划为可确认脚本，并交付一条最终视频成片。',
    systemPrompt: '先生成结构化视频脚本并等待用户确认；批准前不得提交视频任务。',
    allowedSurfaces: ['canvas', 'workflow', 'simple-chat'],
    catalogSurfaces: ['canvas', 'workflow'],
    inputs: [
      { key: 'brief', label: '创作 Brief', kind: 'text', required: true, maximumLength: 4_000 },
      {
        key: 'goal', label: '传播目标', kind: 'select', required: true,
        options: ['品牌认知', '产品转化', '活动传播', '内容叙事'], defaultValue: '产品转化',
      },
      { key: 'audience', label: '目标受众', kind: 'text', required: true, maximumLength: 500 },
      {
        key: 'platform', label: '发布平台', kind: 'select', required: true,
        options: ['通用', '抖音', '小红书', 'B站', 'YouTube', 'Instagram'], defaultValue: '通用',
      },
      {
        key: 'style', label: '视觉风格', kind: 'text', required: false,
        maximumLength: 500, defaultValue: '电影感、主体清晰、运动自然',
      },
      { key: 'callToAction', label: '行动号召', kind: 'text', required: false, maximumLength: 300 },
      {
        key: 'durationSeconds', label: '视频时长', kind: 'select', required: true,
        capabilityOptions: { modelRole: 'video', field: 'durationSeconds' },
      },
      {
        key: 'aspectRatio', label: '画面比例', kind: 'select', required: true,
        capabilityOptions: { modelRole: 'video', field: 'aspectRatio' },
      },
      {
        key: 'resolution', label: '分辨率', kind: 'select', required: false,
        capabilityOptions: { modelRole: 'video', field: 'resolution' },
      },
      {
        key: 'startFrame', label: '首帧', kind: 'image', required: false,
        maximumLength: 256, bindToSourceVersions: true,
      },
      {
        key: 'endFrame', label: '尾帧', kind: 'image', required: false,
        maximumLength: 256, bindToSourceVersions: true,
      },
      {
        key: 'negativeConstraints', label: '负面约束', kind: 'text', required: false,
        maximumLength: 1_000,
      },
      { key: 'generateAudio', label: '生成音效', kind: 'boolean', required: false, defaultValue: false },
    ],
    steps: [
      {
        id: 'plan-film',
        label: '规划视频脚本',
        toolId: 'brief_video_plan',
        execution: 'sequential',
        promptTemplate: '根据创作 Brief 生成严格的结构化视频脚本。',
        modelRole: 'orchestrator',
        qualityGateIds: ['structured-output-present'],
        approvalCheckpoint: {
          kind: 'user-approval',
          outputSchemaId: 'brief-to-video-plan-v1',
          nextStepId: 'generate-film',
          allowRevision: true,
        },
      },
      {
        id: 'generate-film',
        label: '生成最终成片',
        toolId: 'video_generate',
        execution: 'sequential',
        promptTemplate: '严格使用已批准脚本生成最终视频。',
        modelRole: 'video',
        qualityGateIds: ['output-present'],
      },
    ],
    enabled,
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  };
}

export const BRIEF_TO_VIDEO_SKILL = createBriefToVideoSkill(
  process.env.BRIEF_TO_VIDEO_SKILL_ENABLED === 'true',
);
