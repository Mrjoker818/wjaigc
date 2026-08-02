import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

describe('canvas progressive generation contract', () => {
  it('polls every durable image slot concurrently instead of waiting for the previous slot', () => {
    expect(source).toContain('await Promise.all(taskIds.map(async (');
    expect(source).toContain('taskIdx: number');
  });

  it('replaces the completed slot immediately using its own task index', () => {
    const completion = source.indexOf("if (pollData.status === 'completed' && completedImageUrls.length > 0)");
    const slotPlaceholder = source.indexOf('const phId = placeholderIds[taskIdx];', completion);
    const immediateCanvasUpdate = source.indexOf('setImages(prev => prev.map(img =>', slotPlaceholder);

    expect(completion).toBeGreaterThan(-1);
    expect(slotPlaceholder).toBeGreaterThan(completion);
    expect(immediateCanvasUpdate).toBeGreaterThan(slotPlaceholder);
    expect(source).toContain('slotIndex: taskIdx');
  });
});
