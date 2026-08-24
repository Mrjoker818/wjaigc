import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../components/video-generation-panel.tsx', import.meta.url),
  'utf8',
);

describe('video duration selector', () => {
  it('uses an accessible discrete slider backed by the exact model catalog', () => {
    expect(source).toContain("useTaskModelCatalog('video')");
    expect(source).toContain('taskModelKey(currentModel.providerId, currentModel.modelId)');
    expect(source).toContain('currentDescriptor?.allowedDurationsSeconds ?? []');
    expect(source).toContain('currentDescriptor?.allowedRatios ?? []');
    expect(source).toContain('currentDescriptor?.allowedSizes ?? []');
    expect(source).toContain('currentDescriptor?.supportedOperations ?? []');
    expect(source).toContain('getPlatformVideoDurations');
    expect(source).toContain('aria-label="视频时长"');
    expect(source).toContain('type="range"');
    expect(source).not.toContain('inferVideoModelFeatures');
  });
});
