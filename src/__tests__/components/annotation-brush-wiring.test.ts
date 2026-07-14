import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('annotation brush wiring', () => {
  it('keeps the active annotation id synchronously available until the mask is exported', () => {
    expect(source).toContain('const brushDrawingAnnIdRef = useRef<string | null>(null);');
    expect(source).toContain('brushDrawingAnnIdRef.current = newAnn.id;');
    expect(source).toContain('const activeBrushAnnotationId = brushDrawingAnnIdRef.current;');
    expect(source).toContain('brushDrawingAnnIdRef.current = null;');
  });
});
