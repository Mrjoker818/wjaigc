import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

const generateSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/generate/route.ts'),
  'utf8',
);

describe('canvas embedded image generator durable slot contract', () => {
  it('marks its submitOnly request as a canvas-direct generation and sends outputCount', () => {
    const generator = canvasSource.indexOf('const handleCanvasGenerate = useCallback');
    const request = canvasSource.indexOf("fetch('/api/generate'", generator);
    const body = canvasSource.slice(request, canvasSource.indexOf('signal: canvasGenController.signal', request));

    expect(generator).toBeGreaterThan(-1);
    expect(body).toContain("generationChannel: 'canvas-direct'");
    expect(body).toContain('outputCount: canvasGenCount');
  });

  it('does not route canvas-direct multi-output requests through the legacy outer-task wrapper', () => {
    const legacyWrapper = generateSource.indexOf(
      'process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER',
    );

    expect(legacyWrapper).toBeGreaterThan(-1);
    expect(generateSource.slice(legacyWrapper - 180, legacyWrapper + 120)).toContain(
      "generationChannel !== 'canvas-direct'",
    );
  });

  it('creates one processing placeholder per durable task and binds each placeholder to its task id', () => {
    const generator = canvasSource.indexOf('const handleCanvasGenerate = useCallback');
    const slotCreation = canvasSource.indexOf('const canvasGenerationSlots:', generator);
    const placeholderCreation = canvasSource.indexOf('const placeholders: CanvasImage[] = submittedSlots.map', slotCreation);
    const processingFlag = canvasSource.indexOf('isProcessingPlaceholder: true', placeholderCreation);
    const taskBinding = canvasSource.indexOf('taskId: slot.taskId', processingFlag);

    expect(slotCreation).toBeGreaterThan(generator);
    expect(placeholderCreation).toBeGreaterThan(slotCreation);
    expect(processingFlag).toBeGreaterThan(placeholderCreation);
    expect(taskBinding).toBeGreaterThan(processingFlag);
  });

  it('polls and settles each slot independently using the resolved provider id', () => {
    const generator = canvasSource.indexOf('const handleCanvasGenerate = useCallback');
    const slotCreation = canvasSource.indexOf('const canvasGenerationSlots =', generator);
    const polling = canvasSource.indexOf('await Promise.all(canvasGenerationSlots.map(async (slot) =>', slotCreation);
    const provider = canvasSource.indexOf('const pollProviderId = data.providerId || canvasGenProviderId;', slotCreation);
    const completion = canvasSource.indexOf('completeProcessingFrame(slot.frameId', slotCreation);

    expect(polling).toBeGreaterThan(slotCreation);
    expect(provider).toBeGreaterThan(slotCreation);
    expect(completion).toBeGreaterThan(slotCreation);
  });

  it('treats success-style provider terminal statuses as completed so the batch unlocks', () => {
    const generator = canvasSource.indexOf('const handleCanvasGenerate = useCallback');
    const pollForSlot = canvasSource.indexOf('const pollForSlot = async', generator);
    const completedStatus = canvasSource.indexOf(
      "['completed', 'success', 'succeeded'].includes",
      pollForSlot,
    );

    expect(pollForSlot).toBeGreaterThan(generator);
    expect(completedStatus).toBeGreaterThan(pollForSlot);
  });
});
