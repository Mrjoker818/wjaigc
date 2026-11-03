import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUiSource, openingNodes, literalAttr, readUiAttr, variableInitializer, evaluateUi, uniqueNode, baseCssProperty } from '../helpers/ui-source-contracts';

const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');
const panelSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas/CanvasEditColorRemoveBgPanel.tsx'),
  'utf8',
);

describe('color adjustment canvas result', () => {
  it('uses the full documented hue range', () => {
    expect(panelSource).toMatch(/min=\{-180\}\s+max=\{180\}\s+value=\{colorHue\}/);
  });

  it('labels the CSS rendering as an approximate preview', () => {
    expect(panelSource).toContain('近似预览');
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

  it('places the panel above workspace sidebars with a viewport-safe right edge', async () => {
    const actual = parseUiSource(panelSource);
    const panel = uniqueNode(openingNodes(actual).filter(node =>
      literalAttr(node, 'data-floating-panel') === 'color-adjust'), 'COLOR_PANEL');
    expect((await baseCssProperty(String(readUiAttr(actual, panel, 'className')), 'z-index')).value).toBe('180');
    for (const [viewportWidth, right] of [
      [320, 'max(12px, env(safe-area-inset-right))'],
      [390, 'max(12px, env(safe-area-inset-right))'],
      [767, 'max(12px, env(safe-area-inset-right))'],
      [768, 'max(24px, env(safe-area-inset-right))'],
      [1024, 'max(24px, env(safe-area-inset-right))'],
    ] as const) {
      const isMobilePanel = evaluateUi(actual, variableInitializer(actual, 'isMobilePanel'), { viewportWidth });
      const style = readUiAttr(actual, panel, 'style', { isMobilePanel }) as Record<string, unknown>;
      expect(style.right).toBe(right);
      expect(style.top).toBe(viewportWidth < 768 ? 'max(12px, env(safe-area-inset-top))' : '120px');
      expect(style.width).toBe(viewportWidth < 768
        ? 'calc(100vw - max(12px, env(safe-area-inset-left)) - max(12px, env(safe-area-inset-right)))'
        : 'min(360px, calc(100vw - 48px))');
    }
  });
});
