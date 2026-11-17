import { describe, expect, it, vi } from 'vitest';
import { asDramaShot, buildDramaDraftFromCanvas } from '@/lib/drama/canvas-bridge';
import { renderShotVideos } from '@/lib/drama/render-client';
import { parseDramaProject } from '@/lib/drama/schema';
import { chooseFirstFrame } from '@/lib/drama/shot-runner';
import type { VideoShotPlan } from '@/lib/video-director/continuity';

function plan(partial: Partial<VideoShotPlan> & { id: string }): VideoShotPlan {
  return {
    index: 0, title: '', purpose: '', actionBeat: '', prompt: 'p', duration: 5, aspectRatio: '16:9',
    references: [], continuityNotes: [], status: 'planned', ...partial,
  };
}

describe('canvas bridge', () => {
  it('turns panel shots into a valid one-episode draft grouped by location', () => {
    const doc = buildDramaDraftFromCanvas({
      idea: '海边骑行的少年在日落时分追上了远去的列车',
      style: 'music-video', aspectRatio: '16:9',
      shots: [
        plan({ id: 'a', prompt: '起步', sceneId: 'beach', characterIds: ['boy', 'ghost'], status: 'completed', videoUrl: '/v/a.mp4', thumbnailUrl: 'data:image/png;base64,xx' }),
        plan({ id: 'b', prompt: '加速', sceneId: 'beach', firstFrameUrl: 'blob:local' }),
        plan({ id: 'c', prompt: '列车', sceneId: 'nowhere' }),
      ],
      characters: [{ id: 'boy', name: '少年', appearance: '白衬衫', imageUrlFront: '/i/boy.png' }, { id: 'bad id!', name: '', appearance: '' }],
      scenes: [{ id: 'beach', name: '海边公路', imageUrl: 'data:image/png;base64,yy' }],
      props: [],
    });
    expect(() => parseDramaProject(doc)).not.toThrow();
    expect(doc.style).toBe('music-video');
    expect(doc.cast.map(member => member.id)).toEqual(['boy', 'char_2']);
    expect(doc.locations[0].imageUrl).toBeUndefined();
    const [first, second] = doc.episodes[0].scenes;
    expect(first).toMatchObject({ heading: '海边公路', locationId: 'beach', characterIds: ['boy'] });
    expect(first.shots.map(shot => shot.id)).toEqual(['a', 'b']);
    expect(first.shots[0]).toMatchObject({ characterIds: ['boy'], selectedTakeId: 'take_a' });
    expect(first.shots[0].takes).toEqual([{ id: 'take_a', status: 'completed', videoUrl: '/v/a.mp4', createdAt: 0 }]);
    expect(first.shots[1].firstFrameUrl).toBeUndefined();
    expect(second.locationId).toBeUndefined();
    expect(second.shots[0].sceneId).toBeUndefined();
  });

  it('lets the panel use the engine first-frame order on live shots', () => {
    const capability = { imageToVideo: true, maxReferenceImages: 2 };
    const prev = asDramaShot(plan({ id: 'a', status: 'completed', videoUrl: '/v/a.mp4' }));
    expect(chooseFirstFrame(asDramaShot(plan({ id: 'b' })), prev, undefined, capability))
      .toEqual({ source: 'previous-shot', previousVideoUrl: '/v/a.mp4' });
    expect(chooseFirstFrame({ ...asDramaShot(plan({ id: 'b' })), firstFrameFromPrev: false }, prev, undefined, capability))
      .toEqual({ source: 'none' });
  });
});

describe('render client', () => {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  it('starts a background render and returns its result', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const responses = [
      json({ success: true, taskId: 'drama_render_1' }, 202),
      json({ status: 'processing', progress: 40 }),
      json({ status: 'completed', result: { videoUrl: '/v/story.mp4', videoThumbnailUrl: '/v/story.jpg', durationSec: 9.5 } }),
    ];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, body: JSON.parse(String(init?.body)) }); return responses.shift()!; });
    const progress: number[] = [];
    const result = await renderShotVideos(['/v/a.mp4', '/v/b.mp4'], 'fade', { fetch: fetcher, sleep: async () => undefined, onProgress: p => progress.push(p) });
    expect(calls[0]).toEqual({ url: '/api/drama/render', body: { videoUrls: ['/v/a.mp4', '/v/b.mp4'], transition: 'fade' } });
    expect(calls[1]).toEqual({ url: '/api/poll-task', body: { taskId: 'drama_render_1' } });
    expect(progress).toEqual([40]);
    expect(result).toEqual({ videoUrl: '/v/story.mp4', thumbnailUrl: '/v/story.jpg', durationSec: 9.5 });
  });

  it('surfaces the server error for a rejected or failed render', async () => {
    await expect(renderShotVideos(['/a', '/b'], 'cut', { fetch: async () => json({ error: '已有一个成片在渲染' }, 409) }))
      .rejects.toThrow('已有一个成片在渲染');
    const responses = [json({ taskId: 't' }, 202), json({ status: 'failed', error: '镜头视频无法读取' })];
    await expect(renderShotVideos(['/a', '/b'], 'cut', { fetch: async () => responses.shift()!, sleep: async () => undefined }))
      .rejects.toThrow('镜头视频无法读取');
  });
});
