import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');
const legacySurfaceSource = readFileSync(resolve(process.cwd(), 'src/components/workflow/WorkflowLegacySurface.tsx'), 'utf8');

describe('node editor drag throttling', () => {
  it('batches drag previews per animation frame and commits the final position once', () => {
    expect(source).toContain('const nodeDragPositionRef = useRef');
    expect(source).toContain('const nodeDragRafRef = useRef<number | null>(null)');
    expect(source).toContain('const applyNodeDragPosition = useCallback');
    expect(source).toContain('if (nodeDragRafRef.current === null)');
    expect(source).toContain('const finalPosition = nodeDragPositionRef.current');
    expect(source).toContain("type: 'nodes.drag.commit'");
    expect(source).toContain('initialPositions: nodeDragInitialPositionsRef.current');
    expect(source).not.toContain('}, dragStartWorkflow);');
    expect(source).not.toContain('applyNodeDragPosition(nodeDragPositionRef.current)');
  });

  it('precomputes nondeterministic workflow values before reducer dispatch', () => {
    const updateBlocks = [...source.matchAll(/updateWorkflow\(prev => \{([\s\S]*?)\n\s*\}\);/g)]
      .map(match => match[1]);

    expect(updateBlocks.join('\n')).not.toMatch(/createConnection\(|Date\.now\(|Math\.random\(/);
  });

  it('uses compositor previews and viewport culling for pan-heavy workflows', () => {
    expect(source).toContain('const updateNodePanPreview = useCallback');
    expect(source).toContain('const visibleNodeIds = useMemo');
    expect(source).toContain('visibleNodeIds={visibleNodeIds}');
    expect(source).not.toContain('visibleConnections={visibleConnections}');
    expect(source).not.toContain('visibleNodes={visibleNodes}');
    expect(legacySurfaceSource).toContain('model.nodes.filter(node => visibleNodeIds.has(node.id))');
    expect(legacySurfaceSource).toContain('model.edges.filter(edge =>');
    expect(source).not.toContain('setViewport(v => ({ ...v, x: panStart.vx');
  });

  it('defers parent workflow synchronization until after node drag state updates render', () => {
    expect(source).toContain('const [workflowSyncRevision, setWorkflowSyncRevision] = useState(0)');
    expect(source).toContain('setWorkflowSyncRevision(revision => revision + 1)');
    expect(source).toContain('}, [wf, workflowSyncRevision]);');
    expect(source).not.toContain('onWorkflowChange?.(currentWf);');
  });
});
