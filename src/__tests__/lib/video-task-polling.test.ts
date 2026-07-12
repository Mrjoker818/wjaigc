import { describe, expect, it } from 'vitest';
import {
  DIRECT_VIDEO_MAX_POLL_ATTEMPTS,
  DIRECT_VIDEO_MAX_POLL_DURATION_MS,
  hasDirectVideoPollingTimedOut,
} from '@/lib/video-task-polling';

describe('video-task-polling', () => {
  it('keeps direct video polling active until the 20-minute limit', () => {
    expect(DIRECT_VIDEO_MAX_POLL_ATTEMPTS).toBe(400);
    expect(DIRECT_VIDEO_MAX_POLL_DURATION_MS).toBe(20 * 60 * 1000);
    expect(hasDirectVideoPollingTimedOut(399, DIRECT_VIDEO_MAX_POLL_DURATION_MS - 1)).toBe(false);
  });

  it('stops direct video polling at either configured limit', () => {
    expect(hasDirectVideoPollingTimedOut(400, 0)).toBe(true);
    expect(hasDirectVideoPollingTimedOut(1, DIRECT_VIDEO_MAX_POLL_DURATION_MS)).toBe(true);
  });
});
