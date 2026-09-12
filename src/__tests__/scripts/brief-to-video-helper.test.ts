import { describe, expect, it } from 'vitest';

import { findNewBriefVideoRunId } from '../../../tests/helpers/brief-to-video-card-selection';

describe('Brief-to-video Simple Chat card selection', () => {
  it('selects only a run card that appeared after the current send', () => {
    expect(findNewBriefVideoRunId(['cancelled-old'], ['cancelled-old', 'fresh-run']))
      .toBe('fresh-run');
  });

  it('does not reuse the restored cancelled card while the new card is pending', () => {
    expect(findNewBriefVideoRunId(['cancelled-old'], ['cancelled-old'])).toBeUndefined();
    expect(findNewBriefVideoRunId(['cancelled-old'], ['cancelled-old', '', 'cancelled-old']))
      .toBeUndefined();
  });
});
