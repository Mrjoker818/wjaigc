import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

describe('color adjustment canvas result', () => {
  it('uses the full documented hue range', () => {
    expect(source).toMatch(/min=\{-180\}\s+max=\{180\}\s+value=\{colorHue\}/);
  });

  it('labels the CSS rendering as an approximate preview', () => {
    expect(source).toContain('近似预览');
  });

  it('creates a separate processing result instead of replacing the source image', () => {
    const handler = source.slice(
      source.indexOf('const applyColorAdjust = useCallback'),
      source.indexOf('const handleConfirmColorAdjust = applyColorAdjust'),
    );

    expect(handler).toContain('createProcessingFrameRightOf');
    expect(handler).toContain('completeProcessingFrame');
    expect(handler).not.toContain('onImagesChange(images.map');
  });

  it('keeps a failed adjustment visible as a terminal frame instead of silently removing it', () => {
    const handler = source.slice(
      source.indexOf('const applyColorAdjust = useCallback'),
      source.indexOf('const handleConfirmColorAdjust = applyColorAdjust'),
    );

    expect(handler).toContain('buildFailedProcessingFrame');
    expect(handler).toContain('updateProcessingFrame(placeholderId, failure)');
    expect(handler).not.toContain('setTimeout(() => removeProcessingFrame(placeholderId), 5000)');
  });

  it('places the panel above workspace sidebars with a viewport-safe right edge', () => {
    const panelStart = source.indexOf('{/* ====== COLOR ADJUST PANEL');
    const panelEnd = source.indexOf('{/* ====== REMOVE BACKGROUND MODEL PICKER', panelStart);
    const panel = source.slice(panelStart, panelEnd);

    expect(panel).toContain('z-[180]');
    expect(panel).toContain("right: 'max(24px, env(safe-area-inset-right))'");
  });
});
