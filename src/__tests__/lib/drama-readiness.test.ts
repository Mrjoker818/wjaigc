import { describe, expect, it } from 'vitest';
import { shotLabel, shotReadiness, summarizeReadiness, type ReadinessModel } from '@/lib/drama/readiness';
import { workbenchTasks } from '@/lib/drama/task-list';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';

function shot(patch: Partial<DramaShot>): DramaShot {
  return {
    id: 's', index: 0, title: '', purpose: '', actionBeat: '', prompt: '', duration: 5, durationSec: 5,
    aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [], ...patch,
  };
}

const i2v: ReadinessModel = { name: 'Seedance', capability: { imageToVideo: true, maxReferenceImages: 4 }, durations: [5, 10], ratios: ['9:16', '16:9'] };

function doc(shots: DramaShot[], episodes = 1): DramaProjectV1 {
  return {
    ...createEmptyDramaProject({ title: '招财猫' }),
    cast: [{ id: 'lin', name: '林辰', appearance: '', lockedImageUrl: '/img/lin.png' }, { id: 'cat', name: '大橘', appearance: '' }],
    props: [{ id: 'ticket', name: '彩票' }],
    episodes: Array.from({ length: episodes }, (_, i) => ({
      id: `e${i}`, index: i, title: '', logline: '', script: '',
      scenes: [{ id: `sc${i}`, heading: '', summary: '', shots: i === episodes - 1 ? shots : [shot({ id: `pad${i}` })] }],
    })),
  };
}

const keys = (checks: ReturnType<typeof shotReadiness>) => checks.filter(check => !check.ok).map(check => check.key);

describe('drama readiness', () => {
  it('blocks a shot without prompt, model or video and only warns about the rest', () => {
    const empty = shot({ id: 'a', characterIds: ['lin', 'cat'], propIds: ['ticket'], dialogue: '慢点吃' });
    const checks = shotReadiness(doc([empty]), 'e0', empty, undefined);
    expect(keys(checks)).toEqual(['prompt', 'model', 'cast', 'props', 'video', 'voiceover']);
    expect(checks.find(check => check.key === 'cast')?.detail).toContain('大橘');
    expect(checks.find(check => check.key === 'cast')?.detail).not.toContain('林辰');
    expect(summarizeReadiness(checks)).toEqual({ ready: false, open: 6, blocking: 3 });
  });

  it('flags a length or ratio the model would change and a missing first frame', () => {
    const odd = shot({ id: 'a', prompt: '蹲下', durationSec: 7, aspectRatio: '1:1' });
    const checks = shotReadiness(doc([odd]), 'e0', odd, i2v);
    expect(keys(checks)).toEqual(['duration', 'ratio', 'firstFrame', 'video']);
    expect(checks.find(check => check.key === 'duration')?.detail).toBe('Seedance 不支持 7 秒，会按 5 秒生成');
    // A text-only model has no first frame to miss.
    expect(keys(shotReadiness(doc([odd]), 'e0', odd, { ...i2v, capability: { imageToVideo: false, maxReferenceImages: 0 } }))).not.toContain('firstFrame');
  });

  it('counts a shot with its video and a current voiceover as ready, and a changed line as stale', () => {
    const done = shot({
      id: 'b', prompt: '蹲下', firstFrameUrl: '/img/b.png', dialogue: '慢点吃', voiceoverUrl: '/a.mp3', voiceoverText: '慢点吃',
      takes: [{ id: 't', status: 'completed', videoUrl: '/v.mp4', createdAt: 1 }],
    });
    expect(summarizeReadiness(shotReadiness(doc([done]), 'e0', done, i2v))).toEqual({ ready: true, open: 0, blocking: 0 });
    const edited = { ...done, dialogue: '慢点' };
    const stale = shotReadiness(doc([edited]), 'e0', edited, i2v);
    expect(stale.find(check => check.key === 'voiceover')?.detail).toBe('台词改过，配音需要重录');
    expect(summarizeReadiness(stale).ready).toBe(true);
  });

  it('lists running work by the shot numbers the grid shows', () => {
    const d = doc([shot({ id: 'a' }), shot({ id: 'b' })], 2);
    expect(shotLabel(d, 'b')).toBe('第 2 集 镜头 2');
    expect(shotLabel(doc([shot({ id: 'b' })]), 'b')).toBe('镜头 1');
    const tasks = workbenchTasks(d, {
      runningShotIds: new Set(['a']), keyframeShotIds: new Set(['b:last', 'gone']), voiceoverShotIds: new Set(['b']),
      render: { status: 'rendering', progress: 40 }, busyLabel: '生成定妆图',
    });
    expect(tasks.map(task => task.label)).toEqual([
      '第 2 集 镜头 1 · 生成视频', '第 2 集 镜头 2 · 画尾帧', '已删除的镜头 · 画关键帧', '第 2 集 镜头 2 · 录配音', '渲染成片', '生成定妆图',
    ]);
    expect(tasks[1].shotId).toBe('b');
    expect(tasks[4].progress).toBe(40);
    expect(workbenchTasks(d, { runningShotIds: new Set(), keyframeShotIds: new Set(), voiceoverShotIds: new Set(), render: { status: 'idle', progress: 0 }, busyLabel: null })).toEqual([]);
  });
});
