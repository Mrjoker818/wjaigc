import { describe, expect, it } from 'vitest';

import {
  isBenignStage3RequestAbort,
  isRecoveredStage3RequestAbort,
  isRecoveredStage3SyncConflict,
  stage3RequestFingerprint,
} from '../../../tests/helpers/stage-3-evidence-filter';

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

  it('accepts a project revision conflict only when a later project sync succeeds', () => {
    const conflict = {
      method: 'POST',
      status: 409,
      url: 'http://127.0.0.1:5000/api/user-data/sync',
      occurredAt: 10,
    };
    expect(isRecoveredStage3SyncConflict(conflict, [conflict])).toBe(false);
    expect(isRecoveredStage3SyncConflict(conflict, [conflict, {
      method: 'POST',
      status: 200,
      url: conflict.url,
      occurredAt: 20,
    }])).toBe(true);
    expect(isRecoveredStage3SyncConflict(conflict, [conflict, {
      method: 'POST',
      status: 200,
      url: conflict.url,
      occurredAt: 5,
    }])).toBe(false);
  });

  it('accepts an interrupted duplicate only when the same durable snapshot has succeeded', () => {
    const first = JSON.stringify({
      key: 'projects',
      projectRevision: 2,
      value: [{ id: 'project-a', updatedAt: 100, canvasImages: [{ id: 'node-a', x: 40 }] }],
    });
    const recovered = JSON.stringify({
      key: 'projects',
      projectRevision: 3,
      value: [{ id: 'project-a', updatedAt: 200, canvasImages: [{ id: 'node-a', x: 40 }] }],
    });
    const changed = JSON.stringify({
      key: 'projects',
      projectRevision: 3,
      value: [{ id: 'project-a', updatedAt: 200, canvasImages: [{ id: 'node-a', x: 41 }] }],
    });
    const failedEntry = {
      method: 'POST',
      url: 'http://127.0.0.1:5000/api/user-data/sync',
      text: 'Load request cancelled',
      requestDigest: stage3RequestFingerprint(first),
      occurredAt: 10,
    };

    expect(isRecoveredStage3RequestAbort(failedEntry, [{
      method: 'POST',
      status: 200,
      url: failedEntry.url,
      requestDigest: stage3RequestFingerprint(recovered),
      occurredAt: 20,
    }])).toBe(true);
    expect(isRecoveredStage3RequestAbort(failedEntry, [{
      method: 'POST',
      status: 200,
      url: failedEntry.url,
      requestDigest: stage3RequestFingerprint(changed),
      occurredAt: 20,
    }])).toBe(false);
    expect(isRecoveredStage3RequestAbort(failedEntry, [{
      method: 'POST',
      status: 200,
      url: failedEntry.url,
      requestDigest: stage3RequestFingerprint(recovered),
      occurredAt: 5,
    }])).toBe(true);
  });
});
