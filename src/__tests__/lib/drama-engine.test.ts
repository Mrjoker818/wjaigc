import { describe, expect, it, vi } from 'vitest';
import { buildDramaShotMessages, DramaPlannerError, parseDramaScriptResponse, parseDramaShotResponse } from '@/lib/drama/planner';
import { DramaDocumentError, parseDramaProject } from '@/lib/drama/schema';
import {
  buildShotGenerateRequest, chooseFirstFrame, chooseLastFrame, chooseReferenceImages, isRetryableTake, orderedShots, runShot,
  shotContinuityText, shotReferenceImages,
} from '@/lib/drama/shot-runner';
import { shotCapabilityFromDescriptor } from '@/components/drama/drama-models';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { collectEpisodeTimeline, dialogueCues } from '@/lib/drama/timeline';
import { buildPolishMessages, parsePolishResponse } from '@/lib/drama/polish';
import { chosenShotValue, shotLanguageText } from '@/lib/drama/shot-language';
import { activeTake, MAX_SHOTS_PER_EPISODE, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';

const scriptJson = JSON.stringify({
  title: '雨夜来信',
  genre: '悬疑',
  cast: [
    { id: 'lin', name: '林夏', appearance: '短发，黑色风衣' },
    { id: 'bad id!', name: '陌生人', appearance: '戴帽子' },
    { id: 'lin', name: '重名', appearance: '' },
  ],
  locations: [{ id: 'cafe', name: '咖啡馆', description: '雨夜的街角咖啡馆' }],
  episodes: [{
    title: '第一集',
    script: '内景 咖啡馆 夜……',
    scenes: [
      { heading: '咖啡馆·内·夜', summary: '林夏收到一封信。她拆开信。脸色变了。', locationId: 'cafe', characterIds: ['lin', 'ghost'] },
      { heading: '街道·外·夜', summary: '她冲进雨里。', locationId: 'nowhere' },
    ],
  }],
});

function plannedDoc(): DramaProjectV1 {
  return parseDramaScriptResponse(scriptJson, { idea: '雨夜收到神秘来信', style: 'music-video', aspectRatio: '9:16' }, 1000);
}

function shot(partial: Partial<DramaShot> & { id: string }): DramaShot {
  return {
    index: 0, title: 't', purpose: '', actionBeat: '', prompt: 'p', duration: 5, durationSec: 5, aspectRatio: '9:16',
    references: [], continuityNotes: [], status: 'planned', takes: [], ...partial,
  };
}

describe('drama planner', () => {
  it('builds a document with sanitized ids and only valid references', () => {
    const doc = plannedDoc();
    expect(doc.title).toBe('雨夜来信');
    expect(doc.style).toBe('music-video');
    expect(doc.cast.map(member => member.id)).toEqual(['lin', 'char_2', 'lin_2']);
    const [first, second] = doc.episodes[0].scenes;
    expect(first.locationId).toBe('cafe');
    expect(first.characterIds).toEqual(['lin']);
    expect(second.locationId).toBeUndefined();
    expect(() => parseDramaProject(doc)).not.toThrow();
  });

  it('rejects non-JSON or empty script responses as retryable plan errors', () => {
    expect(() => parseDramaScriptResponse('抱歉我不能', { idea: 'x' })).toThrow(DramaPlannerError);
    expect(() => parseDramaScriptResponse('{"title":"a","episodes":[]}', { idea: 'x' })).toThrow('DRAMA_PLAN_INVALID');
  });

  it('plans shots for one scene, keeps dialogue and falls back to the scene cast', () => {
    const doc = plannedDoc();
    const episode = doc.episodes[0];
    const scene = episode.scenes[0];
    const messages = buildDramaShotMessages({ doc, episodeId: episode.id, sceneId: scene.id });
    expect(messages[1].content).toContain('lin=林夏');
    expect(messages[1].content).toContain('sceneId 固定为 cafe');
    const shots = parseDramaShotResponse('```json\n' + JSON.stringify({
      shots: [
        { title: '收信', prompt: '林夏接过信', duration: 4, characterIds: ['lin'], dialogue: '这是谁寄的？' },
        { title: '拆信', prompt: '信纸特写', duration: 99, characterIds: ['ghost'] },
      ],
    }) + '\n```', { doc, episodeId: episode.id, sceneId: scene.id }, 2000);
    expect(shots).toHaveLength(2);
    expect(shots[0]).toMatchObject({ dialogue: '这是谁寄的？', durationSec: 4, sceneId: 'cafe', characterIds: ['lin'], takes: [] });
    expect(shots[1].durationSec).toBe(15);
    expect(shots[1].characterIds).toEqual(['lin']);
  });

  it('plans key props and keeps only known prop ids on shots', () => {
    const doc = parseDramaScriptResponse(JSON.stringify({
      title: 't', cast: [{ id: 'lin', name: '林夏' }], locations: [],
      props: [{ id: 'letter', name: '信', description: '牛皮纸信封' }, { id: 'lin', name: '撞名' }, { id: 'bad id', name: '' }],
      episodes: [{ title: '一', scenes: [{ heading: 'A', summary: '林夏收信。' }] }],
    }), { idea: 'x' }, 1000);
    expect(doc.props.map(prop => prop.id)).toEqual(['letter', 'lin_1', 'prop_3']);
    expect(doc.props[2].name).toBe('道具3');
    const [episode] = doc.episodes;
    const messages = buildDramaShotMessages({ doc, episodeId: episode.id, sceneId: episode.scenes[0].id });
    expect(messages[1].content).toContain('letter=信');
    const shots = parseDramaShotResponse(JSON.stringify({ shots: [{ prompt: '拆信', propIds: ['letter', 'letter', 'ghost', 3] }, { prompt: '特写' }] }),
      { doc, episodeId: episode.id, sceneId: episode.scenes[0].id }, 2000);
    expect(shots.map(item => item.propIds)).toEqual([['letter'], []]);
    expect(() => parseDramaProject({ ...doc, episodes: [{ ...episode, scenes: [{ ...episode.scenes[0], shots }] }] })).not.toThrow();
  });

  it('stops adding shots at the per-episode cap', () => {
    const doc = plannedDoc();
    const episode = doc.episodes[0];
    episode.scenes[1].shots = Array.from({ length: MAX_SHOTS_PER_EPISODE }, (_, i) => shot({ id: `s${i}` }));
    expect(() => parseDramaShotResponse(JSON.stringify({ shots: [{ prompt: 'a' }] }),
      { doc, episodeId: episode.id, sceneId: episode.scenes[0].id })).toThrow('DRAMA_PLAN_INVALID');
  });
});

describe('drama schema', () => {
  it('rejects unknown styles and oversized documents', () => {
    const doc = plannedDoc();
    expect(() => parseDramaProject({ ...doc, style: 'noir' })).toThrow(DramaDocumentError);
    expect(() => parseDramaProject({ ...doc, genre: 'x'.repeat(3 * 1024 * 1024) })).toThrow('DRAMA_DOC_TOO_LARGE');
  });
});

describe('shot runner choices', () => {
  const capability = { imageToVideo: true, maxReferenceImages: 3 };
  const doneTake = { id: 'k1', status: 'completed' as const, videoUrl: '/v/prev.mp4', createdAt: 1 };

  it('picks the first frame from user, then the previous shot, then the location', () => {
    const location = { id: 'cafe', name: 'c', imageUrl: '/i/cafe.png' };
    const prev = shot({ id: 'a', takes: [doneTake] });
    expect(chooseFirstFrame(shot({ id: 'b', firstFrameUrl: '/i/user.png' }), prev, location, capability))
      .toEqual({ source: 'user', url: '/i/user.png' });
    // Inside a scene the cut continues from the previous shot even when the location has a plate.
    expect(chooseFirstFrame(shot({ id: 'b' }), prev, location, capability))
      .toEqual({ source: 'previous-shot', previousVideoUrl: '/v/prev.mp4' });
    expect(chooseFirstFrame(shot({ id: 'b' }), undefined, location, capability)).toEqual({ source: 'location', url: '/i/cafe.png' });
    expect(chooseFirstFrame(shot({ id: 'b', firstFrameFromPrev: false }), prev, location, capability)).toEqual({ source: 'location', url: '/i/cafe.png' });
    expect(chooseFirstFrame(shot({ id: 'b', firstFrameFromPrev: false }), prev, undefined, capability)).toEqual({ source: 'none' });
    // A shot at another location never continues from the previous one.
    expect(chooseFirstFrame(shot({ id: 'b', sceneId: 'street' }), shot({ id: 'a', sceneId: 'cafe', takes: [doneTake] }), undefined, capability))
      .toEqual({ source: 'none' });
    // A trimmed take is cut before its end, so that frame is the one to continue from.
    expect(chooseFirstFrame(shot({ id: 'b' }), shot({ id: 'a', takes: [doneTake], clipEdit: { trimEndSec: 3.2 } }), undefined, capability))
      .toEqual({ source: 'previous-shot', previousVideoUrl: '/v/prev.mp4', previousEndSec: 3.2 });
    expect(chooseFirstFrame(shot({ id: 'b', firstFrameUrl: '/i/u.png' }), prev, location, { ...capability, imageToVideo: false }))
      .toEqual({ source: 'none' });
  });

  it('gives every character one reference before second views and respects the model limit', () => {
    const cast = [
      { id: 'a', name: 'A', appearance: '', imageUrlFront: '/a-front', imageUrlSide: '/a-side' },
      { id: 'b', name: 'B', appearance: '', imageUrlFront: '/b-front', imageUrlSide: '/b-side', lockedImageUrl: '/b-locked' },
      { id: 'c', name: 'C', appearance: '', imageUrlFront: '/c-front' },
    ];
    const s = shot({ id: 's', characterIds: ['a', 'b', 'c'] });
    expect(chooseReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 4 })).toEqual(['/a-front', '/b-locked', '/c-front', '/a-side']);
    expect(chooseReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 2 })).toEqual(['/a-front', '/b-locked']);
    expect(chooseReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 0 })).toEqual([]);
    expect(chooseReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 2 }, ['/a-front'])).toEqual(['/b-locked', '/c-front']);
  });

  it('puts prop sheets after one image per character and before second views', () => {
    const cast = [{ id: 'a', name: 'A', appearance: '', imageUrlFront: '/a-front', imageUrlSide: '/a-side' }];
    const props = [{ id: 'ticket', name: '彩票', lockedImageUrl: '/t-locked', imageUrl: '/t' }, { id: 'bare', name: '无图' }];
    const s = shot({ id: 's', characterIds: ['a'], propIds: ['bare', 'ticket', 'ghost'] });
    expect(chooseReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 3 }, [], props)).toEqual(['/a-front', '/t-locked', '/a-side']);
    expect(chooseReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 2 }, [], props)).toEqual(['/a-front', '/t-locked']);
    expect(shotReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 2 }, ['/f.png'], props)).toEqual(['/a-front']);
  });

  it('counts the first frame against the model image limit', () => {
    const cast = [{ id: 'a', name: 'A', appearance: '', imageUrlFront: '/a-front' }, { id: 'b', name: 'B', appearance: '', imageUrlFront: '/b-front' }];
    const s = shot({ id: 's', characterIds: ['a', 'b'] });
    expect(shotReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 2 }, ['/f.png'])).toEqual(['/a-front']);
    expect(shotReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 1 }, ['/f.png'])).toEqual([]);
    expect(shotReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 3 }, ['/f.png', '/l.png', undefined])).toEqual(['/a-front']);
    expect(shotReferenceImages(s, cast, { imageToVideo: true, maxReferenceImages: 2 })).toEqual(['/a-front', '/b-front']);
  });

  it('sends references only to models whose descriptor accepts them', () => {
    const base = { supportsReferenceImages: true, maxReferenceImages: 3, protocol: 'openai-video', supportedOperations: ['image-to-video'] } as unknown as TaskModelDescriptor;
    expect(shotCapabilityFromDescriptor(base)).toEqual({ imageToVideo: true, maxReferenceImages: 3, firstLastFrame: false });
    const firstLast = { ...base, supportedOperations: ['image-to-video', 'first-last-frame'] } as unknown as TaskModelDescriptor;
    expect(shotCapabilityFromDescriptor(firstLast).firstLastFrame).toBe(true);
    expect(shotCapabilityFromDescriptor({ ...firstLast, protocol: 'pearapi-video' }).firstLastFrame).toBe(false);
    expect(shotCapabilityFromDescriptor({ ...base, protocol: 'pearapi-video' }).maxReferenceImages).toBe(0);
    expect(shotCapabilityFromDescriptor({ ...base, supportsReferenceImages: false }).maxReferenceImages).toBe(0);
    expect(shotCapabilityFromDescriptor(undefined)).toEqual({ imageToVideo: true, maxReferenceImages: 0, firstLastFrame: false });
  });

  it('builds a generate request with the style, dialogue and duration', () => {
    const doc = plannedDoc();
    const body = buildShotGenerateRequest({
      doc, shot: shot({ id: 's1', dialogue: '你好', durationSec: 6, characterIds: [] }), modelId: 'm', providerId: 'p',
      capability, firstFrameUrl: '/f.png',
    });
    expect(body).toMatchObject({ model: 'm', providerId: 'p', imageUrl: '/f.png', mode: 'image2video-first', duration: 6,
      generateAudio: true, shotId: 's1' });
    expect(body).not.toHaveProperty('useDirector');
    expect(String(body.prompt)).toContain('台词：「你好」');
    expect(String(body.prompt)).toContain('【连贯要求】');
  });

  it('adds the chosen shot size, camera move, light and sound after the description', () => {
    const doc = plannedDoc();
    const directed = shot({ id: 's1', prompt: '林夏拆信', shotSize: '近景', cameraMotion: 'static', cameraMove: '缓慢推进', lighting: '窗侧冷光', audioCues: '雨声' });
    const lines = String(buildShotGenerateRequest({ doc, shot: directed, modelId: 'm', capability }).prompt).split('\n');
    expect(lines.slice(0, 2)).toEqual(['林夏拆信', '镜头：近景，缓慢推进。光线：窗侧冷光。声音：雨声。']);
    // The planner's placeholders were never chosen, so they add nothing.
    expect(shotLanguageText({ shotSize: 'medium', cameraMotion: 'static', lighting: ' ' })).toBe('');
    expect(chosenShotValue('medium')).toBe('');
  });

  it('asks the polish model for one shot with its scene, cast and current settings', () => {
    const doc = plannedDoc();
    const scene = doc.episodes[0].scenes[0];
    scene.shots = [shot({ id: 'p1', prompt: '@林夏 拆信', characterIds: ['lin'], sceneId: 'cafe', shotSize: '特写', dialogue: '是你？' })];
    const [system, user] = buildPolishMessages(doc, 'p1');
    expect(system.content).toContain('只输出一个 JSON 对象');
    expect(user.content).toContain('原画面描述：@林夏 拆信');
    expect(user.content).toContain('出场角色：林夏（短发，黑色风衣）');
    expect(user.content).toContain('现在的镜头设置：镜头：特写。');
    expect(user.content).toContain('台词：「是你？」');
    expect(() => buildPolishMessages(doc, 'nope')).toThrow(DramaPlannerError);
    expect(parsePolishResponse('{"prompt":"  新描述 ","shotSize":3,"lighting":"顶光"}')).toEqual({ prompt: '新描述', lighting: '顶光' });
    expect(() => parsePolishResponse('{"prompt":""}')).toThrow('DRAMA_PLAN_INVALID');
  });

  it('writes continuity from the bible and the previous shot in the same scene', () => {
    const doc = plannedDoc();
    doc.cast[0] = { ...doc.cast[0], costume: '黑色风衣。', hair: '短发' };
    doc.cast.push({ id: 'cat', name: '大橘', appearance: '圆润的橘猫。', costume: '无', hair: '橘色短毛' });
    doc.props = [{ id: 'letter', name: '信', description: '泛黄的信封' }];
    const scene = doc.episodes[0].scenes[0];
    const current = shot({ id: 'b', sceneId: 'cafe', characterIds: ['lin', 'cat'], propIds: ['letter'], continuityNotes: ['信在左手'] });
    scene.shots = [shot({ id: 'a', actionBeat: '林夏接过信' }), current];
    const chained = shotContinuityText(doc, current, scene.shots[0], 'previous-shot');
    // Trailing sentence marks are dropped so the joined line does not read "。，".
    expect(chained).toContain('人物：林夏（短发，黑色风衣，服装 黑色风衣，短发）；大橘（圆润的橘猫，橘色短毛）');
    expect(chained).toContain('场景：咖啡馆·内·夜，雨夜的街角咖啡馆');
    expect(chained).toContain('道具：信（泛黄的信封）');
    expect(chained).toContain('画风：节奏感画面');
    expect(chained).toContain('首帧就是上一镜头的最后一个画面');
    expect(chained).toContain('注意：信在左手');
    expect(shotContinuityText(doc, current, scene.shots[0], 'user')).toContain('紧接上一镜头（林夏接过信）');
    expect(shotContinuityText(doc, current, undefined, 'location')).not.toContain('衔接');
    // A scene's first shot has nothing before it to continue from.
    expect(orderedShots(doc, doc.episodes[0].id).map(item => item.previous?.id)).toEqual([undefined, 'a']);
  });

  it('sends a last frame only with a first frame and only to models that take both', () => {
    const both = { imageToVideo: true, maxReferenceImages: 3, firstLastFrame: true };
    const s = shot({ id: 's1', lastFrameUrl: '/l.png', characterIds: [] });
    expect(chooseLastFrame(s, both, '/f.png')).toBe('/l.png');
    expect(chooseLastFrame(s, both, undefined)).toBeUndefined();
    expect(chooseLastFrame(s, { ...both, firstLastFrame: false }, '/f.png')).toBeUndefined();
    expect(chooseLastFrame(shot({ id: 's2' }), both, '/f.png')).toBeUndefined();
    const body = buildShotGenerateRequest({ doc: plannedDoc(), shot: s, modelId: 'm', capability: both, firstFrameUrl: '/f.png', lastFrameUrl: '/l.png' });
    expect(body).toMatchObject({ imageUrl: '/f.png', lastFrameImageUrl: '/l.png', mode: 'image2video-firstlast' });
    const single = buildShotGenerateRequest({ doc: plannedDoc(), shot: s, modelId: 'm', capability: both, firstFrameUrl: '/f.png' });
    expect(single).toMatchObject({ mode: 'image2video-first' });
    expect(single).not.toHaveProperty('lastFrameImageUrl');
  });
});

describe('runShot', () => {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  it('extracts the previous last frame, submits once and settles on completion', async () => {
    const doc = plannedDoc();
    const prev = shot({ id: 'a', takes: [{ id: 'k', status: 'completed', videoUrl: '/v/a.mp4', createdAt: 1 }] });
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const responses = [
      json({ imageUrl: '/f/last.png' }),
      json({ taskId: 'task-1', creditCost: 12 }),
      json({ status: 'processing' }),
      json({ status: 'completed', videoUrl: '/v/b.mp4', videoThumbnailUrl: '/v/b.jpg' }),
    ];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return responses.shift()!;
    });
    const takes: string[] = [];
    const take = await runShot({
      doc, shot: shot({ id: 'b' }), previous: prev, modelId: 'm', capability: { imageToVideo: true, maxReferenceImages: 0 },
      fetch: fetcher, sleep: async () => undefined, onTake: t => takes.push(t.status),
    });
    expect(calls.map(call => call.url)).toEqual(['/api/video/extract-frame', '/api/video/generate', '/api/poll-task', '/api/poll-task']);
    expect(calls[0].body).toEqual({ videoUrl: '/v/a.mp4', mode: 'last' });
    expect(calls[1].body.imageUrl).toBe('/f/last.png');
    expect(String(calls[1].body.prompt)).toContain('首帧就是上一镜头的最后一个画面');
    expect(take).toMatchObject({ status: 'completed', taskId: 'task-1', credits: 12, videoUrl: '/v/b.mp4', thumbnailUrl: '/v/b.jpg' });
    expect(takes.at(-1)).toBe('completed');
  });

  it('records the server error when submission is rejected', async () => {
    const fetcher = vi.fn(async () => json({ error: '积分不足，请先充值' }, 402));
    const take = await runShot({
      doc: plannedDoc(), shot: shot({ id: 'b' }), modelId: 'm', capability: { imageToVideo: false, maxReferenceImages: 0 },
      fetch: fetcher, sleep: async () => undefined,
    });
    expect(take).toMatchObject({ status: 'failed', error: '积分不足，请先充值' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps the server retryable flag and never retries credit or capability failures', async () => {
    const responses = [json({ taskId: 'task-1' }), json({ status: 'failed', error: '供应商繁忙', retryable: true })];
    const take = await runShot({
      doc: plannedDoc(), shot: shot({ id: 'b' }), modelId: 'm', capability: { imageToVideo: false, maxReferenceImages: 0 },
      fetch: async () => responses.shift()!, sleep: async () => undefined,
    });
    expect(take).toMatchObject({ status: 'failed', retryable: true });
    expect(isRetryableTake(take)).toBe(true);
    const credit = await runShot({
      doc: plannedDoc(), shot: shot({ id: 'b' }), modelId: 'm', capability: { imageToVideo: false, maxReferenceImages: 0 },
      fetch: async () => json({ error: '积分不足或积分服务暂不可用，未向视频供应商提交请求', retryable: true }, 402), sleep: async () => undefined,
    });
    expect(credit.retryable).toBe(true);
    expect(isRetryableTake(credit)).toBe(false);
    expect(isRetryableTake({ id: 't', status: 'failed', error: '模型不支持参考图', retryable: true, createdAt: 1 })).toBe(false);
    expect(isRetryableTake({ id: 't', status: 'failed', error: '超时', createdAt: 1 })).toBe(false);
  });
});

describe('timeline', () => {
  it('uses selected takes, reports missing shots and places dialogue cues', () => {
    const doc = plannedDoc();
    const episode = doc.episodes[0];
    episode.scenes[0].shots = [
      shot({ id: 'a', dialogue: '第一句', takes: [
        { id: 'k1', status: 'completed', videoUrl: '/v/a1.mp4', createdAt: 1 },
        { id: 'k2', status: 'completed', videoUrl: '/v/a2.mp4', createdAt: 2 },
      ], selectedTakeId: 'k1' }),
      shot({ id: 'b', takes: [{ id: 'k3', status: 'failed', createdAt: 3 }] }),
    ];
    expect(activeTake(episode.scenes[0].shots[0])?.videoUrl).toBe('/v/a1.mp4');
    const timeline = collectEpisodeTimeline(doc, episode.id);
    expect(timeline.clips).toEqual([{ shotId: 'a', videoUrl: '/v/a1.mp4', dialogue: '第一句' }]);
    expect(timeline.missingShotIds).toEqual(['b']);
    expect(dialogueCues([{ dialogue: 'x' }, {}, { dialogue: 'z' }], [0, 4.5, 9], [5, 5, 5], 0.5)).toEqual([
      { startSec: 0, endSec: 4.5, text: 'x' },
      { startSec: 9.5, endSec: 14, text: 'z' },
    ]);
  });
});
