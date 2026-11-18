import { describe, expect, it, vi } from 'vitest';
import { parseDramaScriptResponse } from '@/lib/drama/planner';
import { castImagePrompt, keyframePrompt, keyframeReferences, locationImageRatio, propImagePrompt } from '@/lib/drama/reference-prompts';
import { parseDramaProject } from '@/lib/drama/schema';
import { buildTimeline } from '@/lib/drama/timeline';
import { activeTake, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';
import {
  applyRetakeSuggestion, DramaSaveConflictError, estimateShots, generateReferenceImage, pollShotTake, saveDramaProject,
} from '@/lib/drama/workbench-client';
import {
  addShot, blankEpisodeDoc, failedShots, findShot, fitDuration, formatTimecode, moveShot, orderedPrevious, pendingShots,
  removeCastMember, removeProp, removeShot, selectTake, setSceneShots, updateShot, upsertTake,
} from '@/lib/drama/workbench-state';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function shot(id: string, partial: Partial<DramaShot> = {}): DramaShot {
  return {
    id, index: 0, title: '', purpose: '', actionBeat: '', prompt: id, duration: 5, durationSec: 5, aspectRatio: '9:16',
    references: [], continuityNotes: [], status: 'planned', takes: [], ...partial,
  };
}

function docWithShots(): DramaProjectV1 {
  const doc = parseDramaScriptResponse(JSON.stringify({
    title: '雨夜', cast: [{ id: 'lin', name: '林夏', appearance: '短发' }], locations: [],
    episodes: [{ title: '一', scenes: [{ heading: 'A', summary: 'a', characterIds: ['lin'] }, { heading: 'B', summary: 'b' }] }],
  }), { idea: 'x' }, 1000);
  const [a, b] = doc.episodes[0].scenes;
  return setSceneShots(setSceneShots(doc, a.id, [shot('s1', { characterIds: ['lin'] }), shot('s2')]), b.id, [shot('s3', { durationSec: 3, duration: 3 })]);
}

describe('workbench document edits', () => {
  it('keeps indexes, durations and validity through add, move and remove', () => {
    let doc = docWithShots();
    const sceneA = doc.episodes[0].scenes[0].id;
    const added = addShot(doc, sceneA, 's1', 2000)!;
    doc = added.doc;
    expect(doc.episodes[0].scenes[0].shots.map(s => s.id)).toEqual(['s1', added.shotId, 's2']);
    expect(findShot(doc, added.shotId)?.shot.characterIds).toEqual(['lin']);
    // Moving past the end of a scene joins the next scene.
    doc = moveShot(doc, 's2', 1);
    expect(doc.episodes[0].scenes[1].shots.map(s => s.id)).toEqual(['s2', 's3']);
    expect(doc.episodes[0].scenes[1].shots.map(s => s.index)).toEqual([0, 1]);
    doc = removeShot(doc, added.shotId);
    doc = updateShot(doc, 's1', { durationSec: 8 });
    expect(findShot(doc, 's1')?.shot.duration).toBe(8);
    expect(orderedPrevious(doc, doc.episodes[0].id, 's2')?.id).toBe('s1');
    expect(() => parseDramaProject(doc)).not.toThrow();
  });

  it('selects the newest completed take and keeps an older one when a retake fails', () => {
    let doc = docWithShots();
    doc = upsertTake(doc, 's1', { id: 't1', status: 'completed', videoUrl: '/v/1.mp4', createdAt: 1 });
    doc = upsertTake(doc, 's1', { id: 't2', status: 'generating', taskId: 'task', createdAt: 2 });
    expect(findShot(doc, 's1')?.shot.status).toBe('generating');
    doc = upsertTake(doc, 's1', { id: 't2', status: 'failed', error: 'x', createdAt: 2 });
    const kept = findShot(doc, 's1')!.shot;
    expect(kept.status).toBe('completed');
    expect(activeTake(kept)?.id).toBe('t1');
    doc = upsertTake(doc, 's1', { id: 't3', status: 'completed', videoUrl: '/v/3.mp4', createdAt: 3 });
    expect(findShot(doc, 's1')?.shot.selectedTakeId).toBe('t3');
    doc = selectTake(doc, 's1', 't1');
    expect(activeTake(findShot(doc, 's1')!.shot)?.videoUrl).toBe('/v/1.mp4');
    // A failed take cannot be selected.
    expect(selectTake(doc, 's1', 't2')).toBe(doc);
    expect(pendingShots(doc.episodes[0]).map(s => s.id)).toEqual(['s2', 's3']);
    // Only shots whose newest take failed and that have nothing usable count as failed.
    doc = upsertTake(doc, 's2', { id: 't4', status: 'failed', error: 'x', createdAt: 4 });
    expect(failedShots(doc.episodes[0]).map(s => s.id)).toEqual(['s2']);
    doc = upsertTake(doc, 's2', { id: 't5', status: 'generating', createdAt: 5 });
    expect(failedShots(doc.episodes[0])).toEqual([]);
  });

  it('removes a cast member from scenes and shots', () => {
    const doc = removeCastMember(docWithShots(), 'lin');
    expect(doc.cast).toEqual([]);
    expect(doc.episodes[0].scenes[0].characterIds).toEqual([]);
    expect(findShot(doc, 's1')?.shot.characterIds).toEqual([]);
  });

  it('removes a prop from every shot that shows it', () => {
    let doc = docWithShots();
    doc = { ...doc, props: [{ id: 'ticket', name: '彩票' }, { id: 'ring', name: '戒指' }] };
    doc = updateShot(doc, 's1', { propIds: ['ticket', 'ring'] });
    doc = removeProp(doc, 'ticket');
    expect(doc.props.map(prop => prop.id)).toEqual(['ring']);
    expect(findShot(doc, 's1')?.shot.propIds).toEqual(['ring']);
    expect(() => parseDramaProject(doc)).not.toThrow();
  });

  it('builds a valid blank episode for users who write their own script', () => {
    const doc = blankEpisodeDoc(docWithShots(), '一句话', 5000);
    expect(doc.episodes).toHaveLength(1);
    expect(doc.episodes[0].scenes[0].shots).toEqual([]);
    expect(() => parseDramaProject(doc)).not.toThrow();
  });

  it('fits durations to the model and formats time codes', () => {
    expect(fitDuration(7, [5, 10])).toBe(5);
    expect(fitDuration(8, [5, 10])).toBe(10);
    expect(fitDuration(20, [], 15)).toBe(15);
    expect(fitDuration(0)).toBe(5);
    expect(formatTimecode(3725)).toBe('01:02:05');
  });

  it('lays out the timeline with transition overlap and subtitles', () => {
    let doc = updateShot(docWithShots(), 's2', { dialogue: '你还在等我？' });
    doc = { ...doc, timeline: { ...doc.timeline, transition: 'fade', transitionSec: 1 } };
    const blocks = buildTimeline(doc, doc.episodes[0].id);
    expect(blocks.map(b => b.startSec)).toEqual([0, 4, 8]);
    expect(blocks.at(-1)?.endSec).toBe(11);
    expect(blocks[1].subtitle).toBe('你还在等我？');
    expect(blocks.map(b => b.sceneNumber)).toEqual([1, 1, 2]);
  });
});

describe('workbench client', () => {
  it('reports a version conflict separately from other save errors', async () => {
    const doc = docWithShots();
    await expect(saveDramaProject('drama_x', 1, doc, async () => json({ error: '已在其他窗口修改', currentVersion: 3 }, 409)))
      .rejects.toBeInstanceOf(DramaSaveConflictError);
    await expect(saveDramaProject('drama_x', 1, doc, async () => json({ error: '保存失败' }, 500))).rejects.toThrow('保存失败');
  });

  it('polls an image task until it returns a URL', async () => {
    const calls: string[] = [];
    const responses = [json({ success: true, taskId: 'img1' }), json({ status: 'processing' }), json({ status: 'completed', result: { imageUrl: '/i/a.png' } })];
    const bodies: unknown[] = [];
    const url = await generateReferenceImage('p', '2:3', {
      fetch: async (input, init) => { calls.push(input); bodies.push(JSON.parse(String(init?.body))); return responses.shift()!; },
      sleep: async () => undefined,
    });
    expect(url).toBe('/i/a.png');
    // Image models are admitted by ratio; a pixel size is rejected by models that list none.
    expect(bodies[0]).toEqual({ prompt: 'p', n: 1, aspectRatio: '2:3' });
    expect(calls).toEqual(['/api/generate', '/api/poll-task', '/api/poll-task']);
    await expect(generateReferenceImage('p', 's', { fetch: async () => json({ success: false, error: '积分不足' }, 402) })).rejects.toThrow('积分不足');
  });

  it('sends the chosen image model and references for a keyframe', async () => {
    const bodies: unknown[] = [];
    await generateReferenceImage('p', '9:16', {
      model: 'pear::gpt-image', providerId: 'pear', referenceImages: ['/a.png', '/b.png'],
      fetch: async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return json({ imageUrl: '/i/k.png' }); },
    });
    expect(bodies[0]).toEqual({ prompt: 'p', n: 1, aspectRatio: '9:16', model: 'pear::gpt-image', providerId: 'pear', referenceImages: ['/a.png', '/b.png'] });
  });

  it('resumes a take by task id and refuses to guess when the id is missing', async () => {
    const take = { id: 't', status: 'generating' as const, taskId: 'task-1', createdAt: 1 };
    const fetcher = vi.fn(async () => json({ status: 'completed', videoUrl: '/v/a.mp4' }));
    expect(await pollShotTake(take, 'p::m', 'p', { fetch: fetcher, sleep: async () => undefined }))
      .toMatchObject({ status: 'completed', videoUrl: '/v/a.mp4' });
    expect(await pollShotTake(take, 'p::m', 'p', { fetch: async () => json({ status: 'failed', error: 'busy', retryable: true }), sleep: async () => undefined }))
      .toMatchObject({ status: 'failed', retryable: true });
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown[])[1] && ((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))))
      .toEqual({ taskId: 'task-1', model: 'p::m', providerId: 'p' });
    expect(await pollShotTake({ ...take, taskId: undefined }, undefined, undefined, { fetch: fetcher }))
      .toMatchObject({ status: 'failed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reads the estimate and balance', async () => {
    const result = await estimateShots([{ shotId: 's1', modelId: 'p::m', durationSec: 5 }], async () => json({ total: 50, perShot: { s1: 50 }, balance: 20 }));
    expect(result).toEqual({ total: 50, perShot: { s1: 50 }, balance: 20 });
  });

  it('applies one retake suggestion to the shot', () => {
    const next = applyRetakeSuggestion(shot('s', { prompt: '奔跑' }), { label: '减少动作', patch: { duration: 3, cameraMovement: 'static' }, promptAppend: '动作幅度小' });
    expect(next).toMatchObject({ prompt: '奔跑，动作幅度小', durationSec: 3, duration: 3, cameraMotion: 'static', retakeCount: 1 });
  });
});

describe('reference prompts', () => {
  it('describes the character and matches the project ratio for location plates', () => {
    expect(castImagePrompt({ id: 'a', name: '林夏', appearance: '短发', costume: '风衣' }, 'side', 'cinematic')).toContain('wearing 风衣');
    expect(locationImageRatio('9:16')).toBe('9:16');
    expect(locationImageRatio('4:3')).toBe('16:9');
    expect(locationImageRatio('1:1')).toBe('1:1');
  });

  it('draws a keyframe from the shot, its cast and its location, with locked images first', () => {
    const base = docWithShots();
    const doc: DramaProjectV1 = {
      ...base,
      cast: [{ ...base.cast[0], lockedImageUrl: '/cast/lin.png', imageUrlFront: '/cast/lin-front.png', costume: '风衣' }],
      locations: [{ id: 'loc1', name: '便利店', description: '冷白灯管', imageUrl: '/loc/plate.png' }],
    };
    const keyShot = shot('k', { prompt: '林夏推门而入', characterIds: ['lin'], sceneId: 'loc1', shotSize: '中景' });
    const prompt = keyframePrompt(keyShot, doc);
    expect(prompt).toContain('林夏推门而入');
    expect(prompt).toContain('wearing 风衣');
    expect(prompt).toContain('便利店');
    expect(prompt).toContain('中景');
    expect(keyframeReferences(keyShot, doc, 4)).toEqual(['/cast/lin.png', '/loc/plate.png']);
    expect(keyframeReferences(keyShot, doc, 1)).toEqual(['/cast/lin.png']);
    expect(keyframeReferences(keyShot, doc, 0)).toEqual([]);
    const withProp: DramaProjectV1 = { ...doc, props: [{ id: 'ticket', name: '彩票', description: '泛黄', lockedImageUrl: '/prop/t.png' }] };
    const propShot = { ...keyShot, propIds: ['ticket'] };
    expect(keyframePrompt(propShot, withProp)).toContain('彩票');
    expect(keyframeReferences(propShot, withProp, 4)).toEqual(['/cast/lin.png', '/loc/plate.png', '/prop/t.png']);
  });

  it('draws a prop sheet from its description', () => {
    const prompt = propImagePrompt({ id: 'ticket', name: '彩票', description: '泛黄的旧彩票', material: '纸' }, 'cinematic');
    expect(prompt).toContain('prop design reference sheet');
    expect(prompt).toContain('泛黄的旧彩票');
    expect(prompt).toContain('no people');
  });
});
