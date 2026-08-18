import { describe, expect, it } from 'vitest';
import {
  getVisibleWorkflowNodeIds,
  resolveWorkflowCullingBounds,
  selectVisibleWorkflowConnections,
} from '@/lib/node-canvas-virtualization';

describe('node canvas virtualization', () => {
  const nodes = [
    { id: 'left', x: 0, y: 0, width: 180, height: 120 },
    { id: 'middle', x: 620, y: 0, width: 180, height: 120 },
    { id: 'right', x: 2200, y: 0, width: 180, height: 120 },
  ];

  it('uses a compact idle overscan while preserving the larger pan corridor', () => {
    expect(resolveWorkflowCullingBounds(
      { x: 0, y: 0, zoom: 1 },
      { x: 0, y: 0, zoom: 1 },
      { width: 800, height: 600 },
      false,
    )).toEqual({ minX: 0, minY: 0, maxX: 800, maxY: 600 });

    expect(resolveWorkflowCullingBounds(
      { x: 0, y: 0, zoom: 1 },
      { x: -700, y: 0, zoom: 1 },
      { width: 800, height: 600 },
      true,
    )).toEqual({ minX: -400, minY: -300, maxX: 1900, maxY: 900 });
  });

  it('keeps the full pan corridor mounted while the transform previews ahead of React state', () => {
    const bounds = resolveWorkflowCullingBounds(
      { x: 0, y: 0, zoom: 1 },
      { x: -700, y: 0, zoom: 1 },
      { width: 800, height: 600 },
      true,
    );

    expect(getVisibleWorkflowNodeIds(nodes, bounds)).toEqual(new Set(['left', 'middle']));
  });

  it('keeps selected and actively dragged nodes rendered outside the viewport', () => {
    const bounds = resolveWorkflowCullingBounds(
      { x: 0, y: 0, zoom: 1 },
      { x: 0, y: 0, zoom: 1 },
      { width: 800, height: 600 },
      false,
    );

    expect(getVisibleWorkflowNodeIds(nodes, bounds, new Set(['right']), 'right'))
      .toEqual(new Set(['left', 'middle', 'right']));
  });

  it('renders only connections whose two endpoint nodes are mounted', () => {
    const visibleIds = new Set(['left', 'middle']);
    expect(selectVisibleWorkflowConnections([
      { id: 'left-middle', fromNodeId: 'left', toNodeId: 'middle' },
      { id: 'middle-right', fromNodeId: 'middle', toNodeId: 'right' },
    ], visibleIds).map(connection => connection.id)).toEqual(['left-middle']);
  });
});
