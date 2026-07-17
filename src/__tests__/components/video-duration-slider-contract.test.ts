import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../components/video-generation-panel.tsx', import.meta.url),
  'utf8',
);

describe('video duration selector', () => {
  it('uses an accessible discrete slider backed by platform-capped durations', () => {
    expect(source).toContain('getPlatformVideoDurations');
    expect(source).toContain('aria-label="视频时长"');
    expect(source).toContain('type="range"');
  });
});
