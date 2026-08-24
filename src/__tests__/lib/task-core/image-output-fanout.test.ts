import { describe, expect, it } from 'vitest';

import { planImageOutputFanout } from '@/lib/task-core/image-output-fanout';

describe('image output fan-out', () => {
  it('fans out four platform-approved outputs into four n=1 provider submissions', () => {
    expect(planImageOutputFanout(4)).toEqual([1, 1, 1, 1]);
  });
});
