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
    expect(submitted.image_urls).toEqual(['https://example.com/a.png']);
    expect(submitted).not.toHaveProperty('resolution');
    expect(submitted).not.toHaveProperty('generate_audio');
    expect(body('kling-v3-omni', { advancedParams: { resolution: '4K' } }).mode).toBe('4k');
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
