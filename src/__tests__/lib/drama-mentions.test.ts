import { describe, expect, it } from 'vitest';
import {
  activeMention, filterCandidates, insertMention, mentionCandidates, mergeMentionIds, resolveMentions, stripMentions,
} from '@/lib/drama/mentions';
import { buildShotGenerateRequest } from '@/lib/drama/shot-runner';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';

function doc(): DramaProjectV1 {
  return {
    ...createEmptyDramaProject({ title: 't' }),
    cast: [
      { id: 'lin', name: '林辰', appearance: '' },
      { id: 'linlin', name: '林辰辰', appearance: '' },
      { id: 'cat', name: '大橘', appearance: '' },
      { id: 'blank', name: '  ', appearance: '' },
    ],
    props: [{ id: 'ticket', name: '彩票' }],
  };
}

describe('drama mentions', () => {
  it('resolves cast and props by name, longest name first, in order of first mention', () => {
    expect(resolveMentions('@大橘叼着@彩票跳上台，@林辰辰愣住，@大橘又跳下', doc()))
      .toEqual({ characterIds: ['cat', 'linlin'], propIds: ['ticket'] });
    expect(resolveMentions('@林辰 蹲下', doc()).characterIds).toEqual(['lin']);
    expect(resolveMentions('邮箱 a@b.com，没有引用', doc())).toEqual({ characterIds: [], propIds: [] });
  });

  it('drops the @ before known names only', () => {
    expect(stripMentions('@大橘叼着@彩票，联系 a@b.com', doc())).toBe('大橘叼着彩票，联系 a@b.com');
  });

  it('adds named ids to the shot without removing the ones already linked', () => {
    expect(mergeMentionIds({ characterIds: ['lin'] }, '@大橘 吃饭，@彩票', doc()))
      .toEqual({ characterIds: ['lin', 'cat'], propIds: ['ticket'] });
    const unchanged = { characterIds: ['cat'], propIds: ['ticket'] };
    const merged = mergeMentionIds(unchanged, '@大橘 @彩票', doc());
    expect(merged.characterIds).toBe(unchanged.characterIds);
    expect(merged.propIds).toBe(unchanged.propIds);
  });

  it('finds the mention being typed and inserts the picked name', () => {
    expect(activeMention('镜头里 @大', 6)).toEqual({ start: 4, query: '大' });
    expect(activeMention('@大橘 走来', 6)).toBeNull();
    expect(activeMention('没有', 2)).toBeNull();
    const candidates = mentionCandidates(doc());
    expect(candidates.map(item => item.id)).toEqual(['lin', 'linlin', 'cat', 'ticket']);
    expect(filterCandidates(candidates, '林').map(item => item.id)).toEqual(['lin', 'linlin']);
    expect(insertMention('看 @大 走来', 2, 4, '大橘')).toEqual({ text: '看 @大橘  走来', caret: 6 });
  });

  it('sends plain names to the video model', () => {
    const shot: DramaShot = {
      id: 's', index: 0, title: '', purpose: '', actionBeat: '', prompt: '@大橘叼着@彩票', duration: 5, durationSec: 5,
      aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [],
    };
    const body = buildShotGenerateRequest({ doc: doc(), shot, modelId: 'm', capability: { imageToVideo: false, maxReferenceImages: 0 } });
    expect(String(body.prompt).split('\n')[0]).toBe('大橘叼着彩票');
    expect(body.prompt).not.toContain('@');
  });
});
