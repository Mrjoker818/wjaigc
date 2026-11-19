import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildEpisodePackage } from '@/lib/drama/export-client';
import { importDramaPackage } from '@/lib/drama/import-client';
import { packageDoc, readPackageManifest, replaceUrls } from '@/lib/drama/package';
import { parseDramaProject } from '@/lib/drama/schema';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';

function shot(patch: Partial<DramaShot>): DramaShot {
  return {
    id: 's', index: 0, title: '', purpose: '', actionBeat: '', prompt: '', duration: 5, durationSec: 5,
    aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [], ...patch,
  };
}

function doc(): DramaProjectV1 {
  return {
    ...createEmptyDramaProject({ title: '招财猫' }),
    cast: [{ id: 'lin', name: '林辰', appearance: '', imageUrlFront: '/img/lin.png', imageHistory: { front: ['/img/old.png'] } }],
    timeline: {
      transition: 'cut', transitionSec: 0.5, subtitles: true,
      music: { url: '/api/serve-upload/generated-audio/bgm.mp3', name: '雨夜', volume: 0.3, ducking: true },
      lastRender: { taskId: 'r', episodeId: 'e2', status: 'completed', videoUrl: '/v/film.mp4', createdAt: 1 },
    },
    episodes: [
      { id: 'e1', index: 0, title: '一', logline: '', script: '', scenes: [] },
      { id: 'e2', index: 1, title: '二', logline: '', script: '第二集', scenes: [{ id: 'sc', heading: '', summary: '', shots: [
        shot({ id: 'a', firstFrameUrl: '/img/a.png', selectedTakeId: 't2', takes: [
          { id: 't1', status: 'completed', videoUrl: '/v/a.mp4', createdAt: 1 },
          { id: 't2', taskId: 'gone', status: 'generating', createdAt: 2 },
        ] }),
      ] }] },
    ],
  };
}

describe('drama production package', () => {
  it('keeps only the exported episode and drops work that cannot be resumed elsewhere', () => {
    const out = packageDoc(doc(), 'e2');
    expect(out.episodes.map(episode => [episode.id, episode.index])).toEqual([['e2', 0]]);
    const a = out.episodes[0].scenes[0].shots[0];
    expect(a.takes.map(take => take.id)).toEqual(['t1']);
    expect(a.selectedTakeId).toBeUndefined();
    expect(out.timeline.lastRender?.videoUrl).toBe('/v/film.mp4');
    expect(packageDoc(doc(), 'e1').timeline.lastRender).toBeUndefined();
  });

  it('replaces every copy of an old address, including history and music', () => {
    const next = replaceUrls(doc(), new Map([['/img/old.png', '/u/1.png'], ['/api/serve-upload/generated-audio/bgm.mp3', '/a/2.mp3']]));
    expect(next.cast[0].imageHistory?.front).toEqual(['/u/1.png']);
    expect(next.timeline.music?.url).toBe('/a/2.mp3');
    expect(next.cast[0].imageUrlFront).toBe('/img/lin.png');
  });

  it('rejects files that are not a workbench package with a message saying what to do', () => {
    expect(() => readPackageManifest('{')).toThrow('已损坏');
    expect(() => readPackageManifest('{"format":"other"}')).toThrow('不是工作台导出的短剧');
  });

  it('imports an exported package as a new drama with every file uploaded again', async () => {
    const exported = await buildEpisodePackage(doc(), 'e2', {
      fetch: async url => (url === '/img/lin.png' ? new Response('', { status: 404 }) : new Response(`bytes:${url}`)),
    });
    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    expect(zip.file('短剧.json')).toBeTruthy();
    expect(zip.file('音乐/背景音乐.mp3')).toBeTruthy();

    const calls: Array<{ url: string; name?: string; type?: string }> = [];
    let created: DramaProjectV1 | null = null;
    const progress: number[] = [];
    const result = await importDramaPackage(exported.blob, {
      projectId: 'p1',
      onProgress: done => progress.push(done),
      fetch: async (url, init) => {
        const file = init?.body instanceof FormData ? init.body.get('file') as File : undefined;
        calls.push({ url, name: file?.name, type: file?.type });
        const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
        if (url === '/api/upload') return json({ url: `/u/${file!.name}` });
        if (url === '/api/drama/clip') return json({ videoUrl: `/c/${file!.name}` });
        if (url === '/api/drama/music') return json({ audioUrl: `/api/serve-upload/generated-audio/new.mp3`, name: file!.name });
        if (url === '/api/drama/projects') {
          const body = JSON.parse(String(init!.body));
          expect(body.projectId).toBe('p1');
          created = parseDramaProject(body.doc);
          return json({ project: { id: 'drama_new', projectId: 'p1', title: body.doc.title, doc: body.doc, version: 1, createdAt: 1, updatedAt: 1 } }, 201);
        }
        return json({ error: 'unexpected' }, 500);
      },
    });

    expect(result.record.id).toBe('drama_new');
    expect(result.failed).toEqual([]);
    expect(calls.filter(call => call.url === '/api/drama/clip').map(call => call.type)).toEqual(['video/mp4', 'video/mp4']);
    expect(progress.at(-1)).toBe(4);
    const imported = created as unknown as DramaProjectV1;
    const a = imported.episodes[0].scenes[0].shots[0];
    expect(a.takes[0].videoUrl).toBe('/c/01_视频.mp4');
    expect(a.firstFrameUrl).toBe('/u/01_首帧.png');
    expect(imported.timeline.lastRender?.videoUrl).toBe('/c/成片.mp4');
    expect(imported.timeline.music?.url).toBe('/api/serve-upload/generated-audio/new.mp3');
    // The front view failed to download at export, so it was never in the ZIP and keeps its old address.
    expect(imported.cast[0].imageUrlFront).toBe('/img/lin.png');
  });

  it('lists files whose upload failed and still creates the drama', async () => {
    const exported = await buildEpisodePackage(doc(), 'e2', { fetch: async url => new Response(`bytes:${url}`) });
    const result = await importDramaPackage(exported.blob, {
      fetch: async (url, init) => {
        if (url === '/api/drama/clip') return new Response(JSON.stringify({ error: '视频超过 48MB' }), { status: 400 });
        if (url === '/api/drama/projects') {
          const body = JSON.parse(String(init!.body));
          return new Response(JSON.stringify({ project: { id: 'd', projectId: null, title: '', doc: body.doc, version: 1, createdAt: 1, updatedAt: 1 } }), { status: 201 });
        }
        return new Response(JSON.stringify({ url: '/u/x.png', audioUrl: '/api/serve-upload/generated-audio/x.mp3' }));
      },
    });
    expect(result.failed).toEqual(['成片.mp4', '镜头/01_视频.mp4']);
    expect(result.record.doc.episodes[0].scenes[0].shots[0].takes[0].videoUrl).toBe('/v/a.mp4');
  });

  it('shrinks an image that is over the upload edge limit and uploads it again', async () => {
    const exported = await buildEpisodePackage(doc(), 'e2', { fetch: async url => new Response(`bytes:${url}`) });
    const uploads: string[] = [];
    const shrunk: Array<[string, number]> = [];
    const result = await importDramaPackage(exported.blob, {
      shrink: async (file, maxEdge) => { shrunk.push([file.name, maxEdge]); return new File(['small'], 'small.png', { type: 'image/png' }); },
      fetch: async (url, init) => {
        const file = init?.body instanceof FormData ? init.body.get('file') as File : undefined;
        if (url === '/api/upload') {
          uploads.push(file!.name);
          if (file!.name === '01_首帧.png') return new Response(JSON.stringify({ error: 'Image dimensions exceed the 2048px maximum edge' }), { status: 400 });
          return new Response(JSON.stringify({ url: `/u/${file!.name}` }));
        }
        if (url === '/api/drama/projects') {
          const body = JSON.parse(String(init!.body));
          return new Response(JSON.stringify({ project: { id: 'd', projectId: null, title: '', doc: body.doc, version: 1, createdAt: 1, updatedAt: 1 } }), { status: 201 });
        }
        return new Response(JSON.stringify({ videoUrl: '/c/x.mp4', audioUrl: '/api/serve-upload/generated-audio/x.mp3' }));
      },
    });
    expect(shrunk).toEqual([['01_首帧.png', 2048]]);
    expect(uploads.filter(name => name === 'small.png')).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(result.record.doc.episodes[0].scenes[0].shots[0].firstFrameUrl).toBe('/u/small.png');
  });

  it('says which file to choose when the ZIP is not a package', async () => {
    const zip = new JSZip();
    zip.file('剧本.txt', 'x');
    await expect(importDramaPackage(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow('只能导入工作台导出的制作包');
    await expect(importDramaPackage(new Blob(['not a zip']))).rejects.toThrow('不是 ZIP 压缩包');
  });
});
