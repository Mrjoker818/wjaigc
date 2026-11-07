import { describe, expect, it } from 'vitest';
import { buildVideoSubmitRequest } from '@/lib/video-api';

// APIMart Seedance 2.0 视频契约来源（docs.apimart.ai 本机不可达，取两份独立转述）：
// - github.com/apimart-api-ai-Aggregator/seedance-2.0-api README「Request parameters」：
//   size 为比例（16:9/9:16/1:1/4:3/3:4/21:9/adaptive，默认 16:9），resolution 480p/720p/1080p/4k，
//   duration 4–15，image_urls 与 image_with_roles 二选一。
// - github.com/aqm857886159/Nomi docs/handoff/2026-06-16-seedance-apimart-complete.md：
//   「apimart 比例字段是 size，不是 aspect_ratio（那是 Seedance 1.5 Pro 旧名）」。
// 其它 APIMart 视频模型（Veo、Sora、Kling 等）没有对应证据，保持现有字段。

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
});
