import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

describe('canvas progressive generation contract', () => {
  it('polls every durable image slot concurrently instead of waiting for the previous slot', () => {
    expect(source).toContain(
      'const activeSubmittedSlots = submittedSlots.filter(slot => !terminalStatuses.has(slot.status));',
    );
    expect(source).toContain('await Promise.all(activeSubmittedSlots.map(async (');
    expect(source).toContain('submittedSlot');
  });

  it('replaces the completed slot immediately using canonical server slot metadata', () => {
    const completion = source.indexOf("if (pollData.status === 'completed' && completedImageUrls.length > 0)");
    const canonicalSlot = source.indexOf('resolveGenerationSlotIndex(', completion);
    const immediateProjection = source.indexOf('projectWorkspaceTaskEvent({', canonicalSlot);

    expect(completion).toBeGreaterThan(-1);
    expect(canonicalSlot).toBeGreaterThan(completion);
    expect(immediateProjection).toBeGreaterThan(canonicalSlot);
    expect(source).toContain('slotIndex: completedSlotIndex');
  });

  it('replaces slots already completed in the submit response before polling siblings', () => {
    const submitCompletedStart = source.indexOf('submittedSlots.forEach((slot) => {');
    const immediateSubmitProjection = source.indexOf(
      "source: 'submit'",
      submitCompletedStart,
    );
    const activePollingStart = source.indexOf(
      'await Promise.all(activeSubmittedSlots.map(async (submittedSlot) => {',
      submitCompletedStart,
    );

    expect(submitCompletedStart).toBeGreaterThan(-1);
    expect(immediateSubmitProjection).toBeGreaterThan(submitCompletedStart);
    expect(activePollingStart).toBeGreaterThan(immediateSubmitProjection);
  });

  it('does not append a second image after the matching slot was already replaced', () => {
    const batchReconciliation = source.slice(
      source.indexOf('const completedCanvasImages = completedImages.map'),
      source.indexOf('toast.success(`', source.indexOf('const completedCanvasImages = completedImages.map')),
    );

    expect(batchReconciliation).toContain("existing.taskProjection?.status !== 'completed'");
    expect(batchReconciliation).not.toContain('reconcileCompletedGenerationSlot');
    expect(batchReconciliation).not.toContain('updated.push(');
  });

  it('retains the explicit provider id when polling omits a display name', () => {
    const completion = source.slice(
      source.indexOf("if (pollData.status === 'completed' && completedImageUrls.length > 0)"),
      source.indexOf('taskCompleted = true;', source.indexOf("if (pollData.status === 'completed' && completedImageUrls.length > 0)")),
    );

    expect(completion).toContain('params.providerId');
  });
});
