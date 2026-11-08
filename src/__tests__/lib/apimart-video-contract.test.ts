import { describe, expect, it } from 'vitest';
import { VIDEO_MODEL_REGISTRY, buildVideoSubmitRequest } from '@/lib/video-api';

// APIMart 视频契约（2026-11-08 实测 api.apib.ai，401 响应带 apimart_error 签名）：
// - seedance-2.0 resolution 仅 480p/720p/1080p/4k，大小写敏感（"1K" 被拒，"4K" 通过）。
// - seedance-2.0-fast / fast-face / mini 仅 480p/720p。
// - 上游异步校验：ratio ∈ {16:9,9:16,4:3,3:4,1:1,21:9,adaptive}，duration 为 -1 或 4–15 秒。
// - kling-v3-omni 的 mode 必须为 std/pro/4k（同步校验），其 resolution 字段不被校验。
// - kling-3.0-turbo 上游仅支持 720p/1080p（"8K" 异步 task_failed）。
// 比例字段 size、image_with_roles 角色标注来自两份已核实原文的转述
// （apimart-api-ai-Aggregator/seedance-2.0-api README、Nomi 2026-06-16 handoff）。
// 未文档化且无实测证据的字段不发送。其余模型保持现有字段。
// 待确认项见交付报告，不在此猜测。

const BASE = 'https://api.apimart.ai';

function body(model: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const request = buildVideoSubmitRequest('apimart-video', {
    baseUrl: BASE, apiKey: 'k', model, prompt: '竹林小径', ...extra,
  });
  expect(request.url).toBe(`${BASE}/v1/videos/generations`);
  return JSON.parse(request.body);
}

describe('APIMart Seedance video submit contract', () => {
  it.each(['doubao-seedance-2.0-face', 'doubao-seedance-2.0-fast-face', 'doubao-seedance-2.0-mini', 'seedance-2.0'])(
    'sends the aspect ratio as size for %s',
    (model) => {
      const submitted = body(model, { aspectRatio: '9:16' });
      expect(submitted.size).toBe('9:16');
      expect(submitted).not.toHaveProperty('aspect_ratio');
    },
  );

  it('keeps first/last frames in image_with_roles and never sends image_urls alongside it', () => {
    const submitted = body('doubao-seedance-2.0-face', {
      imageUrl: 'https://example.com/a.png',
      lastFrameImageUrl: 'https://example.com/b.png',
    });
    expect(submitted.image_with_roles).toEqual([
      { url: 'https://example.com/a.png', role: 'first_frame' },
      { url: 'https://example.com/b.png', role: 'last_frame' },
    ]);
    expect(submitted).not.toHaveProperty('image_urls');
  });

  it('leaves the ratio field of non-Seedance APIMart models unchanged', () => {
    const submitted = body('veo3.1-fast', { aspectRatio: '16:9' });
    expect(submitted.aspect_ratio).toBe('16:9');
    expect(submitted).not.toHaveProperty('size');
  });

  it('does not send the undocumented generation_type field (official docs derive the mode from parameter combinations)', () => {
    const submitted = body('doubao-seedance-2.0-face');
    expect(submitted).not.toHaveProperty('generation_type');
  });

  it('sends flat image_urls for non-Seedance APIMart models (official Kling v3 Omni page documents image_urls)', () => {
    const submitted = body('kling-v3-omni', { imageUrl: 'https://example.com/a.png' });
    expect(submitted.image_urls).toEqual(['https://example.com/a.png']);
    expect(submitted).not.toHaveProperty('image_with_roles');
  });

  it('keeps flat image_urls for sora-2 first/last frames', () => {
    const submitted = body('sora-2', {
      imageUrl: 'https://example.com/a.png',
      lastFrameImageUrl: 'https://example.com/b.png',
    });
    expect(submitted.image_urls).toEqual(['https://example.com/a.png', 'https://example.com/b.png']);
    expect(submitted).not.toHaveProperty('image_with_roles');
  });

  it('exposes the documented 4-15s duration range for APImart Seedance models', () => {
    for (const model of ['doubao-seedance-2.0-face', 'doubao-seedance-2.0-fast-face', 'doubao-seedance-2.0-mini']) {
      const durations = VIDEO_MODEL_REGISTRY[model]?.features.durations;
      expect(durations, model).toBeDefined();
      expect(durations?.[0], model).toBe(4);
      expect(durations?.[durations.length - 1], model).toBe(15);
    }
  });

  // 2026-11-08 实测 api.apib.ai：resolution 大小写敏感，只认小写 "4k"。
  it('lowercases a 4K resolution tier before sending it', () => {
    const submitted = body('seedance-2.0', { advancedParams: { resolution: '4K' } });
    expect(submitted.resolution).toBe('4k');
  });

  // 实测：kling-v3-omni 校验的是 mode（std/pro/4k），不校验 resolution。
  it('sends the resolution tier as mode for kling-v3-omni and omits resolution', () => {
    const submitted = body('kling-v3-omni', {
      aspectRatio: '16:9',
      advancedParams: { resolution: '4K' },
    });
    expect(submitted.mode).toBe('4k');
    expect(submitted).not.toHaveProperty('resolution');
    expect(submitted.aspect_ratio).toBe('16:9');
  });
});

describe('APIMart video registry matches the probed gateway contract', () => {
  // 网关模型 seedance-2.0-fast / fast-face / mini 实测仅 480p/720p。
  // 注册表中对应的 APIMart 档案条目是 doubao- 前缀变体；
  // doubao-seedance-2-0* 属于 volcengine-ark、kling-v3 属于 AI Link，不在本次范围内。
  it('limits the fast seedance variants to the probed 480p/720p tiers', () => {
    for (const id of ['doubao-seedance-2.0-fast-face', 'doubao-seedance-2.0-mini']) {
      expect(VIDEO_MODEL_REGISTRY[id].features.resolutions).toEqual(['480p', '720p']);
    }
  });

  // 网关 seedance-2.0 实测支持 480p/720p/1080p/4k。注册表无同名键，
  // 最接近的 APIMart 条目是 face 变体，其 1080p/4K 档位保持现状（见待确认）。
  it('keeps the face variant resolution tiers unchanged pending confirmation', () => {
    expect(VIDEO_MODEL_REGISTRY['doubao-seedance-2.0-face'].features.resolutions)
      .toEqual(['480p', '720p', '1080p', '4K']);
  });
});
