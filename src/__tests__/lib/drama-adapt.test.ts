import { describe, expect, it, vi } from 'vitest';
import { buildAdaptChunkPrompt, mergeAdaptedChunk, splitSourceText } from '@/lib/drama/adapt';
import { createEmptyDramaProject, type DramaProjectV1 } from '@/lib/drama/types';
import { startAdaptation, waitForAdaptation } from '@/lib/drama/workbench-client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function part(patch: Partial<DramaProjectV1>, episodeId: string): DramaProjectV1 {
  return {
    ...createEmptyDramaProject({ title: '原题' }),
    episodes: [{ id: episodeId, index: 0, title: '', logline: `${episodeId} 梗概`, script: '', scenes: [
      { id: `${episodeId}_sc`, heading: '', summary: '', locationId: 'shop', characterIds: ['lin', 'cat'], shots: [] },
    ] }],
    ...patch,
  };
}

describe('drama adaptation', () => {
  it('splits at paragraph breaks, then sentence ends, and folds a short tail into the last part', () => {
    const paragraph = `${'甲'.repeat(69)}\n`;
    const chunks = splitSourceText(paragraph.repeat(4), 100);
    expect(chunks.every(chunk => chunk.length <= 100)).toBe(true);
    expect(chunks.join('')).toBe('甲'.repeat(69 * 4));
    expect(splitSourceText(`${'乙'.repeat(70)}。${'丙'.repeat(60)}`, 100)).toEqual(['乙'.repeat(70) + '。', '丙'.repeat(60)]);
    expect(splitSourceText('丁'.repeat(230), 100).map(chunk => chunk.length)).toEqual([100, 100, 30]);
    // The 10-character tail is too short for its own episode and joins the previous part on a new line.
    expect(splitSourceText('戊'.repeat(210), 100)).toEqual(['戊'.repeat(100), `${'戊'.repeat(100)}\n${'戊'.repeat(10)}`]);
  });

  it('tells each part which ids already exist and what happened before', () => {
    const known = { cast: [{ id: 'lin', name: '林辰', appearance: '' }], locations: [], props: [] };
    const prompt = buildAdaptChunkPrompt({ chunk: '原文段落', index: 1, total: 3, known, previous: '他捡到彩票' });
    expect(prompt).toContain('第 2/3 段');
    expect(prompt).toContain('lin=林辰');
    expect(prompt).toContain('上一集梗概：他捡到彩票');
    expect(prompt.endsWith('原文：\n原文段落')).toBe(true);
  });

  it('merges parts: reused ids keep the first description, clashing ids are renamed in scenes too', () => {
    const first = mergeAdaptedChunk(null, part({
      cast: [{ id: 'lin', name: '林辰', appearance: '短发' }],
      locations: [{ id: 'cat', name: '猫咖' }],
    }, 'e1'));
    const merged = mergeAdaptedChunk(first, part({
      cast: [{ id: 'lin', name: '林辰', appearance: '长发', costume: '外卖服' }, { id: 'cat', name: '大橘', appearance: '橘猫' }],
      locations: [{ id: 'shop', name: '便利店' }],
    }, 'e2'));
    expect(merged.cast).toEqual([
      { id: 'lin', name: '林辰', appearance: '短发', costume: '外卖服' },
      { id: 'cat_2', name: '大橘', appearance: '橘猫' },
    ]);
    expect(merged.locations.map(item => item.id)).toEqual(['cat', 'shop']);
    expect(merged.episodes.map(episode => episode.index)).toEqual([0, 1]);
    expect(merged.episodes[1].scenes[0].characterIds).toEqual(['lin', 'cat_2']);
    expect(merged.episodes[0].scenes[0].characterIds).toEqual(['lin', 'cat']);
  });

  it('starts an adaptation and follows it to the saved drama', async () => {
    const start = vi.fn(async () => json({ success: true, taskId: 'drama_adapt_1', parts: 3 }, 202));
    const input = { text: '原文', planner: { providerId: 'p', modelId: 'chat-2' } };
    await expect(startAdaptation(input, start)).resolves.toEqual({ taskId: 'drama_adapt_1', parts: 3 });
    expect(start).toHaveBeenCalledWith('/api/drama/adapt', expect.objectContaining({ body: JSON.stringify(input) }));
    await expect(startAdaptation(input, async () => json({ error: '已有一部小说在改编' }, 409))).rejects.toThrow('已有一部小说在改编');

    const replies = [
      json({ status: 'processing', progress: 40, label: '改编小说 · 第 2/3 段' }),
      json({ status: 'completed', result: { dramaId: 'd1', adaptedParts: 2, totalParts: 3 } }),
    ];
    const progress = vi.fn();
    let clock = 0;
    await expect(waitForAdaptation('drama_adapt_1', {
      fetch: async () => replies.shift()!, sleep: async () => { clock += 3000; }, now: () => clock, onProgress: progress,
    })).resolves.toEqual({ dramaId: 'd1', adaptedParts: 2, totalParts: 3 });
    expect(progress).toHaveBeenCalledWith(40, '改编小说 · 第 2/3 段');
    await expect(waitForAdaptation('x', { fetch: async () => json({ status: 'failed', error: '改编失败了' }), sleep: async () => undefined }))
      .rejects.toThrow('改编失败了');
  });
});
