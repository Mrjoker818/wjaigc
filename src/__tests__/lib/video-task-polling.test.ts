import { describe, expect, it } from 'vitest';
import {
  DIRECT_VIDEO_MAX_POLL_ATTEMPTS,
  DIRECT_VIDEO_MAX_POLL_DURATION_MS,
  buildVideoProgressLabel,
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

  it('replaces the trailing status on each poll without growing the label', () => {
    let label = buildVideoProgressLabel('文生视频 · Seedance 2.0 (AI Link) · 排队中...', false);
    for (let i = 0; i < 5; i += 1) label = buildVideoProgressLabel(label, i > 2);
    expect(label).toBe('文生视频 · Seedance 2.0 (AI Link) · 生成中...');
    expect(buildVideoProgressLabel('文生视频 · Seedance 2.0 (AI Link) · 提交中...', false)).toBe('文生视频 · Seedance 2.0 (AI Link) · 排队中...');
    expect(buildVideoProgressLabel(undefined, true)).toBe('视频生成 · 生成中...');
  });
});
