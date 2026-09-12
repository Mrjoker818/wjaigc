export const BRIEF_TO_VIDEO_PLAN_SCHEMA_ID = 'brief-to-video-plan-v1' as const;
export const BRIEF_TO_VIDEO_RESULT_SCHEMA_ID = 'brief-to-video-result-v1' as const;

export const BRIEF_TO_VIDEO_GOALS = [
  '品牌认知',
  '产品转化',
  '活动传播',
  '内容叙事',
] as const;

export const BRIEF_TO_VIDEO_PLATFORMS = [
  '通用',
  '抖音',
  '小红书',
  'B站',
  'YouTube',
  'Instagram',
] as const;

export type BriefToVideoGoal = (typeof BRIEF_TO_VIDEO_GOALS)[number];
export type BriefToVideoPlatform = (typeof BRIEF_TO_VIDEO_PLATFORMS)[number];

export interface BriefToVideoInput {
  brief: string;
  goal: BriefToVideoGoal;
  audience: string;
  platform: BriefToVideoPlatform;
  style: string;
  callToAction?: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution?: string;
  startFrame?: string;
  endFrame?: string;
  negativeConstraints?: string;
  generateAudio: boolean;
}

export interface BriefToVideoSceneV1 {
  order: number;
  timeRange: string;
  visual: string;
  camera: string;
  action: string;
  textOverlay?: string;
}

export interface BriefToVideoPlanV1 {
  schemaId: typeof BRIEF_TO_VIDEO_PLAN_SCHEMA_ID;
  title: string;
  logline: string;
  durationSeconds: number;
  aspectRatio: string;
  scenes: BriefToVideoSceneV1[];
  finalVideoPrompt: string;
  negativePrompt: string;
  factualConstraints: string[];
}

export interface BriefToVideoResultV1 {
  schemaId: typeof BRIEF_TO_VIDEO_RESULT_SCHEMA_ID;
  runId: string;
  planChecksum: string;
  videoAssetVersionId: string;
  sourceAssetVersionIds: string[];
  providerId: string;
  modelId: string;
  remoteTaskId?: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution?: string;
  thumbnailUrl?: string;
}
