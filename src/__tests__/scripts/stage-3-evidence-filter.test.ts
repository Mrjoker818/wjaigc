import { describe, expect, it } from 'vitest';

import { isBenignStage3RequestAbort } from '../../../tests/helpers/stage-3-evidence-filter';

describe('Stage 3 browser evidence request filtering', () => {
  it('accepts only known lifecycle request aborts as benign', () => {
    expect(isBenignStage3RequestAbort({
      method: 'POST',
      url: 'http://127.0.0.1:5000/api/user-data/record',
      text: 'net::ERR_ABORTED',
    })).toBe(true);
    expect(isBenignStage3RequestAbort({
      method: 'POST',
      url: 'http://127.0.0.1:5000/api/user-data/sync',
      text: 'net::ERR_ABORTED',
    })).toBe(false);
    expect(isBenignStage3RequestAbort({
      method: 'POST',
      status: 500,
      url: 'http://127.0.0.1:5000/api/user-data/record',
      text: 'server error',
    })).toBe(false);
  });
});
