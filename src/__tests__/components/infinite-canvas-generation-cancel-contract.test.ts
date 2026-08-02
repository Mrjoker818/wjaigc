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
    const frameRemoval = source.indexOf('removeProcessingFrame(image.id)', handler);

    expect(handler).toBeGreaterThan(-1);
    expect(persistedCancellation).toBeGreaterThan(handler);
    expect(frameRemoval).toBeGreaterThan(persistedCancellation);
  });

  it('keeps the processing frame visible when the server rejects cancellation', () => {
    const handler = source.indexOf('const handleCancelProcessingFrame = useCallback');
    const failureGuard = source.indexOf('if (!cancellation.success)', handler);
    const frameRemoval = source.indexOf('removeProcessingFrame(image.id)', handler);

    expect(failureGuard).toBeGreaterThan(handler);
    expect(frameRemoval).toBeGreaterThan(failureGuard);
  });

  it('routes both visible processing-card cancel buttons through the durable handler', () => {
    const genericButtons = source.match(/void handleCancelProcessingFrame\(image\)/g) || [];

    expect(genericButtons).toHaveLength(2);
  });
});
