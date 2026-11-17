import { describe, expect, it } from 'vitest';
import {
  findPearVideoSpec,
  getPearMaxDuration,
  inferVideoResolutionTier,
  isPearVideoProvider,
  normalizePearResolution,
  pearSpecToPanelFeatures,
  pickPearDuration,
} from '@/lib/pear-video-specs';
import {
  buildVideoSubmitRequest,
  getPlatformVideoDurations,
  PLATFORM_VIDEO_MAX_DURATION_SECONDS,
  type VideoGenerateParams,
} from '@/lib/video-api';

function pearBody(params: Partial<VideoGenerateParams> & { model: string }): Record<string, unknown> {
  const req = buildVideoSubmitRequest('pearapi-video', {
    prompt: 'test',
    baseUrl: 'https://api.pearapi.ai',
    apiKey: 'sk-test',
    ...params,
  } as VideoGenerateParams);
  return JSON.parse(req.body) as Record<string, unknown>;
}

describe('PearAPI video specs (official model table)', () => {
  it('matches official ids exactly and by provider prefix', () => {
    expect(findPearVideoSpec('veo-3.1')?.id).toBe('veo-3.1');
    expect(findPearVideoSpec('veo-3.1-fast')?.id).toBe('veo-3.1-fast');
    expect(findPearVideoSpec('pear::hailuo-2.3')?.id).toBe('hailuo-2.3');
    expect(findPearVideoSpec('unknown-model')).toBeNull();
  });

  it('exposes the documented ratios / resolutions / durations to the panel', () => {
    const sd25 = pearSpecToPanelFeatures(findPearVideoSpec('doubao-seedance-2-5-260628')!);
    expect(sd25.resolutions).toEqual(['480P', '720P', '1080P']);
    expect(sd25.aspectRatios).toEqual(['16:9', '9:16', '1:1', '4:3', '3:4']);

    const veo = pearSpecToPanelFeatures(findPearVideoSpec('veo-3.1')!);
    expect(veo.aspectRatios).toEqual(['16:9', '9:16']);
    expect(veo.resolutions).toEqual(['720P']);
    expect(veo.durations).toEqual([8]);
    expect(veo.firstLastFrame).toBe(false);

    const minimax = pearSpecToPanelFeatures(findPearVideoSpec('minimax-h3')!);
    expect(minimax.resolutions).toEqual(['480P', '720P', '768P', '2K']);

    const sd10 = pearSpecToPanelFeatures(findPearVideoSpec('seedance-1.0-pro')!);
    expect(sd10.aspectRatios).toContain('21:9');
    expect(sd10.durations).toEqual([5, 10, 12]);
  });

  it('normalises resolution casing and rejects unlisted values', () => {
    const spec = findPearVideoSpec('doubao-seedance-2-0-260128')!;
    expect(normalizePearResolution(spec, '720p')).toBe('720P');
    expect(normalizePearResolution(spec, '1080p')).toBeNull();
  });

  it('snaps durations to the nearest documented value', () => {
    expect(pickPearDuration(findPearVideoSpec('hailuo-2.3')!, 8)).toBe(6);
    expect(pickPearDuration(findPearVideoSpec('veo-3.1')!, 5)).toBe(8);
    expect(pickPearDuration(findPearVideoSpec('grok-imagine-video-1.5')!, 11)).toBe(10);
  });

  it('detects PearAPI providers only', () => {
    expect(isPearVideoProvider({ baseUrl: 'https://api.pearapi.ai' })).toBe(true);
    expect(isPearVideoProvider({ name: 'APIMart', baseUrl: 'https://api.apimart.ai' })).toBe(false);
  });
});

describe('PearAPI video submit body', () => {
  it('clamps unsupported ratio and resolution to documented defaults', () => {
    const body = pearBody({ model: 'veo-3.1', aspectRatio: '1:1', resolution: '1080p', duration: 5 });
    expect(body.aspect_ratio).toBe('16:9');
    expect(body.resolution).toBe('720P');
    expect(body.duration).toBe(8);
    expect(body.mode).toBe('text2video');
  });

  it('passes through supported values in official casing', () => {
    const body = pearBody({ model: 'doubao-seedance-2-5-260628', aspectRatio: '3:4', resolution: '1080p', duration: 10 });
    expect(body.aspect_ratio).toBe('3:4');
    expect(body.resolution).toBe('1080P');
    expect(body.duration).toBe(10);
  });

  it('uses imageend2video only for models that support it', () => {
    const sd = pearBody({ model: 'doubao-seedance-2-0-260128', imageUrl: 'https://x/a.png', lastFrameImageUrl: 'https://x/b.png' });
    expect(sd.mode).toBe('imageend2video');
    const veo = pearBody({ model: 'veo-3.1', imageUrl: 'https://x/a.png', lastFrameImageUrl: 'https://x/b.png' });
    expect(veo.mode).toBe('image2video');
  });

  it('caps reference images at the model limit and drops unsupported fields', () => {
    const body = pearBody({
      model: 'grok-imagine-video-1.5',
      imageUrl: 'https://x/a.png',
      referenceImages: ['https://x/b.png', 'https://x/c.png'],
      negativePrompt: 'blur',
      seed: 1,
    } as Partial<VideoGenerateParams> & { model: string });
    expect((body.reference_contents as unknown[]).length).toBe(1);
    expect(body.negative_prompt).toBeUndefined();
    expect(body.seed).toBeUndefined();
  });

  it('allows Seedance 2.5 up to 30s while other models keep the 15s platform cap', () => {
    const sd25 = findPearVideoSpec('doubao-seedance-2-5-260628')!;
    expect(getPearMaxDuration(sd25, PLATFORM_VIDEO_MAX_DURATION_SECONDS)).toBe(30);
    expect(getPlatformVideoDurations(sd25.durations, getPearMaxDuration(sd25, PLATFORM_VIDEO_MAX_DURATION_SECONDS))).toContain(30);
    expect(pearBody({ model: 'doubao-seedance-2-5-260628', duration: 30 }).duration).toBe(30);

    const sd20 = findPearVideoSpec('doubao-seedance-2-0-260128')!;
    expect(getPearMaxDuration(sd20, PLATFORM_VIDEO_MAX_DURATION_SECONDS)).toBe(15);
    expect(getPlatformVideoDurations([5, 10, 30])).toEqual([5, 10]);
  });

  it('sends reference audio in reference_contents and caps it at the model limit', () => {
    const body = pearBody({
      model: 'doubao-seedance-2-0-260128',
      referenceAudios: ['https://x/1.mp3', 'https://x/2.mp3', 'https://x/3.mp3', 'https://x/4.mp3'],
    });
    const contents = body.reference_contents as Array<{ type: string; media_url: string }>;
    expect(contents.filter(c => c.type === 'audio')).toHaveLength(3);
  });

  it('drops non-public audio and keeps lip-sync models on image2video', () => {
    const body = pearBody({
      model: 'ltx-digitalhuman',
      imageUrl: 'https://x/face.png',
      referenceAudios: ['data:audio/mp3;base64,AAAA', 'https://x/voice.mp3'],
    });
    const contents = body.reference_contents as Array<{ type: string; media_url: string }>;
    expect(contents.filter(c => c.type === 'audio').map(c => c.media_url)).toEqual(['https://x/voice.mp3']);
    expect(body.mode).toBe('image2video');
    expect(body.duration).toBe(0);
  });

  it('exposes audio limits to the panel', () => {
    const ltx = pearSpecToPanelFeatures(findPearVideoSpec('ltx-digitalhuman')!);
    expect(ltx.maxAudios).toBe(1);
    expect(ltx.requiresAudio).toBe(true);
    expect(pearSpecToPanelFeatures(findPearVideoSpec('veo-3.1')!).maxAudios).toBe(0);
  });

  it('infers a resolution tier from the source video size for video edit', () => {
    expect(inferVideoResolutionTier(1280, 720)).toBe('720P');
    expect(inferVideoResolutionTier(1080, 1920)).toBe('1080P');
    expect(inferVideoResolutionTier(854, 480)).toBe('480P');
    expect(inferVideoResolutionTier(undefined, 720)).toBeUndefined();
  });
});
