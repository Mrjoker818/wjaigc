import { describe, expect, it } from 'vitest';
import {
  currentTakeForShot, filmInputSnapshot, isFilmCurrent, isTakeCurrent, isVoiceoverCurrent,
  quoteInputSnapshot, shotInputSnapshot, voiceoverInputSnapshot,
} from '@/lib/drama/production-version';
import { buildTimeline, collectEpisodeTimeline } from '@/lib/drama/timeline';
import { shotReadiness } from '@/lib/drama/readiness';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot, type DramaTake } from '@/lib/drama/types';

const selection = { videoModelId: 'video', videoProviderId: 'vp', imageModelId: 'image', imageProviderId: 'ip' };

function shot(id = 's'): DramaShot {
  return {
    id, index: 0, title: '开门', purpose: '揭示', actionBeat: '推门', prompt: '她推开门', directedPrompt: 'close up, opens door',
    shotSize: '近景', cameraMove: '推进', cameraMotion: '推进', lighting: '暖光', audioCues: '风声',
    camera: { type: 'push_in', speed: 20, intensity: 30 },
    motion: { maskDataUrl: 'data:image/png;base64,mask', trajectories: [{ startX: 0, startY: 0, endX: 1, endY: 1, speed: 20 }] },
    firstFramePrompt: '门外', lastFramePrompt: '门内', firstFrameUrl: '/first.png', lastFrameUrl: '/last.png', firstFrameFromPrev: false,
    duration: 5, durationSec: 5, aspectRatio: '9:16', modelId: 'video', providerId: 'vp',
    references: [{ id: 'r', url: '/ref.png', role: 'identity', weight: 0.8, label: '参考' }],
    continuityNotes: ['保持外套'], setting: '老屋', characterIds: ['a'], sceneId: 'room', propIds: ['key'],
    dialogue: '我回来了', speakerId: 'a', status: 'planned', takes: [],
  };
}

function fixture(): DramaProjectV1 {
  const script = '内景 老屋 夜\n甲：我回来了\n';
  return {
    ...createEmptyDramaProject(),
    cast: [
      { id: 'a', name: '甲', appearance: '短发', costume: '外套', hair: '黑发', age: '20', voice: 'nova', voiceSampleUrl: '/sample.mp3', voiceSampleSec: 3,
        lockedImageUrl: '/a-locked.png', imageUrlFront: '/a-front.png', imageUrlFace: '/a-face.png', frontPrompt: '甲的肖像' },
      { id: 'b', name: '乙', appearance: '长发', voice: 'onyx', imageUrlFront: '/b.png' },
    ],
    locations: [{ id: 'room', name: '老屋', description: '木门', lighting: '黄灯', lockedImageUrl: '/room.png', imageUrl: '/room-other.png' }],
    props: [{ id: 'key', name: '钥匙', description: '铜钥匙', material: '铜', color: '金', lockedImageUrl: '/key.png', imageUrl: '/key-other.png' }],
    episodes: [Object.assign({
      id: 'e', index: 0, title: '归来', logline: '故人回家', script,
      scenes: [Object.assign({ id: 'sc', heading: '内景 老屋 夜', summary: '甲回家', locationId: 'room', characterIds: ['a'], shots: [shot(), shot('other')] },
        { sourceRange: { start: 0, end: script.length } })],
    }, { structuredScript: script })],
  };
}

const target = (doc: DramaProjectV1) => doc.episodes[0].scenes[0].shots[0];
const snapshot = (doc: DramaProjectV1) => shotInputSnapshot(doc, 'e', 's');
const recordedTake = (doc: DramaProjectV1, id = 't'): DramaTake => Object.assign({
  id, status: 'completed' as const, videoUrl: `/${id}.mp4`, createdAt: 1,
}, { inputSnapshot: snapshot(doc) });

describe('drama production input snapshots', () => {
  it('serializes deterministic parseable JSON without mutating the document', () => {
    const doc = fixture();
    const before = structuredClone(doc);
    const value = snapshot(doc);
    expect(JSON.parse(value)).toEqual(expect.any(Object));
    const reordered = structuredClone(doc);
    target(reordered).camera = { intensity: 30, speed: 20, type: 'push_in' };
    expect(snapshot(reordered)).toBe(value);
    expect(snapshot(doc)).toBe(value);
    expect(doc).toEqual(before);
  });

  it('sorts object keys recursively for every public snapshot format', () => {
    const doc = fixture();
    const sortedKeys = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(sortedKeys); return; }
      expect(Object.keys(value)).toEqual(Object.keys(value).sort());
      Object.values(value).forEach(sortedKeys);
    };
    [snapshot(doc), voiceoverInputSnapshot(doc, target(doc)), filmInputSnapshot(doc, 'e'), quoteInputSnapshot(doc, 'e', selection)]
      .forEach(value => sortedKeys(JSON.parse(value)));
  });

  it.each<[string, (s: DramaShot) => void]>([
    ['prompt', s => { s.prompt += '!'; }],
    ['director prompt', s => { s.directedPrompt += '!'; }],
    ['purpose', s => { s.purpose += '!'; }],
    ['action', s => { s.actionBeat += '!'; }],
    ['shot size', s => { s.shotSize = '远景'; }],
    ['camera move', s => { s.cameraMove = '手持'; }],
    ['camera motion', s => { s.cameraMotion = '手持'; }],
    ['camera parameters', s => { s.camera!.speed = 80; }],
    ['motion mask', s => { s.motion!.maskDataUrl += 'x'; }],
    ['motion trajectory', s => { s.motion!.trajectories[0].endX = 0.4; }],
    ['lighting', s => { s.lighting = '冷光'; }],
    ['audio cues', s => { s.audioCues = '脚步'; }],
    ['duration', s => { s.durationSec = 10; s.duration = 10; }],
    ['aspect ratio', s => { s.aspectRatio = '16:9'; }],
    ['model', s => { s.modelId = 'another'; }],
    ['provider', s => { s.providerId = 'another'; }],
    ['first frame prompt', s => { s.firstFramePrompt += '!'; }],
    ['last frame prompt', s => { s.lastFramePrompt += '!'; }],
    ['first frame', s => { s.firstFrameUrl = '/new.png'; }],
    ['last frame', s => { s.lastFrameUrl = '/new.png'; }],
    ['frame continuation', s => { s.firstFrameFromPrev = true; }],
    ['reference', s => { s.references[0].url = '/new.png'; }],
    ['reference role', s => { s.references[0].role = 'style'; }],
    ['reference weight', s => { s.references[0].weight = 0.2; }],
    ['continuity', s => { s.continuityNotes.push('保持门开'); }],
    ['setting', s => { s.setting = '新屋'; }],
    ['dialogue', s => { s.dialogue = '再见'; }],
    ['speaker', s => { s.speakerId = 'b'; }],
    ['voice sample switch', s => { s.voiceSampleOff = true; }],
    ['cast assignment', s => { s.characterIds = ['b']; }],
    ['location assignment', s => { s.sceneId = 'elsewhere'; }],
    ['prop assignment', s => { s.propIds = []; }],
  ])('invalidates a shot when its %s changes', (_name, change) => {
    const doc = fixture();
    const before = snapshot(doc);
    change(target(doc));
    expect(snapshot(doc)).not.toBe(before);
  });

  it.each<[string, (doc: DramaProjectV1) => void]>([
    ['style', doc => { doc.style = 'anime'; }],
    ['project ratio', doc => { doc.aspectRatio = '16:9'; }],
    ['source text', doc => { doc.episodes[0].script = doc.episodes[0].script.replace('回来了', '离开了'); }],
    ['parsed source version', doc => { Object.assign(doc.episodes[0], { structuredScript: '旧版正文' }); }],
    ['scene summary', doc => { doc.episodes[0].scenes[0].summary = '甲告别'; }],
    ['scene heading', doc => { doc.episodes[0].scenes[0].heading = '外景 日'; }],
    ['appearance', doc => { doc.cast[0].appearance = '长发'; }],
    ['costume', doc => { doc.cast[0].costume = '西装'; }],
    ['lock', doc => { doc.cast[0].lockedImageUrl = '/new-lock.png'; }],
    ['location lock', doc => { doc.locations[0].lockedImageUrl = '/new-lock.png'; }],
    ['location description', doc => { doc.locations[0].description = '铁门'; }],
    ['prop lock', doc => { doc.props[0].lockedImageUrl = '/new-lock.png'; }],
    ['prop description', doc => { doc.props[0].description = '银钥匙'; }],
    ['voice', doc => { doc.cast[0].voice = 'onyx'; }],
    ['voice sample', doc => { doc.cast[0].voiceSampleUrl = '/new.mp3'; }],
  ])('binds the relevant %s', (_name, change) => {
    const doc = fixture();
    const before = snapshot(doc);
    change(doc);
    expect(snapshot(doc)).not.toBe(before);
  });

  it('ignores production progress, numbering, labels, histories, non-active pictures and unrelated entities', () => {
    const doc = fixture();
    const before = snapshot(doc);
    const s = target(doc);
    Object.assign(s, { status: 'generating', taskId: 'task', error: 'retry', diagnosis: [], retakeCount: 8, index: 12, title: '改名',
      videoUrl: '/output.mp4', thumbnailUrl: '/output.png', endState: { mood: 'happy' },
      selectedTakeId: 't', voiceoverUrl: '/voice.mp3', voiceoverText: '旧台词', voiceoverSnapshot: 'old',
      clipEdit: { speed: 2 }, still: { motion: 'zoom-in' }, createdAt: 999, apiKey: 'secret' });
    s.takes.push({ id: 't', status: 'generating', createdAt: 99 });
    s.references[0].label = '重命名';
    Object.assign(doc.cast[0], { imageUrlFront: '/unused.png', imageHistory: { front: ['/history.png'] }, status: 'generating', voiceSampleName: '新名称' });
    doc.cast[1].appearance = 'unrelated';
    doc.cast.reverse();
    doc.props[0].imageUrl = '/unused.png';
    doc.locations[0].imageUrl = '/unused.png';
    doc.title = '改名';
    doc.timeline.subtitles = false;
    expect(snapshot(doc)).toBe(before);
    expect(snapshot(doc)).not.toContain('secret');
  });

  it('binds fallback images once an item is unlocked', () => {
    const doc = fixture();
    delete doc.cast[0].lockedImageUrl;
    const before = snapshot(doc);
    doc.cast[0].imageUrlFace = '/new-face.png';
    expect(snapshot(doc)).not.toBe(before);
  });

  it('does not invalidate another scene when current and structured text change only outside its range', () => {
    const doc = fixture();
    const before = snapshot(doc);
    doc.episodes[0].script += '\n另一场的对白';
    Object.assign(doc.episodes[0], { structuredScript: doc.episodes[0].script });
    expect(snapshot(doc)).toBe(before);
  });

  it('rejects unknown episode and shot ids instead of manufacturing a shared snapshot', () => {
    expect(() => shotInputSnapshot(fixture(), 'missing', 's')).toThrow();
    expect(() => shotInputSnapshot(fixture(), 'e', 'missing')).toThrow();
    expect(() => filmInputSnapshot(fixture(), 'missing')).toThrow();
    expect(() => quoteInputSnapshot(fixture(), 'missing', selection)).toThrow();
  });
});

describe('drama current production outputs', () => {
  it('preserves legacy takes and checks exact newly recorded snapshots without deleting history', () => {
    const doc = fixture();
    const s = target(doc);
    const take = recordedTake(doc);
    s.takes.push(take);
    expect(isTakeCurrent(doc, 'e', s, take)).toBe(true);
    expect(currentTakeForShot(doc, 'e', s)).toBe(take);
    s.prompt += '!';
    expect(isTakeCurrent(doc, 'e', s, take)).toBe(false);
    expect(currentTakeForShot(doc, 'e', s)).toBeUndefined();
    expect(s.takes).toEqual([take]);
    const legacy: DramaTake = { id: 'legacy', status: 'completed', videoUrl: '/old.mp4', createdAt: 0 };
    expect(isTakeCurrent(doc, 'e', s, legacy)).toBe(true);
    expect(isTakeCurrent(doc, 'missing', s, legacy)).toBe(false);
    expect(isTakeCurrent(doc, 'e', s, { ...legacy, inputSnapshot: '' } as DramaTake)).toBe(false);
  });

  it('does not replace a stale selected take with another completed historical take', () => {
    const doc = fixture();
    const s = target(doc);
    s.takes = [recordedTake(doc, 'old')];
    s.prompt += '!';
    s.takes.push(recordedTake(doc, 'new'));
    s.selectedTakeId = 'old';
    expect(currentTakeForShot(doc, 'e', s)).toBeUndefined();
    s.selectedTakeId = 'new';
    expect(currentTakeForShot(doc, 'e', s)?.id).toBe('new');
    s.takes.push({ id: 'pending', status: 'generating', createdAt: 10 });
    delete s.selectedTakeId;
    expect(currentTakeForShot(doc, 'e', s)?.id).toBe('new');
  });

  it('invalidates legacy takes explicitly marked after a source reparse but permits newly captured takes', () => {
    const doc = fixture();
    const s = target(doc);
    const legacy: DramaTake = { id: 'legacy', status: 'completed', videoUrl: '/old.mp4', createdAt: 1 };
    s.takes = [legacy];
    doc.episodes[0].scenes[0].sourceChanged = true;
    expect(isTakeCurrent(doc, 'e', s, legacy)).toBe(false);
    expect(currentTakeForShot(doc, 'e', s)).toBeUndefined();
    s.takes.push(recordedTake(doc, 'after-reparse'));
    expect(currentTakeForShot(doc, 'e', s)?.id).toBe('after-reparse');
  });

  it('binds voiceover to dialogue, resolved speaker, voice and sample but ignores visual edits', () => {
    const doc = fixture();
    const s = target(doc);
    const value = voiceoverInputSnapshot(doc, s);
    s.voiceoverUrl = '/voice.mp3'; s.voiceoverText = s.dialogue;
    Object.assign(s, { voiceoverSnapshot: value });
    expect(isVoiceoverCurrent(doc, s)).toBe(true);
    s.prompt += '!'; s.camera!.speed = 99;
    expect(voiceoverInputSnapshot(doc, s)).toBe(value);
    doc.cast[0].voice = 'onyx';
    expect(isVoiceoverCurrent(doc, s)).toBe(false);
    doc.cast[0].voice = 'nova'; doc.cast[0].voiceSampleUrl = '/new-sample.mp3';
    expect(isVoiceoverCurrent(doc, s)).toBe(false);
    s.speakerId = 'b';
    expect(voiceoverInputSnapshot(doc, s)).not.toBe(value);
  });

  it('uses existing speaker fallback and legacy voiceover text rules', () => {
    const doc = fixture();
    const s = target(doc);
    s.dialogue = '  你好  '; s.voiceoverUrl = '/voice.mp3'; s.voiceoverText = '你好';
    expect(isVoiceoverCurrent(doc, s)).toBe(true);
    s.voiceoverText = '再见';
    expect(isVoiceoverCurrent(doc, s)).toBe(false);
    s.speakerId = 'missing';
    const value = voiceoverInputSnapshot(doc, s);
    doc.cast[0].voice = 'onyx';
    expect(voiceoverInputSnapshot(doc, s)).not.toBe(value);
    s.dialogue = '';
    expect(isVoiceoverCurrent(doc, s)).toBe(false);
  });

  it('checks render completion, episode and exact inputs while leaving legacy renders usable', () => {
    const doc = fixture();
    expect(isFilmCurrent(doc, 'e')).toBe(false);
    doc.timeline.lastRender = { taskId: 'r', status: 'completed', videoUrl: '/film.mp4', episodeId: 'e', createdAt: 1 };
    expect(isFilmCurrent(doc, 'e')).toBe(true);
    expect(isFilmCurrent(doc, 'missing')).toBe(false);
    Object.assign(doc.timeline.lastRender, { inputSnapshot: filmInputSnapshot(doc, 'e') });
    expect(isFilmCurrent(doc, 'e')).toBe(true);
    doc.timeline.lastRender.createdAt = 2;
    expect(isFilmCurrent(doc, 'e')).toBe(true);
    doc.timeline.subtitles = false;
    expect(isFilmCurrent(doc, 'e')).toBe(false);
    doc.timeline.subtitles = true; doc.timeline.lastRender.episodeId = 'other';
    expect(isFilmCurrent(doc, 'e')).toBe(false);
    doc.timeline.lastRender.episodeId = 'e'; doc.timeline.lastRender.status = 'processing';
    expect(isFilmCurrent(doc, 'e')).toBe(false);
  });
});

describe('drama film and quote dependency coverage', () => {
  it.each<[string, (doc: DramaProjectV1) => void]>([
    ['take selection', doc => { target(doc).selectedTakeId = 'second'; }],
    ['active media', doc => { target(doc).takes[0].videoUrl = '/replaced.mp4'; }],
    ['trim', doc => { target(doc).clipEdit = { trimStartSec: 1, trimEndSec: 3 }; }],
    ['speed', doc => { target(doc).clipEdit = { speed: 1.5 }; }],
    ['source audio', doc => { target(doc).clipEdit = { volume: 0 }; }],
    ['still choice', doc => { target(doc).still = { motion: 'push-in' }; }],
    ['dialogue', doc => { target(doc).dialogue = '新台词'; }],
    ['voice', doc => { doc.cast[0].voice = 'onyx'; }],
    ['voice media', doc => { target(doc).voiceoverUrl = '/new-audio.mp3'; }],
    ['subtitles', doc => { doc.timeline.subtitles = false; }],
    ['transition', doc => { doc.timeline.transition = 'fade'; }],
    ['transition length', doc => { doc.timeline.transitionSec = 1; }],
    ['music', doc => { doc.timeline.music = { url: '/bgm.mp3', name: '曲', volume: 0.5, ducking: true }; }],
    ['shot order', doc => { doc.episodes[0].scenes[0].shots.reverse(); }],
  ])('binds film %s', (_name, change) => {
    const doc = fixture();
    target(doc).takes = [{ id: 'first', status: 'completed', videoUrl: '/first.mp4', createdAt: 1 }, { id: 'second', status: 'completed', videoUrl: '/second.mp4', createdAt: 2 }];
    target(doc).selectedTakeId = 'first';
    target(doc).voiceoverUrl = '/voice.mp3'; target(doc).voiceoverText = target(doc).dialogue;
    const before = filmInputSnapshot(doc, 'e');
    change(doc);
    expect(filmInputSnapshot(doc, 'e')).not.toBe(before);
  });

  it('ignores unselected history and render progress in a film snapshot', () => {
    const doc = fixture();
    target(doc).takes = [recordedTake(doc)];
    target(doc).selectedTakeId = 't';
    const before = filmInputSnapshot(doc, 'e');
    target(doc).takes.unshift({ id: 'history', status: 'completed', videoUrl: '/history.mp4', createdAt: 0 });
    target(doc).takes.push({ id: 'pending', status: 'generating', createdAt: 3 });
    doc.timeline.lastRender = { taskId: 'render', status: 'processing', createdAt: 999 };
    expect(filmInputSnapshot(doc, 'e')).toBe(before);
  });

  it('binds full quote input configuration including all model choices and bible image prompts', () => {
    const doc = fixture();
    const before = quoteInputSnapshot(doc, 'e', selection);
    for (const key of Object.keys(selection) as Array<keyof typeof selection>) {
      expect(quoteInputSnapshot(doc, 'e', { ...selection, [key]: 'changed' })).not.toBe(before);
    }
    expect(quoteInputSnapshot(doc, 'e', { ...selection, generateAudio: true })).not.toBe(before);
    expect(quoteInputSnapshot(doc, 'e', { ...selection, generateAudio: true }))
      .not.toBe(quoteInputSnapshot(doc, 'e', { ...selection, generateAudio: false }));
    const changes: Array<(doc: DramaProjectV1) => void> = [
      doc => { target(doc).durationSec = 10; }, doc => { target(doc).camera!.intensity = 1; },
      doc => { target(doc).modelId = 'override'; }, doc => { doc.cast[0].frontPrompt = '新版'; },
      doc => { doc.locations[0].scenePrompt = '新版'; }, doc => { doc.props[0].propPrompt = '新版'; },
      doc => { doc.cast[0].lockedImageUrl = '/new.png'; }, doc => { doc.episodes[0].script += '新版'; },
      doc => { Object.assign(doc, { planner: { modelId: 'chat', providerId: 'cp' } }); },
    ];
    for (const change of changes) {
      const changed = structuredClone(doc); change(changed);
      expect(quoteInputSnapshot(changed, 'e', selection)).not.toBe(before);
    }
  });

  it('permits take and render progress without invalidating generation configuration', () => {
    const doc = fixture();
    const before = quoteInputSnapshot(doc, 'e', selection);
    target(doc).status = 'generating';
    target(doc).takes.push({ id: 'running', taskId: 'task', status: 'generating', createdAt: 1 });
    doc.cast[0].status = 'generating';
    doc.timeline.lastRender = { taskId: 'render', status: 'processing', createdAt: 1 };
    expect(quoteInputSnapshot(doc, 'e', selection)).toBe(before);
    // Completed outputs are relevant to the INITIAL quote (they remove paid work).
    target(doc).takes[0].status = 'completed'; target(doc).takes[0].videoUrl = '/done.mp4';
    expect(quoteInputSnapshot(doc, 'e', selection)).not.toBe(before);
  });

  it('never serializes arbitrary provider configuration or secrets on nested input objects', () => {
    const doc = fixture();
    Object.assign(doc, { apiKey: 'top-secret', providers: [{ apiKey: 'provider-secret' }] });
    Object.assign(target(doc).camera!, { apiKey: 'camera-secret' });
    Object.assign(target(doc).references[0], { authorization: 'ref-secret' });
    Object.assign(doc.cast[0], { apiKey: 'cast-secret' });
    const values = [snapshot(doc), voiceoverInputSnapshot(doc, target(doc)), filmInputSnapshot(doc, 'e'), quoteInputSnapshot(doc, 'e', selection)];
    for (const value of values) expect(value).not.toContain('secret');
  });
});

describe('drama timeline and readiness version integration', () => {
  it('does not offer a stale previous take as an available first frame', () => {
    const doc = fixture();
    const first = target(doc);
    const next = doc.episodes[0].scenes[0].shots[1];
    first.takes = [recordedTake(doc)];
    first.prompt += '!';
    delete next.firstFrameUrl;
    delete next.firstFrameFromPrev;
    doc.locations = [];
    const model = { name: 'video', capability: { imageToVideo: true, maxReferenceImages: 1 }, durations: [5], ratios: ['9:16'] };
    expect(shotReadiness(doc, 'e', next, model).find(check => check.key === 'firstFrame')?.ok).toBe(false);
    first.takes.push(recordedTake(doc, 'fresh'));
    expect(shotReadiness(doc, 'e', next, model).find(check => check.key === 'firstFrame')?.ok).toBe(true);
  });

  it('omits stale selected media from rendering and reports it missing even with a newer valid historical take', () => {
    const doc = fixture();
    const s = target(doc);
    s.takes = [recordedTake(doc, 'old')];
    s.prompt += '!'; s.takes.push(recordedTake(doc, 'fresh')); s.selectedTakeId = 'old';
    expect(collectEpisodeTimeline(doc, 'e').missingShotIds).toContain('s');
    expect(collectEpisodeTimeline(doc, 'e').clips.find(clip => clip.shotId === 's')).toBeUndefined();
    expect(buildTimeline(doc, 'e').find(block => block.shotId === 's')?.hasTake).toBe(false);
    expect(shotReadiness(doc, 'e', s, undefined).find(check => check.key === 'video')?.ok).toBe(false);
  });

  it('omits an old voice after a voice change and still permits explicitly chosen still media', () => {
    const doc = fixture();
    const s = target(doc);
    s.takes = [recordedTake(doc)];
    s.voiceoverUrl = '/voice.mp3'; s.voiceoverText = s.dialogue;
    Object.assign(s, { voiceoverSnapshot: voiceoverInputSnapshot(doc, s) });
    doc.cast[0].voice = 'onyx';
    s.still = { motion: 'push-in' };
    expect(collectEpisodeTimeline(doc, 'e').clips.find(clip => clip.shotId === 's')).toEqual({
      shotId: 's', still: { url: '/first.png', motion: 'push-in', durationSec: 5 }, dialogue: '我回来了',
    });
    expect(buildTimeline(doc, 'e').find(block => block.shotId === 's')?.hasTake).toBe(true);
    const checks = shotReadiness(doc, 'e', s, undefined);
    expect(checks.find(check => check.key === 'video')?.ok).toBe(true);
    expect(checks.find(check => check.key === 'voiceover')?.ok).toBe(false);
  });
});
