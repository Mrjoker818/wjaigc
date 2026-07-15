import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

describe('infinite canvas drag throttling', () => {
  it('uses requestAnimationFrame-backed refs for high-frequency drag previews', () => {
    for (const ref of ['brushRafRef', 'groupDragRafRef', 'genGroupDragRafRef', 'hexCubeDragRafRef']) {
      expect(source).toContain(`const ${ref} = useRef<number | null>(null)`);
      expect(source).toContain(`if (${ref}.current === null)`);
    }

    expect(source).toContain('groupDragOffsetRef.current');
    expect(source).toContain('genGroupDragOffsetRef.current');
    expect(source).toContain('hexCubeDragOffsetRef.current');
  });
});
