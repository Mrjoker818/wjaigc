import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);
const removeBgPanelSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas/CanvasEditColorRemoveBgPanel.tsx'),
  'utf8',
);

describe('remove-background canvas output contract', () => {
  it('does not add the black-and-white mask to the canvas by default', () => {
    expect(canvasSource).toContain(
      'const [addRemoveBgMaskToCanvas, setAddRemoveBgMaskToCanvas] = useState(false);',
    );
    expect(canvasSource).toContain(
      'if (addRemoveBgMaskToCanvas && maskResultUrl && completedImage)',
    );
  });

  it('offers an accessible explicit mask-output control', () => {
    expect(removeBgPanelSource).toContain('aria-label="同时将黑白蒙版加入画布"');
    expect(removeBgPanelSource).toContain('checked={addRemoveBgMaskToCanvas}');
  });
});
