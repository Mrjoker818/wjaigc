import { describe, expect, it } from 'vitest';
import { VIDEO_MODEL_REGISTRY, buildVideoPollRequest, buildVideoSubmitRequest } from '@/lib/video-api';

// APIMart 视频契约：
// - 字段与取值来自 docs.apib.ai/cn/api-reference/videos/*（2026-11-09 核对）。
// - 模型 id 以网关 GET /v1/models 为准（2026-11-09）：seedance-2.0*、wan2.5-preview、MiniMax-Hailuo-02；
//   sora-2 不在网关列表中。
// - 2026-11-08 实测：resolution 大小写敏感（"1K" 被拒，"4k" 通过）；kling-v3-omni 校验 mode（std/pro/4k）。

const BASE = 'https://api.apib.ai';

function body(model: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const request = buildVideoSubmitRequest('apimart-video', {
    baseUrl: BASE, apiKey: 'k', model, prompt: '竹林小径', ...extra,
  });
  expect(request.url).toBe(`${BASE}/v1/videos/generations`);
  return JSON.parse(request.body);
}

describe('APIMart Seedance video submit contract', () => {
  it.each(['seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-mini', 'seedance-2.0-face', 'seedance-2.0-fast-face', 'seedance-2.5'])(
    'sends the aspect ratio as size for %s',
    (model) => {
      const submitted = body(model, { aspectRatio: '9:16' });
      expect(submitted.size).toBe('9:16');
      expect(submitted).not.toHaveProperty('aspect_ratio');
    },
  );

  it('keeps first/last frames in image_with_roles and never sends image_urls alongside it', () => {
    const submitted = body('seedance-2.0-face', {
      imageUrl: 'https://example.com/a.png',
      lastFrameImageUrl: 'https://example.com/b.png',
    });
    expect(submitted.image_with_roles).toEqual([
      { url: 'https://example.com/a.png', role: 'first_frame' },
      { url: 'https://example.com/b.png', role: 'last_frame' },
    ]);
    expect(submitted).not.toHaveProperty('image_urls');
  });

  it('sends generate_audio for Seedance', () => {
    expect(body('seedance-2.5', { generateAudio: false }).generate_audio).toBe(false);
  });

  it('sends character references as reference images, since APIMart has no character field', () => {
    const submitted = body('seedance-2.5', {
      referenceImages: ['https://example.com/prop.png'],
      characterReferences: ['https://example.com/hero.png', 'https://example.com/prop.png'],
    });
    expect(submitted.image_urls).toEqual(['https://example.com/prop.png', 'https://example.com/hero.png']);
    expect(submitted).not.toHaveProperty('character_references');
    const framed = body('seedance-2.0', { imageUrl: 'https://example.com/a.png', characterReferences: ['https://example.com/hero.png'] });
    expect(framed.image_with_roles).toEqual([
      { url: 'https://example.com/a.png', role: 'first_frame' },
      { url: 'https://example.com/hero.png', role: 'reference_image' },
    ]);
  });

  it('sends AI Link Seedance character references as reference_images', () => {
    const request = buildVideoSubmitRequest('ai-link', {
      baseUrl: 'https://api.ai-link.shop', apiKey: 'k', model: 'doubao-seedance-2-0-260128', prompt: '竹林小径',
      characterReferences: ['https://example.com/hero.png'],
    });
    expect(JSON.parse(request.body).reference_images).toEqual(['https://example.com/hero.png']);
  });

  it('does not send the undocumented generation_type field', () => {
    expect(body('seedance-2.0-face')).not.toHaveProperty('generation_type');
  });

  it('lowercases a 4K resolution tier before sending it', () => {
    expect(body('seedance-2.0', { advancedParams: { resolution: '4K' } }).resolution).toBe('4k');
  });
});

describe('APIMart per-model submit fields', () => {
  it('keeps aspect_ratio and flat image_urls for Veo 3.1', () => {
    const submitted = body('veo3.1-fast', {
      aspectRatio: '16:9',
      imageUrl: 'https://example.com/a.png',
      lastFrameImageUrl: 'https://example.com/b.png',
    });
    expect(submitted.aspect_ratio).toBe('16:9');
    expect(submitted.image_urls).toEqual(['https://example.com/a.png', 'https://example.com/b.png']);
    expect(submitted).not.toHaveProperty('size');
    expect(submitted).not.toHaveProperty('generate_audio');
  });

  it('never sends image_urls to veo3.1-lite', () => {
    expect(body('veo3.1-lite', { imageUrl: 'https://example.com/a.png' })).not.toHaveProperty('image_urls');
  });

  it('maps the resolution tier to mode and sends audio for kling-v3-omni', () => {
    const submitted = body('kling-v3-omni', {
      aspectRatio: '16:9',
      generateAudio: true,
      imageUrl: 'https://example.com/a.png',
      advancedParams: { resolution: '1080p' },
    });
    expect(submitted.mode).toBe('pro');
    expect(submitted.audio).toBe(true);
    // docs.apib.ai kling-v3-omni: frames go in image_with_roles; image_urls are cited references
    expect(submitted.image_with_roles).toEqual([{ url: 'https://example.com/a.png', role: 'first_frame' }]);
    expect(submitted).not.toHaveProperty('image_urls');
    expect(submitted).not.toHaveProperty('resolution');
    expect(submitted).not.toHaveProperty('generate_audio');
    expect(body('kling-v3-omni', { advancedParams: { resolution: '4K' } }).mode).toBe('4k');
  });

  it('uses the kling-v3-omni "reference" role for references next to frames', () => {
    const submitted = body('kling-v3-omni', {
      imageUrl: 'https://example.com/a.png',
      lastFrameImageUrl: 'https://example.com/b.png',
      referenceImages: ['https://example.com/c.png'],
    });
    expect(submitted.image_with_roles).toEqual([
      { url: 'https://example.com/a.png', role: 'first_frame' },
      { url: 'https://example.com/b.png', role: 'last_frame' },
      { url: 'https://example.com/c.png', role: 'reference' },
    ]);
  });

  it('does not send the undocumented n or negative_prompt fields', () => {
    for (const model of ['seedance-2.0', 'seedance-2.5', 'veo3.1-fast', 'kling-3.0-turbo']) {
      const submitted = body(model, { negativePrompt: 'blur' });
      expect(submitted).not.toHaveProperty('n');
      expect(submitted).not.toHaveProperty('negative_prompt');
    }
    expect(body('seedance-2.0', { seed: 7 }).seed).toBe(7);
  });

  it('omits size for seedance-2.5 first/last-frame tasks but keeps it for seedance-2.0', () => {
    const frames = { aspectRatio: '16:9', imageUrl: 'https://example.com/a.png' };
    expect(body('seedance-2.5', frames)).not.toHaveProperty('size');
    expect(body('seedance-2.5', { aspectRatio: '16:9' }).size).toBe('16:9');
    expect(body('seedance-2.0', frames).size).toBe('16:9');
  });

  it('sends first_frame_image only and limits 1080p to 6 seconds for MiniMax-Hailuo-2.3', () => {
    const submitted = body('MiniMax-Hailuo-2.3', {
      duration: 6, imageUrl: 'https://example.com/a.png', advancedParams: { resolution: '1080p' },
    });
    expect(submitted.first_frame_image).toBe('https://example.com/a.png');
    expect(submitted).not.toHaveProperty('last_frame_image');
    expect(() => body('MiniMax-Hailuo-2.3', { duration: 10, advancedParams: { resolution: '1080p' } }))
      .toThrow(/6 秒/);
  });

  it('sends first_frame_image and drops aspect_ratio for kling-3.0-turbo image-to-video', () => {
    const submitted = body('kling-3.0-turbo', {
      aspectRatio: '9:16',
      imageUrl: 'https://example.com/a.png',
      advancedParams: { resolution: '1080p' },
    });
    expect(submitted.first_frame_image).toBe('https://example.com/a.png');
    expect(submitted).not.toHaveProperty('aspect_ratio');
    expect(submitted).not.toHaveProperty('image_urls');
    expect(submitted.resolution).toBe('1080p');
    expect(body('kling-3.0-turbo', { aspectRatio: '9:16' }).aspect_ratio).toBe('9:16');
  });

  it('uses first/last frame fields and no ratio for MiniMax-Hailuo-02', () => {
    const submitted = body('MiniMax-Hailuo-02', {
      aspectRatio: '16:9',
      imageUrl: 'https://example.com/a.png',
      lastFrameImageUrl: 'https://example.com/b.png',
    });
    expect(submitted.first_frame_image).toBe('https://example.com/a.png');
    expect(submitted.last_frame_image).toBe('https://example.com/b.png');
    expect(submitted).not.toHaveProperty('aspect_ratio');
    expect(submitted).not.toHaveProperty('size');
  });

  it('rejects 1080p longer than 5 seconds for MiniMax-Hailuo-02', () => {
    expect(() => body('MiniMax-Hailuo-02', { duration: 10, advancedParams: { resolution: '1080p' } }))
      .toThrow(/5 秒/);
  });

  it('sends size only for Wan2.5 text-to-video', () => {
    expect(body('wan2.5-preview', { aspectRatio: '4:3' }).size).toBe('4:3');
    const imageToVideo = body('wan2.5-preview', { aspectRatio: '4:3', imageUrl: 'https://example.com/a.png' });
    expect(imageToVideo).not.toHaveProperty('size');
    expect(imageToVideo.image_urls).toEqual(['https://example.com/a.png']);
  });

  it('sends size for Grok Imagine video', () => {
    const submitted = body('grok-imagine-1.5-video-apimart', { aspectRatio: '3:2' });
    expect(submitted.size).toBe('3:2');
    expect(submitted).not.toHaveProperty('aspect_ratio');
  });

  it('omits duration for gemini-omni-flash-preview', () => {
    const submitted = body('gemini-omni-flash-preview', { duration: 10, aspectRatio: '9:16' });
    expect(submitted).not.toHaveProperty('duration');
    expect(submitted.aspect_ratio).toBe('9:16');
    expect(() => body('gemini-omni-flash-preview', { duration: 5 })).toThrow(/duration/);
  });

  it('polls the task endpoint with language=zh', () => {
    const request = buildVideoPollRequest('apimart-video', BASE, 'k', 'task-1');
    expect(request.url).toBe(`${BASE}/v1/tasks/task-1?language=zh`);
  });
});

describe('APIMart video registry matches the documented models', () => {
  function features(id: string) {
    const entry = VIDEO_MODEL_REGISTRY[id];
    expect(entry, id).toBeDefined();
    expect(entry.profile, id).toBe('apimart-video');
    return entry.features;
  }

  it('uses gateway model ids and drops models the gateway does not list', () => {
    for (const id of ['doubao-seedance-2.0-face', 'doubao-seedance-2.0-fast-face', 'doubao-seedance-2.0-mini', 'wan2.5-video', 'sora-2', 'minimax-hailuo-02']) {
      expect(VIDEO_MODEL_REGISTRY[id], id).toBeUndefined();
    }
  });

  it('exposes 4-15s for Seedance 2.0 and 4-30s for Seedance 2.5', () => {
    for (const id of ['seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-mini', 'seedance-2.0-face', 'seedance-2.0-fast-face']) {
      const durations = features(id).durations;
      expect(durations[0], id).toBe(4);
      expect(durations.at(-1), id).toBe(15);
    }
    expect(features('seedance-2.5').durations.at(-1)).toBe(30);
  });

  it('limits 1080p/4K to seedance-2.0 and drops 4K from seedance-2.5', () => {
    expect(features('seedance-2.0').resolutions).toEqual(['480p', '720p', '1080p', '4K']);
    for (const id of ['seedance-2.0-fast', 'seedance-2.0-mini', 'seedance-2.0-face', 'seedance-2.0-fast-face']) {
      expect(features(id).resolutions, id).toEqual(['480p', '720p']);
    }
    expect(features('seedance-2.5').resolutions).toEqual(['480p', '720p', '1080p']);
  });

  it('matches the Kling pages', () => {
    expect(features('kling-v3-omni')).toMatchObject({
      durations: Array.from({ length: 13 }, (_, i) => i + 3),
      ratios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p', '4K'],
    });
    expect(features('kling-3.0-turbo')).toMatchObject({
      imageToVideo: true,
      firstLastFrame: false,
      ratios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p'],
    });
  });

  it('matches the remaining model pages', () => {
    expect(features('veo3.1-fast')).toMatchObject({ durations: [8], ratios: ['16:9', '9:16'], resolutions: ['720p', '1080p', '4K'] });
    expect(features('MiniMax-Hailuo-02')).toMatchObject({ durations: [5, 10], resolutions: ['512p', '768p', '1080p'] });
    expect(features('wan2.5-preview')).toMatchObject({ durations: [5, 10], resolutions: ['480p', '720p', '1080p'] });
    expect(features('grok-imagine-1.5-video-apimart')).toMatchObject({ ratios: ['16:9', '9:16', '1:1', '3:2', '2:3'], resolutions: ['480p', '720p'] });
    expect(features('gemini-omni-flash-preview')).toMatchObject({ ratios: ['16:9', '9:16'], resolutions: ['720p'] });
  });
});

// docs.apib.ai/cn/api-reference/videos/*（2026-11-16 核对）新增模型的请求字段
describe('APIMart video models added on 2026-11-16', () => {
  const A = 'https://example.com/a.png';
  const B = 'https://example.com/b.png';
  const C = 'https://example.com/c.png';

  it('sends first/last frames in image_with_roles with aspect_ratio, seed and audio for Seedance 1.x', () => {
    const submitted = body('seedance-1-5-pro', { imageUrl: A, lastFrameImageUrl: B, aspectRatio: '21:9', seed: 3, generateAudio: false });
    expect(submitted.image_with_roles).toEqual([{ url: A, role: 'first_frame' }, { url: B, role: 'last_frame' }]);
    expect(submitted.aspect_ratio).toBe('21:9');
    expect(submitted.seed).toBe(3);
    expect(submitted.audio).toBe(false);
    expect(body('seedance-1-0-pro-fast', { generateAudio: true })).not.toHaveProperty('audio');
  });

  it('sends Kling V4 references as reference_image roles, resolution and no audio or negative_prompt', () => {
    const submitted = body('kling-v4', {
      referenceImages: [A, B], aspectRatio: '21:9', generateAudio: false, negativePrompt: 'blur',
      advancedParams: { resolution: '1080p' },
    });
    expect(submitted.image_with_roles).toEqual([{ url: A, role: 'reference_image' }, { url: B, role: 'reference_image' }]);
    expect(submitted).not.toHaveProperty('image_urls');
    expect(submitted.aspect_ratio).toBe('21:9');
    expect(submitted.resolution).toBe('1080p');
    expect(submitted).not.toHaveProperty('mode');
    expect(submitted).not.toHaveProperty('audio');
    expect(submitted).not.toHaveProperty('negative_prompt');
    // image-to-video follows the first frame and rejects a ratio
    expect(body('kling-v4-flash', { imageUrl: A, aspectRatio: '16:9' })).not.toHaveProperty('aspect_ratio');
    expect(() => body('kling-v4', { imageUrl: A, referenceImages: [B] })).toThrow(/参考图/);
  });

  it('maps resolution to mode for Kling v3, v2.6 and Video O1', () => {
    const v3 = body('kling-v3', {
      imageUrl: A, lastFrameImageUrl: B, generateAudio: true, negativePrompt: 'blur', advancedParams: { resolution: '4K' },
    });
    expect(v3).toMatchObject({ mode: '4k', audio: true, negative_prompt: 'blur', image_urls: [A, B] });
    expect(v3).not.toHaveProperty('resolution');
    const o1 = body('kling-video-o1', { generateAudio: true, negativePrompt: 'blur', advancedParams: { resolution: '1080p' } });
    expect(o1.mode).toBe('pro');
    expect(o1).not.toHaveProperty('audio');
    expect(o1).not.toHaveProperty('negative_prompt');
    expect(body('kling-v2-6', { generateAudio: true, advancedParams: { resolution: '1080p' } })).toMatchObject({ mode: 'pro', audio: true });
    expect(() => body('kling-v2-6', { generateAudio: true, advancedParams: { resolution: '720p' } })).toThrow(/1080p/);
    expect(() => body('kling-v2-6', { imageUrl: A, lastFrameImageUrl: B, generateAudio: true, advancedParams: { resolution: '1080p' } }))
      .toThrow(/尾帧与声音/);
  });

  it('sends upper-case resolutions where the docs use them', () => {
    expect(body('MiniMax-H3', { advancedParams: { resolution: '2K' } }).resolution).toBe('2K');
    expect(body('MiniMax-H3-Max', { advancedParams: { resolution: '768p' } }).resolution).toBe('768P');
    expect(body('happyhorse-1.1', { advancedParams: { resolution: '720p' } }).resolution).toBe('720P');
    expect(body('wan2.7', { advancedParams: { resolution: '1080p' } }).resolution).toBe('1080P');
    expect(body('wan3.0-video', { advancedParams: { resolution: '480p' } }).resolution).toBe('480P');
    expect(body('viduq4-preview', { advancedParams: { resolution: '2K' } }).resolution).toBe('2k');
  });

  it('keeps MiniMax H3 references in image_urls and adds them as roles next to frames', () => {
    expect(body('MiniMax-H3', { referenceImages: [A] }).image_urls).toEqual([A]);
    expect(body('MiniMax-H3', { imageUrl: A, referenceImages: [B] }).image_with_roles).toEqual([
      { url: A, role: 'first_frame' }, { url: B, role: 'reference_image' },
    ]);
  });

  it('sends HappyHorse first_frame_image or image_urls and size only without a first frame', () => {
    const i2v = body('happyhorse-1.0', { imageUrl: A, aspectRatio: '9:16', seed: 1 });
    expect(i2v.first_frame_image).toBe(A);
    expect(i2v).not.toHaveProperty('size');
    expect(i2v).not.toHaveProperty('image_urls');
    expect(i2v.seed).toBe(1);
    const r2v = body('happyhorse-1.1', { referenceImages: [A, B], aspectRatio: '9:16' });
    expect(r2v).toMatchObject({ image_urls: [A, B], size: '9:16' });
    expect(() => body('happyhorse-1.1', { imageUrl: A, referenceImages: [B] })).toThrow(/参考图/);
  });

  it('follows the Wan 2.6 / 2.7 / 3.0 ratio, image and audio fields', () => {
    expect(body('wan2.6', { aspectRatio: '4:3' }).aspect_ratio).toBe('4:3');
    const wan26 = body('wan2.6', { aspectRatio: '4:3', imageUrl: A, generateAudio: true, negativePrompt: 'blur' });
    expect(wan26).toMatchObject({ image_urls: [A], audio: true, negative_prompt: 'blur' });
    expect(wan26).not.toHaveProperty('aspect_ratio');
    expect(body('wan2.6-i2v', { imageUrl: A, generateAudio: true })).not.toHaveProperty('audio');
    expect(body('wan2.6-i2v-flash', { imageUrl: A, generateAudio: true }).audio).toBe(true);
    const wan27 = body('wan2.7', { imageUrl: A, lastFrameImageUrl: B, aspectRatio: '16:9' });
    expect(wan27.image_urls).toEqual([A, B]);
    expect(wan27).not.toHaveProperty('size');
    const wan30 = body('wan3.0-video', { referenceImages: [A], aspectRatio: '21:9', generateAudio: false });
    expect(wan30).toMatchObject({ image_with_roles: [{ url: A, role: 'reference_image' }], size: '21:9', audio: false });
    expect(wan30).not.toHaveProperty('image_urls');
    expect(() => body('wan3.0-video-prime', { imageUrl: A, referenceImages: [B] })).toThrow(/参考图/);
  });

  it('follows the Vidu Q3 / Q4 image and ratio rules', () => {
    const q4 = body('viduq4-preview', { imageUrl: A, aspectRatio: '1:1', generateAudio: false });
    expect(q4.image_with_roles).toEqual([{ url: A, role: 'first_frame' }]);
    expect(q4).not.toHaveProperty('aspect_ratio');
    expect(q4.audio).toBe(false);
    expect(body('viduq4-preview', { referenceImages: [A, B], aspectRatio: '1:1' })).toMatchObject({
      image_with_roles: [{ url: A, role: 'reference_image' }, { url: B, role: 'reference_image' }], aspect_ratio: '1:1',
    });
    const q3pro = body('viduq3-pro', { imageUrl: A, lastFrameImageUrl: B, aspectRatio: '1:1', generateAudio: true });
    expect(q3pro).toMatchObject({ image_urls: [A, B], audio: true });
    expect(q3pro).not.toHaveProperty('aspect_ratio');
    expect(body('viduq3', { referenceImages: [A, B, C], aspectRatio: '4:3' })).toMatchObject({ image_urls: [A, B, C], aspect_ratio: '4:3' });
  });

  it('uses size for PixVerse V6 and aspect_ratio for V6 Max', () => {
    const v6 = body('pixverse-v6', { aspectRatio: '21:9', negativePrompt: 'blur', generateAudio: true });
    expect(v6).toMatchObject({ size: '21:9', negative_prompt: 'blur', audio: true });
    const max = body('pixverse-v6-max', { aspectRatio: '21:9', negativePrompt: 'blur' });
    expect(max.aspect_ratio).toBe('21:9');
    expect(max).not.toHaveProperty('negative_prompt');
    expect(body('pixverse-v6-max', { imageUrl: A, aspectRatio: '21:9' })).not.toHaveProperty('aspect_ratio');
  });

  it('sends duration only for Gemini Omni 1.2 and frames in image_with_roles', () => {
    const v12 = body('gemini-omni-1.2-flash', { duration: 12, imageUrl: A });
    expect(v12.duration).toBe(12);
    expect(v12.image_with_roles).toEqual([{ url: A, role: 'first_frame' }]);
    expect(() => body('gemini-omni-1.2-flash', { duration: 12, imageUrl: A, lastFrameImageUrl: B })).toThrow(/3–10/);
    expect(body('gemini-omni-1.1-flash', { duration: 10 })).not.toHaveProperty('duration');
    expect(() => body('gemini-omni-1.1-flash', { duration: 5 })).toThrow(/duration/);
  });

  it('follows the Zoe, SkyReels and Flux 3 Video image fields', () => {
    expect(body('apimart-zoe', { referenceImages: [A, B] }).image_urls).toEqual([A, B]);
    expect(() => body('apimart-zoe', { imageUrl: A, referenceImages: [B] })).toThrow(/参考图/);
    const sky = body('skyreels-v4-fast', { imageUrl: A, aspectRatio: '4:3' });
    expect(sky.first_frame_image).toBe(A);
    expect(sky).not.toHaveProperty('aspect_ratio');
    expect(body('flux-3-video', { imageUrl: A, lastFrameImageUrl: B, generateAudio: false })).toMatchObject({
      image_urls: [A, B], audio: false,
    });
  });
});
