import { describe, expect, it } from 'vitest';
import { parseSourceScript, reparseEpisode, sceneSourceText, isEpisodeStructureCurrent } from '@/lib/drama/source-script';
import { parseDramaProject } from '@/lib/drama/schema';
import { createEmptyDramaProject, type DramaShot } from '@/lib/drama/types';

const shot = (id: string): DramaShot => ({
  id, index: 0, title: '', purpose: '', actionBeat: '', prompt: '', duration: 5, durationSec: 5,
  aspectRatio: '9:16', references: [], continuityNotes: [], status: 'completed', selectedTakeId: 'take',
  takes: [{ id: 'take', status: 'completed', videoUrl: '/stored.mp4', createdAt: 1, inputSnapshot: 'old' }],
});

describe('source script parsing', () => {
  it('preserves CRLF, emoji and original snapshots, reuses exact names across episodes without invented content', () => {
    const text = '第一集 雨夜\r\n第一场 内景 咖啡馆 夜\r\n林夏（低声）：等我😀。\r\n第二集 清晨\r\nScene 1: Park\r\n林夏：我来了。\r\nALICE: Hello.\r\n';
    const { doc, stats } = parseSourceScript(text, { title: '来信', fileName: '原稿.txt', format: 'txt', now: 123 });
    expect(doc.sourceScript).toEqual({ originalText: text, fileName: '原稿.txt', format: 'txt', importedAt: 123 });
    expect(stats).toEqual({ episodes: 2, scenes: 2, characters: 2, dialogues: 3 });
    expect(doc.episodes.map(e => e.script).join('')).toBe(text);
    expect(doc.episodes.every(e => e.script === e.structuredScript)).toBe(true);
    expect(doc.cast.map(c => [c.name, c.appearance])).toEqual([['林夏', ''], ['ALICE', '']]);
    expect(doc.locations).toEqual([]); expect(doc.props).toEqual([]);
    expect(doc.episodes[0].scenes[0].characterIds).toEqual([doc.cast[0].id]);
    expect(doc.episodes[1].scenes[0].characterIds).toEqual(doc.cast.map(c => c.id));
    expect(doc.episodes[0].scenes[0].dialogues?.[0].text).toBe('等我😀。');
    expect(sceneSourceText(doc.episodes[0], doc.episodes[0].scenes[0])).toBe('第一场 内景 咖啡馆 夜\r\n林夏（低声）：等我😀。\r\n');
    expect(parseDramaProject(doc).sourceScript).toEqual(doc.sourceScript);
  });

  it('recognizes English sluglines and uppercase speaker blocks without merging different names', () => {
    const { doc, stats } = parseSourceScript('EPISODE 1 - Home\nINT. ROOM - DAY\nALICE\nHello there.\n\nEXT. PARK - NIGHT\nAlice: Goodbye.');
    expect(stats).toEqual({ episodes: 1, scenes: 2, characters: 2, dialogues: 2 });
    expect(doc.cast.map(c => c.name)).toEqual(['ALICE', 'Alice']);
    expect(doc.episodes[0].scenes[0].dialogues?.[0].text).toBe('Hello there.');
  });

  it('recognizes Chinese sluglines and preserves text outside named scenes with a review warning', () => {
    const { doc, warnings } = parseSourceScript('第一集\n原稿说明，不能丢弃。\n内景 咖啡馆 夜\n甲：好\n外景 公园 日\n乙：走');
    expect(doc.episodes[0].scenes.map(s => s.heading)).toEqual(['内景 咖啡馆 夜', '外景 公园 日']);
    expect(warnings.some(w => w.includes('PREAMBLE'))).toBe(true);
    expect(doc.episodes[0].script).toContain('原稿说明，不能丢弃。');
  });

  it('warns for unformatted or ambiguous text and keeps it intact without creating shots', () => {
    const text = '\uFEFF  一场雨落了下来。\r\n时间：晚上八点\r\nhttps://example.com\r\n';
    const { doc, warnings, stats } = parseSourceScript(text);
    expect(warnings.length).toBeGreaterThan(0);
    expect(stats).toEqual({ episodes: 1, scenes: 1, characters: 0, dialogues: 0 });
    expect(sceneSourceText(doc.episodes[0], doc.episodes[0].scenes[0])).toBe(text);
    expect(doc.episodes[0].scenes[0].shots).toEqual([]);
    expect(() => parseSourceScript(' \r\n')).toThrow();
  });

  it('uses half-open UTF16 offsets and reads the structured snapshot after edits', () => {
    const { doc } = parseSourceScript('第一场 门口\n甲：😀\n第二场 屋内\n甲：好');
    const episode = doc.episodes[0];
    expect(episode.scenes[1].sourceRange).toEqual({ start: 12, end: 22 });
    episode.script = '新正文';
    expect(isEpisodeStructureCurrent(episode)).toBe(false);
    expect(sceneSourceText(episode, episode.scenes[1])).toBe('第二场 屋内\n甲：好');
    expect(() => parseDramaProject(doc)).not.toThrow();
    expect(isEpisodeStructureCurrent({ ...episode, structuredScript: undefined })).toBe(true);
  });
});

describe('episode reparse', () => {
  it('matches duplicate headings one-to-one, preserves takes, archives removed scenes and marks changed outputs', () => {
    const { doc } = parseSourceScript('第一场 门口\n甲：一\n第一场 门口\n甲：二\n第二场 屋内\n甲：三');
    const episode = doc.episodes[0];
    episode.scenes.forEach((scene, i) => { scene.shots = [shot(`shot-${i}`)]; });
    doc.timeline.lastRender = { taskId: 'r', status: 'completed', videoUrl: '/film.mp4', createdAt: 1 };
    episode.script = '第一场 门口\n甲：一\n第一场 门口\n甲：修改\n第三场 路上\n乙：四';
    const original = structuredClone(doc);
    const result = reparseEpisode(doc, episode.id);
    const next = result.doc.episodes[0];
    expect(doc).toEqual(original);
    expect(next.scenes.slice(0, 2).map(s => s.id)).toEqual(episode.scenes.slice(0, 2).map(s => s.id));
    expect(next.scenes[0].shots).toEqual([shot('shot-0')]);
    expect(next.scenes[1].shots).toEqual([shot('shot-1')]);
    expect(next.scenes[0].sourceChanged).toBeFalsy();
    expect(next.scenes[1].sourceChanged).toBe(true);
    expect(next.scenes[2].shots).toEqual([]);
    expect(next.archivedScenes?.[0]).toMatchObject({ id: episode.scenes[2].id, shots: [shot('shot-2')], sourceChanged: true });
    expect(sceneSourceText(next, next.archivedScenes![0])).toBe('第二场 屋内\n甲：三');
    expect(next.archivedScenes![0].sourceRange).toBeUndefined();
    expect(next.scenes.map(s => s.id)).not.toContain(episode.scenes[2].id);
    expect(result.changedSceneIds).toEqual(expect.arrayContaining([next.scenes[1].id, next.scenes[2].id, episode.scenes[2].id]));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.doc.timeline.lastRender).toMatchObject({ videoUrl: '/film.mp4', sourceChanged: true });
    expect(isEpisodeStructureCurrent(next)).toBe(true);
    expect(parseDramaProject(result.doc).episodes[0].archivedScenes).toHaveLength(1);
    expect(reparseEpisode(result.doc, next.id).changedSceneIds).toEqual([]);
  });

  it('archives every prior scene when the episode text is cleared, preserving media and source', () => {
    const { doc } = parseSourceScript('第一场 门口\n甲：旧台词');
    const episode = doc.episodes[0]; episode.scenes[0].shots = [shot('s')]; episode.script = '';
    const result = reparseEpisode(doc, episode.id); const next = result.doc.episodes[0];
    expect(next.scenes).toEqual([]); expect(next.structuredScript).toBe('');
    expect(sceneSourceText(next, next.archivedScenes![0])).toBe('第一场 门口\n甲：旧台词');
    expect(next.archivedScenes![0].shots[0].takes[0].videoUrl).toBe('/stored.mp4');
    expect(result.changedSceneIds).toEqual([episode.scenes[0].id]);
    expect(() => parseDramaProject(result.doc)).not.toThrow();
  });
});

describe('source metadata validation', () => {
  it('keeps legacy documents and validates provenance, references, ranges and input snapshots', () => {
    expect(parseDramaProject(createEmptyDramaProject()).sourceScript).toBeUndefined();
    const { doc } = parseSourceScript('Scene 1\nALICE: Hi');
    const invalid = (mutate: (d: typeof doc) => void) => { const d = structuredClone(doc); mutate(d); expect(() => parseDramaProject(d)).toThrow(); };
    invalid(d => { d.sourceScript!.format = 'pdf' as never; });
    invalid(d => { d.sourceScript!.importedAt = NaN; });
    invalid(d => { d.episodes[0].scenes[0].sourceRange = { start: -1, end: 10 }; });
    invalid(d => { d.episodes[0].scenes[0].sourceRange = { start: 10, end: 2 }; });
    invalid(d => { d.episodes[0].scenes[0].sourceRange = { start: 0, end: 999 }; });
    invalid(d => { d.episodes[0].scenes[0].characterIds = ['missing']; });
    invalid(d => { d.episodes[0].scenes[0].dialogues![0].characterId = 'missing'; });
    const scene = doc.episodes[0].scenes[0]; scene.shots = [shot('s')];
    scene.shots[0].voiceoverSnapshot = 'voice';
    doc.timeline.lastRender = { taskId: 'r', status: 'completed', createdAt: 0, inputSnapshot: 'render' };
    expect(parseDramaProject(doc).episodes[0].scenes[0].shots[0].takes[0].inputSnapshot).toBe('old');
    invalid(d => { d.episodes[0].scenes[0].shots[0].takes[0].inputSnapshot = 1 as never; });
    invalid(d => { d.episodes[0].scenes[0].shots[0].voiceoverSnapshot = {} as never; });
    invalid(d => { d.timeline.lastRender!.inputSnapshot = false as never; });
  });
});
