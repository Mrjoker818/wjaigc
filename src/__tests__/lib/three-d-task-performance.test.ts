import { describe, expect, it } from 'vitest';

import {
  AUTO_MULTI_VIEW_IMAGE_CONCURRENCY,
  THREE_D_POLL_INTERVAL_MS,
  THREE_D_POLL_REQUEST_TIMEOUT_MS,
  THREE_D_SUBMISSION_TIMEOUT_MS,
  THREE_D_TASK_TIMEOUT_MS,
  TRIPO_UPLOAD_CONCURRENCY,
  TRIPO_UPLOAD_TIMEOUT_MS,
  isMeshyThreeDProvider,
  mapWithConcurrency,
} from '@/lib/three-d-task-performance';

describe('3D task performance safeguards', () => {
  it('uses short request windows and a real wall-clock task deadline', () => {
    expect(THREE_D_POLL_INTERVAL_MS).toBe(2_000);
    expect(THREE_D_POLL_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(THREE_D_SUBMISSION_TIMEOUT_MS).toBe(60_000);
    expect(THREE_D_TASK_TIMEOUT_MS).toBe(600_000);
    expect(TRIPO_UPLOAD_TIMEOUT_MS).toBe(30_000);
  });

  it('limits throughput without changing item ordering', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4], TRIPO_UPLOAD_CONCURRENCY, async (value) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return value * 2;
    });

    expect(peak).toBeLessThanOrEqual(TRIPO_UPLOAD_CONCURRENCY);
    expect(results).toEqual([2, 4, 6, 8]);
    expect(AUTO_MULTI_VIEW_IMAGE_CONCURRENCY).toBe(2);
  });

  it('recognizes Meshy from provider metadata', () => {
    expect(isMeshyThreeDProvider({ providerPreset: 'meshy' })).toBe(true);
    expect(isMeshyThreeDProvider({ name: 'Meshy AI' })).toBe(true);
    expect(isMeshyThreeDProvider({ baseUrl: 'https://api.meshy.ai/openapi/v1' })).toBe(true);
    expect(isMeshyThreeDProvider({ name: 'Tripo' })).toBe(false);
  });
});
