import { describe, expect, it, vi } from 'vitest';
import { getPearVideoModelSpec } from '@/lib/pear-video-models';
import { buildVideoPollRequest, buildVideoSubmitRequest, fetchPearVideoPoll, getVideoModelInfo, parseVideoPollResponse, parseVideoSubmitResponse,
  resolveVideoCompatProfile } from '@/lib/video-api';

// Seedance 2.0 Mini submit/poll: https://pearapi.apifox.cn/api-533519671.md
// https://pearapi.apifox.cn/api-533519672.md
// Legacy poll: https://pearapi.apifox.cn/api-533519663.md
// - 提交 POST /v1/videos/generations；查询 GET /v1/videos/tasks/{id}
// - generation_mode: text2video | image2video | reference2video | video2video（省略时按素材自动判断）
// - ratio 与 aspect_ratio 等效；duration 与 seconds 等效；时长/清晰度/比例/素材上限按模型（src/lib/pear-video-models.ts）
// - Mini 素材可分别使用 images/videos/audios（各 ≤10）或统一 reference_contents
// - 提交成功取 id；完成后读 output.video_url；失败原因在 error.message

const BASE = 'https://api.pearapi.ai';
const KEY = 'pear-key';
const IMAGE = 'https://example.com/first.png';
const SECOND_IMAGE = 'https://example.com/second.png';
const VIDEO = 'https://example.com/source.mp4';

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

  it('sends the exact admitted duration and keeps the documented ratio alias', () => {
    expect(submitBody({ aspectRatio: '9:16' })).toMatchObject({ aspect_ratio: '9:16' });
    expect(submitBody({ duration: 5 })).toMatchObject({ duration: 5 });
    expect(submitBody({ duration: '15' })).toMatchObject({ duration: 15 });
    for (const duration of [2, 30, 6.7, NaN, Infinity, null, [5]]) {
      expect(() => submitBody({ duration })).toThrow(/duration/);
    }
  });

  it('passes only the resolutions the model documents, upper-cased', () => {
    expect(submitBody({ advancedParams: { resolution: '720p' } })).toMatchObject({ resolution: '720P' });
    // mini 只开放 720P
    expect(submitBody({ advancedParams: { resolution: '480p' } })).not.toHaveProperty('resolution');
  });

  it('keeps all accepted reference material and rejects requests above the model limit', () => {
    const single = submitBody({ imageUrl: IMAGE });
    expect(single.reference_contents).toEqual([
      { type: 'image', media_url: IMAGE },
    ]);
    const referenceImages = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.png`);
    expect(submitBody({ referenceImages }).reference_contents).toEqual(
      referenceImages.map(media_url => ({ type: 'image', media_url })),
    );
    expect(() => submitBody({ referenceImages: [...referenceImages, IMAGE] })).toThrow(/referenceImages/);
    expect(() => submitBody({ model: 'doubao-seedance-2-0-260128', referenceImages })).toThrow(/referenceImages/);
  });

  it('follows each documented model spec for duration, resolution, ratio and references', () => {
    const body = (model: string, extra: Record<string, unknown>) => JSON.parse(buildVideoSubmitRequest('pearapi-video', {
      baseUrl: BASE, apiKey: KEY, model, prompt: 'p', ...extra,
    }).body);
    expect(body('doubao-seedance-2-0-260128', { advancedParams: { resolution: '480p' } })).toMatchObject({ resolution: '480P' });
    expect(body('doubao-seedance-2-5-260628', { duration: 20, advancedParams: { resolution: '1080p' } }))
      .toMatchObject({ duration: 20, resolution: '1080P' });
    expect(body('minimax-h3', { advancedParams: { resolution: '2k' } })).toMatchObject({ resolution: '2K' });
    expect(body('hailuo-2.3', { imageUrl: IMAGE, advancedParams: { resolution: '768p' } }))
      .toMatchObject({ duration: 6, resolution: '768P' });
    expect(() => body('hailuo-2.3', { imageUrl: IMAGE, duration: 8 })).toThrow(/duration/);
    expect(body('happyhorse-1.0', { aspectRatio: '4:3' })).toMatchObject({ aspect_ratio: '16:9' });
    expect(body('seedance-1.0-pro', { aspectRatio: '21:9', duration: 10 })).toMatchObject({ aspect_ratio: '21:9', duration: 10 });
    expect(() => body('seedance-1.0-pro', { duration: 11 })).toThrow(/duration/);
  });

  it('sends the source video for the supported video2video mode', () => {
    expect(submitBody({ videoUrl: VIDEO }).reference_contents).toEqual([
      { type: 'video', media_url: VIDEO },
    ]);
    const omni = submitBody({ model: 'gemini-omni', videoUrl: VIDEO });
    expect(omni).toMatchObject({ generation_mode: 'video2video', duration: 10, videos: [VIDEO] });
    expect(omni).not.toHaveProperty('reference_contents');
  });

  it.each(['seedance-1.0-pro', 'seedance-1.5-pro', 'gemini-omni', 'grok-imagine-video-1.5', 'veo-3.1', 'veo-3.1-fast'])(
    'uses the documented images array for %s', model => {
      const body = submitBody({ model, imageUrl: IMAGE });
      expect(body).toMatchObject({ generation_mode: 'image2video', images: [IMAGE] });
      expect(body).not.toHaveProperty('reference_contents');
    },
  );

  it('allows a single generic image reference only where documented', () => {
    expect(submitBody({ model: 'happyhorse-1.0', referenceImages: [IMAGE] })).toMatchObject({
      generation_mode: 'reference2video', reference_contents: [{ type: 'image', media_url: IMAGE }],
    });
    expect(() => submitBody({ referenceImages: [IMAGE] })).toThrow(/referenceImages/);
    expect(() => submitBody({ referenceImages: [IMAGE, IMAGE] })).toThrow(/referenceImages/);
  });

  it.each([
    [{ model: 'hailuo-2.3' }, 'operation'],
    [{ model: 'hailuo-2.3', videoUrl: VIDEO }, 'operation'],
    [{ model: 'minimax-h3', videoUrl: VIDEO }, 'operation'],
    [{ model: 'seedance-1.0-pro', referenceImages: [IMAGE, SECOND_IMAGE] }, 'operation'],
    [{ lastFrameImageUrl: SECOND_IMAGE }, 'operation'],
    [{ imageUrl: IMAGE, lastFrameImageUrl: SECOND_IMAGE }, 'operation'],
    [{ mode: 'image2video-firstlast', imageUrl: IMAGE }, 'operation'],
    [{ characterReferences: [IMAGE] }, 'characterReferences'],
    [{ imageUrl: IMAGE, referenceImages: [SECOND_IMAGE] }, 'operation'],
    [{ imageUrl: IMAGE, videoUrl: VIDEO }, 'operation'],
    [{ referenceImages: [IMAGE, '  '] }, 'referenceImages'],
    [{ action: 'edit' }, 'operation'],
  ] as const)('rejects unsupported or ambiguous inputs %j', (extra, field) => {
    expect(() => submitBody(extra)).toThrow(field);
  });

  it('keeps unlisted IDs on the generic path and exposes only implemented Mini features', () => {
    for (const model of ['unlisted-video', 'constructor', '__proto__']) {
      expect(getPearVideoModelSpec(model)).toBeUndefined();
      expect(submitBody({ model, duration: 7 })).toMatchObject({ generation_mode: 'text2video', duration: 7 });
      expect(getVideoModelInfo(model)).toMatchObject({ profile: 'rest-generic' });
    }
    expect(getVideoModelInfo('doubao-seedance-2-0-mini-260615')?.features).toMatchObject({
      firstLastFrame: false, videoEdit: false, imageToVideo: true, multiReference: true, maxReferenceImages: 10,
    });
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

  it.each([
    () => new Response(null, { status: 405 }),
    () => Response.json({ error: { code: 'endpoint_not_found' } }, { status: 404 }),
    () => new Response('<pre>Cannot GET /v1/videos/tasks/old%20%2F%3F%201</pre>', { status: 404 }),
  ])('polls the historical endpoint only after an explicit route mismatch', async mismatch => {
    const result = Response.json({ task_id: 'old /? 1', status: 'completed', url: VIDEO });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(mismatch()).mockResolvedValueOnce(result);
    const response = await fetchPearVideoPoll(`${BASE}/v1/`, KEY, 'old /? 1', fetcher);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/v1/videos/tasks/old%20%2F%3F%201`,
      `${BASE}/v1/video/generations/old%20%2F%3F%201`,
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${KEY}` }, redirect: 'error' });
      expect(init?.body).toBeUndefined();
    }
    expect(parseVideoPollResponse('pearapi-video', await response.json())).toMatchObject({ status: 'succeeded', videoUrl: VIDEO });
  });

  it.each([
    [200, '{"status":"failed","error":{"message":"route not found"}}'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [404, '{"error":{"code":"task_not_found","message":"Task not found"}}'],
    [404, '{"error":{"message":"Task not found or belongs to another account"}}'],
    [404, '<pre>Cannot GET /different/path</pre>'],
    [422, 'Unsupported endpoint'],
    [429, 'Too many requests'],
    [503, 'Endpoint not found'],
  ])('keeps HTTP %s with body %s on the current endpoint', async (status, body) => {
    const current = new Response(body, { status });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(current);
    expect(await fetchPearVideoPoll(BASE, KEY, 'task_example', fetcher)).toBe(current);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await current.text()).toBe(body);
  });

  it('does not try another endpoint when the transport fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));
    await expect(fetchPearVideoPoll(BASE, KEY, 'task_example', fetcher)).rejects.toThrow('network failure');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
