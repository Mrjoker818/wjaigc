import { describe, expect, it, vi } from 'vitest';
import { parseDramaScriptResponse } from '@/lib/drama/planner';
import { castImagePrompt, locationImageSize } from '@/lib/drama/reference-prompts';
import { parseDramaProject } from '@/lib/drama/schema';
import { buildTimeline } from '@/lib/drama/timeline';
import { activeTake, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';
import {
  applyRetakeSuggestion, DramaSaveConflictError, estimateShots, generateReferenceImage, pollShotTake, saveDramaProject,
} from '@/lib/drama/workbench-client';
import {
  addShot, blankEpisodeDoc, findShot, fitDuration, formatTimecode, moveShot, orderedPrevious, pendingShots,
  removeCastMember, removeShot, selectTake, setSceneShots, updateShot, upsertTake,
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
  });

  it('removes a cast member from scenes and shots', () => {
    const doc = removeCastMember(docWithShots(), 'lin');
    expect(doc.cast).toEqual([]);
    expect(doc.episodes[0].scenes[0].characterIds).toEqual([]);
    expect(findShot(doc, 's1')?.shot.characterIds).toEqual([]);
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
    const url = await generateReferenceImage('p', '1024x1536', {
      fetch: async input => { calls.push(input); return responses.shift()!; }, sleep: async () => undefined,
    });
    expect(url).toBe('/i/a.png');
    expect(calls).toEqual(['/api/generate', '/api/poll-task', '/api/poll-task']);
    await expect(generateReferenceImage('p', 's', { fetch: async () => json({ success: false, error: '积分不足' }, 402) })).rejects.toThrow('积分不足');
  });

  it('resumes a take by task id and refuses to guess when the id is missing', async () => {
    const take = { id: 't', status: 'generating' as const, taskId: 'task-1', createdAt: 1 };
    const fetcher = vi.fn(async () => json({ status: 'completed', videoUrl: '/v/a.mp4' }));
    expect(await pollShotTake(take, 'p::m', 'p', { fetch: fetcher, sleep: async () => undefined }))
      .toMatchObject({ status: 'completed', videoUrl: '/v/a.mp4' });
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
    expect(locationImageSize('9:16')).toBe('1024x1536');
    expect(locationImageSize('16:9')).toBe('1536x1024');
  });
});
