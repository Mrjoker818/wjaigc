import { describe, expect, it } from 'vitest';
import {
  analyzeHumanImage,
  buildHumanRepairPrompt,
  buildHumanMaskSpec,
  rankHumanCandidates,
} from '@/lib/human-ai-engine';

describe('human AI engine domain rules', () => {
  const image = { id: 'source-image', url: '/source.png', width: 1200, height: 800 };

  it('returns stable person and target identifiers for supported repair areas', () => {
    const analysis = analyzeHumanImage(image);

    expect(analysis.persons[0]).toMatchObject({ id: 'person_01' });
    expect(analysis.targets.map(target => target.type)).toEqual(expect.arrayContaining(['face', 'left_hand', 'right_hand', 'body', 'feet', 'hair', 'clothes', 'interaction']));
    expect(analysis.recommendations.length).toBeGreaterThan(0);
  });

  it('protects the outside region and defaults to identity, garment and product locks', () => {
    const target = analyzeHumanImage(image).targets[0];
    const mask = buildHumanMaskSpec(target, image, 'standard');
    const prompt = buildHumanRepairPrompt(target, { strength: 0.75 });

    expect(mask.protectOutside).toBe(true);
    expect(mask.featherPx).toBeGreaterThan(0);
    expect(prompt).toContain('identity');
    expect(prompt).toContain('text, logo and product');
  });

  it('ranks only candidates that pass preservation validation', () => {
    const ranked = rankHumanCandidates([
      { id: 'unsafe', targetId: 'face_01', imageUrl: '/unsafe.png', provider: 'mock', structureScore: 99, outsideChangeRate: 0.04 },
      { id: 'safe', targetId: 'face_01', imageUrl: '/safe.png', provider: 'mock', structureScore: 86, outsideChangeRate: 0.002 },
    ]);

    expect(ranked[0]?.id).toBe('safe');
    expect(ranked.find(candidate => candidate.id === 'unsafe')?.validation.passed).toBe(false);
  });
});
