import { describe, expect, it } from 'vitest';
import { buildVideoPollRequest, buildVideoSubmitRequest, parseVideoPollResponse, parseVideoSubmitResponse,
  resolveVideoCompatProfile } from '@/lib/video-api';

// PearAPI 视频契约来源：https://pearapi.apifox.cn（doubao-seedance-2-0-mini-260615
// 提交 api-533519667 / 查询 api-533519668 的 OpenAPI 描述，逐字核对）。
// - 提交 POST /v1/videos/generations；查询 GET /v1/videos/tasks/{id}
// - generation_mode: text2video | image2video | reference2video | video2video（省略时按素材自动判断）
// - ratio 与 aspect_ratio 等效；duration 与 seconds 等效；时长/清晰度/比例/素材上限按模型（src/lib/pear-video-models.ts）
// - 参考素材 images/videos/audios ≤10 或统一 reference_contents[{type,media_url,name}]
// - 提交成功取 id；完成后读 output.video_url；失败原因在 error.message

const BASE = 'https://api.pearapi.ai';
const KEY = 'pear-key';

function submitBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const request = buildVideoSubmitRequest('pearapi-video', {
    baseUrl: BASE, apiKey: KEY, model: 'doubao-seedance-2-0-mini-260615', prompt: '镜头缓慢推进', ...extra,
  });
  return JSON.parse(request.body);
}

describe('PearAPI video submit contract', () => {
  it('posts to the documented /v1/videos/generations endpoint', () => {
    const request = buildVideoSubmitRequest('pearapi-video', {
      baseUrl: BASE, apiKey: KEY, model: 'doubao-seedance-2-0-mini-260615', prompt: 'p',
    });
    expect(request.url).toBe(`${BASE}/v1/videos/generations`);
    expect(request.method).toBe('POST');
    expect(request.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it('names the generation mode field generation_mode and derives it from inputs', () => {
    expect(submitBody()).toMatchObject({ generation_mode: 'text2video' });
    expect(submitBody()).not.toHaveProperty('mode');
    expect(submitBody({ imageUrl: 'https://example.com/a.png' })).toMatchObject({ generation_mode: 'image2video' });
    expect(submitBody({ referenceImages: ['https://example.com/a.png', 'https://example.com/b.png'] }))
      .toMatchObject({ generation_mode: 'reference2video' });
    expect(submitBody({ videoUrl: 'https://example.com/v.mp4' })).toMatchObject({ generation_mode: 'video2video' });
  });

  it('keeps the documented ratio alias and clamps duration to 4-15 integer seconds', () => {
    expect(submitBody({ aspectRatio: '9:16' })).toMatchObject({ aspect_ratio: '9:16' });
    expect(submitBody({ duration: 5 })).toMatchObject({ duration: 5 });
    expect(submitBody({ duration: 2 })).toMatchObject({ duration: 4 });
    expect(submitBody({ duration: 30 })).toMatchObject({ duration: 15 });
    expect(submitBody({ duration: 6.7 })).toMatchObject({ duration: 6 });
  });

  it('passes only the resolutions the model documents, upper-cased', () => {
    expect(submitBody({ advancedParams: { resolution: '720p' } })).toMatchObject({ resolution: '720P' });
    // mini 只开放 720P
    expect(submitBody({ advancedParams: { resolution: '480p' } })).not.toHaveProperty('resolution');
  });

  it('maps reference material into reference_contents and caps it at 10 entries', () => {
    const single = submitBody({ imageUrl: 'https://example.com/a.png' });
    expect(single.reference_contents).toEqual([
      { type: 'image', media_url: 'https://example.com/a.png' },
    ]);
    const many = submitBody({
      referenceImages: Array.from({ length: 14 }, (_, i) => `https://example.com/${i}.png`),
    });
    expect((many.reference_contents as unknown[]).length).toBe(10);
  });

  it('follows each documented model spec for duration, resolution, ratio and references', () => {
    const body = (model: string, extra: Record<string, unknown>) => JSON.parse(buildVideoSubmitRequest('pearapi-video', {
      baseUrl: BASE, apiKey: KEY, model, prompt: 'p', ...extra,
    }).body);
    expect(body('doubao-seedance-2-0-260128', { advancedParams: { resolution: '480p' } })).toMatchObject({ resolution: '480P' });
    expect(body('doubao-seedance-2-5-260628', { duration: 20, advancedParams: { resolution: '1080p' } }))
      .toMatchObject({ duration: 20, resolution: '1080P' });
    expect(body('minimax-h3', { advancedParams: { resolution: '2k' } })).toMatchObject({ resolution: '2K' });
    expect(body('hailuo-2.3', { duration: 8, advancedParams: { resolution: '768p' } }))
      .toMatchObject({ duration: 6, resolution: '768P' });
    expect(body('happyhorse-1.0', { aspectRatio: '4:3' })).toMatchObject({ aspect_ratio: '16:9' });
    expect(body('seedance-1.0-pro', { aspectRatio: '21:9', duration: 11 })).toMatchObject({ aspect_ratio: '21:9', duration: 10 });
    const refs = body('doubao-seedance-2-0-260128', {
      referenceImages: Array.from({ length: 12 }, (_, i) => `https://example.com/${i}.png`),
    }).reference_contents as unknown[];
    expect(refs).toHaveLength(9);
  });

  it('sends the source video as a video reference for video2video', () => {
    expect(submitBody({ videoUrl: 'https://example.com/v.mp4' }).reference_contents).toEqual([
      { type: 'video', media_url: 'https://example.com/v.mp4' },
    ]);
  });

  it('reads the task id from the documented id field', () => {
    const parsed = parseVideoSubmitResponse('pearapi-video', { id: 'task_example', status: 'queued' });
    expect(parsed).toMatchObject({ taskId: 'task_example', status: 'submitted' });
  });
});

describe('PearAPI video poll contract', () => {
  it('polls the documented /v1/videos/tasks/{id} endpoint', () => {
    const request = buildVideoPollRequest('pearapi-video', BASE, KEY, 'task_example', {});
    expect(request.url).toBe(`${BASE}/v1/videos/tasks/task_example`);
    expect(request.method).toBe('GET');
  });

  it('prefers output.video_url for the completed result', () => {
    const parsed = parseVideoPollResponse('pearapi-video', {
      id: 'task_example', status: 'completed', output: { video_url: 'https://cdn.example.com/v.mp4' },
    });
    expect(parsed.status).toBe('succeeded');
    expect(parsed.videoUrl).toBe('https://cdn.example.com/v.mp4');
  });

  it('maps queued to pending, running to running and reports error.message on failure', () => {
    expect(parseVideoPollResponse('pearapi-video', { id: 't', status: 'queued' }).status).toBe('pending');
    const running = parseVideoPollResponse('pearapi-video', { id: 't', status: 'running', progress: 45 });
    expect(running.status).toBe('running');
    const failed = parseVideoPollResponse('pearapi-video', {
      id: 't', status: 'failed', error: { message: '素材不可读' },
    });
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('素材不可读');
  });

  it('resolves pearapi base urls to the pearapi-video profile', () => {
    expect(resolveVideoCompatProfile('doubao-seedance-2-0-mini-260615', undefined, BASE)).toBe('pearapi-video');
  });
});
