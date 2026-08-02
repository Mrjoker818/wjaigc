import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('image edit source rendering contract', () => {
  it('loads the selected editing source directly instead of routing it through Next image optimization', () => {
    const editorStart = source.indexOf('{/* ====== ERASE/MASK FLOATING WINDOW ====== */}');
    const editorEnd = source.indexOf('{/* ====== COLOR ADJUST PANEL', editorStart);
    const editorSource = source.slice(editorStart, editorEnd);

    expect(editorSource).toContain('<img');
    expect(editorSource).toContain('src={editImg.url}');
    expect(editorSource).toContain('alt="edit"');
    expect(editorSource).not.toContain('<NextImage');
  });

  it('does not allow drawing or submission until the editing source has loaded', () => {
    const editorStart = source.indexOf('{/* ====== ERASE/MASK FLOATING WINDOW ====== */}');
    const editorEnd = source.indexOf('{/* ====== COLOR ADJUST PANEL', editorStart);
    const editorSource = source.slice(editorStart, editorEnd);

    expect(source).toContain("const [editSourceLoadState, setEditSourceLoadState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');");
    expect(source).toContain("setEditSourceLoadState('loading');");
    expect(editorSource).toContain("onLoad={() => setEditSourceLoadState('loaded')}");
    expect(editorSource).toContain("onError={() => setEditSourceLoadState('error')}");
    expect(editorSource).toContain("pointerEvents: editSourceLoadState === 'loaded' ? 'auto' : 'none'");
    expect(editorSource).toContain("disabled={editStrokes.length === 0 || isEditProcessing || editSourceLoadState !== 'loaded'}");
    expect(editorSource).toContain('图片加载失败，无法进行编辑');
  });
});
