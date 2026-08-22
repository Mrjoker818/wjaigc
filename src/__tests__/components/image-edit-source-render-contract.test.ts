import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);
const eraseMaskPanelSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas/CanvasEditEraseMaskPanel.tsx'),
  'utf8',
);

describe('image edit source rendering contract', () => {
  it('loads the selected editing source directly instead of routing it through Next image optimization', () => {
    expect(eraseMaskPanelSource).toContain('<img');
    expect(eraseMaskPanelSource).toContain('src={editImg.url}');
    expect(eraseMaskPanelSource).toContain('alt="edit"');
    expect(eraseMaskPanelSource).not.toContain('<NextImage');
  });

  it('does not allow drawing or submission until the editing source has loaded', () => {
    expect(canvasSource).toContain("const [editSourceLoadState, setEditSourceLoadState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');");
    expect(canvasSource).toContain("setEditSourceLoadState('loading');");
    expect(eraseMaskPanelSource).toContain("onLoad={() => setEditSourceLoadState('loaded')}");
    expect(eraseMaskPanelSource).toContain("onError={() => setEditSourceLoadState('error')}");
    expect(eraseMaskPanelSource).toContain("pointerEvents: editSourceLoadState === 'loaded' ? 'auto' : 'none'");
    expect(eraseMaskPanelSource).toContain("disabled={editStrokes.length === 0 || isEditProcessing || editSourceLoadState !== 'loaded'}");
    expect(eraseMaskPanelSource).toContain('图片加载失败，无法进行编辑');
  });
});
