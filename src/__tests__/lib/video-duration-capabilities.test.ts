import { describe, expect, it } from 'vitest';
import {
  clampVideoDurationToAllowed,
  getPlatformVideoDurations,
  PLATFORM_VIDEO_MAX_DURATION_SECONDS,
} from '@/lib/video-api';

describe('platform video duration capabilities', () => {
  it('caps a continuous Seedance duration list at the 15 second platform limit', () => {
    expect(PLATFORM_VIDEO_MAX_DURATION_SECONDS).toBe(15);
    expect(getPlatformVideoDurations([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 30])).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  it('keeps only provider-supported discrete durations below the platform limit', () => {
    expect(getPlatformVideoDurations([5, 10, 15, 30])).toEqual([5, 10, 15]);
    expect(getPlatformVideoDurations([3, 5, 8])).toEqual([3, 5, 8]);
  });

  it('snaps stale or unsupported values to the nearest supported duration', () => {
    const allowed = [5, 10, 15];

    expect(clampVideoDurationToAllowed(30, allowed)).toBe(15);
    expect(clampVideoDurationToAllowed(8, allowed)).toBe(10);
    expect(clampVideoDurationToAllowed(4, allowed)).toBe(5);
  });
});
