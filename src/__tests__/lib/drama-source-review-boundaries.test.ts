import { describe, expect, it } from 'vitest';
import { parseSourceScript, reparseEpisode } from '@/lib/drama/source-script';
import { parseDramaProject } from '@/lib/drama/schema';
import { removeCastMember } from '@/lib/drama/workbench-state';
import { parseDramaShotResponse } from '@/lib/drama/planner';

describe('source preservation review boundaries', () => {
  it('preserves source dialogue identities when removing an active role, including archived scenes', () => {
    const { doc } = parseSourceScript('第一场 客厅\n林夏：你好。');
    doc.episodes[0].archivedScenes = structuredClone(doc.episodes[0].scenes).map(scene => ({ ...scene, id: `${scene.id}_archive` }));
    const next = removeCastMember(doc, doc.cast[0].id);
    expect(() => parseDramaProject(next)).not.toThrow();
    expect(next.cast).toHaveLength(0);
    expect(next.sourceCharacters).toEqual([{ id: doc.cast[0].id, name: '林夏' }]);
    expect(next.episodes[0].archivedScenes![0].dialogues![0].text).toBe('你好。');
  });
  it('preserves manual summary and silent cast choice on an unchanged source scene', () => {
    const { doc } = parseSourceScript('第一场 客厅\n林夏：你好。\n第二场 街道\n阿明：再见。');
    const episode = doc.episodes[0]; episode.scenes[0].summary = '手动复核的摘要';
    episode.scenes[0].characterIds!.push(doc.cast[1].id);
    episode.script += '\n阿明：等等。';
    const next = reparseEpisode(doc, episode.id).doc;
    expect(next.episodes[0].scenes[0].summary).toBe('手动复核的摘要');
    expect(next.episodes[0].scenes[0].characterIds).toEqual(episode.scenes[0].characterIds);
  });
  it('rejects missing dialogue and overlong unsplit dialogue instead of accepting truncation', () => {
    const { doc } = parseSourceScript(`第一场 客厅\n林夏：${'长'.repeat(2101)}`);
    const input = { doc, episodeId: doc.episodes[0].id, sceneId: doc.episodes[0].scenes[0].id };
    for (const dialogue of ['', '长'.repeat(2000), '长'.repeat(2101)]) expect(() => parseDramaShotResponse(JSON.stringify({ shots: [{ prompt: 'x', dialogue }] }), input)).toThrow('DRAMA_PLAN_INVALID');
    expect(parseDramaShotResponse(JSON.stringify({ shots: [{ prompt: 'x', dialogue: '长'.repeat(1500) }, { prompt: 'y', dialogue: '长'.repeat(601) }] }), input)).toHaveLength(2);
  });
});
