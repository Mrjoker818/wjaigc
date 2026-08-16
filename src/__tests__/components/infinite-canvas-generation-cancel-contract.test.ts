import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('infinite canvas generation cancellation contract', () => {
  it('cancels the durable provider task before removing a processing frame', () => {
    const handler = source.indexOf('const handleCancelProcessingFrame = useCallback');
    const persistedCancellation = source.indexOf(
      'await taskEventsClient.cancelTask(taskId)',
      handler,
    );
    const frameRemoval = source.indexOf('removeProcessingFrame(image.id)', persistedCancellation);

    expect(handler).toBeGreaterThan(-1);
    expect(persistedCancellation).toBeGreaterThan(handler);
    expect(frameRemoval).toBeGreaterThan(persistedCancellation);
  });

  it('keeps the processing frame visible when the server rejects cancellation', () => {
    const handler = source.indexOf('const handleCancelProcessingFrame = useCallback');
    const failureGuard = source.indexOf('if (!cancellation.success)', handler);
    const frameRemoval = source.indexOf('removeProcessingFrame(image.id)', failureGuard);

    expect(failureGuard).toBeGreaterThan(handler);
    expect(frameRemoval).toBeGreaterThan(failureGuard);
  });

  it('routes both visible processing-card cancel buttons through the durable handler', () => {
    const genericButtons = source.match(/void handleCancelProcessingFrame\(image\)/g) || [];

    expect(genericButtons).toHaveLength(2);
  });

  it('keeps processing-card cancel pointer gestures out of the canvas drag handler', () => {
    const cancelButtons = source.match(
      /<button[\s\S]*?onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}[\s\S]*?void handleCancelProcessingFrame\(image\);[\s\S]*?<\/button>/g,
    ) || [];

    expect(cancelButtons).toHaveLength(2);
    expect(cancelButtons.every(button => button.includes('type="button"'))).toBe(true);
  });

  it('uses a per-task abort controller for direct-generation slots instead of cancelling an unrelated global poller', () => {
    const generator = source.indexOf('const handleCanvasGenerate = useCallback');
    const directPoller = source.indexOf('const pollForSlot = async', generator);
    const directPollerEnd = source.indexOf('const results = await Promise.all', directPoller);
    const directPollerSource = source.slice(directPoller, directPollerEnd);
    const visibleCancelCards = source.slice(source.indexOf('onClick={(e) => {', 10000));

    expect(source.indexOf('canvasGenerationAbortControllersRef')).toBeGreaterThan(-1);
    expect(directPollerSource).toContain('const abortController = new AbortController()');
    expect(directPollerSource).toContain('signal: abortController.signal');
    expect(visibleCancelCards).not.toContain('pollingAbortRef.current.abort()');
  });
});
