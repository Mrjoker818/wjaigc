import { describe, expect, it } from 'vitest';

import { parseShotPlanFullResponse, parseStoryAssetsResponse } from '@/lib/video-director/continuity';

describe('video director response parsing', () => {
  it('parses shots and production assets from an LLM JSON response', () => {
    const result = parseShotPlanFullResponse(JSON.stringify({
      shots: [{
        title: 'Opening',
        prompt: 'A character enters a cafe',
        duration: 5,
        aspectRatio: '16:9',
        characterIds: ['char-1'],
        sceneId: 'scene-1',
      }],
      characters: [{ id: 'char-1', name: 'Mina', appearance: 'short dark hair' }],
      scenes: [{ id: 'scene-1', name: 'Cafe', description: 'A quiet cafe' }],
      props: [{ id: 'prop-1', name: 'Notebook', description: 'A red notebook' }],
    }));

    expect(result.shots).toHaveLength(1);
    expect(result.shots[0]).toMatchObject({ title: 'Opening', characterIds: ['char-1'], sceneId: 'scene-1' });
    expect(result.characters[0]).toMatchObject({ id: 'char-1', name: 'Mina' });
    expect(result.scenes[0]).toMatchObject({ id: 'scene-1', name: 'Cafe' });
    expect(result.props[0]).toMatchObject({ id: 'prop-1', name: 'Notebook' });
  });

  it('returns empty plans for malformed JSON and ignores malformed asset entries', () => {
    expect(parseShotPlanFullResponse('not json').shots).toEqual([]);
    expect(parseStoryAssetsResponse(JSON.stringify({ prompts: [null, { prompt: 'valid asset prompt', type: 'scene' }] })).prompts)
      .toEqual([expect.objectContaining({ type: 'scene', prompt: 'valid asset prompt' })]);
  });
});
