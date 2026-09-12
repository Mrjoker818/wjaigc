import { describe, expect, it } from 'vitest';

import {
  canonicalBriefToVideoPlanJson,
  parseBriefToVideoInput,
  parseBriefToVideoPlan,
  parseBriefToVideoResult,
} from '@/lib/brief-to-video/schema';

const validInput = {
  brief: '为一款轻量跑鞋制作新品发布短片。',
  goal: '产品转化',
  audience: '18 至 35 岁城市跑步爱好者',
  platform: '抖音',
  durationSeconds: '10',
  aspectRatio: '9:16',
};

const validPlan = {
  schemaId: 'brief-to-video-plan-v1',
  title: '轻盈向前',
  logline: '从清晨第一步到城市冲刺，突出轻量与回弹。',
  durationSeconds: 10,
  aspectRatio: '9:16',
  scenes: [{
    order: 1,
    timeRange: '0-10s',
    visual: '跑者从清晨街道进入明亮城市空间。',
    camera: '低机位跟拍后切至产品特写。',
    action: '落地、回弹、加速。',
    textOverlay: '轻盈向前',
  }],
  finalVideoPrompt: '电影感新品短片，主体清晰，运动自然。',
  negativePrompt: '畸形，闪烁，错误文字',
  factualConstraints: ['鞋面颜色保持白色', '品牌标识不得变形'],
};

const validResult = {
  schemaId: 'brief-to-video-result-v1',
  runId: 'run-1',
  planChecksum: 'sha256:0123456789abcdef',
  videoAssetVersionId: 'video-v1',
  sourceAssetVersionIds: ['start-v1', 'end-v1'],
  providerId: 'pear-video',
  modelId: 'video-model',
  remoteTaskId: 'remote-1',
  durationSeconds: 10,
  aspectRatio: '9:16',
  resolution: '1080p',
  thumbnailUrl: '/api/serve-upload/thumb.png',
};

describe('brief to video schemas', () => {
  it('normalizes bounded input and supplies the optional style default', () => {
    expect(parseBriefToVideoInput(validInput)).toEqual({
      ...validInput,
      durationSeconds: 10,
      style: '电影感、主体清晰、运动自然',
      callToAction: undefined,
      resolution: undefined,
      startFrame: undefined,
      endFrame: undefined,
      negativeConstraints: undefined,
      generateAudio: false,
    });
  });

  it.each([
    [{ ...validInput, brief: '' }, 'BRIEF_VIDEO_BRIEF_INVALID'],
    [{ ...validInput, brief: 'x'.repeat(4_001) }, 'BRIEF_VIDEO_BRIEF_INVALID'],
    [{ ...validInput, audience: '' }, 'BRIEF_VIDEO_AUDIENCE_INVALID'],
    [{ ...validInput, audience: 'x'.repeat(501) }, 'BRIEF_VIDEO_AUDIENCE_INVALID'],
    [{ ...validInput, goal: '未知目标' }, 'BRIEF_VIDEO_GOAL_INVALID'],
    [{ ...validInput, platform: '未知平台' }, 'BRIEF_VIDEO_PLATFORM_INVALID'],
    [{ ...validInput, durationSeconds: '0' }, 'BRIEF_VIDEO_DURATION_INVALID'],
    [{ ...validInput, durationSeconds: 10.5 }, 'BRIEF_VIDEO_DURATION_INVALID'],
    [{ ...validInput, aspectRatio: 'bad' }, 'BRIEF_VIDEO_ASPECT_RATIO_INVALID'],
    [{ ...validInput, callToAction: 'x'.repeat(301) }, 'BRIEF_VIDEO_CALL_TO_ACTION_INVALID'],
    [{ ...validInput, negativeConstraints: 'x'.repeat(1_001) }, 'BRIEF_VIDEO_NEGATIVE_INVALID'],
    [{ ...validInput, endFrame: 'end-v1' }, 'BRIEF_VIDEO_END_FRAME_REQUIRES_START'],
    [{ ...validInput, startFrame: '../unsafe' }, 'BRIEF_VIDEO_START_FRAME_INVALID'],
    [{ ...validInput, extra: true }, 'BRIEF_VIDEO_INPUT_UNKNOWN_FIELD'],
  ] as const)('rejects invalid input with %s', (value, code) => {
    expect(() => parseBriefToVideoInput(value)).toThrow(code);
  });

  it('strictly parses a bounded plan and emits deterministic JSON', () => {
    const parsed = parseBriefToVideoPlan(validPlan);
    expect(parsed.scenes).toHaveLength(1);
    expect(canonicalBriefToVideoPlanJson(validPlan)).toBe(JSON.stringify(parsed));
    expect(canonicalBriefToVideoPlanJson({ ...validPlan })).toBe(
      canonicalBriefToVideoPlanJson(validPlan),
    );
  });

  it.each([
    [{ ...validPlan, schemaId: 'other' }, 'BRIEF_VIDEO_PLAN_SCHEMA_INVALID'],
    [{ ...validPlan, scenes: [] }, 'BRIEF_VIDEO_PLAN_SCENES_INVALID'],
    [{ ...validPlan, scenes: Array.from({ length: 65 }, () => validPlan.scenes[0]) }, 'BRIEF_VIDEO_PLAN_SCENES_INVALID'],
    [{ ...validPlan, scenes: [{ ...validPlan.scenes[0], order: 0 }] }, 'BRIEF_VIDEO_PLAN_SCENE_INVALID'],
    [{ ...validPlan, scenes: [{ ...validPlan.scenes[0], unknown: true }] }, 'BRIEF_VIDEO_PLAN_SCENE_INVALID'],
    [{ ...validPlan, factualConstraints: Array.from({ length: 33 }, () => 'constraint') }, 'BRIEF_VIDEO_PLAN_CONSTRAINTS_INVALID'],
    [{ ...validPlan, extra: true }, 'BRIEF_VIDEO_PLAN_UNKNOWN_FIELD'],
  ] as const)('rejects an invalid plan with %s', (value, code) => {
    expect(() => parseBriefToVideoPlan(value)).toThrow(code);
  });

  it('parses the stable AssetVersion result contract', () => {
    expect(parseBriefToVideoResult(validResult)).toEqual(validResult);
    expect(parseBriefToVideoResult(validResult).videoAssetVersionId).toBe('video-v1');
  });

  it.each([
    [{ ...validResult, videoAssetVersionId: '../video' }, 'BRIEF_VIDEO_RESULT_ASSET_INVALID'],
    [{ ...validResult, sourceAssetVersionIds: ['start-v1', 'start-v1'] }, 'BRIEF_VIDEO_RESULT_SOURCE_INVALID'],
    [{ ...validResult, providerId: '' }, 'BRIEF_VIDEO_RESULT_PROVIDER_INVALID'],
    [{ ...validResult, durationSeconds: 0 }, 'BRIEF_VIDEO_RESULT_DURATION_INVALID'],
    [{ ...validResult, extra: true }, 'BRIEF_VIDEO_RESULT_UNKNOWN_FIELD'],
  ] as const)('rejects an invalid result with %s', (value, code) => {
    expect(() => parseBriefToVideoResult(value)).toThrow(code);
  });
});
