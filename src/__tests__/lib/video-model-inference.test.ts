import { describe, expect, it } from 'vitest';
import { getVideoModelInfo } from '@/lib/video-api';

describe('video model feature inference', () => {
  it('does not grant Kling-only controls to a Qwen chat model', () => {
    const model = getVideoModelInfo('qwen-plus');

    expect(model?.name).not.toContain('可灵');
    expect(model?.profile).not.toBe('dashscope');
    expect(model?.features.motionBrush).toBe(false);
    expect(model?.features.multiReference).toBe(false);
  });

  it('does not treat a Wanx model as a Kling model', () => {
    const model = getVideoModelInfo('wanx2.1-t2v-turbo');

    expect(model?.name).not.toContain('可灵');
    expect(model?.features.motionBrush).toBe(false);
    expect(model?.features.characterConsistency).toBe(false);
  });
});
