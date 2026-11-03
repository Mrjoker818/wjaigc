import { describe, expect, it } from 'vitest';
import { createMinimapPointerTracker, type MinimapPointerTracker } from '@/lib/workflow-renderer/minimap-pointer';

const point = { clientX: 284.66668701171875, clientY: 683.4500122070312 };
const click = { clientX: 284, clientY: 683, button: 0, detail: 0, pointerId: 7, pointerType: 'mouse' };
function arm(tracker: MinimapPointerTracker, owner: EventTarget, pointerType = 'mouse'): void {
  const input = { ...point, button: 0, isPrimary: true, pointerId: 7, pointerType };
  tracker.begin(owner, input);
  tracker.end(owner, input);
}
describe('NS minimap click gesture identity', () => {
  it.each(['mouse', 'touch', 'pen'])('matched %s detail0 retains the released coordinates', (pointerType: string): void => {
    const tracker = createMinimapPointerTracker(), owner = new EventTarget();
    arm(tracker, owner, pointerType);
    expect(tracker.consume(owner, { ...click, pointerType })).toEqual(point);
  });
  it('unassociated keyboard detail0 keeps its own click coordinates', (): void => {
    const tracker = createMinimapPointerTracker(), owner = new EventTarget();
    expect(tracker.consume(owner, { ...click, pointerId: -1, pointerType: '' })).toEqual({ clientX: 284, clientY: 683 });
  });
  it('keyboard detail0 cannot leave a stale physical coordinate for the following click', (): void => {
    const tracker = createMinimapPointerTracker(), owner = new EventTarget();
    arm(tracker, owner);
    expect(tracker.consume(owner, { ...click, pointerId: -1, pointerType: '' })).toEqual({ clientX: 284, clientY: 683 });
    expect(tracker.consume(owner, { ...click, detail: 1 })).toEqual({ clientX: 284, clientY: 683 });
  });
});
