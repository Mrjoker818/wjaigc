import { describe, expect, it } from 'vitest';

import { parseSimpleChatBriefVideoIntent } from '@/lib/brief-to-video/simple-chat-intent';

const capabilities = [{
  providerId: 'video-provider-1',
  modelId: 'video-model-1',
  allowedDurationsSeconds: [5, 10],
  allowedRatios: ['16:9', '9:16'],
  allowedSizes: ['720p', '1080p'],
  supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame'],
}] as const;

const ambiguousCapabilities = [
  ...capabilities,
  { ...capabilities[0], providerId: 'video-provider-2' },
  { ...capabilities[0], providerId: 'video-provider-3', modelId: 'video-model-10' },
] as const;

describe('parseSimpleChatBriefVideoIntent', () => {
  it('only recognizes an explicit Brief or script plus video plus generation request', () => {
    expect(parseSimpleChatBriefVideoIntent('根据这份 Brief 生成最终视频', [], capabilities))
      .toMatchObject({
        kind: 'needs_clarification',
        missing: expect.arrayContaining(['brief']),
        question: '请提供具体 Brief 或脚本内容。',
      });
    expect(parseSimpleChatBriefVideoIntent('帮我分析这份 Brief 的视频方向', [], capabilities))
      .toEqual({ kind: 'none' });
    expect(parseSimpleChatBriefVideoIntent('生成一个产品成片', [], capabilities))
      .toEqual({ kind: 'none' });
  });

  it('parses a complete request into the hidden shared Skill invocation', () => {
    expect(parseSimpleChatBriefVideoIntent(
      '根据 Brief：展示轻薄防晒霜的通勤使用场景，生成最终成片。平台：抖音；时长：5秒；比例：9:16；视频模型：video-model-1；受众：都市上班族；目标：产品转化',
      [{ assetVersionId: 'frame-v1', placementId: 'placement-1' }],
      capabilities,
    )).toMatchObject({
      kind: 'ready',
      skillId: 'preset-brief-to-video-film',
      skillVersion: 1,
      sourceVersionIds: ['frame-v1'],
      modelBinding: { providerId: 'video-provider-1', modelId: 'video-model-1' },
      inputValues: {
        brief: '展示轻薄防晒霜的通勤使用场景',
        platform: '抖音',
        durationSeconds: 5,
        aspectRatio: '9:16',
        startFrame: 'frame-v1',
      },
    });
  });

  it('asks for one missing field at a time in the specified order', () => {
    const result = parseSimpleChatBriefVideoIntent(
      '根据 Brief：新品通勤短片，生成最终视频',
      [],
      capabilities,
    );
    expect(result).toMatchObject({
      kind: 'needs_clarification',
      missing: ['platform', 'durationSeconds', 'aspectRatio', 'videoModel'],
      question: '请指定发布平台。',
    });
  });

  it('rejects unmanaged attachments and unsupported frozen capability values', () => {
    expect(parseSimpleChatBriefVideoIntent(
      '根据 Brief：新品通勤短片，生成最终视频。平台：抖音；时长：30秒；比例：1:1；视频模型：video-model-1',
      [{ url: 'blob:temporary' }],
      capabilities,
    )).toMatchObject({
      kind: 'needs_clarification',
      missing: ['attachments', 'durationSeconds', 'aspectRatio'],
      question: '请重新附加受管素材。',
    });
  });

  it('matches a full provider/model exactly and accepts a bare model only when unique', () => {
    const request = '根据 Brief：新品通勤短片，生成最终视频。平台：抖音；时长：5秒；比例：9:16；视频模型：';

    expect(parseSimpleChatBriefVideoIntent(`${request}video-provider-2/video-model-1`, [], ambiguousCapabilities))
      .toMatchObject({ kind: 'ready', modelBinding: { providerId: 'video-provider-2', modelId: 'video-model-1' } });
    expect(parseSimpleChatBriefVideoIntent(`${request}video-model-1`, [], ambiguousCapabilities))
      .toMatchObject({ kind: 'needs_clarification', missing: ['videoModel'] });
    expect(parseSimpleChatBriefVideoIntent(`${request}video-model-10`, [], ambiguousCapabilities))
      .toMatchObject({ kind: 'ready', modelBinding: { providerId: 'video-provider-3', modelId: 'video-model-10' } });
  });
});
