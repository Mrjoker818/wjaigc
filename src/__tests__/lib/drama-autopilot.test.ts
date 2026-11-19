import { describe, expect, it } from 'vitest';
import {
  applyBibleImage, autopilotDone, autopilotPlan, bibleImageRequest, quoteTotal, withinQuote, type AutopilotQuote,
} from '@/lib/drama/autopilot';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';

function shot(id: string, patch: Partial<DramaShot> = {}): DramaShot {
  return {
    id, index: 0, title: '', purpose: '', actionBeat: '', prompt: `画面${id}`, duration: 5, durationSec: 5,
    aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [], ...patch,
  };
}

const done = (id: string) => ({ takes: [{ id: `t${id}`, status: 'completed' as const, videoUrl: `/v/${id}.mp4`, createdAt: 1 }], selectedTakeId: `t${id}` });

function doc(): DramaProjectV1 {
  return {
    ...createEmptyDramaProject({ title: '招财猫' }),
    cast: [
      { id: 'lin', name: '林辰', appearance: '短发', lockedImageUrl: '/img/lin.png' },
      { id: 'cat', name: '大橘', appearance: '橘猫' },
      { id: 'extra', name: '路人', appearance: '' },
    ],
    locations: [{ id: 'shop', name: '小店' }, { id: 'street', name: '街口', imageUrl: '/img/street.png' }],
    props: [{ id: 'ticket', name: '彩票' }, { id: 'unused', name: '没出场的道具' }],
    episodes: [{
      id: 'e1', index: 0, title: '', logline: '', script: '',
      scenes: [
        { id: 'sc1', heading: '小店', summary: '', locationId: 'shop', characterIds: ['lin'], shots: [
          shot('a', { ...done('a'), dialogue: '慢点吃' }),
          shot('b', { characterIds: ['cat'], propIds: ['ticket'], dialogue: '喵' }),
          shot('c', { firstFrameUrl: '/img/c.png' }),
        ] },
        { id: 'sc2', heading: '街口', summary: '', locationId: 'street', shots: [] },
      ],
    }],
  };
}

describe('drama autopilot plan', () => {
  it('lists only what the episode shows and still lacks', () => {
    const plan = autopilotPlan(doc(), 'e1');
    expect(plan.scenes).toEqual(['sc2']);
    expect(plan.bible.map(item => item.key)).toEqual(['bible:cast:cat', 'bible:location:shop', 'bible:prop:ticket']);
    expect(plan.keyframes).toEqual(['b']);
    expect(plan.shots).toEqual(['b', 'c']);
    expect(plan.voiceovers).toEqual(['a', 'b']);
  });

  it('skips keyframes for shots whose model cannot start from an image', () => {
    expect(autopilotPlan(doc(), 'e1', s => s.id !== 'b').keyframes).toEqual([]);
  });

  it('fills a bible gap with the front view, the plate or the prop sheet', () => {
    const d = doc();
    const [cat, shop, ticket] = autopilotPlan(d, 'e1').bible;
    expect(bibleImageRequest(d, cat)).toMatchObject({ aspectRatio: '2:3' });
    expect(bibleImageRequest(d, cat)?.prompt).toContain('大橘');
    expect(bibleImageRequest(d, shop)).toMatchObject({ aspectRatio: '9:16' });
    expect(bibleImageRequest(d, ticket)).toMatchObject({ aspectRatio: '1:1' });
    const filled = [cat, shop, ticket].reduce((next, item) => applyBibleImage(next, item, `/img/${item.id}.png`), d);
    expect(filled.cast.find(m => m.id === 'cat')?.imageUrlFront).toBe('/img/cat.png');
    expect(filled.locations.find(l => l.id === 'shop')?.imageUrl).toBe('/img/shop.png');
    expect(filled.props.find(p => p.id === 'ticket')?.imageUrl).toBe('/img/ticket.png');
    expect(autopilotPlan(filled, 'e1').bible).toEqual([]);
    expect(bibleImageRequest(d, { ...cat, id: 'gone' })).toBeNull();
  });
});

describe('drama autopilot quote', () => {
  const quote = (credits: AutopilotQuote['credits']): AutopilotQuote => ({ episodeId: 'e1', plan: autopilotPlan(doc(), 'e1'), credits, balance: 100 });
  const all = { bible: true, keyframes: true, voiceover: true, render: true };

  it('adds the chosen paid stages and leaves out the ones the user unticked', () => {
    const q = quote({ bible: 30, keyframes: 10, shots: 80 });
    expect(quoteTotal(q, all)).toBe(120);
    expect(quoteTotal(q, { ...all, bible: false, keyframes: false })).toBe(80);
  });

  it('has no total when a chosen stage with work could not be priced', () => {
    expect(quoteTotal(quote({ bible: 30, shots: 80 }), all)).toBeUndefined();
    expect(quoteTotal(quote({ bible: 30, shots: 80 }), { ...all, keyframes: false })).toBe(110);
  });

  it('refuses a run once the episode gained paid work, and counts finished items', () => {
    const d = doc();
    const q: AutopilotQuote = { episodeId: 'e1', plan: autopilotPlan(d, 'e1'), credits: {} };
    expect(withinQuote(q, autopilotPlan(d, 'e1'))).toBe(true);
    const grown = { ...d, episodes: [{ ...d.episodes[0], scenes: [{ ...d.episodes[0].scenes[0], shots: [...d.episodes[0].scenes[0].shots, shot('d')] }, d.episodes[0].scenes[1]] }] };
    expect(withinQuote(q, autopilotPlan(grown, 'e1'))).toBe(false);

    const progressed = applyBibleImage({
      ...d, episodes: [{ ...d.episodes[0], scenes: [{ ...d.episodes[0].scenes[0], shots: d.episodes[0].scenes[0].shots.map(s => (s.id === 'c' ? { ...s, ...done('c') } : s)) }, d.episodes[0].scenes[1]] }],
    }, q.plan.bible[0], '/img/cat.png');
    expect(withinQuote(q, autopilotPlan(progressed, 'e1'))).toBe(true);
    expect(autopilotDone(q, autopilotPlan(progressed, 'e1'))).toEqual({ bible: 1, keyframes: 0, shots: 1, voiceover: 0 });
  });
});
