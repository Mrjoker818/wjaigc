import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { buildEpisodePackage, buildProjectPackage } from '@/lib/drama/export-client';
import { importDramaPackage } from '@/lib/drama/import-client';
import { PACKAGE_MANIFEST, projectPackageDoc, readPackageManifest, remapPackageDocument } from '@/lib/drama/package';
import { isTakeCurrent, shotInputSnapshot } from '@/lib/drama/production-version';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';

function fixture(): DramaProjectV1 {
  const shot: DramaShot = {
    id: 'shot', index: 0, title: '', purpose: '', actionBeat: '', prompt: '原文', duration: 5, durationSec: 5,
    aspectRatio: '9:16', references: [{ id: 'ref', role: 'style', url: '/ref.png' }], continuityNotes: [], status: 'generating', taskId: 'live-shot',
    firstFrameUrl: '/first.png', lastFrameUrl: '/last.png', voiceoverUrl: '/voice.mp3', voiceoverText: '原台词', dialogue: '原台词',
    selectedTakeId: 'chosen', takes: [
      { id: 'old', status: 'completed', videoUrl: '/old.mp4', thumbnailUrl: '/old-thumb.png', createdAt: 1, taskId: 'past-task' },
      { id: 'chosen', status: 'completed', videoUrl: '/chosen.mp4', thumbnailUrl: '/chosen-thumb.png', createdAt: 2, taskId: 'paid-task' },
      { id: 'running', status: 'generating', taskId: 'live-task', createdAt: 3 },
    ],
  };
  return Object.assign(createEmptyDramaProject({ title: '原稿' }), {
    sourceScript: { originalText: '第一集\r\n原台词\n第二集', format: 'txt', fileName: '原稿.txt', importedAt: 123 },
    productionRun: { id: 'run', checkpoints: [{ operationId: 'paid-op' }] },
    productionImages: [
      { id: 'finished', status: 'completed', url: '/orphan.png', sourceUrl: '/orphan-source.png', taskId: 'old-image-task' },
      { id: 'pending', status: 'generating', taskId: 'live-image-task' },
    ],
    cast: [{ id: 'cast', name: '同名', appearance: '', lockedImageUrl: '/lock.png', imageUrlFront: '/front.png', imageUrlFull: '/full.png',
      imageUrlSide: '/side.png', imageUrlBack: '/back.png', imageUrlFace: '/face.png', voiceSampleUrl: '/sample.wav', imageHistory: { front: ['/old-front.png'] } }],
    locations: [{ id: 'loc', name: '同名', imageUrl: '/location.png', lockedImageUrl: '/location-lock.png', imageHistory: { plate: ['/old-location.png'] } }],
    props: [{ id: 'prop', name: '同名', imageUrl: '/prop.png', lockedImageUrl: '/prop-lock.png', imageHistory: { sheet: ['/old-prop.png'] } }],
    references: [{ url: '/ref.png', source: 'canvas' }],
    episodes: [
      { id: 'e1', index: 3, title: '第一集', logline: '', script: '原台词', structuredScript: '原台词', scenes: [{ id: 'scene', heading: '', summary: '', sourceRange: { start: 0, end: 3 }, shots: [shot] }] },
      { id: 'e2', index: 8, title: '第二集', logline: '', script: '后续', scenes: [{ id: 'scene2', heading: '', summary: '', shots: [{ ...shot, id: 'shot2', takes: [{ id: 'take2', status: 'completed', videoUrl: '/second.mp4', createdAt: 1 }] }] }] },
    ],
    timeline: { transition: 'fade', transitionSec: 0.5, subtitles: true, music: { url: '/music.mp3', name: '音乐', volume: 0.2, ducking: true },
      lastRender: { status: 'completed', taskId: 'render-task', episodeId: 'e2', videoUrl: '/film.mp4', thumbnailUrl: '/film-thumb.png', createdAt: 3 } },
  }) as DramaProjectV1;
}

async function unpack(mode: 'selected' | 'history', fetcher = async (url: string) => new Response(`bytes:${url}`)) {
  const result = await buildProjectPackage(fixture(), { mediaMode: mode, fetch: fetcher });
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const manifest = readPackageManifest(await zip.file(PACKAGE_MANIFEST)!.async('string'));
  return { result, zip, manifest };
}

describe('whole-project production archive', () => {
  it('retains every episode and exact source metadata without carrying paid operations', () => {
    const source = fixture();
    const out = projectPackageDoc(source, 'history');
    expect(out.episodes.map(e => [e.id, e.index])).toEqual([['e1', 3], ['e2', 8]]);
    expect((out as unknown as Record<string, unknown>).sourceScript).toEqual((source as unknown as Record<string, unknown>).sourceScript);
    expect(out.episodes[0].scenes[0]).toMatchObject({ sourceRange: { start: 0, end: 3 } });
    expect(out).not.toHaveProperty('productionRun');
    expect(out).not.toHaveProperty('productionImages');
    expect(JSON.stringify(out)).not.toMatch(/live-task|paid-task|past-task|render-task|live-shot/);
    expect(out.episodes[0].scenes[0].shots[0].takes.map(t => t.id)).toEqual(['old', 'chosen']);
    expect(out.episodes[0].scenes[0].shots[0].status).toBe('completed');
    expect(source.episodes[0].scenes[0].shots[0].takes).toHaveLength(3);
    expect(out.timeline.lastRender?.videoUrl).toBe('/film.mp4');
  });

  it('keeps author text literal while remapping canonical current and stale dependency snapshots', () => {
    const source = fixture();
    const shot = source.episodes[0].scenes[0].shots[0];
    shot.takes[0].inputSnapshot = shotInputSnapshot(source, 'e1', shot.id);
    shot.prompt = '/front.png';
    source.episodes[0].script = '/front.png';
    source.episodes[0].structuredScript = source.episodes[0].script;
    source.episodes[0].scenes[0].sourceRange = { start: 0, end: source.episodes[0].script.length };
    source.sourceScript!.originalText = '/front.png';
    shot.takes[1].inputSnapshot = shotInputSnapshot(source, 'e1', shot.id);
    const out = remapPackageDocument(source, new Map([['/front.png', '/new/front.png'], ['/lock.png', '/new/lock.png']]));
    const next = out.episodes[0].scenes[0].shots[0];
    expect(out.sourceScript!.originalText).toBe('/front.png');
    expect(out.episodes[0].script).toBe('/front.png');
    expect(next.prompt).toBe('/front.png');
    expect(out.cast[0].lockedImageUrl).toBe('/new/lock.png');
    expect(isTakeCurrent(out, 'e1', next, next.takes[1])).toBe(true);
    expect(isTakeCurrent(out, 'e1', next, next.takes[0])).toBe(false);
  });

  it('keeps opaque snapshot bindings after remapping so they cannot become legacy-current outputs', () => {
    const source = fixture();
    source.episodes[0].scenes[0].shots[0].takes[1].inputSnapshot = 'sha256:old-input-binding';
    const out = remapPackageDocument(source, new Map([['/chosen.mp4', '/new/chosen.mp4']]));
    const shot = out.episodes[0].scenes[0].shots[0];
    expect(shot.takes[1].videoUrl).toBe('/new/chosen.mp4');
    expect(shot.takes[1].inputSnapshot).toBe('sha256:old-input-binding');
    expect(isTakeCurrent(out, 'e1', shot, shot.takes[1])).toBe(false);
    expect(source.episodes[0].scenes[0].shots[0].takes[0].inputSnapshot).toBeUndefined();
  });

  it('archives stored image receipts without resuming them, and covers removed-scene media', async () => {
    const source = fixture();
    Object.assign(source, { productionImages: [{ id: 'stored', state: 'stored', taskId: 'old', url: '/stored.png', sourceUrl: 'https://supplier.test/source.png', target: { kind: 'cast', entityId: 'cast', view: 'front' } }] });
    source.episodes[0].archivedScenes = [{ id: 'removed', heading: '', summary: '', sourceText: '旧稿', shots: [{ ...source.episodes[0].scenes[0].shots[0], id: 'removed-shot', firstFrameUrl: '/removed-frame.png' }] }];
    const result = await buildProjectPackage(source, { mediaMode: 'history', fetch: async url => new Response(url) });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const manifest = readPackageManifest(await zip.file(PACKAGE_MANIFEST)!.async('string'));
    expect(Object.keys(manifest.media)).toEqual(expect.arrayContaining(['/stored.png', 'https://supplier.test/source.png', '/removed-frame.png']));
    expect(manifest.doc.episodes[0].archivedScenes![0].shots[0].takes).toHaveLength(2);
    expect(manifest.doc).not.toHaveProperty('productionImages');
  });

  it('keeps recovered completed image sources and permits literal percent signs in archive paths', async () => {
    const source = fixture();
    source.episodes[0].title = '进度 100%';
    Object.assign(source, { productionImages: [{ id: 'retrieved', state: 'retrieving', sourceUrl: '/recovered.png', taskId: 'private-task' }] });
    const exported = await buildProjectPackage(source, { mediaMode: 'history', fetch: async url => new Response(url) });
    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    const manifest = readPackageManifest(await zip.file(PACKAGE_MANIFEST)!.async('string'));
    expect(manifest.media['/recovered.png']).toBeTruthy();
    expect(zip.file('分集/001_进度 100%/剧本.txt')).toBeTruthy();
    expect(JSON.stringify(manifest)).not.toContain('private-task');
    // The valid exported path must remain importable, not be mistaken for an invalid URI escape.
    expect(() => readPackageManifest(JSON.stringify({ format: 'wujie-drama-package', version: 1, doc: source, media: { '/ref.png': '设定/100%.png' } }))).not.toThrow();
  });

  it('packs all current views, locks, thumbnails, voices, references and all episodes in selected mode', async () => {
    const { manifest, result, zip } = await unpack('selected');
    expect(result.complete).toBe(true);
    expect(manifest.archive).toMatchObject({ scope: 'project', mediaMode: 'selected', complete: true });
    expect(Object.keys(manifest.media).sort()).toEqual([
      '/lock.png', '/front.png', '/full.png', '/side.png', '/back.png', '/face.png', '/sample.wav', '/location.png', '/location-lock.png',
      '/prop.png', '/prop-lock.png', '/ref.png', '/first.png', '/last.png', '/voice.mp3', '/chosen.mp4', '/chosen-thumb.png', '/second.mp4',
      '/music.mp3', '/film.mp4', '/film-thumb.png',
    ].sort());
    expect(manifest.doc.cast[0].imageHistory).toBeUndefined();
    expect(manifest.doc.episodes[0].scenes[0].shots[0].takes.map(t => t.id)).toEqual(['chosen']);
    const ref = manifest.archive!.files.find(f => f.url === '/ref.png')!;
    expect(ref.references).toHaveLength(3);
    for (const file of manifest.archive!.files) {
      expect(file.status).toBe('packed');
      expect(await zip.file(file.name)!.async('string')).toBe(`bytes:${file.url}`);
    }
    expect(zip.file('分集/001_第一集/剧本.txt')).toBeTruthy();
    expect(zip.file('分集/002_第二集/剧本.txt')).toBeTruthy();
    expect(await zip.file('原始剧本.txt')!.async('string')).toBe('第一集\r\n原台词\n第二集');
  });

  it('includes completed histories and detached completed image provenance in history mode', async () => {
    const { manifest } = await unpack('history');
    for (const url of ['/old-front.png', '/old-location.png', '/old-prop.png', '/old.mp4', '/old-thumb.png', '/orphan.png', '/orphan-source.png']) {
      expect(manifest.media[url], url).toBeTruthy();
    }
    expect(manifest.archive!.completedProductionImages).toEqual([{ id: 'finished', status: 'completed', url: '/orphan.png', sourceUrl: '/orphan-source.png' }]);
    expect(JSON.stringify(manifest)).not.toContain('old-image-task');
    expect(new Set(Object.values(manifest.media)).size).toBe(Object.keys(manifest.media).length);
  });

  it('reports every failed or unsupported reference and never claims an incomplete archive is complete', async () => {
    const source = fixture();
    source.references!.push({ url: 'javascript:alert(1)', source: 'canvas' });
    const fetcher = vi.fn(async (url: string) => new Response('bytes', { status: url === '/ref.png' ? 404 : 200 }));
    const result = await buildProjectPackage(source, { mediaMode: 'history', fetch: fetcher });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const manifest = readPackageManifest(await zip.file(PACKAGE_MANIFEST)!.async('string'));
    expect(result.complete).toBe(false);
    expect(result.missing).toHaveLength(2);
    expect(manifest.archive!.complete).toBe(false);
    expect(manifest.archive!.files.filter(f => f.status === 'missing').map(f => f.url).sort()).toEqual(['/ref.png', 'javascript:alert(1)']);
    expect(fetcher.mock.calls.some(([url]) => url.startsWith('javascript:'))).toBe(false);
    expect(zip.file('缺失文件.txt')).toBeTruthy();
  });

  it('bundles inline media, but reports unsupported inline formats without mislabeling their bytes', async () => {
    const source = fixture();
    source.references = [{ url: 'data:image/png;base64,aGk=', source: 'canvas' }, { url: 'data:image/svg+xml,<svg/>', source: 'chat' }];
    const fetcher = vi.fn(async (url: string) => new Response(`bytes:${url}`));
    const result = await buildProjectPackage(source, { mediaMode: 'selected', fetch: fetcher });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const manifest = readPackageManifest(await zip.file(PACKAGE_MANIFEST)!.async('string'));
    expect(manifest.media['data:image/png;base64,aGk=']).toBeTruthy();
    expect(manifest.archive!.files.find(file => file.url.startsWith('data:image/svg'))?.status).toBe('missing');
    expect(fetcher.mock.calls.some(([url]) => url.startsWith('data:image/svg'))).toBe(false);
    expect(result.complete).toBe(false);
  });

  it('bounds streaming downloads even when the response omits its size', async () => {
    const result = await buildProjectPackage(fixture(), { mediaMode: 'selected', limits: { maxFileBytes: 3 }, fetch: async () => new Response('1234') });
    expect(result.complete).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    await expect(buildProjectPackage(fixture(), { mediaMode: 'history', limits: { maxFiles: 1 }, fetch: vi.fn() })).rejects.toThrow(/上限/);
    const controller = new AbortController(); controller.abort();
    await expect(buildProjectPackage(fixture(), { mediaMode: 'selected', signal: controller.signal })).rejects.toThrow();
  });

  it('also bounds legacy episode downloads without changing their format', async () => {
    const result = await buildEpisodePackage(fixture(), 'e1', { fetch: async () => new Response('small', { headers: { 'Content-Length': String(49 * 1024 * 1024) } }) });
    expect(result.missing.length).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(zip.file('镜头/01_视频.mp4')).toBeNull();
    expect(zip.file(PACKAGE_MANIFEST)).toBeTruthy();
  });

  it('round-trips all episodes with local media and rewrites JSON snapshots only on changed URLs', async () => {
    const source = fixture();
    Object.assign(source.episodes[0].scenes[0].shots[0], { inputSnapshot: JSON.stringify({ url: '/chosen.mp4', voice: '原音色' }) });
    const exported = await buildProjectPackage(source, { mediaMode: 'history', fetch: async url => new Response(url) });
    const calls: string[] = [];
    const result = await importDramaPackage(exported.blob, { fetch: async (url, init) => {
      calls.push(url);
      const file = init?.body instanceof FormData ? init.body.get('file') as File : undefined;
      const json = (data: unknown) => new Response(JSON.stringify(data));
      if (url === '/api/drama/projects') {
        const { doc } = JSON.parse(String(init!.body));
        return json({ project: { id: 'new', doc, version: 1, projectId: null, createdAt: 1, updatedAt: 1, title: doc.title } });
      }
      return json({ url: `/new/${file!.name}`, videoUrl: `/new/${file!.name}`, audioUrl: `/new/${file!.name}` });
    } });
    expect(result.failed).toEqual([]);
    expect(result.record.doc.retainedImages?.some(image => image.url.startsWith('/new/'))).toBe(true);
    const reexported = await buildProjectPackage(result.record.doc, { mediaMode: 'history', fetch: async url => new Response(url) });
    const rezipped = await JSZip.loadAsync(await reexported.blob.arrayBuffer());
    const remanifest = readPackageManifest(await rezipped.file(PACKAGE_MANIFEST)!.async('string'));
    expect(Object.keys(remanifest.media)).toEqual(expect.arrayContaining(result.record.doc.retainedImages!.map(image => image.url)));
    expect(result.record.doc.episodes.map(e => [e.id, e.index])).toEqual([['e1', 3], ['e2', 8]]);
    const shot = result.record.doc.episodes[0].scenes[0].shots[0];
    expect(shot.takes[1].videoUrl).toMatch(/^\/new\//);
    expect(JSON.parse((shot as unknown as { inputSnapshot: string }).inputSnapshot)).toEqual({ url: shot.takes[1].videoUrl, voice: '原音色' });
    expect(result.record.doc).not.toHaveProperty('productionRun');
    expect(calls.every(url => url.startsWith('/api/'))).toBe(true);
  });

  it('rejects traversal paths, sanitized ZIP entries and missing claimed files before uploading', async () => {
    const { zip, manifest } = await unpack('history');
    const fetcher = vi.fn();
    const first = Object.keys(manifest.media)[0];
    const original = manifest.media[first];
    manifest.media[first] = '../escape.png';
    expect(() => readPackageManifest(JSON.stringify(manifest))).toThrow(/路径/);
    manifest.media[first] = original;
    zip.remove(original);
    await expect(importDramaPackage(await zip.generateAsync({ type: 'blob' }), { fetch: fetcher })).rejects.toThrow(/缺失|完整/);
    expect(fetcher).not.toHaveBeenCalled();
    zip.file('../evil.png', 'x');
    await expect(importDramaPackage(await zip.generateAsync({ type: 'blob' }), { fetch: fetcher })).rejects.toThrow(/路径/);
  });

  it.each(['C:/escape.png', '/root.png', 'folder\\escape.png', 'folder/%2e%2e/escape.png', '%252e%252e/escape.png'])('rejects the unsafe manifest path %s', name => {
    expect(() => readPackageManifest(JSON.stringify({ format: 'wujie-drama-package', version: 1, doc: fixture(), media: { '/ref.png': name } }))).toThrow(/路径/);
  });

  it('rejects a compressed ZIP with oversized declared expansion before any upload', async () => {
    const zip = new JSZip(); zip.file(PACKAGE_MANIFEST, '{}');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length - 28; i++) if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 49 * 1024 * 1024, true);
    const fetcher = vi.fn();
    await expect(importDramaPackage(new Blob([new Uint8Array(bytes).buffer]), { fetch: fetcher })).rejects.toThrow(/展开大小超过上限/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds actual inflation when a ZIP understates its manifest size', async () => {
    const zip = new JSZip(); zip.file(PACKAGE_MANIFEST, ' '.repeat(9 * 1024 * 1024));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length - 28; i++) if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1024, true);
    const fetcher = vi.fn();
    await expect(importDramaPackage(new Blob([new Uint8Array(bytes).buffer]), { fetch: fetcher })).rejects.toThrow(/上限/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not create an incomplete project when any project media upload fails', async () => {
    const { result } = await unpack('selected');
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify({ error: `upload failed: ${url}` }), { status: 400 }));
    await expect(importDramaPackage(result.blob, { fetch: fetcher })).rejects.toThrow(/未创建不完整/);
    expect(fetcher.mock.calls.some(([url]) => url === '/api/drama/projects')).toBe(false);
  });
});
