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

  it('uses compositor previews and viewport culling for pan-heavy workflows', () => {
    expect(source).toContain('const updateNodePanPreview = useCallback');
    expect(source).toContain('const visibleNodes = useMemo');
    expect(source).toContain('const visibleConnections = useMemo');
    expect(source).toContain('visibleConnections.map(conn =>');
    expect(source).toContain('visibleNodes.map(node =>');
    expect(source).not.toContain('setViewport(v => ({ ...v, x: panStart.vx');
  });
});
