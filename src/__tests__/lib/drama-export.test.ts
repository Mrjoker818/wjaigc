import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { episodePackageMedia, episodeSrt, safeFileName, shotListCsv } from '@/lib/drama/export';
import { buildEpisodePackage } from '@/lib/drama/export-client';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';

function shot(patch: Partial<DramaShot>): DramaShot {
  return {
    id: 's', index: 0, title: '', purpose: '', actionBeat: '', prompt: '', duration: 5, durationSec: 5,
    aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [], ...patch,
  };
}

function doc(): DramaProjectV1 {
  return {
    ...createEmptyDramaProject({ title: '招财/猫' }),
    cast: [{ id: 'lin', name: '林辰', appearance: '', lockedImageUrl: '/img/lin.png' }],
    props: [{ id: 'ticket', name: '彩票', imageUrl: '/img/ticket.webp' }],
    timeline: { transition: 'fade', transitionSec: 0.5, subtitles: false },
    episodes: [{ id: 'e', index: 0, title: '', logline: '', script: '第一场', scenes: [{ id: 'sc', heading: '便利店·夜', summary: '', shots: [
      shot({ id: 'a', index: 0, prompt: '@林辰 蹲下', dialogue: '慢点吃', characterIds: ['lin'], propIds: ['ticket'], modelId: 'p::seedance',
        firstFrameUrl: '/img/a.png', voiceoverUrl: '/api/serve-upload/generated-audio/a.mp3', voiceoverText: '慢点吃',
        takes: [{ id: 't', status: 'completed', videoUrl: '/v/a.mp4', createdAt: 1 }] }),
      shot({ id: 'b', index: 1, prompt: '=HYPERLINK("x")', dialogue: '他说："走"', durationSec: 4 }),
    ] }] }],
  };
}

describe('drama export', () => {
  it('writes subtitles on the planned timeline even when they are not burned in', () => {
    expect(episodeSrt(doc(), 'e')).toBe('1\n00:00:00,000 --> 00:00:04,500\n慢点吃\n\n2\n00:00:05,000 --> 00:00:08,500\n他说："走"\n');
    expect(episodeSrt(doc(), 'missing')).toBe('');
  });

  it('writes a shot list Excel can open, with formulas neutralised and quotes escaped', () => {
    const csv = shotListCsv(doc(), 'e');
    expect(csv.startsWith('\uFEFF镜号,场次,场景')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[1]).toBe('01,1,便利店·夜,0.0,5,林辰 蹲下,慢点吃,林辰,彩票,seedance,/v/a.mp4,/api/serve-upload/generated-audio/a.mp3');
    expect(lines[2]).toBe(`02,1,便利店·夜,4.5,4,"'=HYPERLINK(""x"")","他说：""走""",,,,,`);
  });

  it('lists media once each, named by shot, and makes names safe for every file system', () => {
    expect(episodePackageMedia(doc(), 'e').map(item => item.name)).toEqual([
      '镜头/01_视频.mp4', '镜头/01_首帧.png', '配音/01.mp3', '设定/角色_林辰.png', '设定/道具_彩票.webp',
    ]);
    expect(safeFileName('a/b:c*?.txt')).toBe('a_b_c_.txt');
    expect(safeFileName('...')).toBe('短剧');
  });

  it('packs script, tables and media, and lists files that failed to download', async () => {
    const result = await buildEpisodePackage(doc(), 'e', {
      fetch: async url => (url.endsWith('.mp3') ? new Response('', { status: 404 }) : new Response(`bytes:${url}`)),
    });
    expect(result.fileName).toBe('招财_猫_第1集_制作包.zip');
    expect(result.missing).toEqual(['配音/01.mp3']);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).filter(name => !zip.files[name].dir).sort()).toEqual([
      '剧本.txt', '字幕.srt', '短剧.json', '缺失文件.txt', '设定/角色_林辰.png', '设定/道具_彩票.webp', '镜头/01_视频.mp4', '镜头/01_首帧.png', '镜头表.csv',
    ].sort());
    expect(await zip.file('镜头/01_视频.mp4')!.async('string')).toBe('bytes:/v/a.mp4');
  });
});
