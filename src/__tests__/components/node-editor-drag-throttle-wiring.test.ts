import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');

describe('node editor drag throttling', () => {
  it('batches node drag updates per animation frame and flushes the final position', () => {
    expect(source).toContain('const nodeDragPositionRef = useRef');
    expect(source).toContain('const nodeDragRafRef = useRef<number | null>(null)');
    expect(source).toContain('const applyNodeDragPosition = useCallback');
    expect(source).toContain('if (nodeDragRafRef.current === null)');
    expect(source).toContain('applyNodeDragPosition(nodeDragPositionRef.current)');
  });
});
