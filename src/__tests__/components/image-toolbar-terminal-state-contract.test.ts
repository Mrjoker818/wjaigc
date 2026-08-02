import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

function handlerSource(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end);
}

describe('image toolbar terminal state contract', () => {
  it('keeps failed color adjustments on the canvas instead of silently removing them', () => {
    const handler = handlerSource(
      'const applyColorAdjust = useCallback',
      'const handleConfirmColorAdjust = applyColorAdjust',
    );

    expect(handler).toContain('buildFailedProcessingFrame');
    expect(handler).toContain('updateProcessingFrame(placeholderId, failure)');
    expect(handler).not.toContain('setTimeout(() => removeProcessingFrame(placeholderId), 5000)');
  });

  it('keeps failed erase and mask requests as terminal processing cards', () => {
    const fullHandler = handlerSource(
      'const handleEditConfirm = useCallback',
      '// Mask keyword confirm',
    );
    const handler = fullHandler.slice(
      fullHandler.indexOf("if (editMode === 'erase' || editMode === 'mask')"),
      fullHandler.indexOf("if (editMode === 'expand')"),
    );

    expect(handler).toContain('const failImageEdit');
    expect(handler).toContain('buildFailedProcessingFrame');
    expect(handler).toContain('toast.error(failure.error)');
    expect(handler).not.toContain('setTimeout(() => removeProcessingFrame(placeholderId), 5000)');
  });

  it('keeps failed element decomposition requests visible for retry diagnostics', () => {
    const handler = handlerSource(
      'const handleDisplayDecomposeLegacy',
      'void handleDisplayDecomposeLegacy',
    );

    expect(handler).toContain('buildFailedProcessingFrame');
    expect(handler).toContain('toast.error');
    expect(handler).not.toContain('setTimeout(() => removeProcessingFrame(placeholderId), 5000)');
  });
});
