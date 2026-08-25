import { describe, expect, it } from 'vitest';

import { resolveSimpleChatModelMenuLayout } from '@/lib/simple-chat-model-menu-position';

describe('simple chat model menu positioning', () => {
  it('keeps the image model menu inside a 320px viewport when its trigger is inset', () => {
    const trigger = { left: 142, right: 270, top: 270, bottom: 302, width: 128, height: 32 };
    const layout = resolveSimpleChatModelMenuLayout(trigger, { width: 320, height: 568 });

    expect(trigger.left + layout.left).toBe(12);
    expect(trigger.left + layout.left + layout.width).toBe(308);
    expect(layout.width).toBe(296);
    expect(layout.maxHeight).toBeLessThanOrEqual(254);
  });

  it('preserves right alignment when the trigger has enough viewport space', () => {
    const trigger = { left: 1428, right: 1558, top: 12, bottom: 44, width: 130, height: 32 };
    const layout = resolveSimpleChatModelMenuLayout(trigger, { width: 2048, height: 991 });

    expect(trigger.left + layout.left).toBe(1238);
    expect(trigger.left + layout.left + layout.width).toBe(trigger.right);
    expect(layout.width).toBe(320);
  });

  it('opens above the trigger when the lower viewport cannot fit the minimum menu height', () => {
    const trigger = { left: 180, right: 300, top: 500, bottom: 532, width: 120, height: 32 };
    const layout = resolveSimpleChatModelMenuLayout(trigger, { width: 320, height: 568 });

    expect(layout.top).toBeLessThan(0);
    expect(trigger.top + layout.top).toBeGreaterThanOrEqual(12);
    expect(layout.maxHeight).toBeLessThanOrEqual(384);
  });
});
