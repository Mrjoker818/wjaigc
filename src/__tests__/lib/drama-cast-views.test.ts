import { describe, expect, it } from 'vitest';
import { castViewImage, setSlotImage, slotHistory } from '@/lib/drama/bible-images';
import { episodePackageMedia } from '@/lib/drama/export';
import { CAST_VIEWS, castImagePrompt } from '@/lib/drama/reference-prompts';
import { shotReadiness } from '@/lib/drama/readiness';
import { parseDramaProject } from '@/lib/drama/schema';
import { chooseReferenceImages } from '@/lib/drama/shot-runner';
import { createEmptyDramaProject, type DramaCastMember, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';

function shot(patch: Partial<DramaShot> = {}): DramaShot {
  return {
    id: 's', index: 0, title: '', purpose: '', actionBeat: '', prompt: '走开', duration: 5, durationSec: 5,
    aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [], ...patch,
  };
}

const lin: DramaCastMember = {
  id: 'lin', name: '林辰', appearance: '短发', imageUrlFront: '/f.png', imageUrlSide: '/s.png', imageUrlBack: '/b.png', imageUrlFace: '/c.png',
};

function doc(member: DramaCastMember = lin): DramaProjectV1 {
  return {
    ...createEmptyDramaProject({ title: '招财猫' }),
    cast: [member],
    episodes: [{ id: 'e', index: 0, title: '', logline: '', script: '', scenes: [{ id: 'sc', heading: '', summary: '', shots: [shot({ characterIds: ['lin'] })] }] }],
  };
}

describe('drama cast views', () => {
  it('reads and replaces each of the four angles with its own history', () => {
    expect(CAST_VIEWS.map(view => castViewImage(lin, view))).toEqual(['/f.png', '/s.png', '/b.png', '/c.png']);
    const next = setSlotImage(doc(), { kind: 'cast', id: 'lin', view: 'back' }, '/b2.png');
    expect(next.cast[0].imageUrlBack).toBe('/b2.png');
    expect(slotHistory(next, { kind: 'cast', id: 'lin', view: 'back' })).toEqual(['/b.png']);
    expect(slotHistory(next, { kind: 'cast', id: 'lin', view: 'face' })).toEqual([]);
    expect(parseDramaProject(next).cast[0].imageHistory).toEqual({ back: ['/b.png'] });
  });

  it('sends the face close-up right after the front, then the other angles, unless one image is locked', () => {
    const capability = { imageToVideo: true, maxReferenceImages: 4 };
    expect(chooseReferenceImages(shot({ characterIds: ['lin'] }), [lin], capability)).toEqual(['/f.png', '/c.png', '/s.png', '/b.png']);
    expect(chooseReferenceImages(shot({ characterIds: ['lin'] }), [{ ...lin, lockedImageUrl: '/c.png' }], capability)).toEqual(['/c.png']);
  });

  it('counts any angle as a character image and exports each one', () => {
    const backOnly = { id: 'lin', name: '林辰', appearance: '', imageUrlBack: '/b.png' };
    const checks = shotReadiness(doc(backOnly), 'e', doc(backOnly).episodes[0].scenes[0].shots[0], undefined);
    expect(checks.find(check => check.key === 'cast')?.ok).toBe(true);
    expect(episodePackageMedia(doc(), 'e').map(item => item.name)).toEqual(expect.arrayContaining([
      '设定/角色_林辰.png', '设定/角色_林辰_侧面.png', '设定/角色_林辰_背面.png', '设定/角色_林辰_面部.png',
    ]));
  });

  it('asks for the same person when an angle is drawn from an existing view', () => {
    expect(castImagePrompt(lin, 'back', 'cinematic')).toContain('back view');
    expect(castImagePrompt(lin, 'face', 'cinematic', true)).toContain('the same character as the reference image');
    expect(castImagePrompt(lin, 'face', 'cinematic')).not.toContain('reference image');
  });
});
